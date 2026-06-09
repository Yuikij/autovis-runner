import { useEffect, useRef } from "react"

import { connectRetryingEventSource } from "./eventSource"

/**
 * The single SSE subscription primitive for the workspace. Given a stream URL
 * and a message handler, it owns connect / JSON-parse / teardown so the
 * individual entity hooks no longer each re-implement `new EventSource(...)`.
 *
 * The handler is held in a ref, so changing handler identity across renders
 * never tears down and re-opens the stream — re-subscription only happens when
 * the URL itself changes (or becomes null). This is what prevents the
 * reconnect churn that previously fed the `/stream` request storm.
 */
export function useEntityStream<T>(url: string | null, onMessage: (value: T) => void) {
  const handlerRef = useRef(onMessage)

  useEffect(() => {
    handlerRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    if (!url) {
      return undefined
    }
    return connectRetryingEventSource({
      url,
      onMessage: (event) => {
        let parsed: T
        try {
          parsed = JSON.parse(event.data) as T
        } catch {
          return
        }
        handlerRef.current(parsed)
      },
    })
  }, [url])
}
