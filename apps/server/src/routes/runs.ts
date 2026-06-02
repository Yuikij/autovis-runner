import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type {
  ApiEnvelope,
  ExecutionRun,
  GenerateScriptResponse,
  StartRunRequest,
  StartRunResponse,
  StartVerificationRequest,
  StartVerificationResponse,
} from "@autovis/shared"
import { store } from "../store.js"

export async function runsRoutes(app: FastifyInstance) {
  app.post("/runs", async (request, reply): Promise<ApiEnvelope<StartRunResponse> | void> => {
    const body = z
      .object({
        projectId: z.string(),
        testCaseId: z.string(),
        scriptId: z.string(),
        targetUrlId: z.string().optional(),
        kind: z.enum(["execution", "verification", "temporary"]).optional(),
        taskRunId: z.string().optional(),
        batchOrder: z.number().int().optional(),
      })
      .parse(request.body) as StartRunRequest

    try {
      return {
        data: {
          run: await store.startRun(body),
        },
      }
    } catch (err: any) {
      if (err?.code === "TASK_CONFLICT" && err.conflictId) {
        reply.code(409)
        return {
          data: {
            run: (await store.getRun(err.conflictId)) ?? (undefined as any),
          },
        } as any
      }
      throw err
    }
  })

  app.post("/verifications", async (request): Promise<ApiEnvelope<StartVerificationResponse>> => {
    const body = z
      .object({
        projectId: z.string(),
        testCaseId: z.string(),
        scriptId: z.string(),
        targetUrlId: z.string().optional(),
      })
      .parse(request.body) as StartVerificationRequest
  
    return {
      data: {
        run: await store.startVerification(body),
      },
    }
  })

  app.get("/runs/:runId", async (request, reply) => {
    const params = z
      .object({
        runId: z.string(),
      })
      .parse(request.params)
  
    const run = await store.getRun(params.runId)
    if (!run) {
      reply.code(404)
      return {
        message: "Run not found",
      }
    }
  
    return {
      data: run,
    }
  })

  app.get("/runs/:runId/stream", async (request, reply) => {
    const params = z
      .object({
        runId: z.string(),
      })
      .parse(request.params)
  
    const run = await store.getRun(params.runId)
    if (!run) {
      reply.code(404)
      return {
        message: "Run not found",
      }
    }
  
    reply.raw.setHeader("Content-Type", "text/event-stream")
    reply.raw.setHeader("Cache-Control", "no-cache")
    reply.raw.setHeader("Connection", "keep-alive")
    reply.raw.flushHeaders()
  
    reply.raw.write(`data: ${JSON.stringify(run)}\n\n`)
    const unsubscribe = store.subscribe(run.id, (nextRun) => {
      reply.raw.write(`data: ${JSON.stringify(nextRun)}\n\n`)
    })
  
    request.raw.on("close", () => {
      unsubscribe()
      reply.raw.end()
    })
  
    return reply
  })

  app.get("/runs/:runId/live", { websocket: true }, (socket, request) => {
    const params = z.object({ runId: z.string() }).parse(request.params)
    const unsubscribe = store.subscribeLiveViewport(params.runId, (chunk) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(chunk)
      }
    })
  
    socket.on("close", () => {
      unsubscribe()
    })
  })

  app.post("/runs/:runId/human-input", async (request): Promise<ApiEnvelope<ExecutionRun>> => {
    const params = z.object({ runId: z.string() }).parse(request.params)
    const body = z.object({ handoffId: z.string().min(1), value: z.string() }).parse(request.body)
  
    return {
      data: await store.submitRunHumanInput(params.runId, body.handoffId, body.value),
    }
  })

  app.post("/runs/:runId/repair", async (request, reply): Promise<ApiEnvelope<GenerateScriptResponse> | void> => {
    const params = z.object({ runId: z.string() }).parse(request.params)
  
    const run = await store.getRun(params.runId)
    if (!run) {
      reply.code(404)
      return { error: { message: "Run not found" } } as any
    }

    const testCase = await store.getTestCase(run.testCaseId)
    const script = await store.getScript(run.scriptId)
    if (!testCase || !script) {
      reply.code(400)
      return { error: { message: "Test Case or Script not found" } } as any
    }

    const originalPrompt = script.prompt || "// 暂无原始 Prompt"
    const repairPrompt = store.buildRepairPrompt(testCase, run, originalPrompt)

    const sessionId = `agent_${Math.random().toString(36).slice(2, 10)}`
    void store.runScriptAgent({
      projectId: run.projectId,
      testCaseId: run.testCaseId,
      prompt: repairPrompt,
      runTargetUrlId: run.targetUrlId,
      baseScriptId: run.scriptId,
      sessionId,
    })

    return {
      data: {
        sessionId,
      },
    }
  })

  app.get("/task-runs/:taskRunId", async (request, reply) => {
    const params = z.object({ taskRunId: z.string() }).parse(request.params)
    const taskRun = await store.getTaskRun(params.taskRunId)
    if (!taskRun) {
      reply.code(404)
      return { message: "Task run not found" }
    }
    return { data: taskRun }
  })

  app.get("/task-runs/:taskRunId/stream", async (request, reply) => {
    const params = z.object({ taskRunId: z.string() }).parse(request.params)
    const taskRun = await store.getTaskRun(params.taskRunId)
    if (!taskRun) {
      reply.code(404)
      return { message: "Task run not found" }
    }
  
    reply.raw.setHeader("Content-Type", "text/event-stream")
    reply.raw.setHeader("Cache-Control", "no-cache")
    reply.raw.setHeader("Connection", "keep-alive")
    reply.raw.flushHeaders()
  
    reply.raw.write(`data: ${JSON.stringify(taskRun)}\n\n`)
    const unsubscribe = store.subscribeTaskRun(params.taskRunId, (nextTaskRun) => {
      reply.raw.write(`data: ${JSON.stringify(nextTaskRun)}\n\n`)
    })
  
    request.raw.on("close", () => {
      unsubscribe()
      reply.raw.end()
    })
  
    return reply
  })

  app.post("/runs/:runId/pause", async (request, reply) => {
    const params = z.object({ runId: z.string() }).parse(request.params)
    const ok = store.pauseRun(params.runId)
    if (!ok) {
      reply.code(409)
      return { message: "Run not pausable" }
    }
    return { data: { kind: "run", id: params.runId, status: "paused" } }
  })

  app.post("/runs/:runId/resume", async (request, reply) => {
    const params = z.object({ runId: z.string() }).parse(request.params)
    const ok = store.resumeRun(params.runId)
    if (!ok) {
      reply.code(409)
      return { message: "Run not resumable" }
    }
    return { data: { kind: "run", id: params.runId, status: "running" } }
  })

  app.post("/runs/:runId/cancel", async (request, reply) => {
    const params = z.object({ runId: z.string() }).parse(request.params)
    const ok = store.cancelRun(params.runId)
    if (!ok) {
      reply.code(409)
      return { message: "Run not cancellable" }
    }
    return { data: { kind: "run", id: params.runId, status: "cancelling" } }
  })

  app.post("/task-runs/:taskRunId/pause", async (request, reply) => {
    const params = z.object({ taskRunId: z.string() }).parse(request.params)
    const ok = store.pauseTaskRun(params.taskRunId)
    if (!ok) {
      reply.code(409)
      return { message: "Task run not pausable" }
    }
    return { data: { kind: "task-run", id: params.taskRunId, status: "paused" } }
  })

  app.post("/task-runs/:taskRunId/resume", async (request, reply) => {
    const params = z.object({ taskRunId: z.string() }).parse(request.params)
    const ok = store.resumeTaskRun(params.taskRunId)
    if (!ok) {
      reply.code(409)
      return { message: "Task run not resumable" }
    }
    return { data: { kind: "task-run", id: params.taskRunId, status: "running" } }
  })

  app.post("/task-runs/:taskRunId/cancel", async (request, reply) => {
    const params = z.object({ taskRunId: z.string() }).parse(request.params)
    const ok = store.cancelTaskRun(params.taskRunId)
    if (!ok) {
      reply.code(409)
      return { message: "Task run not cancellable" }
    }
    return { data: { kind: "task-run", id: params.taskRunId, status: "cancelling" } }
  })

  app.get("/projects/:projectId/active-tasks", async (request) => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: store.getActiveTasksForProject(params.projectId) }
  })

}
