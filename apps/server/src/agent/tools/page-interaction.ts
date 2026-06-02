import { type Page } from "@playwright/test"
import { type ToolDefinition } from "../../llm.js"
import { buildLocatorTarget, sanitizeFileSegment, saveAgentScreenshot } from "../helpers.js"
import { type LocatorQuery, type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

export const pageInteractionTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "click_element",
      description: "点击页面元素，可按 role/text/label/placeholder/CSS 定位。目标在 iframe 内（如弹出的结算/支付浮层）时传 iframe 参数。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器" },
          role: { type: "string", description: "ARIA role，例如 button、link、menuitem" },
          text: { type: "string", description: "元素文本或名称" },
          label: { type: "string", description: "表单 label" },
          placeholder: { type: "string", description: "placeholder 文本" },
          index: { type: "number", description: "匹配多个元素时选择第几个，默认 0" },
          iframe: { type: "string", description: "目标所在 iframe 的 CSS 选择器，取自页面快照里的 [iframe ...] 段。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_input",
      description: "向输入框填写内容，可按 label/placeholder/CSS 等定位。目标在 iframe 内时传 iframe 参数。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器" },
          role: { type: "string", description: "ARIA role，例如 textbox" },
          text: { type: "string", description: "元素文本或名称" },
          label: { type: "string", description: "表单 label" },
          placeholder: { type: "string", description: "placeholder 文本" },
          value: { type: "string", description: "要填写的值" },
          index: { type: "number", description: "匹配多个元素时选择第几个，默认 0" },
          iframe: { type: "string", description: "目标所在 iframe 的 CSS 选择器（来自快照里的 [iframe ...] 段）。" },
        },
        required: ["value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "对当前页面发送键盘事件，例如 Enter、Escape、ArrowDown。",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "按键名称" },
        },
        required: ["key"],
      },
    },
  },
]

export async function executeClickElement(
  page: Page,
  args: LocatorQuery,
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const { locator, description, selector } = buildLocatorTarget(page, args)
  const count = await locator.count()
  if (count === 0) {
    return {
      stage: "page",
      content: `未找到可点击的 ${description}。`,
      detail: `当前 URL: ${page.url()}`,
      selector,
      url: page.url(),
    }
  }

  await locator.scrollIntoViewIfNeeded().catch(() => undefined)
  await locator.click({ timeout: 10000 })
  await page.waitForTimeout(800)
  const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `click-${sanitizeFileSegment(description)}`)
  return {
    stage: "page",
    content: `已点击 ${description}，当前 URL: ${page.url()}`,
    detail: args.index !== undefined ? `index=${args.index}` : `匹配数量: ${count}`,
    screenshotUrl,
    selector,
    url: page.url(),
    payloadJson: JSON.stringify({ index: args.index ?? 0, count }),
  }
}

export async function executeFillInput(
  page: Page,
  args: LocatorQuery & { value: string },
): Promise<ToolExecutionResult> {
  const { locator, description, selector } = buildLocatorTarget(page, args)
  const count = await locator.count()
  if (count === 0) {
    return {
      stage: "page",
      content: `未找到可填写的 ${description}。`,
      selector,
      url: page.url(),
    }
  }

  await locator.fill(args.value, { timeout: 10000 })
  return {
    stage: "page",
    content: `已向 ${description} 填写内容。`,
    detail: `填写值长度: ${args.value.length}`,
    selector,
    url: page.url(),
  }
}

export async function executePressKey(page: Page, args: { key: string }): Promise<ToolExecutionResult> {
  await page.keyboard.press(args.key)
  await page.waitForTimeout(400)
  return {
    stage: "page",
    content: `已发送按键 ${args.key}`,
    url: page.url(),
    payloadJson: JSON.stringify({ key: args.key }),
  }
}
