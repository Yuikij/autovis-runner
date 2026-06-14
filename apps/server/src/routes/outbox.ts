import type { FastifyInstance } from "fastify"
import type { ApiEnvelope, OutboxItem } from "@autovis/shared"
import { store } from "../store.js"

export async function outboxRoutes(app: FastifyInstance) {
  app.get("/outbox", async (request): Promise<ApiEnvelope<OutboxItem[]>> => {
    const limit = Number((request.query as { limit?: string } | undefined)?.limit) || 60
    return { data: store.getOutbox(limit) }
  })
}
