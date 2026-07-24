import { writeFile, mkdir } from "node:fs/promises"
import { basename, join } from "node:path"
import { type ToolDefinition } from "../../llm.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

export const saveReportTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "save_report",
      description:
        "把你整理好的长内容（中英对照全文、HTML 解读报告、汇总等）落盘成一份可在平台「产出收件箱」里直接打开的 HTML 报告，返回访问 URL。" +
        "**长文/报告类交付一律用它**，不要把整篇正文堆在你的文字回复里。可传完整 HTML 文档或片段（片段会自动补 utf-8 与可读样式）。" +
        "公式用 MathJax/KaTeX、代码高亮等外部脚本时请加 async/defer，避免阻塞渲染。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "报告标题，也用于收件箱卡片标题与文件名" },
          html: { type: "string", description: "报告正文 HTML（完整文档或片段均可）" },
          category: { type: "string", description: "收件箱分类标签，如 论文 / 资讯 / 早报 / 账单。缺省归为「其他」" },
          summary: { type: "string", description: "一句话摘要，显示在收件箱卡片上" },
        },
        required: ["title", "html"],
      },
    },
  },
]

export const slugify = (raw: string) =>
  (raw || "report").trim().replace(/[\/\\?%*:|"<>\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "report"

let reportSeq = 0

/**
 * 把 HTML 报告落盘到 ctx.runDir 并返回带收件箱卡片元数据的 ToolExecutionResult。
 * save_report 与 translate_document 共用：finalize 扫描产物 + collectReportCards 解析 payloadJson.savedReport。
 */
export async function writeReportArtifact(
  ctx: ToolRuntimeContext,
  args: { title: string; html: string; category?: string; summary?: string },
): Promise<ToolExecutionResult> {
  if (!ctx.runDir) {
    return { stage: "page", content: "报告不可用：当前执行环境没有 run 产物目录。" }
  }
  if (!args.html || !args.html.trim()) {
    return { stage: "page", content: "报告失败：html 内容为空。" }
  }
  reportSeq += 1
  const title = args.title?.trim() || "报告"
  const fileName = `report-${reportSeq}-${slugify(title)}.html`
  const hasDoc = /<!doctype|<html[\s>]/i.test(args.html)
  const doc = hasDoc
    ? args.html
    : `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<style>body{max-width:860px;margin:2rem auto;padding:0 1rem;font:16px/1.7 -apple-system,Segoe UI,Roboto,"Helvetica Neue",sans-serif;color:#1a1a1a}h1,h2,h3{line-height:1.3}pre,code{background:#f5f5f5;border-radius:4px}pre{padding:1rem;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;vertical-align:top}</style>` +
      `</head><body>${args.html}</body></html>`

  await mkdir(ctx.runDir, { recursive: true })
  await writeFile(join(ctx.runDir, fileName), doc, "utf-8")
  const url = `/artifacts/${basename(ctx.runDir)}/${fileName}`

  // payloadJson 携带收件箱卡片元数据，供 AgentDirectService 在 finalize 后转成 runtimeOutput。
  const card = { reportUrl: url, title, category: args.category?.trim() || undefined, summary: args.summary?.trim() || undefined }
  return {
    stage: "page",
    content: `已生成报告产物：${title} → ${url}`,
    url,
    fileName,
    payloadJson: JSON.stringify({ savedReport: card }),
  }
}

export async function executeSaveReport(
  ctx: ToolRuntimeContext,
  args: { title: string; html: string; category?: string; summary?: string },
): Promise<ToolExecutionResult> {
  return writeReportArtifact(ctx, args)
}
