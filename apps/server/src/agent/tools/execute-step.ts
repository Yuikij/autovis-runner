import * as ts from "typescript"
import { type Page, expect } from "@playwright/test"
import { type CaseContract, type DataTableScriptApi, type KnowledgeScriptApi, type RuntimeOutput } from "@autovis/shared"
import { type ToolDefinition } from "../../llm.js"
import { detectRiskControl, getPageSnapshot, riskControlBanner, saveAgentScreenshot } from "../helpers.js"
import { RISK_CONTROL_ERROR_PREFIX } from "@autovis/runner"
import { type ScriptRuntimeContext, type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { extname, join, resolve } from "node:path"

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
          timeoutMs: { type: "number", description: "本次执行的超时毫秒数，默认 60000，上限 600000。预计耗时长的步骤（滚动采集虚拟列表长文、遍历多条目、步骤内多次 ai.generate 等）主动调大，不要为凑 60 秒去阉割步骤逻辑。触发整段重放时系统会自动取历史请求过的最大值兜底。" },
        },
        required: ["title", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "probe_step",
      description: "探索期一次性探针：在**当前实时页面**上执行一段代码，把 return 的值 JSON 序列化带回给你，代码**不进入累积脚本**。用于回答 inspect/query 工具答不了的假设性问题：列表是否虚拟渲染（滚动前后 innerText 长度对比）、点击某元素开不开新标签页、重复卡片的真实 class/属性结构、某选择器能否稳定枚举条目、正文块类型分布等。复杂采集类任务在固化前先用它做实验，比在 execute_step 里试错便宜得多（execute_step 失败会污染累积脚本并触发整段重放）。注意：探针可能改变页面状态，下一次 execute_step 会自动重置浏览器重放已验证前缀，这是预期成本。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "探针目的，如：验证精华列表滚动加载行为 / 测点击卡片是否开新标签页" },
          code: { type: "string", description: "一次性执行的代码，可用符号与 execute_step 完全相同（page/expect/loop/retry/temp/ai/knowledge/tables 等）。用 return 带回观测结果（对象会 JSON 序列化，控制体积，别 return 整页 HTML）。" },
          timeoutMs: { type: "number", description: "超时毫秒数，默认 60000，上限 600000。" },
        },
        required: ["title", "code"],
      },
    },
  },
]

// 步骤超时：默认 60s，LLM 可按步骤耗时自行调大（timeoutMs 参数），上限 10 分钟。
// 不写死单一值的原因：滚动采集虚拟列表长文、步骤内调用 ai.generate 等合法场景
// 天然超过 60s，硬卡会逼着 LLM 阉割步骤逻辑（见知识库采集用例的失败复盘）。
const DEFAULT_STEP_TIMEOUT_MS = 60_000
const MIN_STEP_TIMEOUT_MS = 15_000
const MAX_STEP_TIMEOUT_MS = 600_000
// 生成期只证明脚本逻辑成立，不真跑长时长：把 loop.forDuration / loop.times 的长时长 / 大轮次截成短探。
// 真实时长 / 轮次由 runner 包的运行时控制。
const GEN_PHASE_PROBE_MS = 5_000
const GEN_PHASE_PROBE_ROUNDS = 20

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
  generate: (prompt: string, systemPrompt?: string) => Promise<string>
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

/**
 * 风控/反自动化拦截运行时（生成期校验版）。与 runner 包同构：进入强风控环节后调用，
 * 命中即抛标准化 `RISK_CONTROL_BLOCKED`（retry 默认不重试这类错误）。
 */
interface RiskRuntime {
  check: () => Promise<{ blocked: boolean; kind: string | null; reason: string }>
  blocked: () => Promise<boolean>
  assertClear: (label?: string) => Promise<void>
}

/**
 * 富产物输出运行时（生成期校验版）。与 runner 包同构：把脚本生成的长内容落盘成产物，返回可访问路径。
 * 生成期落到 artifacts/reports 目录并返回本地路径，让用到 report.* 的脚本能即时跑通验证。
 */
interface ReportRuntime {
  html: (title: string, html: string) => Promise<string>
  text: (name: string, content: string) => Promise<string>
}

