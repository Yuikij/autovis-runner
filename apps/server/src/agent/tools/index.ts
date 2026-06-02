import { type AgentStage } from "@autovis/shared"
import { type ToolDefinition } from "../../llm.js"
import { type LocatorQuery, type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"
import { executeClickElement, executeFillInput, executePressKey, pageInteractionTools } from "./page-interaction.js"
import { executeInspectPage, executeNavigateTo, pageNavigationTools } from "./page-navigation.js"
import { executeCaptureScreenshot, executeGetElementHtml, executeQueryElements, executeWaitForPageState, pageQueryTools, executeAnalyzeImage, executeAnalyzeCurrentPage } from "./page-query.js"
import { executeGlobWorkspacePaths, executeListWorkspaceTree, executeReadWorkspaceFile, executeSearchWorkspaceCode, workspaceTools } from "./workspace.js"
import { executeStepTools } from "./execute-step.js"

export const AGENT_TOOLS: ToolDefinition[] = [
  ...workspaceTools,
  ...pageNavigationTools,
  ...pageInteractionTools,
  ...pageQueryTools,
  ...executeStepTools,
]

const TOOL_STAGE_MAP: Record<string, AgentStage> = {
  list_workspace_tree: "code",
  glob_workspace_paths: "code",
  search_workspace_code: "code",
  read_workspace_file: "code",
  inspect_page: "page",
  navigate_to: "page",
  query_elements: "page",
  click_element: "page",
  fill_input: "page",
  press_key: "page",
  wait_for_page_state: "page",
  get_element_html: "page",
  capture_screenshot: "page",
  analyze_image: "page",
  analyze_current_page: "page",
  execute_step: "generation",
}

export async function executeTool(
  toolName: string,
  rawArgs: string,
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(rawArgs)
  } catch {
    return {
      stage: TOOL_STAGE_MAP[toolName] ?? "page",
      content: `工具参数解析失败: ${rawArgs}`,
      payloadJson: rawArgs,
    }
  }

  switch (toolName) {
    case "list_workspace_tree":
      return executeListWorkspaceTree(ctx, args as { path?: string })
    case "glob_workspace_paths":
      return executeGlobWorkspacePaths(ctx, args as { pattern: string })
    case "search_workspace_code":
      return executeSearchWorkspaceCode(ctx, args as { query: string; path?: string; limit?: number })
    case "read_workspace_file":
      return executeReadWorkspaceFile(ctx, args as { path: string; offset?: number; limit?: number })
    case "inspect_page":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法访问页面。" }
      return executeInspectPage(ctx.page, args as { url: string; waitForSelector?: string }, ctx)
    case "navigate_to":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法导航。" }
      return executeNavigateTo(ctx.page, args as { url: string }, ctx)
    case "query_elements":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法查询元素。" }
      return executeQueryElements(ctx.page, args as LocatorQuery & { limit?: number })
    case "click_element":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法点击元素。" }
      return executeClickElement(ctx.page, args as LocatorQuery, ctx)
    case "fill_input":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法填写输入框。" }
      return executeFillInput(ctx.page, args as unknown as LocatorQuery & { value: string })
    case "press_key":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法发送按键。" }
      return executePressKey(ctx.page, args as { key: string })
    case "wait_for_page_state":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法等待页面状态。" }
      return executeWaitForPageState(ctx.page, args as { urlIncludes?: string; selector?: string; text?: string }, ctx)
    case "get_element_html":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法查看元素 HTML。" }
      return executeGetElementHtml(ctx.page, args as { selector: string; iframe?: string })
    case "capture_screenshot":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法截图。" }
      return executeCaptureScreenshot(ctx.page, args as { name?: string }, ctx)
    case "analyze_image":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法分析图片。" }
      return executeAnalyzeImage(ctx.page, args as { selector: string; prompt: string }, ctx)
    case "analyze_current_page":
      if (!ctx.page) return { stage: "page", content: "浏览器未初始化，无法分析页面。" }
      return executeAnalyzeCurrentPage(ctx.page, args as { prompt: string; fullPage?: boolean }, ctx)
    case "execute_step":
      return { stage: "generation", content: "execute_step 应由 agent loop 直接处理。" }
    default:
      return { stage: TOOL_STAGE_MAP[toolName] ?? "page", content: `未知工具: ${toolName}` }
  }
}
