import { AutoVisDatabase } from "../db.js"
import { AgentDirectService } from "./agent-direct.service.js"
import { AgentGenerationService } from "./agent-generation.service.js"
import { AgentSessionService } from "./agent-session.service.js"

export class AgentRecoveryService {
  constructor(
    private readonly db: AutoVisDatabase,
    private readonly sessionService: AgentSessionService,
    private readonly generationService: AgentGenerationService,
    private readonly directService: AgentDirectService,
  ) {}

  public async recoverAgent(sessionId: string) {
    if (this.sessionService.hasRegisteredTask(sessionId)) {
      return this.db.getAgentSession(sessionId)
    }

    const existing = this.db.getAgentSession(sessionId)
    if (!existing) {
      throw new Error(`Agent session ${sessionId} not found`)
    }
    if (existing.status === "completed" || existing.status === "cancelled" || existing.status === "error" || existing.status === "interrupted") {
      return existing
    }

    const leaseRequest = this.db.getTaskLease("agent", sessionId)?.request ?? {}
    if (existing.mode === "direct") {
      void this.directService.runDirectAgent({
        sessionId,
        projectId: String(leaseRequest.projectId ?? existing.projectId),
        testCaseId: String(leaseRequest.testCaseId ?? existing.testCaseId),
        prompt: String(leaseRequest.prompt ?? ""),
        runTargetUrlId: typeof leaseRequest.runTargetUrlId === "string" ? leaseRequest.runTargetUrlId : undefined,
        taskRunId: typeof leaseRequest.taskRunId === "string" ? leaseRequest.taskRunId : existing.taskRunId,
        llmOwnerKey: typeof leaseRequest.llmOwnerKey === "string" ? leaseRequest.llmOwnerKey : undefined,
      })
    } else {
      void this.generationService.runScriptAgent({
        sessionId,
        projectId: String(leaseRequest.projectId ?? existing.projectId),
        testCaseId: String(leaseRequest.testCaseId ?? existing.testCaseId),
        prompt: String(leaseRequest.prompt ?? ""),
        runTargetUrlId: typeof leaseRequest.runTargetUrlId === "string" ? leaseRequest.runTargetUrlId : undefined,
        baseScriptId: typeof leaseRequest.baseScriptId === "string" ? leaseRequest.baseScriptId : undefined,
        llmOwnerKey: typeof leaseRequest.llmOwnerKey === "string" ? leaseRequest.llmOwnerKey : undefined,
      })
    }

    if (existing.status === "paused") {
      this.sessionService.pauseAgent(sessionId)
    }
    return this.db.getAgentSession(sessionId) ?? existing
  }
}