import { modulesRoutes } from "./routes/modules.js"
import { gitAuthRoutes } from "./routes/gitAuth.js"
import { recorderRoutes } from "./routes/recorder.js"
import { agentRoutes } from "./routes/agent.js"
import { llmRoutes } from "./routes/llm.js"
import { runsRoutes } from "./routes/runs.js"
import { tasksRoutes } from "./routes/tasks.js"
import { testCasesRoutes } from "./routes/testCases.js"
import { projectsRoutes } from "./routes/projects.js"
import { dashboardRoutes } from "./routes/dashboard.js"
import { authProfilesRoutes } from "./routes/authProfiles.js"
import { authLoginSandboxRoutes } from "./routes/authLoginSandbox.js"
import { scheduleTriggersRoutes } from "./routes/scheduleTriggers.js"
import websocket from "@fastify/websocket"
import cors from "@fastify/cors"
import multipart from "@fastify/multipart"
import fastifyStatic from "@fastify/static"
import Fastify from "fastify"
import { createReadStream } from "node:fs"
import { mkdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const app = Fastify({ logger: false })
const currentDir = dirname(fileURLToPath(import.meta.url))
const webDistDir = join(currentDir, "../../web/dist")
const artifactRoot = process.env.DATA_DIR ? join(process.env.DATA_DIR, "artifacts") : join(currentDir, "../../../data/artifacts")

await mkdir(artifactRoot, { recursive: true })

await app.register(cors, {
  origin: true,
})

await app.register(websocket)
await app.register(multipart)

app.setErrorHandler((error, _, reply) => {
  const candidate = error as { statusCode?: number; message?: string }
  if (typeof candidate.statusCode === "number") {
    reply.code(candidate.statusCode).send({
      message: candidate.message ?? "Request failed",
    })
    return
  }

  const fallbackMessage = error instanceof Error ? error.message : "Unknown server error"

  reply.code(500).send({
    message: fallbackMessage,
  })
})

await app.register(fastifyStatic, {
  root: artifactRoot,
  prefix: "/artifacts/",
})

await app.register(fastifyStatic, {
  root: webDistDir,
  wildcard: false,
  decorateReply: false,
})

app.get("/health", async () => ({ status: "ok" }))

await app.register(async (api) => {
  await api.register(dashboardRoutes)
  await api.register(projectsRoutes)
  await api.register(testCasesRoutes)
  await api.register(tasksRoutes)
  await api.register(runsRoutes)
  await api.register(llmRoutes)
  await api.register(agentRoutes)
  await api.register(recorderRoutes)
  await api.register(gitAuthRoutes)
  await api.register(modulesRoutes)
  await api.register(authProfilesRoutes)
  await api.register(authLoginSandboxRoutes)
  await api.register(scheduleTriggersRoutes)
}, { prefix: "/api" })

const indexHtmlPath = join(webDistDir, "index.html")
const indexHtmlExists = await stat(indexHtmlPath).then(() => true).catch(() => false)

app.setNotFoundHandler((request, reply) => {
  const url = request.raw.url ?? ""
  const isApi = url.startsWith("/api/") || url === "/api"
  const isArtifact = url.startsWith("/artifacts/")
  const isHealth = url === "/health"
  const isGet = request.method === "GET"

  if (!isGet || isApi || isArtifact || isHealth || !indexHtmlExists) {
    reply.code(404).send({ message: "Not Found" })
    return
  }

  reply.type("text/html").send(createReadStream(indexHtmlPath))
})

process.on("uncaughtException", (error) => {
  console.error("🔥 [AutoVis] Uncaught Exception caught, preventing server crash:", error)
})

process.on("unhandledRejection", (reason, promise) => {
  console.error("🔥 [AutoVis] Unhandled Promise Rejection caught, preventing server crash:", reason)
})

const port = Number(process.env.PORT ?? 8787)

app.listen({ port, host: "0.0.0.0" })
  .then((address) => {
    console.log(`🚀 [AutoVis] Server successfully started and listening at ${address}`)
  })
  .catch((error) => {
    console.error("Server start failed:", error)
    process.exit(1)
  })
