import { rm } from "node:fs/promises"
import { type BrowserContext, type Frame, type Page } from "@playwright/test"
import {
  type AuthLoginSandboxSession,
  type AuthProfile,
  type AuthProfileState,
  type RecorderInteractionRequest,
  type SaveAuthLoginSandboxResponse,
  type StartAuthLoginSandboxRequest,
} from "@browsewright/shared"
import { BrowsewrightDatabase } from "../db.js"
import { launchStealthPersistentContext } from "../browser.js"
import { appOrigin, createId, now, resolvePersistentProfileDir } from "./common.js"
import { buildStorageStateSummary } from "./authProfile.utils.js"

const WINDOW_SIZE = { width: 1440, height: 960 }

type StorageStateCookie = Parameters<BrowserContext["addCookies"]>[0][number]
type StorageStateOrigin = { origin: string; localStorage?: Array<{ name: string; value: string }> }

/**
 * 合并多个前置登录态的 storageState：
 * - cookie 按 (name, domain, path) 去重，后注入的覆盖先注入的；
 * - localStorage 按 origin 聚合、按 key 去重，同样后者覆盖前者。
 * 一个前置 profile 可能在多个 targetUrl 下各存一份 state（如 accounts.google.com 与主站），
 * 全部纳入合并——第三方登录态本来就是跨域 cookie，取全集最稳。
 */
const mergePrerequisiteStorageStates = (profiles: AuthProfile[]) => {
  const cookieMap = new Map<string, StorageStateCookie>()
  const originMap = new Map<string, Map<string, string>>()
  const injectedProfileNames: string[] = []

  for (const profile of profiles) {
    let contributed = false
    for (const state of profile.states) {
      if (!state.storageStateJson) continue
      let parsed: { cookies?: StorageStateCookie[]; origins?: StorageStateOrigin[] }
      try {
        parsed = JSON.parse(state.storageStateJson)
      } catch {
        continue
      }
      for (const cookie of parsed.cookies ?? []) {
        if (!cookie?.name) continue
        cookieMap.set(`${cookie.name}\u0000${cookie.domain ?? ""}\u0000${cookie.path ?? "/"}`, cookie)
        contributed = true
      }
      for (const origin of parsed.origins ?? []) {
        if (!origin?.origin || !Array.isArray(origin.localStorage)) continue
        const items = originMap.get(origin.origin) ?? new Map<string, string>()
        for (const item of origin.localStorage) {
          items.set(item.name, item.value)
          contributed = true
        }
        originMap.set(origin.origin, items)
      }
    }
    if (contributed) {
      injectedProfileNames.push(profile.name)
    }
  }

  return {
    cookies: [...cookieMap.values()],
    origins: [...originMap.entries()].map(([origin, items]) => ({
      origin,
      localStorage: [...items.entries()].map(([name, value]) => ({ name, value })),
    })),
    injectedProfileNames,
  }
}

