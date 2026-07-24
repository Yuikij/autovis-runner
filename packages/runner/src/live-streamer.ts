import type { Page } from "@playwright/test"
import type { LiveViewportEvent } from "./types.js"

/**
 * 实时预览推流的帧率 / 画质，可用环境变量调小以降载：
 * - LIVE_SCREENCAST_EVERY_NTH：每 N 帧抓 1 帧（默认 2，1=满帧率最费 CPU）；
 * - LIVE_SCREENCAST_QUALITY：JPEG 质量 1-100（默认 55）。
 * 预览不需要满帧率，调大 everyNthFrame 能显著降低 renderer / 编码开销。
 */
const screencastEveryNthFrame = (): number => {
  const raw = Number.parseInt(process.env.LIVE_SCREENCAST_EVERY_NTH ?? "", 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 2
}

const screencastQuality = (): number => {
  const raw = Number.parseInt(process.env.LIVE_SCREENCAST_QUALITY ?? "", 10)
  return Number.isFinite(raw) && raw >= 1 && raw <= 100 ? raw : 55
}

export interface LiveStreamController {
  /** 永久停止并释放 CDP 会话（会话结束时调用）。 */
  stop: () => Promise<void>
  /**
   * 按需开关底层 Page.startScreencast：仅在有观众订阅时才真正抓帧，
   * 没人看时停掉，避免 renderer 满帧率空转 + Node 端 base64 解码空烧。
   */
  setDemand: (active: boolean) => void
  /**
   * 把推流切到另一个 page（脚本/站点新开标签或弹窗时）。否则前端只会一直看到旧页冻住。
   * 切换会保留当前 demand 状态：原本在抓帧就继续抓新页，否则只换绑不抓。
   */
  rebind: (page: Page) => Promise<void>
}

const SCREENCAST_FRAME = "Page.screencastFrame"

export const createCdpLiveStreamer = async (
  page: Page,
  onLiveViewportEvent?: (event: LiveViewportEvent) => Promise<void> | void,
  options?: {
    /** true=只在有观众时抓帧（默认）；false=会话一建立就持续抓帧（旧行为）。 */
    gateOnDemand?: boolean
  },
): Promise<LiveStreamController | undefined> => {
  if (!onLiveViewportEvent) {
    return undefined
  }

  const gateOnDemand = options?.gateOnDemand ?? true

  type Bound = { session: import("@playwright/test").CDPSession; streaming: boolean }
  let stopped = false
  let demand = !gateOnDemand
  let active: Bound | null = null

  // 帧处理器以闭包捕获自己的 session：每个 CDP 会话只转发"它当前是活动会话且在抓帧"时的帧。
  const attachFrameHandler = (bound: Bound) => {
    bound.session.on(SCREENCAST_FRAME, async (payload: { data: string; metadata?: { deviceWidth?: number; deviceHeight?: number }; sessionId: number }) => {
      if (stopped || active !== bound || !bound.streaming) {
        // 仍需 ack，否则 Chrome 会停止后续帧。
        await bound.session.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => undefined)
        return
      }
      const chunk = Buffer.from(payload.data, "base64")
      await onLiveViewportEvent({
        type: "chunk",
        chunk,
        width: payload.metadata?.deviceWidth,
        height: payload.metadata?.deviceHeight,
      })
      await bound.session.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => undefined)
    })
  }

  const startScreencast = async () => {
    if (stopped || !active || active.streaming) return
    const bound = active
    bound.streaming = true
    await bound.session
      .send("Page.startScreencast", {
        format: "jpeg",
        quality: screencastQuality(),
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: screencastEveryNthFrame(),
      })
      .catch(async () => {
        bound.streaming = false
        await onLiveViewportEvent({ type: "unavailable" })
      })
  }

  const stopScreencast = async (bound: Bound | null = active) => {
    if (!bound || !bound.streaming) return
    bound.streaming = false
    await bound.session.send("Page.stopScreencast").catch(() => undefined)
  }

  // 在目标 page 上建立 CDP 会话并登记为活动会话；失败返回 false。不在此处开抓帧。
  const bind = async (target: Page): Promise<boolean> => {
    let session: import("@playwright/test").CDPSession
    try {
      session = await target.context().newCDPSession(target)
    } catch {
      return false
    }
    const bound: Bound = { session, streaming: false }
    attachFrameHandler(bound)
    active = bound
    return true
  }

  if (!(await bind(page))) {
    await onLiveViewportEvent({ type: "unavailable" })
    return undefined
  }

  // 先发布 started（让前端拿到 live URL 并去连 WS）；是否真正抓帧由 demand 决定。
  await onLiveViewportEvent({
    type: "started",
    mimeType: "image/jpeg",
    width: 1280,
    height: 720,
  })

  if (demand) {
    await startScreencast()
  }

  return {
    stop: async () => {
      stopped = true
      await stopScreencast()
      await active?.session.detach().catch(() => undefined)
      await onLiveViewportEvent({ type: "ended" })
    },
    setDemand: (next: boolean) => {
      if (stopped) return
      demand = next
      void (next ? startScreencast() : stopScreencast())
    },
    rebind: async (target: Page) => {
      if (stopped || target.isClosed()) return
      const previous = active
      await stopScreencast(previous)
      if (!(await bind(target))) {
        active = previous // 新页建会话失败，保持旧绑定不动。
        return
      }
      if (previous && previous.session !== active?.session) {
        await previous.session.detach().catch(() => undefined)
      }
      if (demand) {
        await startScreencast()
      }
    },
  }
}
