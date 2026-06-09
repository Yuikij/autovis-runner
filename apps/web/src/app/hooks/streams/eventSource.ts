export type EventSourceStatus = "connecting" | "live" | "reconnecting" | "closed"

type RetryingEventSourceOptions = {
  url: string
  onMessage: (event: MessageEvent<string>) => void
  onOpen?: () => void
  /** Fired when the server signals the stream is finished (`event: done`). */
  onDone?: (event: MessageEvent<string>) => void
  /** Surfaces connection lifecycle so the UI can show connecting / reconnecting / closed. */
  onStatusChange?: (status: EventSourceStatus) => void
}

/**
 * Wraps the browser `EventSource` with auto-reconnect, while honoring the
 * server's explicit `done` event. Without `done` handling, the server's
 * intentional `reply.raw.end()` on terminal entities looks like a network
 * error to `EventSource`, which then reconnects forever and re-emits the
 * terminal snapshot — a major source of the runaway `/stream` request loop.
 */
export function connectRetryingEventSource({ url, onMessage, onOpen, onDone, onStatusChange }: RetryingEventSourceOptions) {
  let cancelled = false
  let source: EventSource | null = null
  let retryTimer: number | null = null
  let attempt = 0

  const setStatus = (status: EventSourceStatus) => {
    if (cancelled && status !== "closed") return
    onStatusChange?.(status)
  }

  const stop = () => {
    cancelled = true
    if (retryTimer) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
    source?.close()
    source = null
  }

  const connect = () => {
    if (cancelled) return
    setStatus(attempt === 0 ? "connecting" : "reconnecting")
    source = new EventSource(url)
    source.onopen = () => {
      attempt = 0
      setStatus("live")
      onOpen?.()
    }
    source.onmessage = onMessage
    source.addEventListener("done", (event) => {
      // Server finished this stream on purpose. Process the final payload and
      // tear down without reconnecting.
      onDone?.(event as MessageEvent<string>)
      stop()
      setStatus("closed")
    })
    source.onerror = () => {
      if (cancelled) return
      source?.close()
      source = null
      attempt += 1
      const delay = Math.min(15_000, 500 * Math.pow(2, attempt))
      setStatus("reconnecting")
      retryTimer = window.setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    stop()
    setStatus("closed")
  }
}
