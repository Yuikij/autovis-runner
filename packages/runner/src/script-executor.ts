import { readFile } from "node:fs/promises"
import * as ts from "typescript"
import { expect, type Page } from "@playwright/test"
import type { ExecutionRun, HumanHandoffReason, HumanHandoffRequest, RuntimeOutput } from "@autovis/shared"
import { markRunStep, artifactUrlToFilePath, inferMimeTypeFromPath, formatRuntimeValue, createRuntimeOutputId, isRuntimeOwnedData, matchesProducer, now, normalizeRuntimeMatch } from "./utils.js"
import { captureElementScreenshot, captureStepScreenshot } from "./browser-manager.js"
import type { ExecutePlaywrightRunInput, ExecuteScriptInSessionInput, RunnerSession } from "./types.js"

interface HumanInputOptions {
  reason: HumanHandoffReason
  instruction: string
  inputLabel?: string
  placeholder?: string
  confirmText?: string
  imageSelector?: string
}

interface HumanRuntime {
  input: (options: HumanInputOptions) => Promise<string>
}

interface AiAnalyzeImageOptions {
  prompt: string
  imageSelector?: string
  selector?: string
}

interface AiRuntime {
  analyzeImage: (options: AiAnalyzeImageOptions) => Promise<string>
  withImageRetry: (options: {
    imageSelector?: string
    selector?: string
    prompt: string
    maxRetries?: number
    validate?: (text: string) => boolean | Promise<boolean>
    retry?: (retryTimes: number, lastText: string) => Promise<void> | void
    fallback?: () => Promise<string> | string
  }) => Promise<string>
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

/**
 * 长跑/抢购等场景常用的脚本运行时方法。三个方法都会响应任务取消（throw "Task cancelled"）与暂停（等待恢复），
 * 不依赖外层 5 分钟超时也能稳定运行（具体单次脚本超时由调用方 timeoutMs 控制）。
 */
interface ScheduleRuntime {
  /** 等到目标时刻（ISO 字符串、Date 或毫秒时间戳）。可在等待中被 cancel 中断、被 pause 卡住。 */
  waitUntil: (target: string | number | Date, options?: { pollMs?: number; logEverySec?: number }) => Promise<void>
}

interface LoopRuntime {
  /** 反复执行 predicate，直到返回真值即返回该值；可设置间隔、上限耗时、上限轮次、每多少轮打一行日志。 */
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
) => Promise<void>

const AsyncExecutor = Object.getPrototypeOf(async function () {
  return undefined
}).constructor as new (...args: string[]) => ScriptExecutor

export const extractScriptBody = (code: string) => {
  const trimmed = code.trim()

  const sourceFile = ts.createSourceFile("temp.ts", trimmed, ts.ScriptTarget.Latest, true)
  const unwrapExpression = (expression: ts.Expression): ts.Expression => {
    let current = expression
    while (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current)
    ) {
      current = current.expression
    }
    return current
  }

