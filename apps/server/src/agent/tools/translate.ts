import { type ToolDefinition } from "../../llm.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"
import { ensureEvaluateNameShim } from "../helpers.js"
import { writeReportArtifact } from "./report.js"

export const translateDocumentTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "translate_document",
      description:
        "把当前页面（或给定 url）的长正文做**全文中英对照**并落成报告产物。它会自动抽取正文章节、把每节再切成小块**逐块翻译后拼回**（长节也不会被截断），生成原文/译文并排的 HTML。" +
        "**全文翻译这种穷举任务必须用它**，不要自己在一次回复里手写整篇翻译（会被输出长度截断）。可选 includeInsight 让它额外生成一段深度解读放在报告开头。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要翻译的页面 URL；缺省用当前页面。论文优先用全文 HTML 版（如 arxiv.org/html/<id>）" },
          title: { type: "string", description: "报告标题。缺省取页面 <h1>" },
          targetLang: { type: "string", description: "目标语言，缺省「中文」" },
          maxSections: { type: "number", description: "最多翻译多少个章节。缺省翻译全部抽到的章节（不主动丢内容）；只在想截断时才传" },
          includeInsight: { type: "boolean", description: "是否在报告开头附一段深度解读，缺省 true" },
          category: { type: "string", description: "收件箱分类，缺省「论文」" },
          summary: { type: "string", description: "收件箱卡片一句话摘要" },
        },
      },
    },
  },
]

interface Section { heading: string; paras: string[] }

// 单次 LLM 翻译块大小（字符）。整篇通过"分块翻译再拼回"实现全覆盖，不再对单节做硬截断。
const CHUNK_CHARS = 3500
// 安全上限：极端长文（书级）下避免一次工具调用打出无限多次 LLM 请求；命中会在报告里如实标注。
const MAX_TOTAL_CHUNKS = 120
const SECTION_SKIP = /reference|acknowledg|appendix|bibliography|致谢|参考文献|附录/i

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** 把多段文本渲染成 HTML 段落，保留段落结构（而不是压成一坨）。 */
const renderParas = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("") || "<p></p>"

/** 把超长单段按句界切成不超过 maxChars 的片段；切不动时硬切。 */
const splitLongParagraph = (para: string, maxChars: number): string[] => {
  if (para.length <= maxChars) return [para]
  const pieces: string[] = []
  let rest = para
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    // 优先在句界（中英句号/换行）回退切分，找不到再硬切。
    const cut = Math.max(window.lastIndexOf("。"), window.lastIndexOf(". "), window.lastIndexOf("\n"))
    const at = cut > maxChars * 0.5 ? cut + 1 : maxChars
    pieces.push(rest.slice(0, at).trim())
    rest = rest.slice(at)
  }
  if (rest.trim()) pieces.push(rest.trim())
  return pieces
}

/** 把一节的若干段聚合成 ≤CHUNK_CHARS 的翻译块，尽量按段落边界聚合，超长段先拆。 */
const buildChunks = (paras: string[], maxChars: number): string[] => {
  const chunks: string[] = []
  let buf = ""
  const flush = () => { if (buf.trim()) { chunks.push(buf.trim()); buf = "" } }
  for (const para of paras) {
    for (const piece of splitLongParagraph(para, maxChars)) {
      if (buf && buf.length + piece.length + 2 > maxChars) flush()
      buf = buf ? `${buf}\n\n${piece}` : piece
    }
  }
  flush()
  return chunks
}

