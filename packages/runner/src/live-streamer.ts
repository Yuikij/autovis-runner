import type { Page } from "@playwright/test"
import type { LiveViewportEvent } from "./types.js"

export const createCdpLiveStreamer = async (
  page: Page,
  onLiveViewportEvent?: (event: LiveViewportEvent) => Promise<void> | void,
) => {
  if (!onLiveViewportEvent) {
    return undefined
  }

  const session = await page.context().newCDPSession(page)
  let stopped = false

  session.on("Page.screencastFrame", async (payload: { data: string; metadata?: { deviceWidth?: number; deviceHeight?: number }; sessionId: number }) => {
    if (stopped) {
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

  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 65,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1,
  }).catch(async () => {
    await onLiveViewportEvent({ type: "unavailable" })
  })

  await onLiveViewportEvent({
    type: "started",
    mimeType: "image/jpeg",
    width: 1280,
    height: 720,
  })

  return async () => {
    stopped = true
    await session.send("Page.stopScreencast").catch(() => undefined)
    await onLiveViewportEvent({ type: "ended" })
  }
}
