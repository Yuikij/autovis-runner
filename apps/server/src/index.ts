import { modulesRoutes } from "./routes/modules.js"
import { gitAuthRoutes } from "./routes/gitAuth.js"
import { recorderRoutes } from "./routes/recorder.js"
import { agentRoutes } from "./routes/agent.js"
import { llmRoutes } from "./routes/llm.js"
import { runsRoutes } from "./routes/runs.js"
import { outboxRoutes } from "./routes/outbox.js"
import { tasksRoutes } from "./routes/tasks.js"
import { testCasesRoutes } from "./routes/testCases.js"
import { projectsRoutes } from "./routes/projects.js"
import { dashboardRoutes } from "./routes/dashboard.js"
import { authProfilesRoutes } from "./routes/authProfiles.js"
import { authLoginSandboxRoutes } from "./routes/authLoginSandbox.js"
import { scheduleTriggersRoutes } from "./routes/scheduleTriggers.js"
import { authRoutes } from "./routes/auth.js"
import { authEnabled, registerAuthHook } from "./auth.js"
import websocket from "@fastify/websocket"
import cors from "@fastify/cors"
import multipart from "@fastify/multipart"
import fastifyStatic from "@fastify/static"
import Fastify from "fastify"
import { randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, stat } from "node:fs/promises"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { startCloudClient } from "./cloud-client.js"
import { log } from "./log.js"
import { renderObservabilityMetrics } from "./observability.js"
import { store } from "./store.js"

const port = Number(process.env.PORT ?? 8787)
const appOrigin = process.env.APP_ORIGIN ?? `http://localhost:${port}`
const allowAnyCorsOrigin = process.env.NODE_ENV !== "production"
const allowInsecureNoAuth = ["1", "true", "yes", "on"].includes((process.env.AUTOVIS_ALLOW_INSECURE_NO_AUTH ?? "").toLowerCase())

const isLocalOrigin = (origin: string) => {
  try {
    const url = new URL(origin)
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  } catch {
    return false
  }
}

if (process.env.NODE_ENV === "production" && !authEnabled) {
  log.warn("auth.production_disabled", {
    appOrigin,
    allowInsecureNoAuth,
  })

  if (!isLocalOrigin(appOrigin) && !allowInsecureNoAuth) {
    log.error("auth.production_insecure_start_blocked", {
      appOrigin,
      hint: "Set AUTOVIS_AUTH_ENABLED=true or AUTOVIS_ALLOW_INSECURE_NO_AUTH=true to continue.",
    })
    process.exit(1)
  }
}

const app = Fastify({
  logger: {
    level: process.env.AUTOVIS_LOG_LEVEL ?? "info",
  },
  disableRequestLogging: true,
  requestIdHeader: "x-request-id",
  genReqId(request) {
    const header = request.headers["x-request-id"]
    return typeof header === "string" && header.trim() ? header.trim() : randomUUID()
  },
})
const currentDir = dirname(fileURLToPath(import.meta.url))
const webDistDir = join(currentDir, "../../web/dist")
const artifactRoot = process.env.DATA_DIR ? join(process.env.DATA_DIR, "artifacts") : join(currentDir, "../../../data/artifacts")
const legacyArtifactRoot = process.env.DATA_DIR ? null : join(currentDir, "../../../../data/artifacts")
const artifactRoots = Array.from(new Set([artifactRoot, legacyArtifactRoot].filter((value): value is string => Boolean(value))))

await mkdir(artifactRoot, { recursive: true })

const contentTypeByExt: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".zip": "application/zip",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
}

const resolveArtifactFile = async (relativePath: string) => {
  const normalizedPath = relativePath.replace(/^\/+/, "")

  for (const root of artifactRoots) {
    const absoluteRoot = resolve(root)
    const filePath = resolve(absoluteRoot, normalizedPath)
    if (filePath !== absoluteRoot && !filePath.startsWith(`${absoluteRoot}${sep}`)) {
      continue
    }

    const fileStat = await stat(filePath).catch(() => null)
    if (fileStat?.isFile()) {
      return { filePath, fileStat }
    }
  }

  return null
}

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowAnyCorsOrigin) {
      callback(null, true)
      return
    }
    // 允许 Chrome 扩展（登录态采集插件）跨源调用：插件 popup 的 Origin 形如 chrome-extension://<id>。
    if (origin.startsWith("chrome-extension://")) {
      callback(null, true)
      return
    }
    callback(null, origin === appOrigin)
  },
  credentials: true,
})

