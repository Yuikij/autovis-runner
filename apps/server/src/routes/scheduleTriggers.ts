import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { ApiEnvelope, ScheduleTrigger, TaskRun, UpsertScheduleTriggerRequest } from "@autovis/shared"
import { store } from "../store.js"

const upsertSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  name: z.string().optional(),
  kind: z.enum(["at", "cron"]),
  atTime: z.string().optional(),
  cronExpr: z.string().optional(),
  enabled: z.boolean().optional(),
})

export async function scheduleTriggersRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/schedule-triggers", async (request): Promise<ApiEnvelope<ScheduleTrigger[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: store.listScheduleTriggers(params.projectId) }
  })

  app.get("/tasks/:taskId/schedule-triggers", async (request): Promise<ApiEnvelope<ScheduleTrigger[]>> => {
    const params = z.object({ taskId: z.string() }).parse(request.params)
    return { data: store.listScheduleTriggersForTask(params.taskId) }
  })

  app.post("/schedule-triggers", async (request): Promise<ApiEnvelope<ScheduleTrigger>> => {
    const body = upsertSchema.parse(request.body) as UpsertScheduleTriggerRequest
    return { data: store.saveScheduleTrigger(body) }
  })

  app.put("/schedule-triggers/:id", async (request): Promise<ApiEnvelope<ScheduleTrigger>> => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = upsertSchema.parse({ ...(request.body as object), id: params.id }) as UpsertScheduleTriggerRequest
    return { data: store.saveScheduleTrigger(body) }
  })

  app.delete("/schedule-triggers/:id", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ id: z.string() }).parse(request.params)
    store.deleteScheduleTrigger(params.id)
    return { data: true }
  })

  app.post("/schedule-triggers/:id/enable", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({ enabled: z.boolean() }).parse(request.body)
    store.setScheduleTriggerEnabled(params.id, body.enabled)
    return { data: true }
  })

  app.post("/schedule-triggers/:id/fire", async (request): Promise<ApiEnvelope<TaskRun>> => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const taskRun = await store.fireScheduleTriggerNow(params.id)
    return { data: taskRun }
  })
}