/** 串行 + 重试的文本生成，比并发更稳（不易撞限流）；瞬时失败重试，最终失败抛错由上层兜。 */
const generateWithRetry = async (
  generateText: NonNullable<ToolRuntimeContext["generateText"]>,
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal | undefined,
  attempts = 3,
): Promise<string> => {
  let lastError: unknown
  for (let i = 1; i <= attempts; i += 1) {
    if (signal?.aborted) throw new Error("translate_document 已取消")
    try {
      const out = await generateText(prompt, systemPrompt)
      if (out && out.trim()) return out.trim()
      lastError = new Error("空译文")
    } catch (error) {
      lastError = error
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 500 * i))
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function executeTranslateDocument(
  ctx: ToolRuntimeContext,
  args: { url?: string; title?: string; targetLang?: string; maxSections?: number; includeInsight?: boolean; category?: string; summary?: string },
): Promise<ToolExecutionResult> {
  if (!ctx.page) return { stage: "page", content: "translate_document 不可用：浏览器未初始化。" }
  if (!ctx.generateText) return { stage: "page", content: "translate_document 不可用：未启用文本生成能力。" }
  if (!ctx.runDir) return { stage: "page", content: "translate_document 不可用：没有 run 产物目录。" }
  const generateText = ctx.generateText
  const { signal } = ctx

  const targetLang = args.targetLang?.trim() || "中文"

  if (args.url) {
    await ctx.page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined)
    await ctx.page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
  }

  // 下面的 evaluate 含具名内部函数，tsx(esbuild) 会注入 __name 引用；先在当前文档主世界注入兜底，避免 ReferenceError。
  await ensureEvaluateNameShim(ctx.page)

  // 通用抽取：先锁定正文根（避开导航/页脚），取"叶子级"块（段落/标题），按标题边界切成章节。
  // 不混用 article+section（否则父子重复抓取），不靠站点专有 class，对 arxiv-html 与普通文章都成立。
  const paper = await ctx.page.evaluate(() => {
    const norm = (s: string | null | undefined) =>
      (s || "").replace(/[ \t ]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim()

    const root =
      document.querySelector("article, main, .ltx_page_main, .ltx_document, #content, .article, .post-content") ||
      document.body

    const titleEl = document.querySelector(
      "h1.ltx_title_document, h1.ltx_title, article h1, main h1, h1",
    )
    const title = norm(titleEl?.textContent).replace(/\n+/g, " ")

    const selector = "h1,h2,h3,h4,p,li,pre,blockquote"
    const all = [...root.querySelectorAll(selector)]
    // 只保留"叶子级"块：不包含其它候选块的元素，避免 li>p、容器>p 这类嵌套重复计数。
    const leaves = all.filter((el) => !all.some((other) => other !== el && el.contains(other)))

    const isHeading = (el: Element) => /^H[1-4]$/.test(el.tagName)
    const sections: Array<{ heading: string; paras: string[] }> = []
    let current: { heading: string; paras: string[] } | null = null
    for (const el of leaves) {
      const text = norm(el.textContent)
      if (!text) continue
      if (isHeading(el)) {
        current = { heading: text.replace(/\n+/g, " "), paras: [] }
        sections.push(current)
      } else {
        if (!current) {
          current = { heading: "", paras: [] }
          sections.push(current)
        }
        current.paras.push(text)
      }
    }
    return { title, sections }
  }) as { title: string; sections: Section[] }

  // 丢掉空节（仅标题无正文）与参考文献/致谢/附录类。
  let sections = paper.sections.filter((s) => s.paras.join("").trim().length > 0 && !SECTION_SKIP.test(s.heading))
  const extractedCount = sections.length
  if (!sections.length) {
    return {
      stage: "page",
      content: "translate_document：当前页面没抽到可翻译的正文（确认是否在文章/论文全文页，如 arxiv.org/html/<id>）。",
    }
  }

  // 默认不主动丢章节；只有显式 maxSections 才截断。
  let sectionCapped = false
  if (args.maxSections && args.maxSections > 0 && sections.length > args.maxSections) {
    sections = sections.slice(0, args.maxSections)
    sectionCapped = true
  }

  const rows: string[] = []
  let totalChunks = 0
  let chunkCapped = false
  let translatedSections = 0
  let failedChunks = 0

  for (const sec of sections) {
    if (signal?.aborted) throw new Error("translate_document 已取消")
    if (totalChunks >= MAX_TOTAL_CHUNKS) { chunkCapped = true; break }

    const chunks = buildChunks(sec.paras, CHUNK_CHARS)
    const sourceText = sec.paras.join("\n\n")
    const translatedParts: string[] = []
    for (const chunk of chunks) {
      if (totalChunks >= MAX_TOTAL_CHUNKS) { chunkCapped = true; break }
      totalChunks += 1
      try {
        const translated = await generateWithRetry(
          generateText,
          `把下面这一段学术/正式文本完整翻译成流畅${targetLang}，保留术语准确性与段落结构（用空行分段），只输出译文：\n\n${chunk}`,
          `你是专业学术翻译，输出地道${targetLang}，逐段忠实翻译，不要解释、不要加标题、不要省略。`,
          signal,
        )
        translatedParts.push(translated)
      } catch (error) {
        if (signal?.aborted) throw error
        failedChunks += 1
        translatedParts.push(`（本段翻译失败：${error instanceof Error ? error.message : String(error)}）`)
      }
    }

    translatedSections += 1
    rows.push(
      `<h3>${esc(sec.heading || "(无标题节)")}</h3>` +
      `<table class="bi"><tr><th>原文</th><th>${esc(targetLang)}</th></tr>` +
      `<tr><td>${renderParas(sourceText)}</td><td>${renderParas(translatedParts.join("\n\n"))}</td></tr></table>`,
    )
  }

  let insight = ""
  if (args.includeInsight !== false && !signal?.aborted) {
    insight = await generateWithRetry(
      generateText,
      `文档标题：${paper.title}\n章节：${sections.map((s) => s.heading).filter(Boolean).join("; ")}\n\n请用${targetLang}写一份详细解读：1) 解决什么问题、为何重要；2) 核心方法/机制；3) 主要贡献；4) 局限；5) 对相关从业者的借鉴。用带小标题的 HTML 片段（h3 + p/ul），不要外壳。`,
      `你是资深领域研究员，解读具体、避免空话。`,
      signal,
    ).catch(() => "")
  }

  const title = args.title?.trim() || paper.title || "全文翻译报告"
  const notes: string[] = [`抽到 ${extractedCount} 节`, `翻译 ${translatedSections} 节 / ${totalChunks} 块`]
  if (sectionCapped) notes.push(`已按 maxSections=${args.maxSections} 截断`)
  if (chunkCapped) notes.push(`已达单次上限 ${MAX_TOTAL_CHUNKS} 块（超长文，未译完）`)
  if (failedChunks) notes.push(`${failedChunks} 块翻译失败`)

  const style = `<style>.bi{width:100%;border-collapse:collapse;margin:.5rem 0 1.5rem;table-layout:fixed}.bi th,.bi td{border:1px solid #ddd;padding:10px;vertical-align:top;width:50%;word-wrap:break-word}.bi th{background:#fafafa;text-align:left}.bi p{margin:.4rem 0}.meta{color:#666;font-size:14px}</style>`
  const html =
    style +
    `<h1>${esc(title)}</h1>` +
    `<p class="meta">全文对照（${esc(notes.join("，"))}，目标语言 ${esc(targetLang)}）</p>` +
    (insight ? `<h2>详细解读</h2>${insight}` : "") +
    `<h2>全文对照</h2>${rows.join("\n")}`

  const result = await writeReportArtifact(ctx, {
    title,
    html,
    category: args.category?.trim() || "论文",
    summary: args.summary?.trim() || `全文对照 ${translatedSections} 节${insight ? " + 详细解读" : ""}`,
  })
  return {
    ...result,
    content: `已生成全文对照报告（${notes.join("，")}${insight ? " + 解读" : ""}）：${result.url}`,
  }
}
