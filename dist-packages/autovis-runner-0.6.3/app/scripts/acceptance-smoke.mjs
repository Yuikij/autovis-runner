#!/usr/bin/env node
// Deterministic acceptance smoke test for an already-running AutoVis server.
//
// It is intentionally read-only and side-effect free: it verifies that the
// operational surface (/health, /ready, /metrics) is healthy and that the core
// read endpoints the UI depends on (including the scope-targeted refresh
// endpoints) respond with the expected shapes. This gives a repeatable
// "is the system acceptable right now?" gate without flaky end-to-end flows.
//
// Usage:
//   node scripts/acceptance-smoke.mjs [--base http://localhost:8787] [--timeout 30000]
//
// Env overrides:
//   BASE_URL                       base server URL (default http://localhost:8787)
//   AUTOVIS_SESSION_COOKIE         cookie value, e.g. "autovis_session=..." (when auth is enabled)
//   AUTOVIS_ACCEPTANCE_TIMEOUT_MS  how long to wait for /ready (default 30000)

const args = process.argv.slice(2)
const getArg = (flag) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const baseUrl = (getArg("--base") ?? process.env.BASE_URL ?? "http://localhost:8787").replace(/\/$/, "")
const readyTimeoutMs = Number(getArg("--timeout") ?? process.env.AUTOVIS_ACCEPTANCE_TIMEOUT_MS ?? 30000)
const sessionCookie = process.env.AUTOVIS_SESSION_COOKIE ?? ""

const headers = sessionCookie ? { cookie: sessionCookie } : {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  return { status: res.status, ok: res.ok, json, text }
}

async function fetchText(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers })
  const text = await res.text()
  return { status: res.status, ok: res.ok, text }
}

const isArrayResponse = (value) => Array.isArray(value) || Array.isArray(value?.data)
const dataOf = (value) => (Array.isArray(value) ? value : value?.data)

// Wait for readiness so the run is deterministic even right after a cold boot.
async function waitForReady() {
  const deadline = Date.now() + readyTimeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      const res = await fetchJson("/api/ready")
      last = res
      if (res.status === 200 && res.json?.ready) return res
    } catch (reason) {
      last = { status: 0, json: { error: String(reason) } }
    }
    await sleep(1000)
  }
  return last
}

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  const tag = ok ? "PASS" : "FAIL"
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ""}`)
}

async function main() {
  console.log(`AutoVis acceptance smoke → ${baseUrl}`)

  // 1. operational surface
  const health = await fetchJson("/api/health").catch((reason) => ({ status: 0, json: { error: String(reason) } }))
  record("health", health.status === 200 && health.json?.status === "ok", `status=${health.status}`)

  const ready = await waitForReady()
  const reasons = ready?.json?.reasons ?? ready?.json?.blockers ?? ready?.json
  record(
    "ready",
    ready?.status === 200 && Boolean(ready?.json?.ready),
    ready?.status === 200 ? `ready=${ready?.json?.ready}` : `status=${ready?.status} ${JSON.stringify(reasons)}`,
  )

  const metrics = await fetchText("/api/metrics").catch((reason) => ({ status: 0, text: String(reason) }))
  record("metrics", metrics.status === 200 && metrics.text.includes("autovis_ready"), `status=${metrics.status}`)

  // 2. core read endpoints used by the UI
  const projects = await fetchJson("/api/projects").catch((reason) => ({ status: 0, json: { error: String(reason) } }))
  record("projects.list", projects.status === 200 && isArrayResponse(projects.json), `status=${projects.status}`)

  const testCases = await fetchJson("/api/test-cases").catch((reason) => ({ status: 0, json: undefined }))
  record("testCases.listAll", testCases.status === 200 && isArrayResponse(testCases.json), `status=${testCases.status}`)

  const llm = await fetchJson("/api/llm/state").catch((reason) => ({ status: 0, json: undefined }))
  record("llm.state", llm.status === 200 && Boolean(llm.json?.data?.session ?? llm.json?.session), `status=${llm.status}`)

  const dashboard = await fetchJson("/api/dashboard").catch(() => ({ status: 0 }))
  record("dashboard", dashboard.status === 200, `status=${dashboard.status}`)

  // 3. per-project resource endpoints (these are exactly what the refresh
  //    coordinator hits on terminal events — verifies the scope-targeted paths).
  const firstProject = dataOf(projects.json)?.[0]
  if (firstProject?.id) {
    const pid = encodeURIComponent(firstProject.id)
    const checks = [
      ["projects.tasks", `/api/projects/${pid}/tasks`],
      ["projects.runs", `/api/projects/${pid}/runs`],
      ["projects.taskRuns", `/api/projects/${pid}/task-runs`],
      ["projects.recorderSessions", `/api/projects/${pid}/recorder-sessions`],
      ["projects.modules", `/api/projects/${pid}/modules`],
      ["projects.testCases", `/api/projects/${pid}/test-cases`],
    ]
    for (const [name, path] of checks) {
      const res = await fetchJson(path).catch(() => ({ status: 0, json: undefined }))
      record(name, res.status === 200 && isArrayResponse(res.json), `status=${res.status}`)
    }
  } else {
    console.log("[SKIP] per-project endpoints — no project exists yet")
  }

  const failed = results.filter((item) => !item.ok)
  console.log("")
  console.log(`Summary: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((item) => item.name).join(", ")}`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((reason) => {
  console.error("acceptance smoke crashed:", reason)
  process.exit(1)
})