  let bodyNode: ts.Block | null = null
  if (sourceFile.statements.length === 1) {
    const [statement] = sourceFile.statements
    if (ts.isFunctionDeclaration(statement) && statement.body) {
      bodyNode = statement.body
    } else if (ts.isExpressionStatement(statement)) {
      const expression = unwrapExpression(statement.expression)
      if ((ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) && ts.isBlock(expression.body)) {
        bodyNode = expression.body
      }
    } else if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
      const [declaration] = statement.declarationList.declarations
      const initializer = declaration.initializer ? unwrapExpression(declaration.initializer) : null
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && ts.isBlock(initializer.body)) {
        bodyNode = initializer.body
      }
    } else if (ts.isExportAssignment(statement)) {
      const expression = unwrapExpression(statement.expression)
      if ((ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) && ts.isBlock(expression.body)) {
        bodyNode = expression.body
      }
    }
  }

  if (bodyNode) {
    const text = bodyNode.getText(sourceFile)
    return text.substring(1, text.length - 1).trim()
  }

  const lines = trimmed.split("\n")
  const hasImports = lines.some((line) => /^\s*(import\s|const\s.*=\s*require\()/.test(line))
  if (hasImports) {
    const bodyLines = lines.filter((line) => !/^\s*import\s/.test(line) && !/^\s*const\s.*=\s*require\(/.test(line))
    const joined = bodyLines.join("\n").trim()
    if (joined) return joined
  }

  if (trimmed) {
    return trimmed
  }

  throw new Error("Unsupported Playwright script format")
}

export const instrumentPageActions = (
  page: Page,
  run: ExecutionRun,
  onUpdate: () => Promise<void> | void,
  guard?: { waitIfPaused?: () => Promise<void>; signal?: AbortSignal },
) => {
  const debugAccessedProps = new Set<string>()
  const appendActionLog = async (message: string) => {
    console.log(`[Runner Action] ${message}`)
    run.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`)
    await onUpdate()
  }

  const beforeAction = async () => {
    if (guard?.signal?.aborted) {
      throw new Error("Run cancelled")
    }
    if (guard?.waitIfPaused) {
      await guard.waitIfPaused()
    }
  }

  const logAccess = async (name: string) => {
    if (debugAccessedProps.has(name)) {
      return
    }
    debugAccessedProps.add(name)
    await appendActionLog(`调试 · 访问 ${name}`)
  }

  const instrumentedMouse = new Proxy(page.mouse, {
    get(target, prop, receiver) {
      if (prop === "click") {
        return async (...args: Parameters<typeof page.mouse.click>) => {
          await beforeAction()
          await logAccess("page.mouse.click")
          await appendActionLog(`脚本动作 · mouse.click(${args[0]}, ${args[1]})`)
          return target.click(...args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

  const instrumentedKeyboard = new Proxy(page.keyboard, {
    get(target, prop, receiver) {
      if (prop === "type") {
        return async (...args: Parameters<typeof page.keyboard.type>) => {
          await beforeAction()
          await logAccess("page.keyboard.type")
          await appendActionLog(`脚本动作 · keyboard.type(${JSON.stringify(args[0] ?? "")})`)
          return target.type(...args)
        }
      }
      if (prop === "press") {
        return async (...args: Parameters<typeof page.keyboard.press>) => {
          await beforeAction()
          await logAccess("page.keyboard.press")
          await appendActionLog(`脚本动作 · keyboard.press(${String(args[0] ?? "")})`)
          return target.press(...args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

  return new Proxy(page, {
    get(target, prop, receiver) {
      if (prop === "goto") {
        return async (url: string, options?: Parameters<Page["goto"]>[1]) => {
          await beforeAction()
          await logAccess("page.goto")
          await appendActionLog(`脚本动作 · goto(${String(url ?? "")})`)
          const opts = { waitUntil: "domcontentloaded" as const, ...options }
          try {
            return await target.goto(url, opts)
          } catch (err) {
            if (err instanceof Error && err.message.includes("interrupted by another navigation")) {
              await target.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
              return null
            }
            throw err
          }
        }
      }
      if (prop === "mouse") {
        void logAccess("page.mouse")
        return instrumentedMouse
      }
      if (prop === "keyboard") {
        void logAccess("page.keyboard")
        return instrumentedKeyboard
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  }) as Page
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 5 * 60 * 1000

export const executeScriptInSession = async ({
  run,
  session,
  script,
  onUpdate,
  requestHumanInput,
  analyzeImage,
  stepIndex,
  startedLog,
  completedLog,
  handoffContext,
  screenshotFilePrefix = "script",
  timeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
  signal,
  waitIfPaused,
  runtimeProducer,
}: ExecuteScriptInSessionInput) => {
  if (signal?.aborted) {
    throw new Error("Run cancelled before script execution")
  }
  if (waitIfPaused) {
    await waitIfPaused()
  }
  await markRunStep(run, stepIndex, "running", onUpdate, startedLog)
  const rawBody = extractScriptBody(script.code)
  const transpileResult = ts.transpileModule(rawBody, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  })
  const body = transpileResult.outputText
  run.logs.push(`[${new Date().toLocaleTimeString()}] 调试 · 提取脚本正文并转译为 JS:\n${body}`)
  await onUpdate()

  const instrumentedPage = instrumentPageActions(session.page, run, onUpdate, { waitIfPaused, signal })
  const human: HumanRuntime = {
    input: async (options) => {
      if (signal?.aborted) {
        throw new Error("Run cancelled before human input")
      }
      if (waitIfPaused) {
        await waitIfPaused()
      }
      const imageUrl = options.imageSelector
        ? await captureElementScreenshot(session.page, run.id, session.runDir, options.imageSelector, `${screenshotFilePrefix}-human-element-${Date.now()}.png`).catch(() => undefined)
        : undefined
      const viewportUrl = await captureStepScreenshot(session.page, run.id, session.runDir, `${screenshotFilePrefix}-human-page-${Date.now()}.png`).catch(() => undefined)
      if (viewportUrl) {
        run.currentViewport = viewportUrl
      }
      run.logs.push(`[${new Date().toLocaleTimeString()}] 等待人工输入 · ${options.instruction}`)
      await onUpdate()
      return requestHumanInput({
        reason: options.reason,
        instruction: options.instruction,
        inputLabel: options.inputLabel,
        placeholder: options.placeholder,
        confirmText: options.confirmText,
        imageUrl: imageUrl ?? viewportUrl,
        scope: handoffContext?.scope,
        suiteId: handoffContext?.suiteId,
        testCaseId: handoffContext?.testCaseId,
      })
    },
  }

  const analyzeImageFromPage = async (options: AiAnalyzeImageOptions) => {
      const targetSelector = options.imageSelector || options.selector
      const artifactUrl = targetSelector
        ? await captureElementScreenshot(session.page, run.id, session.runDir, targetSelector, `${screenshotFilePrefix}-ai-image-${Date.now()}.png`)
        : await captureStepScreenshot(session.page, run.id, session.runDir, `${screenshotFilePrefix}-ai-page-${Date.now()}.png`)
      const filePath = artifactUrlToFilePath(session.runDir, artifactUrl)
      const mimeType = inferMimeTypeFromPath(filePath)
      const bytes = await readFile(filePath)
      const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`
      run.logs.push(`[${new Date().toLocaleTimeString()}] 图片分析 · ${options.prompt}`)
      console.log(`[Runner AI] 开始图片分析，URL长度: ${dataUrl.length}`)
      await onUpdate()
      const aiResult = await analyzeImage({
        dataUrl,
        mimeType,
        prompt: options.prompt,
      })
      console.log(`[Runner AI] 图片分析结果: ${aiResult}`)
      run.logs.push(`[${new Date().toLocaleTimeString()}] 图片分析结果 · ${aiResult}`)
      await onUpdate()
      return aiResult
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
  }

  let testChain: Promise<any> = Promise.resolve()

  const test: TestRuntime = {
    step: (title, body) => {
      const p = testChain.then(async () => {
        run.logs.push(`[${new Date().toLocaleTimeString()}] 测试步骤 · ${title}`)
        await onUpdate()
        return body()
      })
      testChain = p
      p.catch(() => {}) // Prevent UnhandledPromiseRejectionWarning
      return p
    },
  }

  const getBaseUrl = () => run.testBaseUrl
  const tempValues = new Map<string, unknown>()
  run.runtimeOutputs = run.runtimeOutputs ?? []

  const step: StepRuntime = async (title, purpose, fn) => {
    run.logs.push(`[${new Date().toLocaleTimeString()}] 业务步骤 · ${title} · ${purpose}`)
    const { createExecutionStep } = await import("./utils.js")
    
    const archiveIndex = run.steps.findIndex(s => s.kind === "archive")
    const insertIndex = archiveIndex !== -1 ? archiveIndex : run.steps.length

    const businessStep = createExecutionStep(run.id, insertIndex + 1, title, purpose, "business_step")
    run.steps.splice(insertIndex, 0, businessStep)
    
    run.steps[insertIndex].status = "running"
    await onUpdate()
    
    try {
      const result = await fn()
      const businessShot = await captureStepScreenshot(session.page, run.id, session.runDir, `${screenshotFilePrefix}-step-${insertIndex}-${Date.now()}.png`).catch(() => undefined)
      await markRunStep(run, insertIndex, "passed", onUpdate, `步骤完成：${purpose}`, businessShot)
      return result
    } catch (err) {
      const failShot = await captureStepScreenshot(session.page, run.id, session.runDir, `${screenshotFilePrefix}-step-fail-${insertIndex}-${Date.now()}.png`).catch(() => undefined)
      await markRunStep(run, insertIndex, "failed", onUpdate, `步骤失败：${err instanceof Error ? err.message : String(err)}`, failShot)
      throw err
    }
  }

  const outputs: OutputsRuntime = {
    add: async (description, value, meta) => {
      const output: RuntimeOutput = {
        id: createRuntimeOutputId(run.id),
        runId: run.id,
        testCaseId: runtimeProducer?.testCaseId ?? handoffContext?.testCaseId,
        caseCode: runtimeProducer?.caseCode,
        caseName: runtimeProducer?.caseName,
        description,
        value,
        meta,
        createdAt: now(),
      }
      run.runtimeOutputs = [...(run.runtimeOutputs ?? []), output]
      run.logs.push(`[${new Date().toLocaleTimeString()}] 输出结果 · ${runtimeProducer?.caseName || runtimeProducer?.caseCode || output.testCaseId || "当前节点"} · ${description}: ${formatRuntimeValue(value)}`)
      await onUpdate()
      return value
    },
  }

  const inputs: InputsRuntime = {
    get: async (options = {}) => {
      let candidates = [...(run.runtimeOutputs ?? [])]
      if (options.from) {
        candidates = candidates.filter((item) => matchesProducer(item, options.from!))
      }
      if (options.description) {
        const description = normalizeRuntimeMatch(options.description)
        candidates = candidates.filter((item) => normalizeRuntimeMatch(item.description) === description)
      }
      if (candidates.length === 1) {
        run.logs.push(`[${new Date().toLocaleTimeString()}] 读取输入 · ${candidates[0].caseName || candidates[0].caseCode || candidates[0].testCaseId || "上游节点"} · ${candidates[0].description}`)
        await onUpdate()
        return candidates[0].value
      }
      if (candidates.length === 0) {
        throw new Error(`INPUT_OUTPUT_MISSING: 未找到匹配的上游输出。from=${options.from ?? ""} description=${options.description ?? ""}`)
      }
      throw new Error(`INPUT_OUTPUT_AMBIGUOUS: 匹配到多个上游输出，请指定 from 或 description。候选：${candidates.map((item) => `${item.caseName || item.caseCode || item.testCaseId || "unknown"}:${item.description}`).join("；")}`)
    },
  }

  const temp: TempRuntime = {
    store: async (description, key, fn) => {
      const value = await fn()
      tempValues.set(key, value)
      run.logs.push(`[${new Date().toLocaleTimeString()}] 临时存储 · ${key} · ${description}: ${formatRuntimeValue(value)}`)
      await onUpdate()
      return value
    },
    get: async (key) => {
      if (!tempValues.has(key)) {
        throw new Error(`TEMP_VALUE_MISSING: 未找到临时值 ${key}`)
      }
      return tempValues.get(key) as any
    },
  }

  const guard: GuardRuntime = {
    ownedData: async (record, action) => {
      if (!isRuntimeOwnedData(record, run.runtimeOutputs ?? [], tempValues)) {
        throw new Error(`OWNED_DATA_REQUIRED: 破坏性操作目标不在本次执行链输出或临时数据中：${formatRuntimeValue(record)}`)
      }
      run.logs.push(`[${new Date().toLocaleTimeString()}] 数据保护 · 已确认 owned data: ${formatRuntimeValue(record)}`)
      await onUpdate()
      return await action()
    },
  }

  const ensureNotCancelled = () => {
    if (signal?.aborted) throw new Error("Task cancelled")
  }
  const sleepCancellable = async (ms: number) => {
    if (ms <= 0) return
    const startMs = Date.now()
    while (Date.now() - startMs < ms) {
      ensureNotCancelled()
      if (waitIfPaused) await waitIfPaused()
      const remaining = ms - (Date.now() - startMs)
      const slice = Math.min(Math.max(remaining, 0), 200)
      if (slice <= 0) return
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, slice)
        const onAbort = () => {
          clearTimeout(timer)
          cleanup()
          reject(new Error("Task cancelled"))
        }
        const cleanup = () => {
          if (signal) signal.removeEventListener("abort", onAbort)
        }
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timer)
            cleanup()
            reject(new Error("Task cancelled"))
            return
          }
          signal.addEventListener("abort", onAbort, { once: true })
        }
      })
    }
  }

  const traceLog = (line: string) => {
    run.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`)
    console.log(`[runner ${run.id}] ${line}`)
  }

  const schedule: ScheduleRuntime = {
    waitUntil: async (target, options) => {
      const targetMs = target instanceof Date ? target.getTime() : typeof target === "number" ? target : Date.parse(target)
      if (!Number.isFinite(targetMs)) {
        throw new Error(`schedule.waitUntil: 无法解析目标时间 ${String(target)}`)
      }
      const pollMs = Math.max(50, options?.pollMs ?? 200)
      const logEverySec = Math.max(1, options?.logEverySec ?? 30)
      traceLog(`schedule.waitUntil · 等待至 ${new Date(targetMs).toLocaleString()}（剩余 ${Math.max(0, Math.ceil((targetMs - Date.now()) / 1000))}s）`)
      await onUpdate()
      let lastLogSec = -1
      while (Date.now() < targetMs) {
        ensureNotCancelled()
        if (waitIfPaused) await waitIfPaused()
        const remainingSec = Math.ceil((targetMs - Date.now()) / 1000)
        if (lastLogSec === -1 || lastLogSec - remainingSec >= logEverySec) {
          traceLog(`schedule.waitUntil · 距离 ${new Date(targetMs).toLocaleString()} 还剩 ${remainingSec}s`)
          await onUpdate()
          lastLogSec = remainingSec
        }
        await sleepCancellable(Math.min(pollMs, Math.max(50, targetMs - Date.now())))
      }
      traceLog(`schedule.waitUntil · 到达目标时刻 ${new Date(targetMs).toLocaleString()}`)
      await onUpdate()
    },
  }

  const loop: LoopRuntime = {
    until: async (predicate, options) => {
      const intervalMs = Math.max(50, options.intervalMs)
      const startedAt = Date.now()
      const deadline = options.timeoutMs ? startedAt + options.timeoutMs : Number.POSITIVE_INFINITY
      const maxRounds = options.maxRounds ?? Number.POSITIVE_INFINITY
      const logEvery = Math.max(1, options.logEveryRound ?? 10)
      const label = options.description ?? "loop.until"
      traceLog(`${label} · 开始（intervalMs=${intervalMs}, timeoutMs=${options.timeoutMs ?? "∞"}, maxRounds=${options.maxRounds ?? "∞"}）`)
      let round = 0
      for (;;) {
        ensureNotCancelled()
        if (waitIfPaused) await waitIfPaused()
        round += 1
        let result: any
        try {
          result = await predicate()
        } catch (err) {
          if (signal?.aborted) throw err
          console.warn(`[runner ${run.id}] ${label} · 第 ${round} 轮 predicate 抛错: ${err instanceof Error ? err.message : String(err)}`)
          throw err
        }
        if (result) {
          traceLog(`${label} · 第 ${round} 轮命中`)
          await onUpdate()
          return result as any
        }
        if (round % logEvery === 0) {
          traceLog(`${label} · 已轮询 ${round} 轮，未命中`)
          await onUpdate()
        }
        if (round >= maxRounds) {
          console.warn(`[runner ${run.id}] ${label} · 达到最大轮次 ${maxRounds}，未命中`)
          throw new Error(`LOOP_UNTIL_MAX_ROUNDS: ${label} 达到最大轮次 ${maxRounds}`)
        }
        if (Date.now() + intervalMs > deadline) {
          console.warn(`[runner ${run.id}] ${label} · 已超过 ${options.timeoutMs} ms`)
          throw new Error(`LOOP_UNTIL_TIMEOUT: ${label} 已超过 ${options.timeoutMs} ms`)
        }
        await sleepCancellable(intervalMs)
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
      ensureNotCancelled()
      if (waitIfPaused) await waitIfPaused()
      try {
        const result = await fn(attempt)
        if (attempt > 1) {
          traceLog(`${label} · 第 ${attempt} 次尝试成功`)
          await onUpdate()
        }
        return result
      } catch (err) {
        lastError = err
        if (signal?.aborted) throw err
        const shouldRetry = options?.shouldRetry ? await options.shouldRetry(err, attempt) : true
        if (!shouldRetry || attempt >= times) {
          console.warn(`[runner ${run.id}] ${label} · 第 ${attempt}/${times} 次失败：${err instanceof Error ? err.message : String(err)}（放弃重试）`)
          break
        }
        const delay = baseDelay * Math.pow(factor, attempt - 1)
        traceLog(`${label} · 第 ${attempt} 次失败：${err instanceof Error ? err.message : String(err)}；${delay > 0 ? `${delay} ms 后重试` : "立即重试"}`)
        await onUpdate()
        if (delay > 0) await sleepCancellable(delay)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`RETRY_EXHAUSTED: ${label} 用尽 ${times} 次仍失败`)
  }

  const executor = new AsyncExecutor("page", "expect", "human", "ai", "test", "getBaseUrl", "step", "outputs", "inputs", "temp", "guard", "schedule", "loop", "retry", body)

  const scriptExecution = async () => {
    await executor(instrumentedPage, expect, human, ai, test, getBaseUrl, step, outputs, inputs, temp, guard, schedule, loop, retry)
    await testChain
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`脚本执行超时（已超过 ${Math.round(timeoutMs / 1000)} 秒限制）`)), timeoutMs)
  })

  await Promise.race([scriptExecution(), timeoutPromise])
  const executionShot = await captureStepScreenshot(session.page, run.id, session.runDir, `${screenshotFilePrefix}-finished.png`)
  await markRunStep(run, stepIndex, "passed", onUpdate, completedLog, executionShot)
}

/**
 * 在已经打开的 page 上执行验证脚本（不负责浏览器生命周期）。
 * 返回结构化结果而不是抛错，便于上层做"对照实验"。
 */
export const runValidationOnPage = async (
  page: Page,
  validationScriptCode: string,
  timeoutMs = 15_000,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    const rawBody = extractScriptBody(validationScriptCode)
    const transpileResult = ts.transpileModule(rawBody, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    })
    const body = transpileResult.outputText

    const ValidationExecutor = Object.getPrototypeOf(async function () {
      return undefined
    }).constructor as new (...args: string[]) => (...args: any[]) => Promise<void>
    const executor = new ValidationExecutor("page", "expect", body)

    await Promise.race([
      executor(page, expect),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("验证脚本执行超时")), timeoutMs),
      ),
    ])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