await app.register(websocket)
await app.register(multipart)
registerAuthHook(app, (token) => store.resolveUserBySessionToken(token))

app.addHook("onRequest", async (request, reply) => {
  reply.header("x-request-id", request.id)
})

app.setErrorHandler((error, request, reply) => {
  const candidate = error as { statusCode?: number; message?: string }
  const requestContext = {
    requestId: request.id,
    method: request.method,
    url: request.url,
  }

  if (typeof candidate.statusCode === "number") {
    request.log.warn({ err: error, ...requestContext, statusCode: candidate.statusCode }, "request failed")
    reply.code(candidate.statusCode).send({
      message: candidate.message ?? "Request failed",
    })
    return
  }

  const fallbackMessage = error instanceof Error ? error.message : "Unknown server error"

  request.log.error({ err: error, ...requestContext, statusCode: 500 }, "request failed")

  reply.code(500).send({
    message: fallbackMessage,
  })
})

app.route({
  method: ["GET", "HEAD"],
  url: "/artifacts/*",
  async handler(request, reply) {
    const relativePath = typeof request.params === "object" && request.params && "*" in request.params
      ? String((request.params as { "*": string })["*"] ?? "")
      : ""

    const resolved = await resolveArtifactFile(relativePath)
    if (!resolved) {
      reply.code(404).send({ message: "Not Found" })
      return
    }

    const contentType = contentTypeByExt[extname(resolved.filePath).toLowerCase()] ?? "application/octet-stream"
    reply.header("cache-control", "public, max-age=60")
    reply.header("accept-ranges", "bytes")
    reply.type(contentType)

    if (request.method === "HEAD") {
      reply.header("content-length", String(resolved.fileStat.size))
      return reply.send()
    }

    const rangeHeader = request.headers.range
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-")
      const start = parseInt(parts[0], 10)
      let end = parts[1] ? parseInt(parts[1], 10) : resolved.fileStat.size - 1

      if (!isNaN(start) && !isNaN(end)) {
        if (start >= resolved.fileStat.size) {
          reply.status(416).header("content-range", `bytes */${resolved.fileStat.size}`).send()
          return
        }

        const chunkSize = end - start + 1
        reply.status(206)
          .header("content-range", `bytes ${start}-${end}/${resolved.fileStat.size}`)
          .header("content-length", String(chunkSize))
        
        return reply.send(createReadStream(resolved.filePath, { start, end }))
      }
    }

    reply.header("content-length", String(resolved.fileStat.size))
    return reply.send(createReadStream(resolved.filePath))
  },
})

await app.register(fastifyStatic, {
  root: webDistDir,
  wildcard: false,
  decorateReply: false,
})

