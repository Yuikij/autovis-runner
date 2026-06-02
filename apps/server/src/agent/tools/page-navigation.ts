import { type Page } from "@playwright/test"
import { type ToolDefinition } from "../../llm.js"
import { getPageSnapshot, resolveUrl, sanitizeFileSegment, saveAgentScreenshot } from "../helpers.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

export const pageNavigationTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_page",
      description: "返回当前页面（或指定 URL 页面）的标题、URL 和结构快照。不传 url 时只快照当前页面，不会触发跳转；传 url 时若与当前 URL 同源同 path 也只会快照不跳转，避免冲掉登录态。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "可选，完整 URL 或相对路径；省略时只快照当前页面" },
          waitForSelector: { type: "string", description: "可选，等待某个选择器出现" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "跳转到指定 URL 或站内路径，并返回当前 URL。适合页面导航。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "完整 URL 或相对路径" },
        },
        required: ["url"],
      },
    },
  },
]

function isSameOriginAndPath(target: string, current: string): boolean {
  try {
    const a = new URL(target)
    const b = new URL(current)
    return a.origin === b.origin && a.pathname === b.pathname
  } catch {
    return false
  }
}

export async function executeInspectPage(
  page: Page,
  args: { url?: string; waitForSelector?: string },
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  let navigated = false
  if (args.url) {
    const resolved = resolveUrl(args.url, ctx.project.testBaseUrl, page.url())
    if (!isSameOriginAndPath(resolved, page.url())) {
      await page.goto(resolved, { waitUntil: "domcontentloaded", timeout: 20000 })
      navigated = true
    }
  }
  if (args.waitForSelector) {
    await page.waitForSelector(args.waitForSelector, { timeout: 8000 }).catch(() => undefined)
  }
  if (navigated) {
    await page.waitForTimeout(800)
  }
  const title = await page.title()
  const snapshot = await getPageSnapshot(page)
  const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `inspect-${title || "page"}`)
  return {
    stage: "page",
    content: `页面标题: ${title || "(empty)"}\nURL: ${page.url()}\n\n页面结构:\n${snapshot}`,
    detail: navigated ? `已跳转到 ${page.url()}` : `当前页面 ${page.url()}`,
    screenshotUrl,
    url: page.url(),
    payloadJson: JSON.stringify({ title, url: page.url(), navigated }),
  }
}

export async function executeNavigateTo(
  page: Page,
  args: { url: string },
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const url = resolveUrl(args.url, ctx.project.testBaseUrl, page.url())
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
  await page.waitForTimeout(600)
  const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `navigate-${sanitizeFileSegment(url)}`)
  return {
    stage: "page",
    content: `已导航到 ${page.url()}`,
    detail: `当前页面标题: ${await page.title()}`,
    screenshotUrl,
    url: page.url(),
    payloadJson: JSON.stringify({ url: page.url() }),
  }
}
