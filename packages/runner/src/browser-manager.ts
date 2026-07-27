import { mkdir, readdir } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import type { Browser, BrowserContext, Page } from "@playwright/test"
import type { ExecutionRun, RunArtifact } from "@browsewright/shared"
import { launchPersistentReplayContext, launchReplayBrowser, shouldStealthReplay, waitForProfileDirFree } from "./browser.js"
import { createCdpLiveStreamer } from "./live-streamer.js"
import { markRunStep, toPublicArtifactUrl, now } from "./utils.js"
import type { CreateRunnerSessionInput, FinalizeRunnerSessionInput, RunnerSession } from "./types.js"

const SLOW_MO_MS = 50

/** 按扩展名把 runDir 里的文件归类为产物类型；未知扩展名返回 null（不计入产物）。 */
const ARTIFACT_KIND_BY_EXT: Record<string, RunArtifact["kind"]> = {
  ".png": "screenshot",
  ".jpg": "screenshot",
  ".jpeg": "screenshot",
  ".zip": "trace",
  ".webm": "video",
  ".mp4": "video",
  ".html": "report",
  ".htm": "report",
  ".md": "report",
  ".txt": "report",
}
// 持久 profile 串行锁：同一 userDataDir 同时只能被一个 Chrome 打开（Chrome 锁 profile 目录）。
const profileLocks = new Map<string, Promise<void>>()
const acquireProfileLock = async (
  key: string,
  { timeoutMs, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<() => void> => {
  // 原实现是无超时的 while 轮询：若上一个持有者因崩溃从未 release，这里会**永久挂起**且无任何日志，
  // 正是「卡住几分钟、纯盲盒、停不掉」的元凶之一。这里加上超时 + 取消信号兜底。
  const deadline = timeoutMs && timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY
  while (profileLocks.has(key)) {
    if (signal?.aborted) throw new Error("Run cancelled")
    if (Date.now() >= deadline) {
      throw new Error(
        `等待持久 profile 进程内锁超时（${key}）。通常是上一次该登录态的执行/采集尚未释放浏览器，请稍候重试。`,
      )
    }
    await Promise.race([
      profileLocks.get(key),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ])
  }
  let release!: () => void
  profileLocks.set(key, new Promise<void>((resolve) => {
    release = () => {
      profileLocks.delete(key)
      resolve()
    }
  }))
  return release
}

/**
 * 把一个可能长时间阻塞的 Promise 同时与「超时」「取消信号」竞速：
 * 任一先触发即以可读错误 reject，避免浏览器启动等环节无限期挂起又打不断。
 */
const raceWithTimeoutAndAbort = async <T>(
  label: string,
  factory: () => Promise<T>,
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<T> => {
  if (signal?.aborted) throw new Error("Run cancelled")
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const guards: Promise<never>[] = [
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} 超时（超过 ${Math.round(timeoutMs / 1000)}s 仍未完成）`)),
        timeoutMs,
      )
    }),
  ]
  if (signal) {
    guards.push(
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Run cancelled"))
        signal.addEventListener("abort", onAbort, { once: true })
      }),
    )
  }
  try {
    return await Promise.race([factory(), ...guards])
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener("abort", onAbort)
  }
}

const resolveLaunchTimeoutMs = (override?: number): number => {
  if (override && override > 0) return override
  const fromEnv = Number.parseInt(process.env.BROWSER_LAUNCH_TIMEOUT_MS ?? "", 10)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 60_000
}

const scanArtifacts = (runId: string, fileNames: string[]): RunArtifact[] =>
  fileNames
    .map((fileName) => {
      const kind = ARTIFACT_KIND_BY_EXT[extname(fileName).toLowerCase()]
      return kind ? { kind, name: fileName, url: toPublicArtifactUrl(runId, fileName) } : null
    })
    .filter((item): item is RunArtifact => item !== null)

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

/**
 * 是否录制 video / trace 的默认策略：
 * - temporary（即席快验）run 默认不录，省去 ffmpeg 编码 + trace 快照的重型开销；
 * - 其它 run 默认开启，保持产物回放能力。
 * 可用 RECORD_VIDEO / RUN_TRACING（"0"/"1"）全局覆盖。
 */
const resolveArtifactToggle = (envName: string, fallback: boolean): boolean => {
  const raw = process.env[envName]
  if (raw === undefined || raw.trim() === "") return fallback
  return raw.trim() !== "0"
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
  stealth: stealthConfig,
  recordVideo,
  trace,
  userDataDir,
  signal,
  waitIfPaused,
  launchTimeoutMs,
}: CreateRunnerSessionInput): Promise<RunnerSession> => {
  const runDir = join(artifactsDir, run.id)
  await mkdir(runDir, { recursive: true })

  run.status = "running"
  await onUpdate()

  // 立刻把「初始化浏览器」这一步置为运行中——否则浏览器启动期间三步全是「排队中」，
  // 用户完全看不出系统正卡在启动浏览器（正是本次盲盒问题的表象）。
  await markRunStep(run, initStepIndex, "running", onUpdate, "正在初始化浏览器与 Trace…")

  // 初始化阶段打点：把每一步（含耗时）同时写进 run.logs（前端「输出日志」实时可见）与控制台，
  // 彻底消除「运行中但三步都排队、几分钟无任何信息」的盲盒。
  const t0 = Date.now()
  const sinceStart = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
  const phase = async (message: string) => {
    const line = `初始化 · ${message}`
    run.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`)
    console.log(`[runner ${run.id}] ${line}`)
    await onUpdate()
  }
  const ensureNotCancelled = () => {
    if (signal?.aborted) throw new Error("Run cancelled")
  }

  const defaultArtifacts = run.kind !== "temporary"
  const shouldRecordVideo = resolveArtifactToggle("RECORD_VIDEO", recordVideo ?? defaultArtifacts)
  const shouldTrace = resolveArtifactToggle("RUN_TRACING", trace ?? defaultArtifacts)

  const stealth = shouldStealthReplay(storageStateJson, stealthConfig)
  const persistent = Boolean(userDataDir)
  const slowMo = run.kind === "temporary" ? SLOW_MO_MS : undefined
  const launchTimeout = resolveLaunchTimeoutMs(launchTimeoutMs)
  // 持久 profile 模式：用 launchPersistentContext，登录态/指纹/cf_clearance 都来自磁盘目录，不注入 storageState。
  let browser: Browser | null = null
  let context: BrowserContext
  let releaseLock: (() => void) | undefined

  ensureNotCancelled()
  if (waitIfPaused) await waitIfPaused()
  await phase(
    `准备启动浏览器（模式=${persistent ? "持久 profile" : "临时上下文"}, 反检测有头=${stealth}, headless=${stealth ? false : headless}, 录像=${shouldRecordVideo}, trace=${shouldTrace}, 启动超时=${Math.round(launchTimeout / 1000)}s）`,
  )

  if (persistent) {
    await phase(`等待同进程 profile 锁：${userDataDir}`)
    releaseLock = await acquireProfileLock(userDataDir!, { timeoutMs: launchTimeout, signal })
    await mkdir(userDataDir!, { recursive: true })
    ensureNotCancelled()
    // 进程内锁只挡同进程的并发；登录采集窗口/刚结束的上次执行可能仍占着 Chrome 的目录锁，
    // 启动前等其释放（或清理崩溃残留），否则第二个 Chrome 会转发后退出导致连接立刻关闭。
    await phase("检查 profile 目录是否被其它 Chrome 占用（SingletonLock）…")
    await waitForProfileDirFree(userDataDir!)
    await phase(`profile 目录就绪，开始启动持久上下文（耗时 ${sinceStart()}）…`)
    try {
      context = await raceWithTimeoutAndAbort(
        "启动持久浏览器上下文",
        () =>
          launchPersistentReplayContext(userDataDir!, {
            stealth,
            headless,
            slowMo,
            recordVideoDir: shouldRecordVideo ? runDir : undefined,
          }),
        { timeoutMs: launchTimeout, signal },
      )
    } catch (launchErr) {
      // 启动失败/超时/被取消：必须释放进程内锁，否则下一次启动会卡在 acquireProfileLock。
      releaseLock?.()
      await phase(`持久上下文启动失败：${launchErr instanceof Error ? launchErr.message : String(launchErr)}`)
      throw launchErr
    }
    browser = context.browser()
    await phase(`持久浏览器上下文已启动（耗时 ${sinceStart()}）`)
    // 向后兼容：首次（目录还空）用已有 storageState 播种 cookie/localStorage，
    // 之后登录态由目录自身保留，不再依赖注入。已有 cookie 则跳过，避免覆盖最新态。
    if (storageStateJson) {
      await seedPersistentContext(context, storageStateJson).catch(() => undefined)
    }
  } else {
    await phase(`启动浏览器（耗时 ${sinceStart()}）…`)
    try {
      browser = await raceWithTimeoutAndAbort(
        "启动浏览器",
        () => launchReplayBrowser({ stealth, headless, slowMo }),
        { timeoutMs: launchTimeout, signal },
      )
    } catch (launchErr) {
      await phase(`浏览器启动失败：${launchErr instanceof Error ? launchErr.message : String(launchErr)}`)
      throw launchErr
    }
    await phase(`浏览器进程已启动（耗时 ${sinceStart()}），创建上下文…`)
    context = await browser.newContext({
      viewport: stealth ? null : { width: 1440, height: 960 },
      ...(shouldRecordVideo ? { recordVideo: { dir: runDir, size: { width: 1440, height: 960 } } } : {}),
      storageState: storageStateJson ? JSON.parse(storageStateJson) : undefined,
    })
  }

  try {
    ensureNotCancelled()
    if (shouldTrace) {
      await phase("开启 Playwright Trace（截图+快照）…")
      await context.tracing.start({ screenshots: true, snapshots: true })
    }

    // 持久上下文自带一个初始页，复用它避免多一个空白页。
    // 持久 profile 复用目录时 Chrome 会恢复上次会话残留的标签——只留主页，其余陈旧标签关掉，
    // 否则脚本可能跑在被恢复出来的旧页上、且这些标签会在窗口里越积越多（见登录沙盒同款问题）。
    let page: Page
    if (persistent) {
      const restored = context.pages()
      page = restored[0] ?? (await context.newPage())
      for (const stale of restored.slice(1)) {
        await stale.close().catch(() => undefined)
      }
      await page.bringToFront().catch(() => undefined)
    } else {
      page = await context.newPage()
    }
    const video = page.video()
    await phase(`浏览器页面就绪（耗时 ${sinceStart()}），建立实时预览推流…`)
    const liveStream = await createCdpLiveStreamer(page, onLiveViewportEvent)
    // 脚本/站点新开标签或弹窗时，把实时预览切到最新页，否则前端只会停在旧页冻住；
    // 该活动页若被关闭，再切回仍存活的最后一个页面。
    if (liveStream) {
      context.on("page", (opened) => {
        void liveStream.rebind(opened)
        opened.on("close", () => {
          const survivors = context.pages().filter((candidate) => !candidate.isClosed())
          const fallback = survivors[survivors.length - 1]
          if (fallback) void liveStream.rebind(fallback)
        })
      })
    }

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
    await phase("页面 DOM 已就绪，等待 SPA 首屏内容渲染…")
    await waitForSpaContent(page, 15_000)
    const initialShot = await captureStepScreenshot(page, run.id, runDir, "01-browser-ready.png")
    await markRunStep(run, initStepIndex, "passed", onUpdate, `浏览器初始化完成（总耗时 ${sinceStart()}）。`, initialShot)

    return {
      runDir,
      browser,
      context,
      page,
      video,
      liveStream,
      traceEnabled: shouldTrace,
      persistent,
      releaseLock,
    }
  } catch (err) {
    // 持久模式下 browser 可能为 null（上下文自有），关 context 即可释放整个浏览器。
    await context.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    releaseLock?.()
    throw err
  }
}

/**
 * 持久 profile 首次播种：目录还没 cookie 时，用已有 storageState 灌入 cookie + localStorage。
 * 已有 cookie（说明此前已登录/质询过）则原样保留、不覆盖。
 */
const seedPersistentContext = async (context: BrowserContext, storageStateJson: string) => {
  const existing = await context.cookies().catch(() => [])
  if (existing.length > 0) return
  const parsed = JSON.parse(storageStateJson) as {
    cookies?: Parameters<BrowserContext["addCookies"]>[0]
    origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>
  }
  if (Array.isArray(parsed.cookies) && parsed.cookies.length > 0) {
    await context.addCookies(parsed.cookies).catch(() => undefined)
  }
  for (const origin of parsed.origins ?? []) {
    if (!origin?.origin || !Array.isArray(origin.localStorage) || origin.localStorage.length === 0) continue
    await context.addInitScript(
      ({ origin: target, items }) => {
        if (location.origin === target) {
          for (const item of items) {
            try {
              localStorage.setItem(item.name, item.value)
            } catch {
              // 忽略个别写入失败
            }
          }
        }
      },
      { origin: origin.origin, items: origin.localStorage },
    ).catch(() => undefined)
  }
}

/** 关闭会话浏览器：持久模式只关 context（其拥有的浏览器随之退出），否则关 browser。 */
const closeSessionBrowser = async (session: RunnerSession) => {
  await session.context.close().catch(() => undefined)
  if (!session.persistent) {
    await session.browser?.close().catch(() => undefined)
  }
  session.releaseLock?.()
}

export const finalizeRunnerSession = async ({ run, session, onUpdate, archiveStepIndex }: FinalizeRunnerSessionInput) => {
  await markRunStep(run, archiveStepIndex, "running", onUpdate, "正在归档 trace、video 和截图。")
  if (session.traceEnabled) {
    const tracePath = join(session.runDir, "trace.zip")
    await session.context.tracing.stop({ path: tracePath }).catch(() => undefined)
  }
  await session.liveStream?.stop()
  await closeSessionBrowser(session)

  const artifacts = await readdir(session.runDir)
  run.artifacts = scanArtifacts(run.id, artifacts)

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
  if (session.traceEnabled) {
    await session.context.tracing.stop({ path: join(session.runDir, "trace.zip") }).catch(() => undefined)
  }
  await session.liveStream?.stop().catch(() => undefined)
  await closeSessionBrowser(session)
  const artifacts = await readdir(session.runDir).catch(() => [])
  run.artifacts = scanArtifacts(run.id, artifacts)
  await onUpdate()
}
