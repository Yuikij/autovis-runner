#!/usr/bin/env node
// 真实端到端验证：用真实 runner 会话 + 真实 LLM（本地 DB 里已连接的配置）跑一篇真实 arXiv
// agent-memory 论文，产出「全文双语对照 + 详细解读」的 HTML 报告（report.html 落盘成产物）。
//
// 忠实复刻生产路径：page / ai.generate / report 全走真实运行时；generateText 用 server 的
// generateTextWithLlm + 本地 DB 的 active LLM 配置（apiKey 不打印）。
//
//   node scripts/verify-paper.mjs
//
import { execFileSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createExecutionTemplate,
  createRunnerSession,
  executeScriptInSession,
  finalizeRunnerSession,
} from "../packages/runner/dist/index.js"
import { generateTextWithLlm } from "../apps/server/dist/llm.js"

// 1) 从本地 DB 取 active LLM 配置（session + secrets）。不打印 secrets。
const dbPath = join(process.cwd(), "data/autovis.db")
const raw = execFileSync("sqlite3", ["-json", dbPath, "SELECT configs_json, llm_secrets_json FROM llm_states LIMIT 1;"], { encoding: "utf-8" })
const row = JSON.parse(raw)[0]
const outer = JSON.parse(row.configs_json)
const allSecrets = row.llm_secrets_json ? JSON.parse(row.llm_secrets_json) : {}
const activeId = outer.activeConfigId
const cfg = outer.configs.find((c) => c.session?.id === activeId)
if (!cfg) throw new Error("未找到 active LLM 配置")
// 真 secrets 存在独立列 llm_secrets_json[configId]，configs[].secrets 是占位。
const active = { session: cfg.session, secrets: allSecrets[activeId] ?? cfg.secrets ?? {} }
if (!active.secrets?.apiKey && !active.secrets?.copilot) throw new Error("active 配置没有可用密钥")
console.log(`使用 LLM: ${active.session.name} / ${active.session.model} (${active.session.provider})`)

let genCalls = 0
const generateText = async (prompt, systemPrompt) => {
  genCalls += 1
  const t0 = Date.now()
  const text = await generateTextWithLlm({ prompt, systemPrompt, session: active.session, secrets: active.secrets })
  console.log(`  · ai.generate #${genCalls} ←(${prompt.length}字, ${Date.now() - t0}ms) →${text.length}字`)
  return text
}

