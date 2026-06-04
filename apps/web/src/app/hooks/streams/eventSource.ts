type RetryingEventSourceOptions = {
  url: string
  onMessage: (event: MessageEvent<string>) => void
  onOpen?: () => void
}

export function connectRetryingEventSource({ url, onMessage, onOpen }: RetryingEventSourceOptions) {
  let cancelled = false
  let source: EventSource | null = null
  let retryTimer: number | null = null
  let attempt = 0

  const connect = () => {
    if (cancelled) return
    source = new EventSource(url)
    source.onopen = () => {
      attempt = 0
      onOpen?.()
    }
    source.onmessage = onMessage
    source.onerror = () => {
      if (cancelled) return
      source?.close()
      source = null
      attempt += 1
      const delay = Math.min(15_000, 500 * Math.pow(2, attempt))
      retryTimer = window.setTimeout(connect, delay)
    }
  }

  connect()

  return () => {
    cancelled = true
    if (retryTimer) window.clearTimeout(retryTimer)
    source?.close()
  }
}