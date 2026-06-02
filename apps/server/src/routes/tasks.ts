import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type {
  ApiEnvelope,
  StartTaskRunResponse,
  Task,
  TaskRun,
  UpsertTaskRequest,
} from "@autovis/shared"
import { store } from "../store.js"

const taskModeSchema = z.union([
  z.object({ kind: z.literal("oneshot") }),
  z.object({
    kind: z.literal("polling"),
    intervalMs: z.number().int().min(0),
    maxAttempts: z.number().int().min(1),
    stopOn: z.enum(["success", "exhausted"]).optional(),
    attemptTimeoutMs: z.number().int().min(1000).optional(),
  }),
  z.object({
    kind: z.literal("deadline"),
    at: z.string().min(1),
    prewarmMs: z.number().int().min(0).optional(),
    extraTimeoutMs: z.number().int().min(0).optional(),
  }),
])

const taskItemSchema = z.object({
  caseId: z.string().min(1),
  targetUrlId: z.string().optional(),
})

export async function tasksRoutes(app: FastifyInstance) {
  app.get("/tasks", async (request): Promise<ApiEnvelope<Task[]>> => {
    const query = z.object({ projectId: z.string().min(1) }).parse(request.query)
    return { data: await store.listTasks(query.projectId) }
  })

  app.get("/tasks/:taskId", async (request, reply): Promise<ApiEnvelope<Task> | void> => {
    const params = z.object({ taskId: z.string() }).parse(request.params)
    const task = await store.getTask(params.taskId)
    if (!task) {
      reply.code(404)
      return { message: "Task not found" } as any
    }
    return { data: task }
  })

  app.post("/tasks", async (request): Promise<ApiEnvelope<Task | undefined>> => {
    const body = z
      .object({
        id: z.string().optional(),
        projectId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        items: z.array(taskItemSchema).min(1),
        executionMode: taskModeSchema.optional(),
      })
      .parse(request.body) as UpsertTaskRequest

    return { data: await store.saveTask(body) }
  })

  app.delete("/tasks/:taskId", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ taskId: z.string() }).parse(request.params)
    await store.deleteTask(params.taskId)
    return { data: true }
  })

  app.get("/tasks/:taskId/runs", async (request): Promise<ApiEnvelope<TaskRun[]>> => {
    const params = z.object({ taskId: z.string() }).parse(request.params)
    return { data: await store.listTaskRunsForTask(params.taskId) }
  })

  app.post("/tasks/:taskId/run", async (request): Promise<ApiEnvelope<StartTaskRunResponse>> => {
    const params = z.object({ taskId: z.string() }).parse(request.params)
    const task = await store.getTask(params.taskId)
    if (!task) {
      throw new Error("Task not found")
    }
    const body = z
      .object({
        taskMode: taskModeSchema.optional(),
      })
      .parse(request.body ?? {})

    return {
      data: {
        taskRun: await store.startTaskRun({
          projectId: task.projectId,
          taskId: task.id,
          taskMode: body.taskMode,
        }),
      },
    }
  })
}
