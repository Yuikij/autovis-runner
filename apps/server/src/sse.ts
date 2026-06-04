import type { FastifyReply, FastifyRequest } from "fastify"

type SseStreamOptions<T> = {
  request: FastifyRequest
  reply: FastifyReply
  initialData?: T
  subscribe: (listener: (value: T) => void) => () => void
  isDone?: (value: T) => boolean
  heartbeatMs?: number
}

const isWritable = (reply: FastifyReply) => !reply.raw.destroyed && !reply.raw.writableEnded

const writeSseEvent = (reply: FastifyReply, event: string, payload: unknown) => {
  if (!isWritable(reply)) return
  if (event !== "message") {
    reply.raw.write(`event: ${event}\n`)
  }
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const writeHeartbeat = (reply: FastifyReply) => {
  if (!isWritable(reply)) return
  reply.raw.write(`: ping\n\n`)
}

export const createSseStream = <T>({
  request,
  reply,
  initialData,
  subscribe,
  isDone,
  heartbeatMs = 20_000,
}: SseStreamOptions<T>) => {
  reply.raw.setHeader("Content-Type", "text/event-stream")
  reply.raw.setHeader("Cache-Control", "no-cache")
  reply.raw.setHeader("Connection", "keep-alive")
  reply.raw.flushHeaders()

  let closed = false
  let unsubscribe = () => {}

  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
    if (isWritable(reply)) {
      reply.raw.end()
    }
  }

  const emit = (value: T) => {
    if (closed) return
    writeSseEvent(reply, "message", value)
    if (isDone?.(value)) {
      writeSseEvent(reply, "done", value)
      cleanup()
    }
  }

  const heartbeat = setInterval(() => {
    writeHeartbeat(reply)
  }, heartbeatMs)
  heartbeat.unref?.()

  request.raw.on("close", cleanup)
  reply.raw.on("close", cleanup)
  reply.raw.on("error", () => {
    if (!closed) {
      writeSseEvent(reply, "error", { message: "SSE stream failed" })
    }
    cleanup()
  })

  if (initialData !== undefined) {
    emit(initialData)
  }

  if (!closed) {
    try {
      unsubscribe = subscribe((value) => {
        emit(value)
      })
    } catch (error) {
      writeSseEvent(reply, "error", {
        message: error instanceof Error ? error.message : "SSE subscription failed",
      })
      cleanup()
    }
  }

  return reply
}