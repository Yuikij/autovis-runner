import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type {
  ApiEnvelope,
  AuthLoginSandboxSession,
  RecorderInteractionRequest,
  SaveAuthLoginSandboxResponse,
  StartAuthLoginSandboxRequest,
} from "@autovis/shared"
import { store } from "../store.js"

const interactionSchema = z.object({
  type: z.enum(["navigate", "click", "dblclick", "input", "keydown", "scroll", "pointerdown", "pointermove", "pointerup"]),
  url: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  deltaY: z.number().optional(),
  selector: z.string().optional(),
  role: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
})

export async function authLoginSandboxRoutes(app: FastifyInstance) {
  app.post("/auth-login-sandbox", async (request): Promise<ApiEnvelope<AuthLoginSandboxSession>> => {
    const body = z
      .object({
        projectId: z.string(),
        authProfileId: z.string(),
        targetUrlId: z.string().optional(),
      })
      .parse(request.body) as StartAuthLoginSandboxRequest

    return { data: await store.startAuthLoginSandbox(body) }
  })

  app.post("/auth-login-sandbox/:sessionId/interactions", async (request): Promise<ApiEnvelope<AuthLoginSandboxSession>> => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const body = interactionSchema.parse(request.body) as RecorderInteractionRequest

    return { data: await store.interactAuthLoginSandbox(params.sessionId, body) }
  })

  app.get("/auth-login-sandbox/:sessionId/control", { websocket: true }, (socket, request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    let closed = false
    let queue = Promise.resolve()

    const send = (payload: unknown) => {
      if (!closed && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(payload))
      }
    }

    socket.on("message", (raw: unknown) => {
      let interaction: RecorderInteractionRequest
      try {
        const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw)
        interaction = interactionSchema.parse(JSON.parse(text)) as RecorderInteractionRequest
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) })
        return
      }

      const shouldEchoSession = interaction.type !== "pointermove"
      queue = queue
        .catch(() => undefined)
        .then(async () => {
          const session = await store.interactAuthLoginSandbox(params.sessionId, interaction)
          if (shouldEchoSession) {
            send({ type: "session", data: session })
          }
        })
        .catch((error) => {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) })
        })
    })

    socket.on("close", () => {
      closed = true
    })
  })

  app.post("/auth-login-sandbox/:sessionId/save", async (request): Promise<ApiEnvelope<SaveAuthLoginSandboxResponse>> => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    return { data: await store.saveAuthLoginSandbox(params.sessionId) }
  })

  app.post("/auth-login-sandbox/:sessionId/cancel", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const ok = await store.cancelAuthLoginSandbox(params.sessionId)
    if (!ok) {
      reply.code(404)
      return { message: "登录沙盒会话不存在" }
    }
    return { data: { id: params.sessionId, status: "cancelled" } }
  })

  app.get("/auth-login-sandbox/:sessionId", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const session = store.getAuthLoginSandbox(params.sessionId)
    if (!session) {
      reply.code(404)
      return { message: "登录沙盒会话不存在" }
    }
    return { data: session }
  })

  app.get("/auth-login-sandbox/:sessionId/live", { websocket: true }, (socket, request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const unsubscribe = store.subscribeAuthLoginSandboxLiveViewport(params.sessionId, (chunk) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(chunk)
      }
    })
    socket.on("close", () => {
      unsubscribe()
    })
  })
}
