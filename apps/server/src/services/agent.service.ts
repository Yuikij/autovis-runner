import { AgentWarmupService } from "./agent-warmup.service.js"
import {
  type AgentSession,
  type GenerateScriptRequest,
  type ScriptArtifact,
  type StartDirectAgentRequest,
} from "@autovis/shared"
import { AutoVisDatabase } from "../db.js"
import { type SuiteService } from "./suite.service.js"
import { type LlmConfigService } from "./llm-config.service.js"
import { type ProjectService } from "./project.service.js"
import { type RunService } from "./run.service.js"
import { AgentDirectService } from "./agent-direct.service.js"
import { AgentGenerationService } from "./agent-generation.service.js"
import { AgentRecoveryService } from "./agent-recovery.service.js"
import { AgentSessionService } from "./agent-session.service.js"
import { TaskControlRegistry } from "./task-control.js"
import { type LlmOwned } from "./agent-runtime-context.js"

export class AgentService {
  private readonly sessionService: AgentSessionService

  private readonly generationService: AgentGenerationService

  private readonly directService: AgentDirectService

  private readonly recoveryService: AgentRecoveryService

  constructor(
    db: AutoVisDatabase,
    _suiteService: SuiteService,
    llmService: LlmConfigService,
    projectService: ProjectService,
    runService: RunService,
    agentWarmupService: AgentWarmupService,
    tasks: TaskControlRegistry,
  ) {
    this.sessionService = new AgentSessionService(db, tasks)
    this.generationService = new AgentGenerationService(db, projectService, llmService, runService, agentWarmupService, this.sessionService)
    this.directService = new AgentDirectService(db, projectService, llmService, runService, agentWarmupService, this.sessionService)
    this.recoveryService = new AgentRecoveryService(db, this.sessionService, this.generationService, this.directService)
  }

  public getAgentSession(sessionId: string): AgentSession | undefined {
    return this.sessionService.getAgentSession(sessionId)
  }

  public findActiveAgentForCase(testCaseId: string): AgentSession | undefined {
    return this.sessionService.findActiveAgentForCase(testCaseId)
  }

  public listActiveAgents(projectId?: string): AgentSession[] {
    return this.sessionService.listActiveAgents(projectId)
  }

  public pauseAgent(sessionId: string): boolean {
    return this.sessionService.pauseAgent(sessionId)
  }

  public resumeAgent(sessionId: string): boolean {
    return this.sessionService.resumeAgent(sessionId)
  }

  public cancelAgent(sessionId: string): boolean {
    return this.sessionService.cancelAgent(sessionId)
  }

  public subscribeAgent(sessionId: string, listener: (session: AgentSession) => void) {
    return this.sessionService.subscribeAgent(sessionId, listener)
  }

  public createScriptArtifact(testCaseId: string, provider: ScriptArtifact["provider"], prompt: string, code: string, source: ScriptArtifact["source"] = "generated"): ScriptArtifact {
    return this.generationService.createScriptArtifact(testCaseId, provider, prompt, code, source)
  }

  public async saveScriptVersion(testCaseId: string, input: { code: string; baseScriptId?: string; prompt?: string }) {
    return this.generationService.saveScriptVersion(testCaseId, input)
  }

  public async generateScript(request: GenerateScriptRequest & LlmOwned) {
    return this.generationService.generateScript(request)
  }

  public async runScriptAgent(request: GenerateScriptRequest & { sessionId: string } & LlmOwned) {
    return this.generationService.runScriptAgent(request)
  }

  public async runDirectAgent(request: StartDirectAgentRequest & { sessionId: string } & LlmOwned) {
    return this.directService.runDirectAgent(request)
  }

  public async recoverAgent(sessionId: string) {
    return this.recoveryService.recoverAgent(sessionId)
  }

  /**
   * 任务编排中无脚本用例的 AI 直接执行入口。
   * 自动从用例的 purpose/steps/expectedResult 组成 prompt，使用 runDirectAgent 执行。
   * 返回启动的 AgentSession（可通过 getAgentSession 轮询状态）。
   */
  public async startDirectAgentForTask(opts: {
    projectId: string
    testCaseId: string
    targetUrlId?: string
    taskRunId: string
  }): Promise<AgentSession> {
    return this.directService.startDirectAgentForTask(opts)
  }
}
