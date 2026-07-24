import { type ToolDefinition } from "../../llm.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

/**
 * 项目知识库工具：把跟项目走的多层级 Markdown 内容空间暴露给 direct agent。
 * 与 save_report（单次运行的 HTML 产物）不同，知识库是**可持续更新、可浏览、可组织**的
 * 稳定内容树——采集类任务（把网站/文档整理成本地 md 集合）应把成果写到这里。
 */
export const knowledgeTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_knowledge",
      description:
        "列出项目知识库某目录下的条目（文件/子目录）。写入前先看看已有结构，保持目录组织一致；path 缺省列根目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "知识库内相对路径（如 scys/文章）；缺省为根目录" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_knowledge_file",
      description: "读取项目知识库中某个文本文件（Markdown 等）的内容。用于查看已有沉淀、判断是否需要更新。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "知识库内相对路径（如 scys/文章/AI/xxx.md）" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_knowledge_file",
      description:
        "向项目知识库写入/覆盖一个 Markdown（或其他文本）文件，父目录自动创建。**采集/整理类任务的正文一律写到这里**（多层级路径自己规划，如 scys/文章/AI/4845-标题.md）。" +
        "Markdown 建议带 frontmatter（title / source_url / author / captured_at 等）记录来源。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "知识库内相对路径，含文件名（如 scys/文章/AI/xxx.md）" },
          content: { type: "string", description: "完整文件内容（写入即覆盖）" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_knowledge_asset",
      description:
        "把远程 URL（图片/附件）下载保存为知识库资产，父目录自动创建。Markdown 里引用时用相对路径（如 ../assets/xxx/img-1.webp）。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "保存到知识库的相对路径，含文件名（如 scys/assets/4845/img-1.webp）" },
          url: { type: "string", description: "要下载的 http/https URL" },
        },
        required: ["path", "url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_knowledge_entry",
      description: "删除知识库中的文件或目录（目录递归删除）。仅在明确需要清理/重组时使用，不要随手删用户内容。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "要删除的知识库相对路径" },
        },
        required: ["path"],
      },
    },
  },
]

const unavailable = (tool: string): ToolExecutionResult => ({
  stage: "page",
  content: `${tool} 不可用：当前执行环境未接入项目知识库。`,
})

export async function executeListKnowledge(
  ctx: ToolRuntimeContext,
  args: { path?: string },
): Promise<ToolExecutionResult> {
  if (!ctx.knowledge) return unavailable("list_knowledge")
  const path = args.path?.trim() ?? ""
  const entries = await ctx.knowledge.list(path)
  if (!entries.length) {
    return { stage: "page", content: `知识库目录「${path || "/"}」为空或不存在。`, payloadJson: JSON.stringify({ path, entries: [] }) }
  }
  const preview = entries
    .map((e) => (e.kind === "directory" ? `📁 ${e.path}/` : `📄 ${e.path}（${e.size ?? 0} 字节）`))
    .join("\n")
  return {
    stage: "page",
    content: `知识库目录「${path || "/"}」共 ${entries.length} 项：\n${preview.slice(0, 4000)}`,
    payloadJson: JSON.stringify({ path, entries }),
  }
}

export async function executeReadKnowledgeFile(
  ctx: ToolRuntimeContext,
  args: { path: string },
): Promise<ToolExecutionResult> {
  if (!ctx.knowledge) return unavailable("read_knowledge_file")
  if (!args.path?.trim()) return { stage: "page", content: "read_knowledge_file 失败：path 不能为空。" }
  const content = await ctx.knowledge.read(args.path.trim())
  if (content == null) {
    return { stage: "page", content: `知识库文件不存在或不可读取: ${args.path.trim()}` }
  }
  const truncated = content.length > 20_000
  return {
    stage: "page",
    content: `知识库文件「${args.path.trim()}」内容（${content.length} 字符${truncated ? "，已截断展示" : ""}）：\n${content.slice(0, 20_000)}`,
  }
}

export async function executeWriteKnowledgeFile(
  ctx: ToolRuntimeContext,
  args: { path: string; content: string },
): Promise<ToolExecutionResult> {
  if (!ctx.knowledge) return unavailable("write_knowledge_file")
  if (!args.path?.trim()) return { stage: "page", content: "write_knowledge_file 失败：path 不能为空。" }
  if (typeof args.content !== "string") return { stage: "page", content: "write_knowledge_file 失败：content 必须是字符串。" }
  const saved = await ctx.knowledge.write(args.path.trim(), args.content)
  return {
    stage: "page",
    content: `已写入知识库文件 ${saved}（${Buffer.byteLength(args.content, "utf-8")} 字节）。`,
    payloadJson: JSON.stringify({ path: saved, bytes: Buffer.byteLength(args.content, "utf-8") }),
  }
}

export async function executeSaveKnowledgeAsset(
  ctx: ToolRuntimeContext,
  args: { path: string; url: string },
): Promise<ToolExecutionResult> {
  if (!ctx.knowledge) return unavailable("save_knowledge_asset")
  if (!args.path?.trim() || !args.url?.trim()) {
    return { stage: "page", content: "save_knowledge_asset 失败：path 与 url 均不能为空。" }
  }
  const saved = await ctx.knowledge.saveAsset(args.path.trim(), args.url.trim())
  return {
    stage: "page",
    content: `已保存知识库资产 ${saved} ← ${args.url.trim()}`,
    payloadJson: JSON.stringify({ path: saved, url: args.url.trim() }),
  }
}

export async function executeDeleteKnowledgeEntry(
  ctx: ToolRuntimeContext,
  args: { path: string },
): Promise<ToolExecutionResult> {
  if (!ctx.knowledge) return unavailable("delete_knowledge_entry")
  if (!args.path?.trim()) return { stage: "page", content: "delete_knowledge_entry 失败：path 不能为空。" }
  const removed = await ctx.knowledge.remove(args.path.trim())
  return {
    stage: "page",
    content: removed ? `已删除知识库条目 ${args.path.trim()}。` : `知识库条目不存在: ${args.path.trim()}`,
  }
}
