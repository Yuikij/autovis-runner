#!/usr/bin/env node
// 最小端到端 demo：证明 "抓页面 → ai.generate 翻译/解读 → report.html 出富产物 → http.post 推链接"
// 这条链在真实 runner 脚本执行路径（script-executor）上跑通，且报告产物能挺过 finalize 的磁盘重扫。
//
// 不需要真实 LLM key：generateText 用 stub 注入（真实运行时由 run.service 的
// generateTextWithCurrentLlm 提供）。page / ai.generate / report / http 全部走真实运行时。
//
//   node scripts/demo-ai-generate.mjs
//
import http from "node:http"
import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createExecutionTemplate,
  createRunnerSession,
  executeScriptInSession,
  finalizeRunnerSession,
} from "../packages/runner/dist/index.js"

const received = []

// 1) 本地 server：既当被抓取的目标页，又当 webhook 接收端。
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      received.push(JSON.parse(body))
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
    return
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><html><body>
    <h1 id="headline">AutoVis 每日早报</h1>
    <article id="news">今天 runner 新增了 ai.generate 与 report.html，定时脚本现在能总结内容并产出可查看的 HTML 报告。</article>
  </body></html>`)
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

// 2) stub 文本生成：真实环境由 LLM 提供；这里按 systemPrompt 返回可断言的确定性结果。
const generateText = async (prompt, systemPrompt) => {
  return `[gen|sys=${systemPrompt ?? "none"}] ${prompt.slice(0, 24)}…`
}

// 3) 被定时执行的「保存好的脚本」正文：page 读取 → ai.generate 翻译+解读 → report.html → http.post 推链接。
const scriptCode = `
const headline = await page.locator('#headline').innerText()
const news = await page.locator('#news').innerText()
const zh = await ai.generate(news, '翻译成中文，只输出译文')
const insight = await ai.generate(news, '你是科研助理，用要点解读')
const reportUrl = await report.html(headline, \`
  <h1>\${headline}</h1>
  <h2>原文 / 译文对照</h2>
  <table border="1" cellpadding="8"><tr><td>\${news}</td><td>\${zh}</td></tr></table>
  <h2>解读</h2>
  <div>\${insight}</div>
\`)
await http.post('${baseUrl}/webhook', { data: { headline, reportUrl } })
`

const artifactsDir = await mkdtemp(join(tmpdir(), "autovis-demo-"))
const runId = "demo_" + Math.random().toString(36).slice(2, 10)
const project = { id: "p1", name: "demo", testBaseUrl: baseUrl }
const testCase = { id: "tc1", caseCode: "DEMO-001" }
const script = { id: "s1", testCaseId: "tc1", version: 1, source: "manual", provider: "copilot-proxy", prompt: "", code: scriptCode, createdAt: new Date().toISOString() }

const run = createExecutionTemplate({ runId, project, testCase, script, testBaseUrl: baseUrl })
const onUpdate = () => {}

let session
let ok = false
try {
  session = await createRunnerSession({ run, artifactsDir, headless: true, onUpdate, initStepIndex: 0 })
  await executeScriptInSession({
    run,
    session,
    script,
    onUpdate,
    requestHumanInput: async () => "",
    analyzeImage: async () => "",
    generateText, // ← line 1 注入点
    stepIndex: 1,
    startedLog: "demo 开始",
    completedLog: "demo 完成",
    screenshotFilePrefix: "demo",
    timeoutMs: 60_000,
  })
  // 关键：finalize 会按磁盘重扫重建 run.artifacts，验证 report 产物不被丢弃。
  const archiveStepIndex = run.steps.findIndex((s) => s.kind === "archive")
  await finalizeRunnerSession({ run, session, onUpdate, archiveStepIndex })
  session = null
  ok = true
} catch (err) {
  console.error("脚本执行失败:", err)
} finally {
  if (session) await finalizeRunnerSession({ run, session, onUpdate, archiveStepIndex: 2 }).catch(() => {})
  server.close()
}

console.log("\n=== webhook 收到 ===")
console.log(JSON.stringify(received, null, 2))
console.log("=== run.artifacts（finalize 后）===")
console.log(JSON.stringify(run.artifacts, null, 2))

const got = received[0]
const reportArtifact = (run.artifacts ?? []).find((a) => a.kind === "report" && a.name.endsWith(".html"))

// 读回落盘的报告文件，验证内容与自动补的 utf-8 包裹。
let fileOk = false
if (reportArtifact) {
  const fileContent = await readFile(join(artifactsDir, runId, reportArtifact.name), "utf-8").catch(() => "")
  fileOk =
    fileContent.includes("AutoVis 每日早报") &&
    fileContent.includes('<meta charset="utf-8">') &&
    fileContent.includes("原文 / 译文对照") &&
    fileContent.includes("解读")
}

const pass =
  ok &&
  got &&
  got.headline === "AutoVis 每日早报" &&
  typeof got.reportUrl === "string" &&
  got.reportUrl === `/artifacts/${runId}/${reportArtifact?.name}` &&
  reportArtifact &&
  fileOk

console.log(`\n结果: ${pass ? "✅ 链路打通（page → ai.generate → report.html → http.post），report 产物挺过 finalize 重扫且内容/编码正确" : "❌ 失败"}`)
process.exit(pass ? 0 : 1)
