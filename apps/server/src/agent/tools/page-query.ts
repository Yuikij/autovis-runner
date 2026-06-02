import { type Page } from "@playwright/test"
import { type ToolDefinition } from "../../llm.js"
import { buildLocatorTarget, saveAgentScreenshot, truncate } from "../helpers.js"
import { type LocatorQuery, type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

export const pageQueryTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "query_elements",
      description: "按 role/text/label/placeholder/CSS 查询元素，返回候选元素摘要，帮助定位按钮、菜单、输入框。目标在 iframe 内时传 iframe 参数。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器" },
          role: { type: "string", description: "ARIA role，例如 button、link、textbox、menuitem" },
          text: { type: "string", description: "元素文本或名称" },
          label: { type: "string", description: "表单 label" },
          placeholder: { type: "string", description: "placeholder 文本" },
          index: { type: "number", description: "可选，默认从第 0 个开始" },
          limit: { type: "number", description: "最多返回多少个候选，默认 5" },
          iframe: { type: "string", description: "目标所在 iframe 的 CSS 选择器（来自快照里的 [iframe ...] 段）。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wait_for_page_state",
      description: "等待页面状态变化，可等待 URL 包含特定片段、文本出现或选择器出现。",
      parameters: {
        type: "object",
        properties: {
          urlIncludes: { type: "string", description: "等待 URL 包含某段文本" },
          selector: { type: "string", description: "等待某个 CSS 选择器出现" },
          text: { type: "string", description: "等待某段文本出现" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_element_html",
      description: "获取指定元素的 outerHTML，用于进一步确认 DOM 结构。目标在 iframe 内时传 iframe 参数。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器" },
          iframe: { type: "string", description: "目标所在 iframe 的 CSS 选择器（来自快照里的 [iframe ...] 段）。" },
        },
        required: ["selector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_screenshot",
      description: "保存当前页面截图，便于在工作台展示探索过程。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "截图名称" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_image",
      description: "【仅探索阶段使用】对页面上的图片元素调用多模态模型，目的是让你确认该图的类型/格式（例如纯字母数字 / 数学算式 / 中文文字 / 图形等），以便后续在脚本中为该类型设计专属的 ai.analyzeImage prompt。重要：本工具及其 prompt 只服务于你自己在探索阶段的理解，**绝对不能被拷贝到最终脚本里**。如果用例涉及验证码、二维码、图标识别等 AI 识图场景，你应该至少调用一次本工具。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "图片的 CSS 选择器" },
          prompt: {
            type: "string",
            description: "仅本次探索使用的提示词。推荐写法：让多模态模型同时输出 (a) 图中可见的原始字符或符号，以及 (b) 这张图属于哪种类型（纯字母数字 / 数学算式 / 中文文字 / 图形 等）。这条 prompt **不会也绝不要**出现在最终脚本中；脚本里的 ai.analyzeImage prompt 需要你根据本次探索看到的类型重新设计。",
          },
        },
        required: ["selector", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_current_page",
      description: "截取当前页面截图，调用多模态视觉模型分析页面整体布局、功能区域和当前状态。当文本快照不足以理解页面时使用——例如页面包含 Canvas/ECharts 图表、复杂视觉布局、需要确认整体视觉状态等 DOM 结构无法表达的场景。注意：此工具调用较慢（2-5秒），不要频繁调用；对于能通过 DOM 快照回答的问题请直接使用 query_elements 等工具。",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "分析提示词，描述你想了解页面的哪个方面。例如：'描述当前页面的整体布局和功能区域' 或 '页面中的图表展示了什么数据' 或 '当前页面看起来是成功状态还是错误状态'",
          },
          fullPage: {
            type: "boolean",
            description: "是否截取全页（含滚动区域）。默认 false 只截取可见视口区域。仅在需要看到长页面底部内容时设为 true",
          },
        },
        required: ["prompt"],
      },
    },
  },
]