/**
 * 外部 API 入参运行时（生成期校验版）。读取「已按契约校验」的入参；
 * 生成期用契约里声明的 `default` 当占位值，让参数化脚本能即时跑通验证。
 * 与运行时（runner 包）实现保持同构，确保脚本在两处行为一致。
 */
interface ParamsRuntime {
  get: <T = unknown>(name: string) => T
  all: () => Record<string, unknown>
}

/** 外部 API 响应运行时（生成期校验版）：收集 result.set 写入的响应体，便于人 review。 */
interface ResultRuntime {
  set: (key: string, value: unknown) => void
  setAll: (values: Record<string, unknown>) => void
}

/** 文件运行时（生成期校验版）：真实下载到 artifacts 目录并返回本地路径。 */
interface FilesRuntime {
  download: (url: string, fileName?: string) => Promise<string>
}

interface LoopRuntime {
  until: <T>(predicate: () => Promise<T | false | null | undefined> | T | false | null | undefined, options: {
    intervalMs: number
    timeoutMs?: number
    maxRounds?: number
    description?: string
    logEveryRound?: number
  }) => Promise<T>
  forDuration: <T>(ms: number, fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, options?: {
    intervalMs?: number
    description?: string
    logEveryRound?: number
  }) => Promise<T | undefined>
  times: <T>(n: number, fn: (round: number) => Promise<T | false | null | undefined> | T | false | null | undefined, options?: {
    intervalMs?: number
    description?: string
    logEveryRound?: number
  }) => Promise<T | undefined>
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
  risk: RiskRuntime,
  report: ReportRuntime,
  params: ParamsRuntime,
  result: ResultRuntime,
  files: FilesRuntime,
  tables: DataTableScriptApi,
  knowledge: KnowledgeScriptApi,
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
  /** 本次执行的超时毫秒数（LLM 可自定），缺省 60s，钳制在 [15s, 10min]。 */
  timeoutMs?: number
  /**
   * 探针模式（probe_step）：代码在当前实时页面状态上一次性执行，不校验/不进入累积脚本，
   * 不重置浏览器；return 值 JSON 序列化后带回。调用方需在探针后标记 liveStateDirty。
   */
  probe?: boolean
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
   * 整段重放时的超时下限（毫秒）：取本会话历史 execute_step 请求过的最大 timeoutMs。
   * 重放会从头执行整个累积脚本——若早期有重步骤，仅按本次请求的超时跑必然误杀。
   */
  replayTimeoutFloorMs?: number
  runtimeContext?: ScriptRuntimeContext
  /**
   * 当前用例的 API 契约（若有）。固化阶段 `define_contract` 声明后会被线程化更新。
   * 生成期校验时按契约的 `default` 注入占位入参，让参数化脚本（params.get）能即时跑通。
   */
  contract?: CaseContract
  /** 项目级 data-tables 运行时 API；生成期校验时让使用 `tables` 的脚本能即时跑通。 */
  dataTables?: DataTableScriptApi
  /** 项目级知识库运行时 API；生成期校验时让使用 `knowledge` 的脚本能即时跑通。 */
  knowledge?: KnowledgeScriptApi
  onStep?: (step: any) => void
}

function normalizeForComparison(code: string): string {
  return code.split("\n").map((line) => line.trimEnd()).join("\n")
}

/** 把 LLM 请求的步骤超时钳制到合法区间；未传或非法值回落默认 60s。 */
export function clampStepTimeoutMs(requested: unknown): number {
  const value = typeof requested === "number" && Number.isFinite(requested) ? requested : DEFAULT_STEP_TIMEOUT_MS
  return Math.min(MAX_STEP_TIMEOUT_MS, Math.max(MIN_STEP_TIMEOUT_MS, Math.round(value)))
}

