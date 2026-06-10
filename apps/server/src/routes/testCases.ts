import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type {
  ApiEnvelope,
  CreateScriptVersionRequest,
  CreateScriptVersionResponse,
  ScriptArtifact,
  TestCase,
  UpsertTestCaseRequest,
} from "@autovis/shared"
import { store } from "../store.js"

export async function testCasesRoutes(app: FastifyInstance) {
  app.get("/test-cases", async (request): Promise<ApiEnvelope<TestCase[]>> => {
    const query = z.object({ projectId: z.string().optional() }).parse(request.query)
    if (query.projectId) {
      return { data: await store.listTestCases(query.projectId) }
    }
    return { data: await store.listAllTestCases() }
  })

  app.post("/test-cases", async (request): Promise<ApiEnvelope<TestCase | undefined>> => {
    const body = z
      .object({
        id: z.string().optional(),
        projectId: z.string().min(1),
        caseCode: z.string().optional().default(""),
        moduleName: z.string().optional(),
        moduleId: z.string().optional(),
        purpose: z.string().optional().default(""),
        dependencyCaseIds: z.array(z.string()).default([]),
        authProfileId: z.string().optional(),
        steps: z.array(z.string().min(1)).min(1),
        expectedResult: z.string().min(1),
        testType: z.enum(["functional", "regression", "smoke"]),
        bugId: z.string().optional(),
        note: z.string().optional(),
        aiScript: z.string().optional(),
        defaultTargetUrlId: z.string().optional(),
      })
      .parse(request.body) as UpsertTestCaseRequest

    return { data: await store.saveTestCase(body) }
  })

  app.delete("/test-cases/:testCaseId", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    await store.deleteTestCase(params.testCaseId)
    return { data: true }
  })

  app.get("/test-cases/:testCaseId/scripts", async (request): Promise<ApiEnvelope<ScriptArtifact[]>> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    return { data: await store.listScriptsForTestCase(params.testCaseId) }
  })

  app.post("/test-cases/:testCaseId/scripts", async (request): Promise<ApiEnvelope<CreateScriptVersionResponse>> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    const body = z.object({
      code: z.string().min(1),
      baseScriptId: z.string().optional(),
      prompt: z.string().optional(),
    }).parse(request.body) as CreateScriptVersionRequest
  
    return {
      data: {
        script: await store.saveScriptVersion(params.testCaseId, body),
      },
    }
  })

  app.delete("/test-cases/:testCaseId/scripts/:scriptId", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ testCaseId: z.string(), scriptId: z.string() }).parse(request.params)
    await store.deleteScript(params.scriptId)
    return { data: true }
  })

}
