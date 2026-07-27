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
} from "@browsewright/shared"
import { store } from "../store.js"
import { wrapDeleteOperation } from "./errorHandlers.js"

export async function modulesRoutes(app: FastifyInstance) {
  app.delete("/modules/:moduleId", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ moduleId: z.string() }).parse(request.params)
    await wrapDeleteOperation(
      () => store.deleteModule(params.moduleId),
      "无法删除该模块：该模块下还有测试用例。请先删除或移动相关测试用例后再删除模块。"
    )
    return { data: true }
  })

}
