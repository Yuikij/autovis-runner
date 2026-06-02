import type { FastifyInstance } from "fastify"
import type { ApiEnvelope } from "@autovis/shared"
import { store } from "../store.js"

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (): Promise<ApiEnvelope<Awaited<ReturnType<typeof store.getDashboard>>>> => ({
    data: await store.getDashboard(),
  }))

}
