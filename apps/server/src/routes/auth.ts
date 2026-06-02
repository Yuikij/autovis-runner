import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { authEnabled, clearSessionCookie, getRequestUser, llmScope, setSessionCookie } from "../auth.js"
import { store } from "../store.js"

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/session", async (request) => ({
    data: {
      authEnabled,
      llmScope,
      user: getRequestUser(request),
    },
  }))

  app.post("/auth/login", async (request, reply) => {
    const body = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }).parse(request.body)

    const result = store.login(body.username, body.password)
    if (!result) {
      reply.code(401)
      return { message: "Invalid username or password" }
    }

    setSessionCookie(reply, result.token)
    return {
      data: {
        authEnabled,
        llmScope,
        user: result.user,
      },
    }
  })

  app.post("/auth/logout", async (request, reply) => {
    store.logout(request)
    clearSessionCookie(reply)
    return { data: true }
  })
}
