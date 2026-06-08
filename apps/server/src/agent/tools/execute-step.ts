import * as ts from "typescript"
import { type Page, expect } from "@playwright/test"
import type { RuntimeOutput } from "@autovis/shared"
import { type ToolDefinition } from "../../llm.js"
import { detectRiskControl, getPageSnapshot, riskControlBanner, saveAgentScreenshot } from "../helpers.js"
import { type ScriptRuntimeContext, type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

export const executeStepTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "execute_step",
      description: "提交当前完整累积脚本并执行新增部分。code 应包含之前已验证的所有代码加上本次新增的代码。如果修改了已验证的代码前缀，系统会重置浏览器从头执行整个脚本。成功后浏览器保持在执行后的状态，供下一步继续操作。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "当前步骤标题，如：展开侧边菜单、填写查询条件" },
          code: { type: "string", description: "完整的累积脚本代码（包含之前所有已验证步骤 + 本次新增）。可使用 page, expect, human, ai, test, getBaseUrl 以及 http（用于发送网络请求，如 webhook 通知或 API 调用）。" },
        },
        required: ["title", "code"],
      },
    },
  },
]

const STEP_TIMEOUT_MS = 60_000

interface HumanRuntime {
  input: (options: { reason: string; instruction: string; inputLabel?: string; placeholder?: string; imageSelector?: string }) => Promise<string>
}

interface AiRuntime {
  analyzeImage: (options: { prompt: string; imageSelector?: string; selector?: string }) => Promise<string>
  withImageRetry: (options: {
    imageSelector?: string
    selector?: string
    prompt: string
    maxRetries?: number
    validate?: (text: string) => boolean | Promise<boolean>
    retry?: (retryTimes: number, lastText: string) => Promise<void> | void
    fallback?: () => Promise<string> | string
  }) => Promise<string>
  generateText: (prompt: string, systemPrompt?: string) => Promise<string>
}

interface TestRuntime {
  step: <T>(title: string, body: () => Promise<T>) => Promise<T>
}

interface StepRuntime {
  <T>(title: string, purpose: string, body: () => Promise<T>): Promise<T>
}

interface OutputsRuntime {
  add: (description: string, value: unknown, meta?: Record<string, unknown>) => Promise<unknown>
}

interface InputsRuntime {
  get: (options?: { from?: string; description?: string }) => Promise<any>
}

interface TempRuntime {
  store: <T>(description: string, key: string, body: () => Promise<T> | T) => Promise<T>
  get: <T = unknown>(key: string) => Promise<T>
}

interface GuardRuntime {
  ownedData: <T>(record: unknown, action: () => Promise<T> | T) => Promise<T>
}

interface ScheduleRuntime {
  waitUntil: (target: string | number | Date, options?: { pollMs?: number; logEverySec?: number }) => Promise<void>
}

interface HttpRuntime {
  get: (url: string, options?: { headers?: Record<string, string>; params?: Record<string, string> }) => Promise<any>
  post: (url: string, options?: { headers?: Record<string, string>; data?: any }) => Promise<any>
}

interface LoopRuntime {
  until: <T>(predicate: () => Promise<T | false | null | undefined> | T | false | null | undefined, options: {
    intervalMs: number
    timeoutMs?: number
    maxRounds?: number
    description?: string
    logEveryRound?: number
  }) => Promise<T>
}

type RetryRuntime = <T>(fn: (attempt: number) => Promise<T> | T, options?: {
  times?: number
  backoffMs?: number
  backoffFactor?: number
  description?: string
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>
}) => Promise<T>

type ScriptExecutor = (
  page: Page,
  expectValue: typeof expect,
  human: HumanRuntime,
  ai: AiRuntime,
  test: TestRuntime,
  getBaseUrl: () => string,
  step: StepRuntime,
  outputs: OutputsRuntime,
  inputs: InputsRuntime,
  temp: TempRuntime,
  guard: GuardRuntime,
  schedule: ScheduleRuntime,
  loop: LoopRuntime,
  retry: RetryRuntime,
  http: HttpRuntime,
) => Promise<void>

const AsyncExecutor = Object.getPrototypeOf(async function () {
  return undefined
}).constructor as new (...args: string[]) => ScriptExecutor

