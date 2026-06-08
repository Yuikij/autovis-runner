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
}

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

  let session: import("@playwright/test").CDPSession
  try {
    session = await page.context().newCDPSession(page)
  } catch {
    await onLiveViewportEvent({ type: "unavailable" })
    return undefined
  }

  let stopped = false
  let streaming = false

  session.on("Page.screencastFrame", async (payload: { data: string; metadata?: { deviceWidth?: number; deviceHeight?: number }; sessionId: number }) => {
    if (stopped || !streaming) {
      // 仍需 ack，否则 Chrome 会停止后续帧。
      await session.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => undefined)
      return
    }
    const chunk = Buffer.from(payload.data, "base64")
    await onLiveViewportEvent({
      type: "chunk",
      chunk,
      width: payload.metadata?.deviceWidth,
      height: payload.metadata?.deviceHeight,
    })
    await session.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => undefined)
  })

  const startScreencast = async () => {
    if (stopped || streaming) return
    streaming = true
    await session
      .send("Page.startScreencast", {
        format: "jpeg",
        quality: screencastQuality(),
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: screencastEveryNthFrame(),
      })
      .catch(async () => {
        streaming = false
        await onLiveViewportEvent({ type: "unavailable" })
      })
  }

  const stopScreencast = async () => {
    if (stopped || !streaming) return
    streaming = false
    await session.send("Page.stopScreencast").catch(() => undefined)
  }

  // 先发布 started（让前端拿到 live URL 并去连 WS）；是否真正抓帧由 demand 决定。
  await onLiveViewportEvent({
    type: "started",
    mimeType: "image/jpeg",
    width: 1280,
    height: 720,
  })

  if (!gateOnDemand) {
    await startScreencast()
  }

  return {
    stop: async () => {
      stopped = true
      await stopScreencast()
      await onLiveViewportEvent({ type: "ended" })
    },
    setDemand: (active: boolean) => {
      if (stopped) return
      void (active ? startScreencast() : stopScreencast())
    },
  }
}
