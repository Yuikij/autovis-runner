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
    const body = z
      .object({
        type: z.enum(["navigate", "click", "dblclick", "input", "keydown", "scroll"]),
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
      .parse(request.body) as RecorderInteractionRequest

    return { data: await store.interactAuthLoginSandbox(params.sessionId, body) }
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