export async function executeQueryElements(
  page: Page,
  args: LocatorQuery & { limit?: number },
): Promise<ToolExecutionResult> {
  const { locator, description, selector } = buildLocatorTarget(page, args)
  const count = await locator.count()
  const limit = Math.max(1, Math.min(10, Number(args.limit ?? 5)))
  const items = count > 0
    ? await locator.evaluateAll((nodes, max) => nodes.slice(0, max).map((node, index) => {
      const element = node as HTMLElement
      return {
        index,
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        ariaLabel: element.getAttribute("aria-label") || "",
        role: element.getAttribute("role") || "",
        alt: element.getAttribute("alt") || "",
        title: element.getAttribute("title") || "",
        placeholder: element.getAttribute("placeholder") || "",
        id: element.id || "",
        name: element.getAttribute("name") || "",
        type: element.getAttribute("type") || "",
        src: element.getAttribute("src") ? (element.getAttribute("src")!.length > 50 ? element.getAttribute("src")!.slice(0, 50) + "..." : element.getAttribute("src")) : "",
      }
    }), limit)
    : []

  return {
    stage: "page",
    content: count === 0
      ? `未找到匹配 ${description} 的元素。`
      : `共找到 ${count} 个候选元素：\n${items.map((item) => {
          let desc = `#${item.index} <${item.tag}>`
          if (item.id) desc += ` id="${item.id}"`
          if (item.role) desc += ` role="${item.role}"`
          if (item.type) desc += ` type="${item.type}"`
          if (item.name) desc += ` name="${item.name}"`
          if (item.placeholder) desc += ` placeholder="${item.placeholder}"`
          if (item.alt) desc += ` alt="${item.alt}"`
          if (item.title) desc += ` title="${item.title}"`
          if (item.ariaLabel) desc += ` aria-label="${item.ariaLabel}"`
          if (item.src) desc += ` src="${item.src}"`
          const content = item.text || item.ariaLabel || item.alt || item.title || "(empty)"
          return `${desc} ${content}`
        }).join("\n")}`,
    detail: `查询条件：${description}`,
    selector,
    url: page.url(),
    payloadJson: JSON.stringify({ count, items }, null, 2),
  }
}

export async function executeWaitForPageState(
  page: Page,
  args: { urlIncludes?: string; selector?: string; text?: string },
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  if (args.urlIncludes) {
    await page.waitForFunction((needle) => window.location.href.includes(needle), args.urlIncludes, { timeout: 10000 })
  }
  if (args.selector) {
    await page.waitForSelector(args.selector, { timeout: 10000 })
  }
  if (args.text) {
    await page.getByText(args.text).first().waitFor({ timeout: 10000 })
  }
  const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, "wait-state")
  return {
    stage: "page",
    content: `页面状态已满足等待条件，当前 URL: ${page.url()}`,
    detail: JSON.stringify(args),
    screenshotUrl,
    url: page.url(),
    selector: args.selector,
  }
}

export async function executeGetElementHtml(page: Page, args: { selector: string; iframe?: string }): Promise<ToolExecutionResult> {
  const root = args.iframe ? page.frameLocator(args.iframe) : page
  const locator = root.locator(args.selector)
  const count = await locator.count()
  if (count === 0) {
    return {
      stage: "page",
      content: `未找到匹配选择器 ${args.selector} 的元素。`,
      selector: args.selector,
      url: page.url(),
    }
  }

  const html = await locator.first().evaluate((node) => node.outerHTML)
  return {
    stage: "page",
    content: truncate(html, 4000) + (count > 1 ? `\n\n(共匹配到 ${count} 个元素，仅展示第一个)` : ""),
    detail: `选择器: ${args.selector}`,
    selector: args.selector,
    url: page.url(),
    payloadJson: JSON.stringify({ count }),
  }
}

export async function executeCaptureScreenshot(
  page: Page,
  args: { name?: string },
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, args.name ?? "manual")
  return {
    stage: "page",
    content: `已保存页面截图 ${args.name ?? "manual"}`,
    screenshotUrl,
    url: page.url(),
    payloadJson: JSON.stringify({ screenshotUrl }),
  }
}

export async function executeAnalyzeImage(
  page: Page,
  args: { selector: string; prompt: string },
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  if (!ctx.analyzeImage) {
    return {
      stage: "page",
      content: "当前环境不支持执行 analyzeImage（缺少相关配置或方法）。",
      selector: args.selector,
      url: page.url(),
    }
  }

  const locator = page.locator(args.selector).first()
  const count = await locator.count()
  if (count === 0) {
    return {
      stage: "page",
      content: `未找到匹配 ${args.selector} 的元素，无法截图分析。`,
      selector: args.selector,
      url: page.url(),
    }
  }

  const screenshotBuffer = await locator.screenshot({ type: "jpeg", quality: 80 })
  const base64Data = screenshotBuffer.toString("base64")
  const dataUrl = `data:image/jpeg;base64,${base64Data}`

  try {
    const text = await ctx.analyzeImage({ dataUrl, mimeType: "image/jpeg", prompt: args.prompt })
    return {
      stage: "page",
      content: `图片分析结果:\n${text}`,
      detail: `提示词: ${args.prompt}`,
      selector: args.selector,
      url: page.url(),
      payloadJson: JSON.stringify({ prompt: args.prompt, result: text }),
    }
  } catch (error) {
    return {
      stage: "page",
      content: `图片分析失败: ${error instanceof Error ? error.message : String(error)}`,
      selector: args.selector,
      url: page.url(),
    }
  }
}

export async function executeAnalyzeCurrentPage(
  page: Page,
  args: { prompt: string; fullPage?: boolean },
  ctx: ToolRuntimeContext,
): Promise<ToolExecutionResult> {
  if (!ctx.analyzeImage) {
    return {
      stage: "page",
      content: "当前环境不支持视觉分析（缺少多模态 LLM 配置）。",
      url: page.url(),
    }
  }

  const fullPage = args.fullPage ?? false
  const screenshotBuffer = await page.screenshot({
    type: "jpeg",
    quality: 70,
    fullPage,
  })
  const base64Data = screenshotBuffer.toString("base64")
  const dataUrl = `data:image/jpeg;base64,${base64Data}`

  const screenshotUrl = await saveAgentScreenshot(
    page,
    ctx.artifactsDir,
    ctx.agentSessionId,
    `analyze-page-${fullPage ? "full" : "viewport"}`,
  )

  try {
    const text = await ctx.analyzeImage({ dataUrl, mimeType: "image/jpeg", prompt: args.prompt })
    return {
      stage: "page",
      content: `页面视觉分析结果：\n${text}`,
      detail: `提示词: ${args.prompt} | 模式: ${fullPage ? "全页" : "视口"}`,
      screenshotUrl,
      url: page.url(),
      payloadJson: JSON.stringify({ prompt: args.prompt, fullPage, result: text }),
    }
  } catch (error) {
    return {
      stage: "page",
      content: `页面视觉分析失败: ${error instanceof Error ? error.message : String(error)}`,
      screenshotUrl,
      url: page.url(),
    }
  }
}
