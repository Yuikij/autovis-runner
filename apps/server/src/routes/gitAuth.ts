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

export async function gitAuthRoutes(app: FastifyInstance) {
  app.get("/git-auth-profiles", async (): Promise<ApiEnvelope<GitAuthProfile[]>> => ({
    data: await store.listGitAuthProfiles(),
  }))

  app.post("/git-auth-profiles", async (request): Promise<ApiEnvelope<GitAuthProfile | undefined>> => {
    const body = z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      kind: z.enum(["none", "http_token", "http_basic", "ssh_key"]),
      hostPattern: z.string().min(1),
      username: z.string().optional(),
      secret: z.string().optional(),
    }).parse(request.body) as UpsertGitAuthProfileRequest
    return { data: await store.saveGitAuthProfile(body) }
  })

  app.delete("/git-auth-profiles/:profileId", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ profileId: z.string() }).parse(request.params)
    await store.deleteGitAuthProfile(params.profileId)
    return { data: true }
  })

}