export async function executeStepTool(
  args: ExecuteStepInput,
  ctx: ExecuteStepContext,
): Promise<ToolExecutionResult & { newVerifiedCode?: string; newPage?: Page; stepFailed?: boolean }> {
  const normalizedCode = normalizeForComparison(args.code)
  const normalizedLast = normalizeForComparison(ctx.lastVerifiedCode)

  let codeToExecute: string
  let page = ctx.page
  let isFullRerun = false

  if (args.probe) {
    // 探针：直接在当前实时状态上跑，不做前缀校验、不重置浏览器。
    codeToExecute = args.code
  } else if (ctx.forceReplayFromCheckpoint) {
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

  // ---- 产物回执：收集本次执行的 knowledge/tables/outputs 写入，成功后原样回给 LLM ----
  // 只验证"不抛错"会放过语义级假成功（比如把整个列表页 innerText 当帖子存了）。
  // 把产物的路径 + 字节数 + 内容首尾摘录塞进回执，LLM 一眼就能对出"存的是不是我要的东西"。
  const MAX_SIDE_EFFECT_ENTRIES = 10
  const sideEffects: string[] = []
  const pushSideEffect = (line: string) => {
    if (sideEffects.length < MAX_SIDE_EFFECT_ENTRIES) sideEffects.push(line)
    else if (sideEffects.length === MAX_SIDE_EFFECT_ENTRIES) sideEffects.push("…（本步产物较多，其余省略）")
  }
  const excerptOneLine = (text: string, maxLen: number) => {
    const collapsed = text.replace(/\s+/g, " ").trim()
    return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen)}…` : collapsed
  }
  const safeJsonOneLine = (value: unknown, maxLen: number) => {
    try {
      return excerptOneLine(JSON.stringify(value) ?? String(value), maxLen)
    } catch {
      return excerptOneLine(String(value), maxLen)
    }
  }

  // ---- 新标签页检测基线：点击类操作若开了新页，原 page URL 不变，是最常见的假成功来源 ----
  const pagesBefore = new Set(page.context().pages())
  const describeStrayPages = () => {
    const strays = page.context().pages().filter((p) => !pagesBefore.has(p) && !p.isClosed())
    if (!strays.length) return ""
    const urls = strays.map((p) => p.url()).join("、")
    return `\n\n⚠️ 本步执行后 context 里多了 ${strays.length} 个未关闭的新标签页: ${urls}\n`
      + "若这是点击开出来的详情页/文档页，说明目标内容在**新页**上而不是当前 page——"
      + "正确写法是 `const [p] = await Promise.all([page.context().waitForEvent('page'), locator.click()])` 之后操作 `p`，用完 `await p.close()`；"
      + "在原 page 上等 URL 变化 / 用弱断言（如 h1 存在）判定成功都会假通过。"
  }

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
    generate: async (prompt: string, systemPrompt?: string) => {
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
      pushSideEffect(`- outputs.add「${description}」= ${safeJsonOneLine(value, 300)}`)
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
    waitUntil: async (target) => {
      const targetMs = target instanceof Date ? target.getTime() : typeof target === "number" ? target : Date.parse(target)
      if (!Number.isFinite(targetMs)) throw new Error(`schedule.waitUntil: 无法解析目标时间 ${String(target)}`)
      const remainMs = targetMs - Date.now()
      // 生成期只证明逻辑成立：目标在未来时**立即返回不真等**（否则会撞 60s 验证窗口）。
      // 真实等待到点由 runner 包的运行时控制。
      if (remainMs > 0) {
        devLog(`schedule.waitUntil dev-mode：目标 ${new Date(targetMs).toISOString()} 在未来（剩 ${Math.ceil(remainMs / 1000)}s），生成期立即返回，真实等待由运行时控制`)
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
    // 生成期：把长时长截成短探，跑几轮证明 fn 不抛错即返回（不抛超时错），真实时长交给运行时。
    forDuration: async (ms, fn, options) => {
      const intervalMs = Math.max(0, options?.intervalMs ?? 200)
      const label = options?.description ?? "loop.forDuration"
      const effectiveMs = Math.min(Math.max(0, ms), GEN_PHASE_PROBE_MS)
      const deadline = Date.now() + effectiveMs
      devLog(`${label} dev-mode 短探 ${effectiveMs}ms（真实 ${ms}ms 由运行时控制）`)
      let round = 0
      for (;;) {
        round += 1
        try {
          const result = await fn()
          if (result) { devLog(`${label} 第 ${round} 轮提前命中`); return result as any }
        } catch (err) {
          devLog(`${label} 第 ${round} 轮抛错（已吞，继续）: ${err instanceof Error ? err.message : String(err)}`)
        }
        if (Date.now() + intervalMs >= deadline) { devLog(`${label} dev-mode 短探结束（${round} 轮）`); return undefined }
        await sleep(intervalMs)
      }
    },
    times: async (n, fn, options) => {
      const intervalMs = Math.max(0, options?.intervalMs ?? 200)
      const label = options?.description ?? "loop.times"
      const total = Math.min(Math.max(1, Math.floor(n)), GEN_PHASE_PROBE_ROUNDS)
      devLog(`${label} dev-mode 跑 ${total} 轮（真实 ${n} 轮由运行时控制）`)
      for (let round = 1; round <= total; round += 1) {
        try {
          const result = await fn(round)
          if (result) { devLog(`${label} 第 ${round} 轮提前命中`); return result as any }
        } catch (err) {
          devLog(`${label} 第 ${round} 轮抛错（已吞，继续）: ${err instanceof Error ? err.message : String(err)}`)
        }
        if (round < total) await sleep(intervalMs)
      }
      devLog(`${label} dev-mode ${total} 轮结束`)
      return undefined
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

  // 风控检测（生成期版）：与 runner 同构，命中即抛标准化 RISK_CONTROL_BLOCKED，retry 默认不重试。
  const risk: RiskRuntime = {
    check: async () => detectRiskControl(page),
    blocked: async () => (await detectRiskControl(page)).blocked,
    assertClear: async (label) => {
      const signal = await detectRiskControl(page)
      if (signal.blocked) {
        const prefix = label ? `${label} - ` : ""
        devLog(`风控拦截 · ${prefix}${signal.reason}（kind=${signal.kind}）`)
        throw new Error(`${RISK_CONTROL_ERROR_PREFIX}: ${prefix}${signal.reason}`)
      }
    },
  }

  // 富产物输出（生成期版）：与 runner 同构，落盘到 artifacts/reports 并返回本地路径，供脚本即时校验跑通。
  let reportSeq = 0
  const slugifyReport = (raw: string) =>
    (raw || "report")
      .trim()
      .replace(/[/\\?%*:|"<>\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "report"
  const writeReportFile = (fileName: string, content: string) => {
    const dir = resolve(ctx.artifactsDir, "reports")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const localPath = join(dir, fileName)
    writeFileSync(localPath, content)
    devLog(`report 已落盘：${localPath}`)
    return localPath
  }
  const report: ReportRuntime = {
    html: async (title, html) => {
      reportSeq += 1
      const fileName = `report-${reportSeq}-${slugifyReport(title)}.html`
      const hasDoc = /<!doctype|<html[\s>]/i.test(html)
      const doc = hasDoc
        ? html
        : `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
          `<style>body{max-width:860px;margin:2rem auto;padding:0 1rem;font:16px/1.7 -apple-system,Segoe UI,Roboto,"Helvetica Neue",sans-serif;color:#1a1a1a}h1,h2,h3{line-height:1.3}pre,code{background:#f5f5f5;border-radius:4px}pre{padding:1rem;overflow:auto}blockquote{border-left:3px solid #ddd;margin:0;padding:.2rem 1rem;color:#555}</style>` +
          `</head><body>${html}</body></html>`
      return writeReportFile(fileName, doc)
    },
    text: async (name, content) => {
      reportSeq += 1
      const safe = slugifyReport(name)
      const fileName = /\.[a-z0-9]{1,8}$/i.test(name) ? safe : `${safe}.txt`
      return writeReportFile(fileName, content)
    },
  }

  // -- API 化运行时（生成期校验版）--
  // 与 runner 包的运行时实现保持同构：params 用契约 default 当占位值，result 收集响应，files 真实下载。
  // 这样 LLM 写出的参数化脚本（params.get / result.set / files.download）在生成期就能即时校验跑通。
  const contractParams = ctx.contract?.params ?? []
  const apiParamValues: Record<string, unknown> = {}
  for (const field of contractParams) {
    if (field.default !== undefined) {
      apiParamValues[field.name] = field.default
    }
  }
  const apiResult: Record<string, unknown> = {}

  const params: ParamsRuntime = {
    get: <T = unknown>(name: string) => {
      const value = apiParamValues[name]
      devLog(`params.get(${name}) = ${JSON.stringify(value) ?? String(value)}`)
      return value as T
    },
    all: () => ({ ...apiParamValues }),
  }

  const result: ResultRuntime = {
    set: (key, value) => {
      apiResult[key] = value
      devLog(`result.set(${key}) = ${JSON.stringify(value) ?? String(value)}`)
    },
    setAll: (values) => {
      Object.assign(apiResult, values)
      devLog(`result.setAll(${Object.keys(values).join(", ")})`)
    },
  }

  const files: FilesRuntime = {
    download: async (url, fileName) => {
      devLog(`files.download: ${url}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`下载文件失败：HTTP ${res.status} - ${url}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      const urlTail = url.split("/").pop()?.split("?")[0]
      const baseName = fileName ?? (urlTail && urlTail.length > 0 ? urlTail : `download-${Date.now()}`)
      const safeName = /[\\/]/.test(baseName) ? `download-${Date.now()}${extname(baseName) || ""}` : baseName
      const dir = resolve(ctx.artifactsDir, "downloads")
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const localPath = join(dir, safeName)
      writeFileSync(localPath, buffer)
      devLog(`files.download 已落盘：${localPath}`)
      return localPath
    },
  }

  const unavailableTables = (): never => {
    throw new Error("DATA_TABLES_UNAVAILABLE: 当前运行环境未启用数据表能力（tables.* 不可用）")
  }
  const tablesBase: DataTableScriptApi = ctx.dataTables ?? {
    insert: unavailableTables,
    find: unavailableTables,
    findOne: unavailableTables,
    exists: unavailableTables,
    update: unavailableTables,
    upsert: unavailableTables,
    delete: unavailableTables,
  }
  const tables: DataTableScriptApi = {
    ...tablesBase,
    insert: async (tableName, row) => {
      const inserted = await tablesBase.insert(tableName, row)
      pushSideEffect(`- tables.insert ${tableName} ← ${safeJsonOneLine(row, 260)}`)
      return inserted
    },
    update: async (tableName, match, patch) => {
      const affected = await tablesBase.update(tableName, match, patch)
      pushSideEffect(`- tables.update ${tableName}（match=${safeJsonOneLine(match, 120)}，影响 ${affected} 行）← ${safeJsonOneLine(patch, 200)}`)
      return affected
    },
    upsert: async (tableName, match, row) => {
      const saved = await tablesBase.upsert(tableName, match, row)
      pushSideEffect(`- tables.upsert ${tableName}（match=${safeJsonOneLine(match, 120)}）← ${safeJsonOneLine(row, 200)}`)
      return saved
    },
  }

  const unavailableKnowledge = (): never => {
    throw new Error("KNOWLEDGE_UNAVAILABLE: 当前运行环境未启用知识库能力（knowledge.* 不可用）")
  }
  const knowledgeBase: KnowledgeScriptApi = ctx.knowledge ?? {
    write: unavailableKnowledge,
    read: unavailableKnowledge,
    exists: unavailableKnowledge,
    mkdir: unavailableKnowledge,
    list: unavailableKnowledge,
    saveAsset: unavailableKnowledge,
    remove: unavailableKnowledge,
  }
  const knowledge: KnowledgeScriptApi = {
    ...knowledgeBase,
    write: async (path, content) => {
      const saved = await knowledgeBase.write(path, content)
      pushSideEffect(
        `- knowledge.write ${saved}（${Buffer.byteLength(content, "utf-8")} 字节）\n`
        + `    开头: ${excerptOneLine(content, 200)}\n`
        + `    结尾: ${excerptOneLine(content.slice(-400), 140)}`,
      )
      return saved
    },
    mkdir: async (path) => {
      const created = await knowledgeBase.mkdir(path)
      pushSideEffect(`- knowledge.mkdir ${created}`)
      return created
    },
    saveAsset: async (path, url) => {
      const saved = await knowledgeBase.saveAsset(path, url)
      pushSideEffect(`- knowledge.saveAsset ${saved} ← ${url}`)
      return saved
    },
  }

  try {
    const executor = new AsyncExecutor("page", "expect", "human", "ai", "test", "getBaseUrl", "step", "outputs", "inputs", "temp", "guard", "schedule", "loop", "retry", "http", "risk", "report", "params", "result", "files", "tables", "knowledge", jsCode)

    let probeReturnValue: unknown
    const execution = async () => {
      probeReturnValue = await executor(page, expect, human, ai, test, getBaseUrl, step, outputs, inputs, temp, guard, schedule, loop, retry, http, risk, report, params, result, files, tables, knowledge)
      await testChain
    }

    // 本次超时 = LLM 请求值（钳制后）；整段重放时再以会话历史最大值兜底——
    // 重放跑的是完整累积脚本，早期重步骤的耗时必须计入。
    const requestedTimeoutMs = clampStepTimeoutMs(args.timeoutMs)
    const effectiveTimeoutMs = isFullRerun
      ? Math.max(requestedTimeoutMs, clampStepTimeoutMs(ctx.replayTimeoutFloorMs ?? 0))
      : requestedTimeoutMs
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(
        `步骤执行超时（已超过 ${Math.round(effectiveTimeoutMs / 1000)} 秒）。`
        + `若该步骤本身就需要更长时间（滚动采集长文、遍历列表、步骤内 ai.generate 等），`
        + `请在 execute_step 传更大的 timeoutMs（当前 ${effectiveTimeoutMs}，上限 ${MAX_STEP_TIMEOUT_MS}）重试，不要为省时间砍掉步骤逻辑。`,
      )), effectiveTimeoutMs)
    })

    await Promise.race([execution(), timeout])

    const screenshotUrl = await saveAgentScreenshot(page, ctx.artifactsDir, ctx.agentSessionId, `step-${args.title}`)
    // 即使断言“通过”，也可能落在风控页（断言写得太宽时会出现假性 PASS）→ 显式提示，避免误判已完成。
    const passRisk = await detectRiskControl(page).catch(() => ({ blocked: false, kind: null, reason: "" }))
    const passRiskBanner = passRisk.blocked ? `\n\n${riskControlBanner(passRisk)}` : ""
    const strayPagesBanner = describeStrayPages()
    const sideEffectsEcho = sideEffects.length
      ? `\n\n[本步产物回执——逐条核对是否符合预期：路径/分类对不对、开头是不是目标内容（若是导航菜单/列表页文本说明抓错了源）、字节数是否合理。不符合就视为本步失败，修正后重交]\n${sideEffects.join("\n")}`
      : ""

    if (args.probe) {
      let returnedText: string
      try {
        returnedText = JSON.stringify(probeReturnValue, null, 1) ?? String(probeReturnValue)
      } catch {
        returnedText = String(probeReturnValue)
      }
      if (returnedText.length > 6000) returnedText = `${returnedText.slice(0, 6000)}…（已截断）`
      return {
        stage: "page",
        content: `探针「${args.title}」执行完成。\n当前 URL: ${page.url()}\n返回值:\n${returnedText}${strayPagesBanner}${sideEffectsEcho}${passRiskBanner}`,
        screenshotUrl,
        url: page.url(),
      }
    }

    return {
      stage: "page",
      content: `步骤「${args.title}」执行成功。${isFullRerun ? "（检测到早期代码修改，已重置浏览器从头执行）" : ""}\n当前 URL: ${page.url()}${strayPagesBanner}${sideEffectsEcho}${passRiskBanner}`,
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

    // 风控拦截置顶：很多“undefined / includes is not a function / 超时”其实是被风控打回后页面为空导致的次生错误，
    // 必须先告诉 LLM 这是环境拦截，避免它去改选择器或重写早期步骤。
    const failRisk = await detectRiskControl(page).catch(() => ({ blocked: false, kind: null, reason: "" }))
    const failRiskBanner = failRisk.blocked ? riskControlBanner(failRisk) : ""

    return {
      stage: "page",
      content: [
        failRiskBanner,
        `${args.probe ? "探针" : "步骤"}「${args.title}」执行失败。${isFullRerun ? "（已重置浏览器从头执行）" : ""}`,
        `错误: ${message}`,
        `当前 URL: ${page.url()}`,
        describeStrayPages().trim(),
        "",
        "当前页面结构:",
        pageSnapshot,
      ].filter(Boolean).join("\n"),
      screenshotUrl,
      url: page.url(),
      newPage: isFullRerun ? page : undefined,
      stepFailed: true,
    }
  }
}
