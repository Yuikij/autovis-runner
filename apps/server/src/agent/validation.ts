import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import { launchReplayBrowser, shouldStealthReplay } from "../browser.js"
import { runValidationOnPage } from "@autovis/runner"
import type {
  AuthProfile,
  Project,
  TargetUrl,
  ValidationProgressStep,
  ValidationProgressStepKind,
} from "@autovis/shared"
import { artifactsDir } from "../services/common.js"
import { buildStorageStateSummary } from "../services/authProfile.utils.js"
import { getPageSnapshot } from "./helpers.js"

/**
 * 校验脚本生成 / 登录态重放共用的"步骤发射器"。
 * - emit(step): 追加一个新步骤（默认 running）
 * - updateLast(patch): 更新最近追加的那一步（通常用于把 running 改成 done/error 并附结果）
 */
export interface ValidationStepEmitter {
  emit: (step: ValidationProgressStep) => void
  updateLast: (patch: Partial<ValidationProgressStep>) => void
}

const NAV_TIMEOUT = 20_000
const LOAD_SETTLE_TIMEOUT = 5_000

const isHeadless = () => process.env.HEADLESS !== "false"

const captureScreenshot = async (
  page: Page,
  taskId: string,
  fileName: string,
): Promise<string | undefined> => {
  try {
    const dir = join(artifactsDir, `validation-${taskId}`)
    await mkdir(dir, { recursive: true })
    await page.screenshot({ path: join(dir, fileName), fullPage: false })
    return `/artifacts/validation-${taskId}/${fileName}`
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Generate validation script (双对照 + 验证回归循环)
// ---------------------------------------------------------------------------

export interface ValidationLlmCallInput {
  project: Project
  profile: AuthProfile
  loginUrl: string
  authedSnapshot: string
  anonSnapshot: string
  authedUrl: string
  anonUrl: string
  /** 当前是第几轮重试（1-based） */
  attempt: number
  /** 上一轮的脚本和失败原因；首轮为空 */
  previousAttempt?: { code: string; failureReason: string }
}

export interface GenerateValidationScriptInput {
  taskId: string
  project: Project
  authProfile: AuthProfile
  /** 用于打开的目标 URL（已由调用方解析）。 */
  targetUrl: TargetUrl
  /** 该 (profile, targetUrl) 对应的 Playwright storageState JSON。 */
  storageStateJson: string
  emitter: ValidationStepEmitter
  callLlm: (input: ValidationLlmCallInput) => Promise<string>
  maxAttempts?: number
  signal?: AbortSignal
}

export async function executeValidationScriptGeneration(
  input: GenerateValidationScriptInput,
): Promise<{ code: string; loginUrl: string }> {
  const { taskId, project, authProfile, targetUrl, storageStateJson, emitter, callLlm, signal } = input
  const maxAttempts = input.maxAttempts ?? 3

  const loginUrl = targetUrl.url
  const summary = buildStorageStateSummary(storageStateJson)

  emitter.emit({
    kind: "init",
    label: `准备生成 · 目标 URL ${loginUrl}`,
    status: "running",
    detail: summary
      ? `复用登录态 · ${summary.cookieCount} 个 cookie / ${summary.originCount} 个 origin`
      : "登录态摘要不可用",
    metaJson: JSON.stringify({
      loginUrl,
      sourceCaseId: authProfile.sourceCaseId,
      cookieCount: summary?.cookieCount,
      originCount: summary?.originCount,
    }),
  })
  emitter.updateLast({ status: "done" })

  let browser: Browser | undefined
  let authedCtx: BrowserContext | undefined
  let anonCtx: BrowserContext | undefined
  let authedPage: Page | undefined
  let anonPage: Page | undefined

  try {
    if (signal?.aborted) throw new Error("任务已被取消。")

    // ---- 启动两个浏览器上下文：authed / anon ----
    // 注入了登录态 → 用反检测有头真 Chrome，指纹与采集时一致，避免被风控页误判。
    const stealth = shouldStealthReplay(storageStateJson)
    emitter.emit({ kind: "browser", label: stealth ? "启动反检测浏览器（真 Chrome）" : "启动 Headless Chromium", status: "running" })
    browser = await launchReplayBrowser({ stealth, headless: isHeadless() })
    emitter.updateLast({ status: "done" })

    emitter.emit({ kind: "browser", label: "创建『登录态』BrowserContext 并注入 storageState", status: "running" })
    authedCtx = await browser.newContext({
      viewport: stealth ? null : { width: 1440, height: 960 },
      storageState: JSON.parse(storageStateJson),
    })
    authedPage = await authedCtx.newPage()
    emitter.updateLast({ status: "done" })

    emitter.emit({ kind: "navigate", label: `登录态浏览器访问 ${loginUrl}`, status: "running" })
    await authedPage.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT })
    await authedPage.waitForLoadState("load", { timeout: LOAD_SETTLE_TIMEOUT }).catch(() => undefined)
    const authedShot = await captureScreenshot(authedPage, taskId, "01-authed.png")
    const authedUrl = authedPage.url()
    emitter.updateLast({
      status: "done",
      screenshotUrl: authedShot,
      detail: `到达 ${authedUrl}`,
    })

    emitter.emit({ kind: "browser", label: "创建『匿名』BrowserContext（对照组）", status: "running" })
    anonCtx = await browser.newContext({ viewport: stealth ? null : { width: 1440, height: 960 } })
    anonPage = await anonCtx.newPage()
    emitter.updateLast({ status: "done" })

    emitter.emit({ kind: "navigate", label: `匿名浏览器访问 ${loginUrl}`, status: "running" })
    await anonPage.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT })
    await anonPage.waitForLoadState("load", { timeout: LOAD_SETTLE_TIMEOUT }).catch(() => undefined)
    const anonShot = await captureScreenshot(anonPage, taskId, "02-anon.png")
    const anonUrl = anonPage.url()
    emitter.updateLast({
      status: "done",
      screenshotUrl: anonShot,
      detail: `到达 ${anonUrl}`,
    })

    // ---- 采集 DOM snapshot ----
    emitter.emit({ kind: "snapshot", label: "采集双对照 DOM 快照", status: "running" })
    const authedSnapshot = await getPageSnapshot(authedPage)
    const anonSnapshot = await getPageSnapshot(anonPage)
    emitter.updateLast({
      status: "done",
      detail: `登录态 ${authedSnapshot.length} 字符 / 匿名 ${anonSnapshot.length} 字符`,
      metaJson: JSON.stringify({ authedUrl, anonUrl }),
    })

    // ---- LLM 生成 + 双向验证回归循环 ----
    let attempt = 0
    let previousAttempt: { code: string; failureReason: string } | undefined
    let lastError: string | undefined

    while (attempt < maxAttempts) {
      if (signal?.aborted) throw new Error("任务已被取消。")
      attempt += 1

      // 调 LLM
      emitter.emit({
        kind: "llm",
        label: `调用 LLM 生成校验脚本 (第 ${attempt}/${maxAttempts} 轮)`,
        status: "running",
        iteration: attempt,
      })
      let candidateCode: string
      try {
        candidateCode = await callLlm({
          project,
          profile: authProfile,
          loginUrl,
          authedSnapshot,
          anonSnapshot,
          authedUrl,
          anonUrl,
          attempt,
          previousAttempt,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        emitter.updateLast({ status: "error", detail: msg })
        lastError = msg
        previousAttempt = { code: previousAttempt?.code ?? "", failureReason: `LLM 调用失败: ${msg}` }
        continue
      }
      emitter.updateLast({
        status: "done",
        codePreview: candidateCode,
        detail: `脚本 ${candidateCode.length} 字符`,
      })

      // 回归 1：登录态浏览器必须通过
      emitter.emit({
        kind: "verify",
        label: "回归测试 · 登录态浏览器应通过",
        status: "running",
        iteration: attempt,
      })
      const authedResult = await runValidationOnPage(authedPage, candidateCode)
      if (!authedResult.ok) {
        emitter.updateLast({
          status: "error",
          detail: `登录态被脚本判定为失效: ${authedResult.error}`,
        })
        lastError = `脚本在带有 storageState 的浏览器执行抛错: ${authedResult.error}`
        previousAttempt = { code: candidateCode, failureReason: lastError }
        continue
      }
      emitter.updateLast({ status: "done", detail: "登录态通过校验" })

      // 回归 2：匿名浏览器必须失败
      emitter.emit({
        kind: "verify",
        label: "回归测试 · 匿名浏览器应失败",
        status: "running",
        iteration: attempt,
      })
      const anonResult = await runValidationOnPage(anonPage, candidateCode)
      if (anonResult.ok) {
        emitter.updateLast({
          status: "error",
          detail: "匿名浏览器也通过了脚本，断言过于宽松（误报为已登录）",
        })
        lastError = "脚本在『没有 storageState』的浏览器也通过了校验（应当抛错）。请基于两份 snapshot 的实际差异，使用对【登录态独有】元素（如用户头像/退出按钮/受保护页面 URL）的断言。"
        previousAttempt = { code: candidateCode, failureReason: lastError }
        continue
      }
      emitter.updateLast({
        status: "done",
        detail: `匿名浏览器按预期失败: ${anonResult.error}`,
      })

      // 双向都达标
      return { code: candidateCode, loginUrl }
    }

    throw new Error(`经过 ${maxAttempts} 轮重试，仍未生成同时满足"登录态通过 / 匿名失败"两个条件的校验脚本。最近一次失败原因: ${lastError ?? "未知"}`)
  } finally {
    await anonPage?.close().catch(() => undefined)
    await authedPage?.close().catch(() => undefined)
    await anonCtx?.close().catch(() => undefined)
    await authedCtx?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Check login status (重放：注入 storageState → 访问 URL → 跑 validationScript)
// ---------------------------------------------------------------------------

export interface CheckLoginStatusInput {
  taskId: string
  project: Project
  authProfile: AuthProfile
  targetUrl: TargetUrl
  storageStateJson: string
  emitter: ValidationStepEmitter
  signal?: AbortSignal
}

export async function executeLoginStatusCheck(
  input: CheckLoginStatusInput,
): Promise<{ valid: boolean; error?: string }> {
  const { taskId, project, authProfile, targetUrl, storageStateJson, emitter, signal } = input
  const loginUrl = targetUrl.url

  if (!authProfile.validationScript) {
    emitter.emit({ kind: "init", label: "尚未生成失效校验脚本", status: "error" })
    return { valid: false, error: "未生成失效校验脚本" }
  }

  const summary = buildStorageStateSummary(storageStateJson)
  emitter.emit({
    kind: "init",
    label: "准备重放登录态",
    status: "running",
    detail: summary
      ? `将注入 ${summary.cookieCount} 个 cookie / ${summary.originCount} 个 origin`
      : undefined,
    metaJson: summary ? JSON.stringify(summary) : undefined,
  })
  emitter.updateLast({ status: "done" })

  let browser: Browser | undefined
  try {
    if (signal?.aborted) throw new Error("任务已被取消。")
    const stealth = shouldStealthReplay(storageStateJson)
    emitter.emit({ kind: "browser", label: stealth ? "启动反检测浏览器（真 Chrome）" : "启动 Headless Chromium", status: "running" })
    browser = await launchReplayBrowser({ stealth, headless: isHeadless() })
    emitter.updateLast({ status: "done" })

    emitter.emit({ kind: "browser", label: "新建 BrowserContext 并注入 storageState", status: "running" })
    const context = await browser.newContext({
      viewport: stealth ? null : { width: 1440, height: 960 },
      storageState: JSON.parse(storageStateJson),
    })
    const page = await context.newPage()
    emitter.updateLast({ status: "done" })

    emitter.emit({ kind: "navigate", label: `访问 ${loginUrl}`, status: "running" })
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT })
    await page.waitForLoadState("load", { timeout: LOAD_SETTLE_TIMEOUT }).catch(() => undefined)
    const shot = await captureScreenshot(page, taskId, "check.png")
    emitter.updateLast({ status: "done", screenshotUrl: shot, detail: `到达 ${page.url()}` })

    emitter.emit({
      kind: "verify",
      label: "执行失效校验脚本",
      status: "running",
      codePreview: authProfile.validationScript,
    })
    const result = await runValidationOnPage(page, authProfile.validationScript)
    if (result.ok) {
      emitter.updateLast({ status: "done", detail: "校验脚本通过 · 登录状态有效" })
      emitter.emit({ kind: "result", label: "结论：登录状态有效", status: "done" })
      return { valid: true }
    }
    emitter.updateLast({ status: "error", detail: result.error })
    emitter.emit({
      kind: "result",
      label: "结论：登录状态无效",
      status: "error",
      detail: result.error,
    })
    return { valid: false, error: result.error }
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

// Re-export for convenience
export const validationStepKinds: ValidationProgressStepKind[] = [
  "init",
  "browser",
  "navigate",
  "snapshot",
  "llm",
  "verify",
  "save",
  "result",
]
