import type { FastifyInstance } from "fastify"
import type {
  ApiEnvelope,
  AuthProfile,
  AuthProfileState,
  UpdateAuthProfilePostLoginUrlRequest,
  UpsertAuthProfileRequest,
} from "@autovis/shared"
import { store } from "../store.js"
import { buildStorageStateSummary, decorateAuthProfile, decorateAuthProfiles } from "../services/authProfile.utils.js"

export async function authProfilesRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/auth-profiles", async (request): Promise<ApiEnvelope<AuthProfile[]>> => {
    const { projectId } = request.params as { projectId: string }
    const profiles = await store.listAuthProfiles(projectId)
    return { data: decorateAuthProfiles(profiles) }
  })

  app.get("/auth-profiles/:profileId", async (request): Promise<ApiEnvelope<AuthProfile | null>> => {
    const { profileId } = request.params as { profileId: string }
    const profile = await store.getAuthProfile(profileId)
    return { data: decorateAuthProfile(profile) ?? null }
  })

  app.post("/auth-profiles", async (request): Promise<ApiEnvelope<AuthProfile>> => {
    const profile = await store.saveAuthProfile(request.body as UpsertAuthProfileRequest)
    return { data: decorateAuthProfile(profile)! }
  })

  app.delete("/auth-profiles/:profileId", async (request): Promise<ApiEnvelope<void>> => {
    const { profileId } = request.params as { profileId: string }
    await store.deleteAuthProfile(profileId)
    return { data: undefined }
  })

  // Async generation - returns taskId immediately
  app.post("/auth-profiles/:profileId/generate-validation-script", async (request, reply): Promise<ApiEnvelope<{ taskId: string }>> => {
    const { profileId } = request.params as { profileId: string }
    const { projectId, targetUrlId } = request.body as { projectId: string; targetUrlId?: string }
    const taskId = store.startGenerateValidationScript(projectId, profileId, targetUrlId)
    reply.code(202)
    return { data: { taskId } }
  })

  // SSE stream for generation progress
  app.get("/validation-tasks/:taskId/stream", async (request, reply) => {
    const { taskId } = request.params as { taskId: string }

    reply.raw.setHeader("Content-Type", "text/event-stream")
    reply.raw.setHeader("Cache-Control", "no-cache")
    reply.raw.setHeader("Connection", "keep-alive")
    reply.raw.flushHeaders()

    const task = store.getValidationTask(taskId)
    if (task) {
      reply.raw.write(`data: ${JSON.stringify(task)}\n\n`)
      if (task.status !== "running") {
        reply.raw.end()
        return reply
      }
    }

    const unsubscribe = store.subscribeValidationTask(taskId, (t) => {
      reply.raw.write(`data: ${JSON.stringify(t)}\n\n`)
      if (t.status !== "running") {
        unsubscribe()
        reply.raw.end()
      }
    })

    request.raw.on("close", () => {
      unsubscribe()
      reply.raw.end()
    })

    return reply
  })

  // 登录状态重放检查（异步流式）：返回 taskId，前端订阅同一个 /validation-tasks/:id/stream
  app.post("/auth-profiles/:profileId/check-login-status", async (request, reply): Promise<ApiEnvelope<{ taskId: string }>> => {
    const { profileId } = request.params as { profileId: string }
    const { projectId, targetUrlId } = request.body as { projectId: string; targetUrlId: string }
    if (!targetUrlId) {
      reply.code(400)
      return { data: { taskId: "" } } as any
    }
    const taskId = store.startCheckLoginStatus(projectId, profileId, targetUrlId)
    reply.code(202)
    return { data: { taskId } }
  })

  // 手动覆盖 / 清除"登录后 URL"：override 与 auto 互不影响，下次刷新只覆盖 auto。
  app.patch("/auth-profiles/:profileId/states/:targetUrlId/post-login-url", async (request, reply): Promise<ApiEnvelope<AuthProfileState>> => {
    const { profileId, targetUrlId } = request.params as { profileId: string; targetUrlId: string }
    const body = (request.body ?? {}) as UpdateAuthProfilePostLoginUrlRequest
    const state = await store.setAuthProfileStatePostLoginUrl(profileId, targetUrlId, body.postLoginUrl ?? null)
    reply.code(200)
    return {
      data: {
        ...state,
        storageStateSummary: buildStorageStateSummary(state.storageStateJson),
        postLoginUrl: state.postLoginUrlOverride ?? state.postLoginUrlAuto,
      },
    }
  })

  // 手动刷新登录态：跑 sourceCase + 把 storageState 落到指定 targetUrl 行。
  app.post("/auth-profiles/:profileId/refresh-state", async (request, reply): Promise<ApiEnvelope<{ runId: string; targetUrlId: string; testBaseUrl: string }>> => {
    const { profileId } = request.params as { profileId: string }
    const body = (request.body ?? {}) as { targetUrlId?: string }
    if (!body.targetUrlId) {
      reply.code(400)
      throw new Error("缺少 targetUrlId")
    }
    const result = await store.startRefreshAuthProfileState(profileId, body.targetUrlId)
    reply.code(202)
    return { data: result }
  })
}
