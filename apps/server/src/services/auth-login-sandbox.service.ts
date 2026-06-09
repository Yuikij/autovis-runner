import { rm } from "node:fs/promises"
import { type BrowserContext, type Page } from "@playwright/test"
import {
  type AuthLoginSandboxSession,
  type AuthProfileState,
  type RecorderInteractionRequest,
  type SaveAuthLoginSandboxResponse,
  type StartAuthLoginSandboxRequest,
} from "@autovis/shared"
import { AutoVisDatabase } from "../db.js"
import { launchStealthPersistentContext } from "../browser.js"
import { appOrigin, createId, now } from "./common.js"
import { buildStorageStateSummary } from "./authProfile.utils.js"

const WINDOW_SIZE = { width: 1440, height: 960 }

const screencastEveryNthFrame = (): number => {
  const raw = Number.parseInt(process.env.LIVE_SCREENCAST_EVERY_NTH ?? "", 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 2
}
const screencastQuality = (): number => {
  const raw = Number.parseInt(process.env.LIVE_SCREENCAST_QUALITY ?? "", 10)
  return Number.isFinite(raw) && raw >= 1 && raw <= 100 ? raw : 60
}
const SCREENCAST = { format: "jpeg" as const, maxWidth: 1280, maxHeight: 720 }

/** 登录沙盒空闲自动回收时长（ms），杜绝用户开了沙盒走开后残留的有头 Chrome。0 关闭。 */
const idleTimeoutMs = (): number => {
  const raw = Number.parseInt(process.env.AUTH_SANDBOX_IDLE_MS ?? "", 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : 10 * 60_000
}

interface ScreencastController {
  setDemand: (active: boolean) => void
  stop: () => Promise<void>
}

interface SandboxRuntime {
  context: BrowserContext
  page: Page
  userDataDir: string
  screencast?: ScreencastController
  lastActivityAt: number
}

/**
 * 复杂登录沙盒：在服务端用 Patchright 起一个真浏览器，把画面用 WS-JPEG 推到前端，
 * 用户亲手完成登录（滑块/点选/短信/扫码等），点"保存登录态"后把 context.storageState()
 * 写入 (authProfile, targetUrl) 的状态行——后续业务回放沿用现成的 storageState 注入逻辑。
 *
 * 会话只存于内存，不落 DB（关闭即销毁），因此 0 schema 变更。
 */
export class AuthLoginSandboxService {
  private readonly sessions = new Map<string, AuthLoginSandboxSession>()
  private readonly runtimes = new Map<string, SandboxRuntime>()
  private readonly liveViewportSubscribers = new Map<string, Set<(chunk: Uint8Array) => void>>()

  constructor(private readonly db: AutoVisDatabase) {
    const ttl = idleTimeoutMs()
    if (ttl > 0) {
      const timer = setInterval(() => this.reapIdleSessions(ttl), Math.min(ttl, 60_000))
      // 不要因为这个常驻定时器阻止进程退出。
      ;(timer as { unref?: () => void }).unref?.()
    }
  }

  public getSession(sessionId: string): AuthLoginSandboxSession | undefined {
    return this.sessions.get(sessionId)
  }

  private touch(sessionId: string) {
    const runtime = this.runtimes.get(sessionId)
    if (runtime) {
      runtime.lastActivityAt = Date.now()
    }
  }

  private reapIdleSessions(ttl: number) {
    const nowMs = Date.now()
    for (const [sessionId, runtime] of this.runtimes) {
      // 有观众在看 → 不算空闲。
      if ((this.liveViewportSubscribers.get(sessionId)?.size ?? 0) > 0) continue
      if (nowMs - runtime.lastActivityAt < ttl) continue
      const session = this.sessions.get(sessionId)
      if (session && (session.status === "live" || session.status === "starting")) {
        session.status = "cancelled"
        session.error = "登录沙盒空闲超时，已自动回收。"
        session.finishedAt = now()
      }
      void this.teardown(sessionId)
    }
  }

  public subscribeLiveViewport(sessionId: string, listener: (chunk: Uint8Array) => void) {
    const set = this.liveViewportSubscribers.get(sessionId) ?? new Set<(chunk: Uint8Array) => void>()
    set.add(listener)
    this.liveViewportSubscribers.set(sessionId, set)
    this.touch(sessionId)
    // 第一个观众接入 → 开启抓帧。
    if (set.size === 1) {
      this.runtimes.get(sessionId)?.screencast?.setDemand(true)
    }
    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.liveViewportSubscribers.delete(sessionId)
        // 最后一个观众离开 → 停止抓帧。
        this.runtimes.get(sessionId)?.screencast?.setDemand(false)
      }
    }
  }

  public async start(request: StartAuthLoginSandboxRequest): Promise<AuthLoginSandboxSession> {
    const project = this.db.getProject(request.projectId)
    if (!project) {
      throw new Error("项目不存在")
    }
    const profile = this.db.getAuthProfile(request.authProfileId)
    if (!profile || profile.projectId !== request.projectId) {
      throw new Error("登录态配置不存在或不属于该项目")
    }
    const resolved = this.db.resolveTargetUrl(request.projectId, request.targetUrlId)
    if (!resolved) {
      throw new Error("无法解析目标 URL：请先在项目设置中配置主域名或选择有效的 TargetUrl。")
    }
    if (!resolved.id) {
      throw new Error("请选择一个具体的目标 URL：无法把登录态写入未知 URL。")
    }

    const session: AuthLoginSandboxSession = {
      id: createId("authsbx"),
      projectId: request.projectId,
      authProfileId: profile.id,
      targetUrlId: resolved.id,
      targetUrl: resolved.url,
      status: "starting",
      startedAt: now(),
    }
    this.sessions.set(session.id, session)

    let context: BrowserContext
    let userDataDir: string
    try {
      // 反检测：headed + 真 Chrome + persistent context + viewport:null（见 launchStealthPersistentContext）。
      ;({ context, userDataDir } = await launchStealthPersistentContext({ windowSize: WINDOW_SIZE }))
    } catch (error) {
      session.status = "error"
      session.error = error instanceof Error ? error.message : String(error)
      session.finishedAt = now()
      throw error
    }
    const page = context.pages()[0] ?? (await context.newPage())
    const runtime: SandboxRuntime = { context, page, userDataDir, lastActivityAt: Date.now() }
    this.runtimes.set(session.id, runtime)

    page.on("close", () => this.handleUnexpectedClose(session.id))

    runtime.screencast = await this.startScreencast(session.id, page)
    // 若此刻已有观众在等画面，立即开抓帧。
    if ((this.liveViewportSubscribers.get(session.id)?.size ?? 0) > 0) {
      runtime.screencast?.setDemand(true)
    }

    session.liveViewport = {
      mode: "ws-jpeg-stream",
      url: `${appOrigin.replace(/^http/, "ws")}/api/auth-login-sandbox/${session.id}/live`,
      status: "live",
      mimeType: "image/jpeg",
      // viewport:null 下真实 CSS 视口不等于窗口尺寸（被工具栏吃掉一部分高度），
      // 前端按这两个值把画面坐标映射回 page.mouse 的 CSS 像素坐标，否则点击会错位。
      width: WINDOW_SIZE.width,
      height: WINDOW_SIZE.height,
    }

    await page.goto(resolved.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined)
    const viewport = await this.measureViewport(page)
    session.liveViewport.width = viewport.width
    session.liveViewport.height = viewport.height
    session.status = "live"
    session.currentUrl = page.url()
    session.pageTitle = await page.title().catch(() => undefined)
    return session
  }

  /** viewport:null 时 page.viewportSize() 返回 null，需直接读真实 CSS 视口。 */
  private async measureViewport(page: Page): Promise<{ width: number; height: number }> {
    const dims = await page
      .evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
      .catch(() => null)
    if (dims && dims.width > 0 && dims.height > 0) {
      return dims
    }
    return { width: WINDOW_SIZE.width, height: WINDOW_SIZE.height }
  }

  public async interact(sessionId: string, interaction: RecorderInteractionRequest): Promise<AuthLoginSandboxSession> {
    const session = this.sessions.get(sessionId)
    const runtime = this.runtimes.get(sessionId)
    if (!session || !runtime) {
      throw new Error("登录沙盒会话不存在或已结束")
    }
    if (session.status !== "live" && session.status !== "starting") {
      throw new Error("登录沙盒会话当前不可交互")
    }
    runtime.lastActivityAt = Date.now()
    const { page } = runtime

    if (interaction.type === "navigate") {
      if (interaction.url) {
        await page.goto(interaction.url, { waitUntil: "domcontentloaded", timeout: 30_000 })
        if (session.liveViewport) {
          const viewport = await this.measureViewport(page)
          session.liveViewport.width = viewport.width
          session.liveViewport.height = viewport.height
        }
      }
    } else if (interaction.type === "click" || interaction.type === "dblclick") {
      await page.mouse.click(interaction.x ?? 0, interaction.y ?? 0, { clickCount: interaction.type === "dblclick" ? 2 : 1 })
    } else if (interaction.type === "pointerdown") {
      await page.mouse.move(interaction.x ?? 0, interaction.y ?? 0)
      await page.mouse.down()
    } else if (interaction.type === "pointermove") {
      await page.mouse.move(interaction.x ?? 0, interaction.y ?? 0)
    } else if (interaction.type === "pointerup") {
      if (interaction.x != null && interaction.y != null) {
        await page.mouse.move(interaction.x, interaction.y)
      }
      await page.mouse.up()
    } else if (interaction.type === "scroll") {
      await page.mouse.wheel(0, interaction.deltaY ?? 0)
    } else if (interaction.type === "keydown") {
      if (interaction.key) {
        await page.keyboard.press(interaction.key)
      }
    } else if (interaction.type === "input") {
      if (interaction.value != null) {
        if (interaction.selector) {
          await page.locator(interaction.selector).fill(interaction.value)
        } else {
          await page.keyboard.type(interaction.value)
        }
      }
    }

    session.currentUrl = page.url()
    session.pageTitle = await page.title().catch(() => session.pageTitle)
    return session
  }

  public async save(sessionId: string): Promise<SaveAuthLoginSandboxResponse> {
    const session = this.sessions.get(sessionId)
    const runtime = this.runtimes.get(sessionId)
    if (!session || !runtime) {
      throw new Error("登录沙盒会话不存在或已结束")
    }
    session.status = "saving"
    const state = await runtime.context.storageState()
    const json = JSON.stringify(state)
    const rawUrl = runtime.page.url()
    const postLoginUrl = rawUrl && rawUrl !== "about:blank" ? rawUrl : null
    const stateRow = this.db.upsertAuthProfileState(session.authProfileId, session.targetUrlId, json, postLoginUrl)

    session.savedSummary = buildStorageStateSummary(json)
    session.postLoginUrl = postLoginUrl ?? undefined
    session.status = "saved"
    session.finishedAt = now()
    await this.teardown(sessionId)

    const decorated: AuthProfileState = {
      ...stateRow,
      storageStateSummary: buildStorageStateSummary(stateRow.storageStateJson),
      postLoginUrl: stateRow.postLoginUrlOverride ?? stateRow.postLoginUrlAuto,
    }
    return { session, state: decorated }
  }

  public async cancel(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return false
    }
    if (session.status !== "saved") {
      session.status = "cancelled"
      session.finishedAt = now()
    }
    await this.teardown(sessionId)
    return true
  }

  private async startScreencast(sessionId: string, page: Page): Promise<ScreencastController | undefined> {
    let cdp
    try {
      cdp = await page.context().newCDPSession(page)
    } catch {
      return undefined
    }
    let stopped = false
    let streaming = false
    cdp.on("Page.screencastFrame", async (payload: { data: string; sessionId: number }) => {
      if (!stopped && streaming) {
        this.notifyLiveViewport(sessionId, Buffer.from(payload.data, "base64"))
      }
      await cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => undefined)
    })

    const startStream = async () => {
      if (stopped || streaming) return
      streaming = true
      await cdp
        .send("Page.startScreencast", {
          ...SCREENCAST,
          quality: screencastQuality(),
          everyNthFrame: screencastEveryNthFrame(),
        })
        .catch(() => {
          streaming = false
        })
    }
    const stopStream = async () => {
      if (stopped || !streaming) return
      streaming = false
      await cdp.send("Page.stopScreencast").catch(() => undefined)
    }

    return {
      setDemand: (active: boolean) => {
        if (stopped) return
        void (active ? startStream() : stopStream())
      },
      stop: async () => {
        stopped = true
        await stopStream()
      },
    }
  }

  private notifyLiveViewport(sessionId: string, chunk: Uint8Array) {
    const set = this.liveViewportSubscribers.get(sessionId)
    if (!set) {
      return
    }
    for (const listener of set) {
      try {
        listener(chunk)
      } catch {
        // 单个订阅者出错不影响其它订阅者
      }
    }
  }

  private handleUnexpectedClose(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session && (session.status === "live" || session.status === "starting")) {
      session.status = "error"
      session.error = "浏览器已关闭"
      session.finishedAt = now()
    }
    this.runtimes.delete(sessionId)
  }

  private async teardown(sessionId: string) {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) {
      return
    }
    this.runtimes.delete(sessionId)
    if (runtime.screencast) {
      await runtime.screencast.stop().catch(() => undefined)
    }
    // persistent context：关闭 context 即关闭浏览器。
    await runtime.context.close().catch(() => undefined)
    await rm(runtime.userDataDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