const createRuntimeOutputId = (prefix: string) => `${prefix}_output_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const normalizeRuntimeMatch = (value?: string) => value?.trim() ?? ""

const matchesProducer = (output: RuntimeOutput, from: string) => {
  const target = normalizeRuntimeMatch(from)
  return [output.testCaseId, output.caseCode, output.caseName]
    .map((item) => normalizeRuntimeMatch(item))
    .some((item) => item === target)
}

const formatRuntimeValue = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const isRuntimeOwnedData = (record: unknown, outputs: RuntimeOutput[], tempValues: Map<string, unknown>) => {
  const needle = formatRuntimeValue(record)
  const haystacks = [
    ...outputs.map((item) => formatRuntimeValue(item.value)),
    ...[...tempValues.values()].map((item) => formatRuntimeValue(item)),
  ]
  return haystacks.some((item) => item === needle || item.includes(needle))
}

interface ExecuteStepInput {
  title: string
  code: string
}

interface ExecuteStepContext {
  page: Page
  project: { testBaseUrl: string }
  agentSessionId: string
  artifactsDir: string
  lastVerifiedCode: string
  analyzeImage?: (input: { dataUrl: string; mimeType: string; prompt: string }) => Promise<string>
  requestHumanInput?: (request: { reason: string; instruction: string; inputLabel?: string; placeholder?: string; confirmText?: string; imageUrl?: string }) => Promise<string>
  generateText?: (prompt: string, systemPrompt?: string) => Promise<string>
  resetBrowser: () => Promise<Page>
  forceReplayFromCheckpoint?: boolean
  /**
   * D 方案静态守卫：用例文案 + 已观察到的页面真实数据。
   * 在脚本里出现"页面有 但用例没提到"的字面量时，认定为硬编码业务数据并 warning。
   */
  dataGuard?: {
    caseTextCorpus: string
    pageDataCorpus: string
  }
  runtimeContext?: ScriptRuntimeContext
  onStep?: (step: any) => void
}

function normalizeForComparison(code: string): string {
  return code.split("\n").map((line) => line.trimEnd()).join("\n")
}

/**
 * D 方案静态守卫：扫描脚本里的字符串字面量，找出"页面快照里出现过、但用例描述里没出现过"的可疑业务数据。
 * 只 warning，不 block——避免误报阻断合法字面量（按钮名、列标题、URL 子路径等）。
 */
function detectHardcodedPageData(
  code: string,
  guard: { caseTextCorpus: string; pageDataCorpus: string },
): string[] {
  const sourceFile = ts.createSourceFile("step.ts", code, ts.ScriptTarget.ES2022, /*setParentNodes*/ true)
  const suspects = new Set<string>()
  const caseCorpus = guard.caseTextCorpus
  const pageCorpus = guard.pageDataCorpus

  function isPotentialBusinessData(text: string): boolean {
    if (text.length < 2 || text.length > 200) return false
    if (/^\s*$/.test(text)) return false
    if (text.startsWith("/") || text.startsWith("#") || text.startsWith(".") || text.startsWith("[")) return false
    if (/^[a-zA-Z][\w-]{0,40}$/.test(text)) return false
    if (/^https?:/i.test(text)) return false
    if (/^data:/i.test(text)) return false
    if (/[\u4e00-\u9fa5]/.test(text)) return true
    if (/\d{4,}/.test(text)) return true
    if (/^[A-Za-z]+\d+/.test(text)) return true
    if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(text)) return true
    return false
  }

  /**
   * 当字符串字面量是这些 locator 方法的参数（包括 { name: '...' } 选项）时，
   * 它本质上就是\u201c按稳定 UI 标签定位\u201d，里面的串属于设计层文本，不算硬编码业务数据。
   * 注意：getByText 没在白名单里——`getByText('测试1')` 这种"按数据值找记录"恰恰是想抓的反模式。
   */
  const SAFE_LOCATOR_METHODS = new Set([
    "getByRole",
    "getByLabel",
    "getByPlaceholder",
    "getByTitle",
    "getByAltText",
    "getByTestId",
  ])

  function isInsideSafeLocatorCall(node: ts.Node): boolean {
    let current: ts.Node | undefined = node.parent
    let depth = 0
    while (current && depth < 6) {
      if (ts.isCallExpression(current)) {
        const expr = current.expression
        if (ts.isPropertyAccessExpression(expr) && SAFE_LOCATOR_METHODS.has(expr.name.text)) {
          return true
        }
        return false
      }
      current = current.parent
      depth += 1
    }
    return false
  }

  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const raw = node.text
      if (raw && isPotentialBusinessData(raw) && !isInsideSafeLocatorCall(node)) {
        if (!caseCorpus.includes(raw) && pageCorpus.includes(raw)) {
          suspects.add(raw)
        }
      }
    } else if (ts.isTemplateExpression(node)) {
      if (!isInsideSafeLocatorCall(node)) {
        for (const span of node.templateSpans) {
          const literal = span.literal.text
          if (literal && isPotentialBusinessData(literal) && !caseCorpus.includes(literal) && pageCorpus.includes(literal)) {
            suspects.add(literal)
          }
        }
        const head = node.head.text
        if (head && isPotentialBusinessData(head) && !caseCorpus.includes(head) && pageCorpus.includes(head)) {
          suspects.add(head)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return [...suspects].slice(0, 8)
}

export async function executeStepTool(
  args: ExecuteStepInput,
  ctx: ExecuteStepContext,
): Promise<ToolExecutionResult & { newVerifiedCode?: string; newPage?: Page }> {
  const normalizedCode = normalizeForComparison(args.code)
  const normalizedLast = normalizeForComparison(ctx.lastVerifiedCode)

  let codeToExecute: string
  let page = ctx.page
  let isFullRerun = false

  if (ctx.forceReplayFromCheckpoint) {
    isFullRerun = true
    codeToExecute = args.code
    page = await ctx.resetBrowser()
  } else if (!ctx.lastVerifiedCode) {
    codeToExecute = args.code
  } else if (normalizedCode.startsWith(normalizedLast)) {
    codeToExecute = args.code.slice(ctx.lastVerifiedCode.length)
    if (!codeToExecute.trim()) {
      return {
        stage: "page",
        content: "提交的代码与上次验证通过的代码相同，没有新增内容需要执行。",
        url: page.url(),
        newVerifiedCode: ctx.lastVerifiedCode,
      }
    }
  } else {
    isFullRerun = true
    codeToExecute = args.code
    page = await ctx.resetBrowser()
  }

  const transpileResult = ts.transpileModule(codeToExecute, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  })
  const jsCode = transpileResult.outputText

  const human: HumanRuntime = {
    input: async (options) => {
      if (!ctx.requestHumanInput) {
        return "(人工输入不可用)"
      }
      return ctx.requestHumanInput({
        reason: options.reason,
        instruction: options.instruction,
        inputLabel: options.inputLabel,
        placeholder: options.placeholder,
      })
    },
  }

  const analyzeImageFromPage = async (options: { prompt: string; imageSelector?: string; selector?: string }) => {
      if (!ctx.analyzeImage) {
        return "(图片分析不可用)"
      }
      const targetSelector = options.imageSelector || options.selector
      const locator = targetSelector ? page.locator(targetSelector).first() : page
      const screenshotBuffer = await (targetSelector
        ? locator.screenshot({ type: "jpeg", quality: 80 })
        : page.screenshot({ type: "jpeg", quality: 80 }))
      const base64Data = screenshotBuffer.toString("base64")
      const dataUrl = `data:image/jpeg;base64,${base64Data}`
      return ctx.analyzeImage({ dataUrl, mimeType: "image/jpeg", prompt: options.prompt })
  }

  const ai: AiRuntime = {
    analyzeImage: analyzeImageFromPage,
    withImageRetry: async (options) => {
      const maxRetries = Math.max(1, options.maxRetries ?? 1)
      let lastText = ""
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        lastText = await analyzeImageFromPage(options)
        const valid = options.validate ? await options.validate(lastText) : Boolean(lastText.trim())
        if (valid) {
          return lastText
        }
        if (attempt < maxRetries && options.retry) {
          await options.retry(attempt, lastText)
        }
      }
      if (options.fallback) {
        return await options.fallback()
      }
      throw new Error(`IMAGE_RETRY_FAILED: 图片理解结果未通过校验，最后结果：${lastText}`)
    },
    generateText: async (prompt: string, systemPrompt?: string) => {
      if (!ctx.generateText) {
        return "(文本生成不可用)"
      }
      return ctx.generateText(prompt, systemPrompt)
    }
  }

  let testChain: Promise<any> = Promise.resolve()
  const test: TestRuntime = {
    step: (title, body) => {
      const p = testChain.then(() => body())
      testChain = p
      p.catch(() => {})
      return p
    },
  }

  const getBaseUrl = () => ctx.project.testBaseUrl
  const runtimeContext = ctx.runtimeContext ?? {
    outputs: [],
    tempValues: new Map<string, unknown>(),
  }

  const step: StepRuntime = async (title, purpose, fn) => {
    const id = `sub_step_${Math.random().toString(36).slice(2, 10)}`
    if (ctx.onStep) {
      ctx.onStep({
        id,
        type: "verification",
        stage: "verification",
        title,
        content: purpose,
        status: "running",
        timestamp: new Date().toISOString(),
      })
    }

    try {
      const result = await fn()
      let screenshotUrl: string | undefined
      try {
        screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `substep-${title}`)
      } catch (err) {
        console.warn("Failed to save substep screenshot:", err)
      }

      if (ctx.onStep) {
        ctx.onStep({
          id,
          type: "verification",
          stage: "verification",
          title,
          content: purpose,
          status: "completed",
          timestamp: new Date().toISOString(),
          screenshotUrl,
          url: page.url(),
        })
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      let screenshotUrl: string | undefined
      try {
        screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `substep-fail-${title}`)
      } catch (err) {
        console.warn("Failed to save substep fail screenshot:", err)
      }

      if (ctx.onStep) {
        ctx.onStep({
          id,
          type: "verification",
          stage: "verification",
          title,
          content: purpose,
          status: "error",
          detail: message,
          timestamp: new Date().toISOString(),
          screenshotUrl,
          url: page.url(),
        })
      }
      throw error
    }
  }

  const outputs: OutputsRuntime = {
    add: async (description, value, meta) => {
      const output: RuntimeOutput = {
        id: createRuntimeOutputId(ctx.agentSessionId),
        runId: ctx.agentSessionId,
        testCaseId: runtimeContext.producer?.testCaseId,
        caseCode: runtimeContext.producer?.caseCode,
        caseName: runtimeContext.producer?.caseName,
        description,
        value,
        meta,
        createdAt: new Date().toISOString(),
      }
      runtimeContext.outputs.push(output)
      return value
    },
  }

  const inputs: InputsRuntime = {
    get: async (options = {}) => {
      let candidates = [...runtimeContext.outputs]
      if (options.from) {
        candidates = candidates.filter((item) => matchesProducer(item, options.from!))
      }
      if (options.description) {
        const description = normalizeRuntimeMatch(options.description)
        candidates = candidates.filter((item) => normalizeRuntimeMatch(item.description) === description)
      }
      if (candidates.length === 1) {
        return candidates[0].value
      }
      if (candidates.length === 0) {
        throw new Error(`INPUT_OUTPUT_MISSING: 未找到匹配的上游输出。from=${options.from ?? ""} description=${options.description ?? ""}`)
      }
      throw new Error(`INPUT_OUTPUT_AMBIGUOUS: 匹配到多个上游输出，请指定 from 或 description。候选：${candidates.map((item) => `${item.caseName || item.caseCode || item.testCaseId || "unknown"}:${item.description}`).join("；")}`)
    },
  }

  const temp: TempRuntime = {
    store: async (_description, key, fn) => {
      const value = await fn()
      runtimeContext.tempValues.set(key, value)
      return value
    },
    get: async (key) => {
      if (!runtimeContext.tempValues.has(key)) {
        throw new Error(`TEMP_VALUE_MISSING: 未找到临时值 ${key}`)
      }
      return runtimeContext.tempValues.get(key) as any
    },
  }

  const guard: GuardRuntime = {
    ownedData: async (record, action) => {
      if (!isRuntimeOwnedData(record, runtimeContext.outputs, runtimeContext.tempValues)) {
        throw new Error(`OWNED_DATA_REQUIRED: 破坏性操作目标不在本次执行链输出或临时数据中：${formatRuntimeValue(record)}`)
      }
      return await action()
    },
  }

  // dev-loop 的简化版：execute_step 跑在 agent 生成阶段，超时是固定 60s（见 STEP_TIMEOUT_MS），
  // 这里只保证 schedule/loop/retry 的"形状"能跑：waitUntil 等到目标时刻、loop 反复轮询、retry 失败重试。
  // 真正长跑场景由运行时 timeoutMs 控制（runner 包内）。
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))
  const devLog = (line: string) => {
    console.log(`[agent-exec ${ctx.agentSessionId}] ${line}`)
  }
  const schedule: ScheduleRuntime = {
    waitUntil: async (target, options) => {
      const targetMs = target instanceof Date ? target.getTime() : typeof target === "number" ? target : Date.parse(target)
      if (!Number.isFinite(targetMs)) throw new Error(`schedule.waitUntil: 无法解析目标时间 ${String(target)}`)
      const pollMs = Math.max(50, options?.pollMs ?? 200)
      devLog(`schedule.waitUntil dev-mode → ${new Date(targetMs).toISOString()} (剩余 ${Math.max(0, Math.ceil((targetMs - Date.now()) / 1000))}s；注意 execute_step 仅 ${Math.round(STEP_TIMEOUT_MS / 1000)}s 验证窗口，长 wait 请放到真正运行时验证)`)
      while (Date.now() < targetMs) {
        await sleep(Math.min(pollMs, Math.max(50, targetMs - Date.now())))
      }
    },
  }
  const loop: LoopRuntime = {
    until: async (predicate, options) => {
      const intervalMs = Math.max(50, options.intervalMs)
      const startedAt = Date.now()
      const deadline = options.timeoutMs ? startedAt + options.timeoutMs : Number.POSITIVE_INFINITY
      const maxRounds = options.maxRounds ?? Number.POSITIVE_INFINITY
      const label = options.description ?? "loop.until"
      devLog(`${label} dev-mode start intervalMs=${intervalMs} timeoutMs=${options.timeoutMs ?? "∞"} maxRounds=${options.maxRounds ?? "∞"}`)
      let round = 0
      for (;;) {
        round += 1
        const result = await predicate()
        if (result) {
          devLog(`${label} 第 ${round} 轮命中`)
          return result as any
        }
        if (round >= maxRounds) throw new Error(`LOOP_UNTIL_MAX_ROUNDS: ${label} 达到最大轮次 ${maxRounds}`)
        if (Date.now() + intervalMs > deadline) throw new Error(`LOOP_UNTIL_TIMEOUT: ${label} 已超过 ${options.timeoutMs} ms`)
        await sleep(intervalMs)
      }
    },
  }
  const retry: RetryRuntime = async (fn, options) => {
    const times = Math.max(1, options?.times ?? 3)
    const baseDelay = options?.backoffMs ?? 0
    const factor = options?.backoffFactor ?? 1
    const label = options?.description ?? "retry"
    let lastError: unknown
    for (let attempt = 1; attempt <= times; attempt += 1) {
      try {
        const result = await fn(attempt)
        if (attempt > 1) devLog(`${label} 第 ${attempt} 次尝试成功`)
        return result
      } catch (err) {
        lastError = err
        const shouldRetry = options?.shouldRetry ? await options.shouldRetry(err, attempt) : true
        if (!shouldRetry || attempt >= times) {
          devLog(`${label} 第 ${attempt}/${times} 次失败：${err instanceof Error ? err.message : String(err)}（放弃）`)
          break
        }
        devLog(`${label} 第 ${attempt} 次失败：${err instanceof Error ? err.message : String(err)}；${baseDelay * Math.pow(factor, attempt - 1)} ms 后重试`)
        await sleep(baseDelay * Math.pow(factor, attempt - 1))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`RETRY_EXHAUSTED: ${label}`)
  }

  const http: HttpRuntime = {
    get: async (url, options) => {
      devLog(`http.get: ${url}`)
      const query = options?.params ? `?${new URLSearchParams(options.params).toString()}` : ""
      const res = await fetch(url + query, { headers: options?.headers })
      if (!res.ok) throw new Error(`HTTP GET ${url} failed with status ${res.status}`)
      const text = await res.text()
      try { return JSON.parse(text) } catch { return text }
    },
    post: async (url, options) => {
      devLog(`http.post: ${url}`)
      const isJson = options?.data && typeof options.data === "object"
      const headers = { ...(isJson ? { "Content-Type": "application/json" } : {}), ...options?.headers }
      const body = isJson ? JSON.stringify(options.data) : options?.data
      const res = await fetch(url, { method: "POST", headers, body })
      if (!res.ok) throw new Error(`HTTP POST ${url} failed with status ${res.status}`)
      const text = await res.text()
      try { return JSON.parse(text) } catch { return text }
    }
  }

  try {
    const executor = new AsyncExecutor("page", "expect", "human", "ai", "test", "getBaseUrl", "step", "outputs", "inputs", "temp", "guard", "schedule", "loop", "retry", "http", jsCode)

    const execution = async () => {
      await executor(page, expect, human, ai, test, getBaseUrl, step, outputs, inputs, temp, guard, schedule, loop, retry, http)
      await testChain
    }

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`步骤执行超时（已超过 ${Math.round(STEP_TIMEOUT_MS / 1000)} 秒）`)), STEP_TIMEOUT_MS)
    })

    await Promise.race([execution(), timeout])

    const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `step-${args.title}`)
    const hardcodeWarning = ctx.dataGuard
      ? buildHardcodeWarning(detectHardcodedPageData(args.code, ctx.dataGuard))
      : ""
    // 即使断言“通过”，也可能落在风控页（断言写得太宽时会出现假性 PASS）→ 显式提示，避免误判已完成。
    const passRisk = await detectRiskControl(page).catch(() => ({ blocked: false, kind: null, reason: "" }))
    const passRiskBanner = passRisk.blocked ? `\n\n${riskControlBanner(passRisk)}` : ""
    return {
      stage: "page",
      content: `步骤「${args.title}」执行成功。${isFullRerun ? "（检测到早期代码修改，已重置浏览器从头执行）" : ""}\n当前 URL: ${page.url()}${hardcodeWarning}${passRiskBanner}`,
      screenshotUrl,
      url: page.url(),
      newVerifiedCode: args.code,
      newPage: isFullRerun ? page : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `step-fail-${args.title}`).catch(() => undefined)
    let pageSnapshot = ""
    try {
      pageSnapshot = await getPageSnapshot(page)
    } catch {
      pageSnapshot = "(无法获取页面快照)"
    }

    const hardcodeWarning = ctx.dataGuard
      ? buildHardcodeWarning(detectHardcodedPageData(args.code, ctx.dataGuard))
      : ""

    // 风控拦截置顶：很多“undefined / includes is not a function / 超时”其实是被风控打回后页面为空导致的次生错误，
    // 必须先告诉 LLM 这是环境拦截，避免它去改选择器或重写早期步骤。
    const failRisk = await detectRiskControl(page).catch(() => ({ blocked: false, kind: null, reason: "" }))
    const failRiskBanner = failRisk.blocked ? riskControlBanner(failRisk) : ""

    return {
      stage: "page",
      content: [
        failRiskBanner,
        `步骤「${args.title}」执行失败。${isFullRerun ? "（已重置浏览器从头执行）" : ""}`,
        `错误: ${message}`,
        `当前 URL: ${page.url()}`,
        hardcodeWarning ? hardcodeWarning.trim() : "",
        "",
        "当前页面结构:",
        pageSnapshot,
      ].filter(Boolean).join("\n"),
      screenshotUrl,
      url: page.url(),
      newPage: isFullRerun ? page : undefined,
    }
  }
}

function buildHardcodeWarning(suspects: string[]): string {
  if (suspects.length === 0) return ""
  const list = suspects.map((s) => JSON.stringify(s)).join(", ")
  return (
    `\n\n⚠️ 测试数据守卫（D 方案）：在脚本里检测到 ${suspects.length} 个疑似硬编码的页面业务数据字面量: ${list}。` +
    `\n这些值出现在当前页面快照里但不在本次用例的描述/操作步骤/预期结果里，意味着它们是当前测试环境的具体数据——换个测试地址就会失效。` +
    `\n请改成运行时锚定（先用 temp.store(description, key, fn) 读出值存到变量，再用变量做后续操作/断言），或换成稳定的 UI 文案（按钮名、列标题、状态枚举等）。` +
    `\n（如果你确实在断言一个稳定的 UI 文案被误报，请忽略本提示并在下个 execute_step 继续。）`
  )
}