/** about:blank / 空 URL：尚未导航到实页的"白页"，推流跟过去只会得到一片空白。 */
const isBlankUrl = (url: string | undefined): boolean =>
  !url || url === "about:blank" || url === "about:newtab" || url === "chrome://newtab/"

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
  /** 持久 profile：userDataDir 是该 profile 的固定目录，关闭沙盒时**不能删**（回放还要复用）。 */
  persistent?: boolean
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
  /** 同一 profile 的浏览器启动串行化：前端可能双发启动请求（React StrictMode / 连点），
   * 并发启动会让两个 Chrome 抢同一个持久 profile 目录，后者撞锁失败。 */
  private readonly launchQueues = new Map<string, Promise<unknown>>()

  constructor(private readonly db: BrowsewrightDatabase) {
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

  /** 把同一 profile 的启动排进队列：前一个启动（无论成败）结束后才轮到下一个。 */
  private withLaunchQueue<T>(profileId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.launchQueues.get(profileId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(task)
    const settled = run.catch(() => undefined).finally(() => {
      if (this.launchQueues.get(profileId) === settled) {
        this.launchQueues.delete(profileId)
      }
    })
    this.launchQueues.set(profileId, settled)
    return run
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

    // 持久 profile（默认开）：用该 profile 的固定目录登录，过的质询/cf_clearance 直接落进回放要复用的 profile。
    const persistentDir = profile.usePersistentProfile !== false ? resolvePersistentProfileDir(profile.id) : undefined
    let context: BrowserContext
    let userDataDir: string
    try {
      // 反检测：headed + 真 Chrome + persistent context + viewport:null（见 launchStealthPersistentContext）。
      ;({ context, userDataDir } = await this.withLaunchQueue(profile.id, () =>
        launchStealthPersistentContext({ windowSize: WINDOW_SIZE, userDataDir: persistentDir }),
      ))
    } catch (error) {
      session.status = "error"
      session.error = error instanceof Error ? error.message : String(error)
      session.finishedAt = now()
      throw error
    }
    // 持久 profile 复用目录时，Chrome 会把上次会话残留的标签页一并恢复；只留一个主页，
    // 其余恢复出来的陈旧标签直接关掉，避免真实窗口里越积越多、也避免推流抓错页面。
    const restored = context.pages()
    const page = restored[0] ?? (await context.newPage())
    for (const stale of restored.slice(1)) {
      await stale.close().catch(() => undefined)
    }
    const runtime: SandboxRuntime = { context, page, userDataDir, persistent: Boolean(persistentDir), lastActivityAt: Date.now() }
    this.runtimes.set(session.id, runtime)

    page.on("close", () => this.handlePageClose(session.id, page))
    // 登录链路常把目标页/验证码开在新标签（如淘宝点"登录"弹出 login.taobao.com）。
    // 跟随最新打开的标签：把推流与交互都切过去，否则前端只看见旧页、点击全打在后台页上没反应。
    context.on("page", (opened) => void this.handleNewPage(session.id, opened))

    runtime.screencast = await this.startScreencast(session.id, page)
    // 主页置前：保证截屏抓的是可见标签、page.mouse 点击落在前台。
    await page.bringToFront().catch(() => undefined)
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

    // 前置登录态注入：打开目标站之前，把配置的前置 profile（如 Google/GitHub）已保存的
    // cookies/localStorage 灌进 context——目标站走第三方 OAuth 登录时可直接带上会话。
    // 注入失败不阻断沙盒：用户仍可全程手动登录。
    await this.injectPrerequisiteStates(session, profile, context)

    await page.goto(resolved.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined)
    const viewport = await this.measureViewport(page)
    session.liveViewport.width = viewport.width
    session.liveViewport.height = viewport.height
    session.status = "live"
    session.currentUrl = page.url()
    session.pageTitle = await page.title().catch(() => undefined)
    return session
  }

  /**
   * 把前置 profile 的登录态合并注入 context。与持久 profile 目录里已有的 cookie 是叠加关系：
   * 已有的不清除，同名 cookie 被注入值覆盖（前置态通常更新，覆盖即"续期"）。
   */
  private async injectPrerequisiteStates(
    session: AuthLoginSandboxSession,
    profile: AuthProfile,
    context: BrowserContext,
  ) {
    const prerequisiteIds = profile.prerequisiteAuthProfileIds ?? []
    if (prerequisiteIds.length === 0) return
    const prerequisites = prerequisiteIds
      .map((id) => this.db.getAuthProfile(id))
      .filter((item): item is AuthProfile => Boolean(item && item.id !== profile.id))
    const merged = mergePrerequisiteStorageStates(prerequisites)
    if (merged.injectedProfileNames.length === 0) return

    if (merged.cookies.length > 0) {
      await context.addCookies(merged.cookies).catch(() => undefined)
    }
    for (const origin of merged.origins) {
      if (origin.localStorage.length === 0) continue
      await context.addInitScript(
        ({ origin: target, items }: { origin: string; items: Array<{ name: string; value: string }> }) => {
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

    session.prerequisiteInjection = {
      profileNames: merged.injectedProfileNames,
      cookieCount: merged.cookies.length,
      originCount: merged.origins.length,
    }
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

  /** 切换推流/交互的目标页：停掉旧页抓帧，绑定新页并置前、按需重新抓帧、刷新视口与 URL/标题。 */
  private async bindActivePage(sessionId: string, page: Page) {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime || page.isClosed()) {
      return
    }
    if (runtime.screencast) {
      await runtime.screencast.stop().catch(() => undefined)
    }
    runtime.page = page
    await page.bringToFront().catch(() => undefined)
    runtime.screencast = await this.startScreencast(sessionId, page)
    if ((this.liveViewportSubscribers.get(sessionId)?.size ?? 0) > 0) {
      runtime.screencast?.setDemand(true)
    }
    const session = this.sessions.get(sessionId)
    if (session?.liveViewport) {
      const viewport = await this.measureViewport(page)
      session.liveViewport.width = viewport.width
      session.liveViewport.height = viewport.height
      session.currentUrl = page.url()
      session.pageTitle = await page.title().catch(() => session.pageTitle)
    }
  }

  /**
   * 新标签打开（含登录弹窗）：登记关闭回调，并把它作为当前活动页跟随推流/交互。
   *
   * 但不要无条件跟随空白页：很多站点登录链路会先 window.open() 弹一个 about:blank
   * 再 navigate 到实页，也有广告/跳板纯空白标签。若立刻切过去，前端只会看到一片空白、
   * 点击全打在白页上，用户卡死（见小红书弹空白标签的现象）。
   * 策略：当前是空白 → 不绑定，等它真正导航到实页再切；其间把原活动页重新置前
   * （有头 Chrome 会自动前置新标签，后台标签停止绘制会让推流卡住）。一直保持空白则忽略。
   */
  private async handleNewPage(sessionId: string, page: Page) {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime || page === runtime.page) {
      return
    }
    page.on("close", () => this.handlePageClose(sessionId, page))
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
    runtime.lastActivityAt = Date.now()

    if (isBlankUrl(page.url())) {
      // 把活动页置回前台，抵消 Chrome 自动前置空白新标签导致原页停画。
      await runtime.page.bringToFront().catch(() => undefined)
      const onNav = (frame: Frame) => {
        if (frame !== page.mainFrame() || isBlankUrl(page.url())) {
          return
        }
        page.off("framenavigated", onNav)
        runtime.lastActivityAt = Date.now()
        void this.handleNewPage(sessionId, page)
      }
      page.on("framenavigated", onNav)
      page.once("close", () => page.off("framenavigated", onNav))
      return
    }
    await this.bindActivePage(sessionId, page)
  }

  /** 某个标签关闭：还有其它标签就切回最后一个；一个都不剩才当作浏览器异常关闭。 */
  private async handlePageClose(sessionId: string, closed: Page) {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) {
      return
    }
    const remaining = runtime.context.pages().filter((candidate) => candidate !== closed && !candidate.isClosed())
    if (remaining.length === 0) {
      this.handleUnexpectedClose(sessionId)
      return
    }
    if (runtime.page === closed) {
      await this.bindActivePage(sessionId, remaining[remaining.length - 1])
    }
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
    // 用户手动关窗只关掉了可见窗口；macOS 下 Chrome 进程会零窗口残活，且仍持有持久 profile 的
    // SingletonLock。若此处只删 runtime 不关 context，这个孤儿进程就再没人能回收，下次对同一
    // profile 起沙盒会撞上它（"正在现有的浏览器会话中打开" → launch 失败）。必须真正 teardown。
    void this.teardown(sessionId)
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
    // 持久 profile 的目录是 profile 固定目录，回放要复用——**不能删**；只清理临时目录。
    if (!runtime.persistent) {
      await rm(runtime.userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
