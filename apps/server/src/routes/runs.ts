import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type {
  ApiEnvelope,
  ExecutionRun,
  GenerateScriptResponse,
  PersistedTaskControlCommand,
  StartRunRequest,
  StartRunResponse,
  StartVerificationRequest,
  StartVerificationResponse,
  TaskRun,
} from "@autovis/shared"
import { store } from "../store.js"
import { getRequestLlmOwnerKey } from "../auth.js"
import { createSseStream } from "../sse.js"

const RUN_TERMINAL_STATUSES = new Set<ExecutionRun["status"]>(["passed", "failed", "cancelled", "interrupted"])
const TASK_RUN_TERMINAL_STATUSES = new Set<TaskRun["status"]>(["passed", "failed", "cancelled", "interrupted"])

export async function runsRoutes(app: FastifyInstance) {
  app.get("/task-control-commands", async (request): Promise<ApiEnvelope<PersistedTaskControlCommand[]>> => {
    const query = z.object({
      projectId: z.string().optional(),
      taskKind: z.enum(["agent", "run", "task-run", "recorder"]).optional(),
      taskId: z.string().optional(),
      status: z.enum(["requested", "applied", "rejected", "orphaned"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(request.query)

    return {
      data: store.listTaskControlCommands(query),
    }
  })

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
          run: await store.startRun({ ...body, llmOwnerKey: getRequestLlmOwnerKey(request) }),
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
        run: await store.startVerification({ ...body, llmOwnerKey: getRequestLlmOwnerKey(request) }),
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
  
    return createSseStream({
      streamName: "run",
      request,
      reply,
      initialData: run,
      subscribe: (listener) => store.subscribe(run.id, listener),
      isDone: (nextRun) => RUN_TERMINAL_STATUSES.has(nextRun.status),
    })
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
      llmOwnerKey: getRequestLlmOwnerKey(request),
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
  
    return createSseStream({
      streamName: "task-run",
      request,
      reply,
      initialData: taskRun,
      subscribe: (listener) => store.subscribeTaskRun(params.taskRunId, listener),
      isDone: (nextTaskRun) => TASK_RUN_TERMINAL_STATUSES.has(nextTaskRun.status),
    })
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
