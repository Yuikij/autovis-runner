import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type {
  ApiEnvelope,
  CopilotPollDeviceFlowRequest,
  CopilotSessionResponse,
  CopilotStartDeviceFlowRequest,
  CreateScriptVersionRequest,
  CreateScriptVersionResponse,
  ExecutionRun,
  GenerateScriptRequest,
  GenerateScriptResponse,
  GitAuthProfile,
  ImportLocalWorkspaceRequest,
  LlmState,
  LlmSessionConfig,
  UpsertLlmConfigRequest,
  Module,
  Project,
  ProjectWorkspace,
  RecorderInteractionRequest,
  RecorderSession,
  ScriptArtifact,
  StartRecorderSessionRequest,
  StartRunRequest,
  StartRunResponse,
  StartVerificationRequest,
  StartVerificationResponse,
  StopRecorderSessionRequest,
  SyncProjectWorkspaceRequest,
  TestCase,
  ActivateLlmConfigRequest,
  ActivateVisionConfigRequest,
  UpsertGitAuthProfileRequest,
  UpsertModuleRequest,
  UpsertProjectRequest,
  UpsertProjectWorkspaceRequest,
  UpsertTestCaseRequest,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceTreeEntry,
} from "@autovis/shared"
import { store } from "../store.js"

export async function llmRoutes(app: FastifyInstance) {
  app.get("/llm/session", async (): Promise<ApiEnvelope<LlmSessionConfig>> => ({
    data: await store.getLlmSession(),
  }))

  app.get("/llm/state", async (): Promise<ApiEnvelope<LlmState>> => ({
    data: await store.getLlmState(),
  }))

  app.post("/llm/configs", async (request): Promise<ApiEnvelope<LlmState>> => {
    const body = z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      provider: z.enum(["copilot-proxy", "openai-compatible", "anthropic-compatible"]),
      model: z.string().min(1),
      baseUrl: z.string().min(1),
      apiKey: z.string().optional(),
    }).parse(request.body) as UpsertLlmConfigRequest
  
    return {
      data: await store.saveLlmConfig(body),
    }
  })

  app.post("/llm/configs/test", async (request): Promise<ApiEnvelope<{ id: string; name: string; vendor: string }[]>> => {
    const body = z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      provider: z.enum(["copilot-proxy", "openai-compatible", "anthropic-compatible"]),
      model: z.string().min(0).optional(),
      baseUrl: z.string().min(1),
      apiKey: z.string().optional(),
    }).parse(request.body) as UpsertLlmConfigRequest
  
    return {
      data: await store.testLlmConfig(body),
    }
  })

  app.post("/llm/configs/activate", async (request): Promise<ApiEnvelope<LlmState>> => {
    const body = z.object({ configId: z.string().min(1) }).parse(request.body) as ActivateLlmConfigRequest
    return {
      data: await store.activateLlmConfig(body.configId),
    }
  })

  app.post("/llm/configs/activate-vision", async (request): Promise<ApiEnvelope<LlmState>> => {
    const body = z.object({ configId: z.string().min(1).nullable() }).parse(request.body) as ActivateVisionConfigRequest
    return {
      data: await store.activateVisionConfig(body.configId),
    }
  })

  app.delete("/llm/configs/:configId", async (request): Promise<ApiEnvelope<LlmState>> => {
    const params = z.object({ configId: z.string().min(1) }).parse(request.params)
    return {
      data: await store.deleteLlmConfig(params.configId),
    }
  })

  app.post("/llm/copilot/device/start", async (request): Promise<ApiEnvelope<CopilotSessionResponse>> => {
    const body = z
      .object({
        model: z.string().optional(),
        configId: z.string().optional(),
      })
      .parse(request.body) as CopilotStartDeviceFlowRequest
  
    return {
      data: {
        session: await store.startCopilotDeviceSession(body),
      },
    }
  })

  app.post("/llm/copilot/device/poll", async (request): Promise<ApiEnvelope<CopilotSessionResponse>> => {
    const body = z
      .object({
        model: z.string().optional(),
        configId: z.string().optional(),
      })
      .parse(request.body) as CopilotPollDeviceFlowRequest
  
    return {
      data: {
        session: await store.pollCopilotDeviceSession(body),
      },
    }
  })

  app.post("/llm/copilot/disconnect", async (request): Promise<ApiEnvelope<CopilotSessionResponse>> => {
    const body = z.object({ configId: z.string().optional() }).default({}).parse(request.body ?? {})
    return {
      data: {
        session: await store.disconnectCopilotSession(body.configId),
      },
    }
  })

  app.get("/llm/models", async (request): Promise<ApiEnvelope<{ id: string; name: string; vendor: string }[]>> => {
    const query = z.object({ configId: z.string().optional() }).parse(request.query)
    return {
      data: await store.fetchLlmModels(query.configId),
    }
  })

  app.post("/llm/session/model", async (request): Promise<ApiEnvelope<LlmSessionConfig>> => {
    const body = z
      .object({
        model: z.string().min(1),
        configId: z.string().optional(),
      })
      .parse(request.body)
  
    return {
      data: await store.updateLlmModel(body.model, body.configId),
    }
  })

}
