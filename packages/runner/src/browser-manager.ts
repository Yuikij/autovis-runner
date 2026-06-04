import { mkdir, readdir } from "node:fs/promises"
import { basename, join } from "node:path"
import type { Page } from "@playwright/test"
import type { ExecutionRun } from "@autovis/shared"
import { launchReplayBrowser, shouldStealthReplay } from "./browser.js"
import { createCdpLiveStreamer } from "./live-streamer.js"
import { markRunStep, toPublicArtifactUrl, now } from "./utils.js"
import type { CreateRunnerSessionInput, FinalizeRunnerSessionInput, RunnerSession } from "./types.js"

const SLOW_MO_MS = 50

export const captureStepScreenshot = async (page: Page, runId: string, runDir: string, fileName: string) => {
  const path = join(runDir, fileName)
  await page.screenshot({ path, fullPage: true })
  return toPublicArtifactUrl(runId, fileName)
}

export const captureElementScreenshot = async (page: Page, runId: string, runDir: string, selector: string, fileName: string) => {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: "visible", timeout: 2000 })
  const path = join(runDir, fileName)
  await locator.screenshot({ path })
  return toPublicArtifactUrl(runId, fileName)
}

/**
 * Wait until the SPA root has rendered meaningful content (text, interactive
 * elements, or large canvas/images). Prevents blank-page screenshots and
 * premature assertions on slow-loading hash-route SPAs.
 */
export const waitForSpaContent = async (page: Page, timeout = 15_000): Promise<void> => {
  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined)
  
  // Also wait for networkidle to ensure API requests have settled
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined)

  await page.waitForFunction(
    () => {
      const body = document.body
      if (!body) return false
      const text = (body.innerText || body.textContent || "").trim()
      if (text.length > 50) return true
      
      const interactive = document.querySelectorAll(
        "input,button,textarea,select,a,[role='button'],[role='textbox']",
      )
      for (const node of interactive) {
        const el = node as HTMLElement
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        if (rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
          return true
        }
      }
      for (const node of document.querySelectorAll("canvas,svg,img")) {
        const rect = (node as HTMLElement).getBoundingClientRect()
        if (rect.width >= 40 && rect.height >= 40) return true
      }
      return false
    },
    undefined,
    { timeout },
  ).catch(() => undefined)
}

export const createRunnerSession = async ({
  run,
  artifactsDir,
  headless = true,
  onUpdate,
  onLiveViewportEvent,
  initStepIndex = 0,
  storageStateJson,
  landingUrl,
}: CreateRunnerSessionInput): Promise<RunnerSession> => {
  const runDir = join(artifactsDir, run.id)
  await mkdir(runDir, { recursive: true })

  run.status = "running"
  await onUpdate()

  const stealth = shouldStealthReplay(storageStateJson)
  const browser = await launchReplayBrowser({
    stealth,
    headless,
    slowMo: run.kind === "temporary" ? SLOW_MO_MS : undefined,
  })
  
  try {
    const context = await browser.newContext({
      viewport: stealth ? null : { width: 1440, height: 960 },
      recordVideo: { dir: runDir, size: { width: 1440, height: 960 } },
      storageState: storageStateJson ? JSON.parse(storageStateJson) : undefined,
    })
    await context.tracing.start({ screenshots: true, snapshots: true })

    const page = await context.newPage()
    const video = page.video()
    const stopLiveStream = await createCdpLiveStreamer(page, onLiveViewportEvent)

    const initialUrl = landingUrl && landingUrl.trim() ? landingUrl : run.testBaseUrl
    const initialUrlLabel = landingUrl && landingUrl !== run.testBaseUrl
      ? `${initialUrl}（登录后落地页，testBaseUrl=${run.testBaseUrl}）`
      : initialUrl
    await markRunStep(run, initStepIndex, "running", onUpdate, `打开目标项目 ${initialUrlLabel}`)
    try {
      await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("interrupted by another navigation"))) {
        throw err
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
    }
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
    await waitForSpaContent(page, 15_000)
    const initialShot = await captureStepScreenshot(page, run.id, runDir, "01-browser-ready.png")
    await markRunStep(run, initStepIndex, "passed", onUpdate, "浏览器初始化完成。", initialShot)

    return {
      runDir,
      browser,
      context,
      page,
      video,
      stopLiveStream,
    }
  } catch (err) {
    await browser.close().catch(() => undefined)
    throw err
  }
}

export const finalizeRunnerSession = async ({ run, session, onUpdate, archiveStepIndex }: FinalizeRunnerSessionInput) => {
  await markRunStep(run, archiveStepIndex, "running", onUpdate, "正在归档 trace、video 和截图。")
  const tracePath = join(session.runDir, "trace.zip")
  await session.context.tracing.stop({ path: tracePath })
  await session.stopLiveStream?.()
  await session.context.close()
  await session.browser.close()

  const artifacts = await readdir(session.runDir)
  run.artifacts = artifacts
    .filter((fileName: string) => fileName.endsWith(".png") || fileName.endsWith(".zip") || fileName.endsWith(".webm"))
    .map((fileName: string) => ({
      kind: fileName.endsWith(".zip") ? "trace" : fileName.endsWith(".webm") ? "video" : "screenshot",
      name: fileName,
      url: toPublicArtifactUrl(run.id, fileName),
    }))

  if (session.video) {
    const videoPath = await session.video.path().catch(() => undefined)
    if (videoPath) {
      const fileName = basename(videoPath)
      if (!run.artifacts.find((item) => item.name === fileName)) {
        run.artifacts.push({ kind: "video", name: fileName, url: toPublicArtifactUrl(run.id, fileName) })
      }
    }
  }

  run.status = "passed"
  run.finishedAt = now()
  const finalShot = run.artifacts.find((item) => item.kind === "screenshot")
  await markRunStep(run, archiveStepIndex, "passed", onUpdate, "执行产物已归档，可在 Web 端回放查看。", finalShot?.url)
}

export const failRunnerSession = async (
  run: ExecutionRun,
  session: RunnerSession,
  onUpdate: () => Promise<void> | void,
  error: Error,
) => {
  const failedIndex = run.steps.findIndex((item) => item.status === "running")
  const failureShot = await captureStepScreenshot(session.page, run.id, session.runDir, "99-failure.png").catch(() => undefined)
  if (failedIndex >= 0) {
    await markRunStep(run, failedIndex, "failed", onUpdate, error.message, failureShot)
  }
  run.status = "failed"
  run.finishedAt = now()
  run.logs.push(`[${new Date().toLocaleTimeString()}] 执行失败: ${error.message}`)
  await session.context.tracing.stop({ path: join(session.runDir, "trace.zip") }).catch(() => undefined)
  await session.stopLiveStream?.().catch(() => undefined)
  await session.context.close().catch(() => undefined)
  await session.browser.close().catch(() => undefined)
  const artifacts = await readdir(session.runDir).catch(() => [])
  run.artifacts = artifacts.map((fileName: string) => ({
    kind: fileName.endsWith(".zip") ? "trace" : fileName.endsWith(".webm") ? "video" : "screenshot",
    name: fileName,
    url: toPublicArtifactUrl(run.id, fileName),
  }))
  await onUpdate()
}