const metricsLines = (values: ReturnType<typeof store.getMetricsSnapshot>) => {
  const memory = process.memoryUsage()
  const baseLines = [
    "# HELP autovis_ready Runner readiness state.",
    "# TYPE autovis_ready gauge",
    `autovis_ready ${values.ready}`,
    "# HELP autovis_schema_version Current database schema version.",
    "# TYPE autovis_schema_version gauge",
    `autovis_schema_version ${values.schemaVersion}`,
    "# HELP autovis_uptime_seconds Runner uptime in seconds.",
    "# TYPE autovis_uptime_seconds gauge",
    `autovis_uptime_seconds ${values.uptimeSeconds}`,
    "# HELP autovis_projects_total Persisted project count.",
    "# TYPE autovis_projects_total gauge",
    `autovis_projects_total ${values.projectsTotal}`,
    "# HELP autovis_runs_active_total Active execution run count.",
    "# TYPE autovis_runs_active_total gauge",
    `autovis_runs_active_total ${values.activeRuns}`,
    "# HELP autovis_task_runs_active_total Active task-run count.",
    "# TYPE autovis_task_runs_active_total gauge",
    `autovis_task_runs_active_total ${values.activeTaskRuns}`,
    "# HELP autovis_agents_active_total Active agent session count.",
    "# TYPE autovis_agents_active_total gauge",
    `autovis_agents_active_total ${values.activeAgents}`,
    "# HELP autovis_recorders_active_total Active recorder session count.",
    "# TYPE autovis_recorders_active_total gauge",
    `autovis_recorders_active_total ${values.activeRecorders}`,
    "# HELP autovis_task_leases_active_total Active task lease count.",
    "# TYPE autovis_task_leases_active_total gauge",
    `autovis_task_leases_active_total ${values.activeLeases}`,
    "# HELP autovis_task_leases_recovering_total Recovering task lease count.",
    "# TYPE autovis_task_leases_recovering_total gauge",
    `autovis_task_leases_recovering_total ${values.recoveringLeases}`,
    "# HELP autovis_task_leases_expired_total Expired active task lease count.",
    "# TYPE autovis_task_leases_expired_total gauge",
    `autovis_task_leases_expired_total ${values.expiredActiveLeases}`,
    "# HELP process_resident_memory_bytes Resident set size in bytes.",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${memory.rss}`,
    "# HELP process_heap_used_bytes V8 heap used in bytes.",
    "# TYPE process_heap_used_bytes gauge",
    `process_heap_used_bytes ${memory.heapUsed}`,
  ]

  const extraMetrics = renderObservabilityMetrics()
  return [...baseLines, extraMetrics].filter((item) => item.length > 0).join("\n")
}

for (const path of ["/health", "/api/health"]) {
  app.get(path, async (request, reply) => {
    reply.header("cache-control", "no-store")
    return {
      status: "ok",
      requestId: request.id,
      uptimeSeconds: Math.floor(process.uptime()),
    }
  })
}

for (const path of ["/ready", "/api/ready"]) {
  app.get(path, async (_, reply) => {
    reply.header("cache-control", "no-store")
    const readiness = store.getReadinessSnapshot()
    reply.code(readiness.ready ? 200 : 503)
    return readiness
  })
}

for (const path of ["/metrics", "/api/metrics"]) {
  app.get(path, async (_, reply) => {
    reply.header("cache-control", "no-store")
    reply.type("text/plain; version=0.0.4; charset=utf-8")
    return metricsLines(store.getMetricsSnapshot())
  })
}

await app.register(async (api) => {
  await api.register(authRoutes)
  await api.register(dashboardRoutes)
  await api.register(projectsRoutes)
  await api.register(testCasesRoutes)
  await api.register(tasksRoutes)
  await api.register(runsRoutes)
  await api.register(outboxRoutes)
  await api.register(llmRoutes)
  await api.register(agentRoutes)
  await api.register(recorderRoutes)
  await api.register(gitAuthRoutes)
  await api.register(modulesRoutes)
  await api.register(authProfilesRoutes)
  await api.register(authLoginSandboxRoutes)
  await api.register(scheduleTriggersRoutes)
}, { prefix: "/api" })

const indexHtmlPath = join(webDistDir, "index.html")
const indexHtmlExists = await stat(indexHtmlPath).then(() => true).catch(() => false)

app.setNotFoundHandler((request, reply) => {
  const url = request.raw.url ?? ""
  const isApi = url.startsWith("/api/") || url === "/api"
  const isArtifact = url.startsWith("/artifacts/")
  const isOperational = url === "/health" || url === "/ready" || url === "/metrics" || url === "/api/health" || url === "/api/ready" || url === "/api/metrics"
  const isGet = request.method === "GET"

  if (!isGet || isApi || isArtifact || isOperational || !indexHtmlExists) {
    reply.code(404).send({ message: "Not Found" })
    return
  }

  reply.type("text/html").send(createReadStream(indexHtmlPath))
})

process.on("uncaughtException", (error) => {
  log.error("process.uncaught_exception", { error })
})

process.on("unhandledRejection", (reason, promise) => {
  log.error("process.unhandled_rejection", { reason })
})

app.listen({ port, host: "0.0.0.0" })
  .then((address) => {
    if (process.env.AUTOVIS_CLOUD_URL && process.env.AUTOVIS_DEVICE_TOKEN) {
      startCloudClient({
        cloudUrl: process.env.AUTOVIS_CLOUD_URL,
        deviceToken: process.env.AUTOVIS_DEVICE_TOKEN,
        localOrigin: appOrigin,
        runnerVersion: process.env.AUTOVIS_RUNNER_VERSION,
      })
    }
    log.info("server.started", { address, appOrigin, port })
  })
  .catch((error) => {
    log.error("server.start_failed", { error, port })
    process.exit(1)
  })
