import { type ToolDefinition } from "../../llm.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"
import { writeReportArtifact } from "./report.js"

export const translateDocumentTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "translate_document",
      description:
        "把当前页面（或给定 url）的长正文做**全文中英对照**并落成报告产物。它会自动抽取页面所有章节、**逐段循环翻译**（保证全覆盖、不截断），再拼成原文/译文并排的 HTML 保存。" +
        "**全文翻译这种穷举任务必须用它**，不要自己在一次回复里手写整篇翻译（会被输出长度截断）。可选 includeInsight 让它额外生成一段中文深度解读放在报告开头。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要翻译的页面 URL；缺省用当前页面。论文优先用全文 HTML 版（如 arxiv.org/html/<id>）" },
          title: { type: "string", description: "报告标题。缺省取页面 <h1>" },
          targetLang: { type: "string", description: "目标语言，缺省「中文」" },
          maxSections: { type: "number", description: "最多翻译多少个章节（防超长），缺省 12" },
          includeInsight: { type: "boolean", description: "是否在报告开头附一段中文深度解读，缺省 true" },
          category: { type: "string", description: "收件箱分类，缺省「论文」" },
          summary: { type: "string", description: "收件箱卡片一句话摘要" },
        },
      },
    },
  },
]

interface Section { heading: string; text: string }

export async function executeTranslateDocument(
  ctx: ToolRuntimeContext,
  args: { url?: string; title?: string; targetLang?: string; maxSections?: number; includeInsight?: boolean; category?: string; summary?: string },
): Promise<ToolExecutionResult> {
  if (!ctx.page) return { stage: "page", content: "translate_document 不可用：浏览器未初始化。" }
  if (!ctx.generateText) return { stage: "page", content: "translate_document 不可用：未启用文本生成能力。" }
  if (!ctx.runDir) return { stage: "page", content: "translate_document 不可用：没有 run 产物目录。" }

  const targetLang = args.targetLang?.trim() || "中文"
  const maxSections = Math.max(1, Math.min(args.maxSections ?? 12, 30))

  if (args.url) {
    await ctx.page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined)
    await ctx.page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
  }

  const paper = await ctx.page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim()
    const title = clean(document.querySelector("h1.ltx_title, h1.ltx_title_document, h1")?.textContent)
    const secs = [...document.querySelectorAll("section.ltx_section, section, article")]
      .map((sec) => ({
        heading: clean(sec.querySelector("h1, h2, h3, .ltx_title")?.textContent),
        text: clean([...sec.querySelectorAll("p, .ltx_para, li")].map((p) => p.textContent).join("\n")),
      }))
      .filter((s) => s.text.length > 120)
    return { title, secs }
  }) as { title: string; secs: Section[] }

  if (!paper.secs.length) {
    return { stage: "page", content: "translate_document：当前页面没抽到可翻译的正文章节（确认是否在论文全文页，如 arxiv.org/html/<id>）。" }
  }

  const skip = /reference|acknowledg|appendix|bibliography|致谢|参考文献/i
  const targets = paper.secs.filter((s) => !skip.test(s.heading)).slice(0, maxSections)

  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const rows: string[] = []
  for (const sec of targets) {
    const src = sec.text.slice(0, 5000)
    const translated = await ctx.generateText(
      `把下面这一节学术论文内容完整翻译成流畅${targetLang}，保留术语准确性，只输出译文：\n\n${sec.heading ? sec.heading + "\n" : ""}${src}`,
      `你是 AI/机器学习领域的学术翻译，输出地道${targetLang}，不要解释、不要加标题。`,
    ).catch(() => "(翻译失败)")
    rows.push(
      `<h3>${esc(sec.heading || "(无标题节)")}</h3>` +
      `<table class="bi"><tr><th>原文</th><th>${esc(targetLang)}</th></tr>` +
      `<tr><td>${esc(src)}</td><td>${esc(translated)}</td></tr></table>`,
    )
  }

  let insight = ""
  if (args.includeInsight !== false) {
    insight = await ctx.generateText(
      `论文标题：${paper.title}\n章节：${paper.secs.map((s) => s.heading).filter(Boolean).join("; ")}\n\n请用${targetLang}写一份详细解读：1) 解决什么问题、为何重要；2) 核心方法/机制；3) 主要贡献；4) 局限；5) 对做 agent 的人的借鉴。用带小标题的 HTML 片段（h3 + p/ul），不要外壳。`,
      `你是资深 AI 研究员，解读具体、避免空话。`,
    ).catch(() => "")
  }

  const title = args.title?.trim() || paper.title || "全文翻译报告"
  const style = `<style>.bi{width:100%;border-collapse:collapse;margin:.5rem 0 1.5rem}.bi th,.bi td{border:1px solid #ddd;padding:10px;vertical-align:top;width:50%}.bi th{background:#fafafa;text-align:left}.meta{color:#666;font-size:14px}</style>`
  const html =
    style +
    `<h1>${esc(title)}</h1>` +
    `<p class="meta">全文对照（共翻译 ${rows.length} / ${paper.secs.length} 节，目标语言 ${esc(targetLang)}）</p>` +
    (insight ? `<h2>详细解读</h2>${insight}` : "") +
    `<h2>全文对照</h2>${rows.join("\n")}`

  const result = await writeReportArtifact(ctx, {
    title,
    html,
    category: args.category?.trim() || "论文",
    summary: args.summary?.trim() || `全文对照 ${rows.length} 节${insight ? " + 详细解读" : ""}`,
  })
  return { ...result, content: `已生成全文对照报告（翻译 ${rows.length} 节${insight ? " + 解读" : ""}）：${result.url}` }
}