// 2) 生成脚本正文（架构里 LLM 该产出的脚本）：搜 arXiv → 取全文 → 逐节双语 → 解读 → report.html
const scriptCode = String.raw`
// --- a) 搜 arXiv：agent memory，按相关度取候选 ---
const atom = await http.get("https://export.arxiv.org/api/query", {
  params: { search_query: 'all:"agent memory"', start: "0", max_results: "8", sortBy: "relevance" },
})
const entries = [...String(atom).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
  const e = m[1]
  const pick = (tag) => (e.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"))?.[1] ?? "").replace(/\s+/g, " ").trim()
  const idUrl = pick("id")
  const arxivId = (idUrl.match(/abs\/([^\s<]+)$/) ?? [])[1] ?? ""
  return { title: pick("title"), summary: pick("summary"), arxivId }
}).filter((x) => x.arxivId)
await outputs.add("arXiv 候选", entries.map((e) => e.title))

// --- b) 挑第一篇能拿到 HTML 全文的（arxiv.org/html 优先，ar5iv 兜底）---
let chosen = null
for (const e of entries) {
  for (const url of ["https://arxiv.org/html/" + e.arxivId, "https://ar5iv.org/abs/" + e.arxivId.replace(/v\d+$/, "")]) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 })
      const secCount = await page.locator("section, .ltx_section").count()
      if (secCount >= 2) { chosen = { ...e, url }; break }
    } catch {}
  }
  if (chosen) break
}
if (!chosen) throw new Error("候选论文都拿不到 HTML 全文")
await temp.store("选中论文", "chosen", async () => chosen.title)

// --- c) 抽取标题 + 各 section（标题 + 正文文本）---
const paper = await page.evaluate(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim()
  const title = clean(document.querySelector("h1.ltx_title, h1.ltx_title_document, h1")?.textContent)
  const secs = [...document.querySelectorAll("section.ltx_section, section")]
    .map((sec) => {
      const heading = clean(sec.querySelector("h2, h3, .ltx_title")?.textContent)
      const text = clean([...sec.querySelectorAll("p, .ltx_para")].map((p) => p.textContent).join("\n"))
      return { heading, text }
    })
    .filter((s) => s.text.length > 120)
  return { title, secs }
})
await step("抽取论文结构", "拿到标题与 " + paper.secs.length + " 个有效 section", async () => {})

// --- d) 逐节双语翻译（section 级切分；跳过参考文献；为本次验证最多取前 6 节）---
const skip = /reference|acknowledg|appendix|bibliography|致谢|参考文献/i
const target = paper.secs.filter((s) => !skip.test(s.heading)).slice(0, 6)
const rows = []
for (const sec of target) {
  const src = sec.text.slice(0, 5000)
  const zh = await ai.generate(
    "把下面这一节学术论文内容完整翻译成流畅中文，保留术语准确性，只输出译文：\n\n" + (sec.heading ? sec.heading + "\n" : "") + src,
    "你是 AI/机器学习领域的学术翻译，输出地道中文，不要解释、不要加标题。",
  )
  rows.push({ heading: sec.heading, en: src, zh })
}

// --- e) 详细解读（喂标题 + 摘要 + 各节标题 + 首节内容）---
const insight = await ai.generate(
  "论文标题：" + paper.title + "\n\n摘要：" + chosen.summary + "\n\n章节：" + paper.secs.map((s) => s.heading).filter(Boolean).join("; ") +
    "\n\n请用中文写一份详细解读，包含：1) 这篇在解决什么问题、为什么重要；2) 核心方法/机制；3) 主要贡献与结论；4) 局限与可质疑处；5) 对做 agent / 浏览器自动化的人有什么可借鉴。用带小标题的 HTML 片段输出（h3 + p/ul），不要 <html> 外壳。",
  "你是资深 AI 研究员，解读犀利、具体、避免空话。",
)

// --- f) 组装报告并落盘成产物 ---
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const bilingual = rows.map((r) =>
  '<h3>' + esc(r.heading || "(无标题节)") + '</h3>' +
  '<table class="bi"><tr><th>原文</th><th>中文</th></tr>' +
  '<tr><td>' + esc(r.en) + '</td><td>' + esc(r.zh) + '</td></tr></table>'
).join("\n")

const html =
  '<script>window.MathJax={tex:{inlineMath:[["$","$"]]}};</' + 'script>' +
  '<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></' + 'script>' +
  '<style>.bi{width:100%;border-collapse:collapse;margin:.5rem 0 1.5rem}.bi th,.bi td{border:1px solid #ddd;padding:10px;vertical-align:top;width:50%}.bi th{background:#fafafa;text-align:left}.meta{color:#666;font-size:14px}</style>' +
  '<h1>' + esc(paper.title) + '</h1>' +
  '<p class="meta">arXiv: ' + esc(chosen.arxivId) + ' · 来源 <a href="' + esc(chosen.url) + '">' + esc(chosen.url) + '</a> · 本次翻译 ' + rows.length + ' / ' + paper.secs.length + ' 节</p>' +
  '<h2>详细解读</h2>' + insight +
  '<h2>全文双语对照</h2>' + bilingual

const reportUrl = await report.html(paper.title, html)
await outputs.add("论文双语报告", { title: paper.title, arxivId: chosen.arxivId, reportUrl, sectionsTranslated: rows.length })
`

const artifactsDir = await mkdtemp(join(tmpdir(), "autovis-paper-"))
const runId = "paper_" + Math.random().toString(36).slice(2, 10)
const project = { id: "p1", name: "paper", testBaseUrl: "https://arxiv.org" }
const testCase = { id: "tc1", caseCode: "PAPER-001" }
const script = { id: "s1", testCaseId: "tc1", version: 1, source: "manual", provider: "openai-compatible", prompt: "", code: scriptCode, createdAt: new Date().toISOString() }

const run = createExecutionTemplate({ runId, project, testCase, script, testBaseUrl: project.testBaseUrl })
const onUpdate = () => {}

const started = Date.now()
let session
try {
  session = await createRunnerSession({ run, artifactsDir, headless: true, onUpdate, initStepIndex: 0 })
  await executeScriptInSession({
    run, session, script, onUpdate,
    requestHumanInput: async () => "",
    analyzeImage: async () => "",
    generateText,
    stepIndex: 1,
    startedLog: "开始论文双语+解读",
    completedLog: "完成",
    screenshotFilePrefix: "paper",
    timeoutMs: 30 * 60 * 1000,
  })
  const archiveStepIndex = run.steps.findIndex((s) => s.kind === "archive")
  await finalizeRunnerSession({ run, session, onUpdate, archiveStepIndex })
  session = null
} catch (err) {
  console.error("执行失败:", err?.message || err)
} finally {
  if (session) await finalizeRunnerSession({ run, session, onUpdate, archiveStepIndex: 2 }).catch(() => {})
}

const reportArtifact = (run.artifacts ?? []).find((a) => a.kind === "report")
console.log("\n=== 结果 ===")
console.log("耗时:", Math.round((Date.now() - started) / 1000) + "s, ai.generate 调用:", genCalls)
console.log("产物:", JSON.stringify(run.artifacts, null, 2))
if (reportArtifact) {
  console.log("报告文件:", join(artifactsDir, runId, reportArtifact.name))
}
process.exit(reportArtifact ? 0 : 1)
