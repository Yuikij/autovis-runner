import { type ToolDefinition } from "../../llm.js"
import { truncate } from "../helpers.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

export const workspaceTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_workspace_tree",
      description: "列出项目工作区某个目录下的文件和子目录，帮助快速了解代码结构。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "可选，相对路径，留空表示根目录" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob_workspace_paths",
      description: "按 glob 模式查找文件路径，例如 src/**/*.tsx、**/*login*。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_workspace_code",
      description: "按关键字在项目代码中搜索，返回匹配文件、行号和片段。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键字" },
          path: { type: "string", description: "可选，在某个子目录内搜索" },
          limit: { type: "number", description: "最多返回多少条结果，默认 20" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_workspace_file",
      description: "按路径读取项目工作区中的单个文件，可按行窗口读取。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对文件路径" },
          offset: { type: "number", description: "从第几行开始，默认 0" },
          limit: { type: "number", description: "最多读取多少行，默认 200" },
        },
        required: ["path"],
      },
    },
  },
]

export async function executeListWorkspaceTree(
  ctx: ToolRuntimeContext,
  args: { path?: string },
): Promise<ToolExecutionResult> {
  if (!ctx.hasWorkspace) {
    return { stage: "code", content: "未配置工作区，当前无法进行代码搜索或读取文件，请优先使用页面操作工具。" }
  }
  const entries = await ctx.listWorkspaceTree(args.path)
  return {
    stage: "code",
    content: entries.length === 0
      ? (args.path ? `目录 ${args.path} 下没有可见文件。` : "本地工作区为空，没有代码文件，请优先使用页面操作工具。")
      : entries.map((entry) => `${entry.kind === "directory" ? "[DIR]" : "[FILE]"} ${entry.path}`).join("\n"),
    detail: `共 ${entries.length} 个条目`,
    fileName: args.path || "/",
    payloadJson: JSON.stringify(entries.slice(0, 100), null, 2),
  }
}

export async function executeGlobWorkspacePaths(
  ctx: ToolRuntimeContext,
  args: { pattern: string },
): Promise<ToolExecutionResult> {
  if (!ctx.hasWorkspace) {
    return { stage: "code", content: "未配置工作区，当前无法进行代码搜索或读取文件，请优先使用页面操作工具。" }
  }
  const paths = await ctx.globWorkspacePaths(args.pattern)
  return {
    stage: "code",
    content: paths.length === 0 ? `没有匹配 ${args.pattern} 的路径。如果你在寻找页面元素，请使用页面操作工具。` : paths.slice(0, 50).join("\n"),
    detail: `共匹配 ${paths.length} 个路径`,
    fileName: paths[0],
    payloadJson: JSON.stringify({ total: paths.length, paths: paths.slice(0, 100) }, null, 2),
  }
}

export async function executeSearchWorkspaceCode(
  ctx: ToolRuntimeContext,
  args: { query: string; path?: string; limit?: number },
): Promise<ToolExecutionResult> {
  if (!ctx.hasWorkspace) {
    return { stage: "code", content: "未配置工作区，当前无法进行代码搜索或读取文件，请优先使用页面操作工具。" }
  }
  const matches = await ctx.searchWorkspaceCode(args.query, args.path, args.limit)
  return {
    stage: "code",
    content: matches.length === 0
      ? `没有搜索到关键字“${args.query}”。注意：如果本地没有同步代码或关键字不在代码中，请优先使用页面操作工具进行测试。`
      : matches.map((match) => `${match.path}:${match.lineNumber}\n${match.preview}`).join("\n\n"),
    detail: `共命中 ${matches.length} 条`,
    fileName: matches[0]?.path,
    payloadJson: JSON.stringify(matches.slice(0, 100), null, 2),
  }
}

export async function executeReadWorkspaceFile(
  ctx: ToolRuntimeContext,
  args: { path: string; offset?: number; limit?: number },
): Promise<ToolExecutionResult> {
  if (!ctx.hasWorkspace) {
    return { stage: "code", content: "未配置工作区，当前无法进行代码搜索或读取文件，请优先使用页面操作工具。" }
  }
  const file = await ctx.readWorkspaceFile(args.path, args.offset, args.limit)
  const startLine = file.offset + 1
  return {
    stage: "code",
    content: `--- ${file.path} (from line ${startLine}) ---\n${truncate(file.content, 5000)}`,
    detail: file.truncated ? `文件共 ${file.totalLines} 行，当前结果已截断。` : `文件共 ${file.totalLines} 行。`,
    fileName: file.path,
    payloadJson: JSON.stringify({ path: file.path, offset: file.offset, totalLines: file.totalLines, truncated: file.truncated }, null, 2),
  }
}
