import { type AgentSession, type AgentStep } from "@autovis/shared"

import type { AutoVisDatabase } from "../db.js"
import { now } from "./common.js"
import { type TaskController, TaskControlRegistry } from "./task-control.js"

export class AgentSessionService {
  private readonly agentSubscribers = new Map<string, Set<(session: AgentSession) => void>>()

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly tasks: TaskControlRegistry,
  ) {}

  public hasRegisteredTask(sessionId: string) {
    return this.tasks.has(sessionId)
  }

  public getAgentSession(sessionId: string): AgentSession | undefined {
    return this.db.getAgentSession(sessionId)
  }

  public findActiveAgentConflict(testCaseId: string) {
    const ctrl = this.tasks.findActiveForCase("agent", testCaseId)
    if (!ctrl) return undefined
    return {
      id: ctrl.id,
      status: this.db.getAgentSession(ctrl.id)?.status ?? ctrl.state,
    }
  }

  public findActiveAgentForCase(testCaseId: string): AgentSession | undefined {
    const ctrl = this.tasks.findActiveForCase("agent", testCaseId)
    if (!ctrl) return undefined
    return this.db.getAgentSession(ctrl.id)
  }

  public listActiveAgents(projectId?: string): AgentSession[] {
    return this.tasks
      .listByKind("agent")
      .map((ctrl) => this.db.getAgentSession(ctrl.id))
      .filter((session): session is AgentSession => session !== undefined && (!projectId || session.projectId === projectId))
  }

  public pauseAgent(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "agent") return false
    if (!ctrl.pause()) return false
    const session = this.db.getAgentSession(sessionId)
    if (session) {
      session.status = "paused"
      session.pausedAt = now()
      this.persistAndNotifyAgent(session)
    }
    return true
  }

  public resumeAgent(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "agent") return false
    if (!ctrl.resume()) return false
    const session = this.db.getAgentSession(sessionId)
    if (session) {
      session.status = "running"
      session.pausedAt = undefined
      this.persistAndNotifyAgent(session)
    }
    return true
  }

  public cancelAgent(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "agent") return false
    const session = this.db.getAgentSession(sessionId)
    if (session) {
      session.status = "cancelling"
      this.persistAndNotifyAgent(session)
    }
    return ctrl.cancel("Agent 已被用户取消。")
  }

  public subscribeAgent(sessionId: string, listener: (session: AgentSession) => void) {
    const set = this.agentSubscribers.get(sessionId) ?? new Set<(session: AgentSession) => void>()
    set.add(listener)
    this.agentSubscribers.set(sessionId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.agentSubscribers.delete(sessionId)
      }
    }
  }

  public persistAndNotifyAgent(session: AgentSession) {
    this.db.upsertAgentSession(session)
    this.db.replaceAgentSteps(session.id, session.steps)
    this.agentSubscribers.get(session.id)?.forEach((listener) => listener(session))
  }

  public createAgentSession(
    request: { sessionId: string; projectId: string; testCaseId: string; taskRunId?: string },
    mode: AgentSession["mode"] = "generate",
  ): AgentSession {
    return {
      id: request.sessionId,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
      taskRunId: request.taskRunId,
      mode,
      status: "running",
      verificationStatus: "idle",
      steps: [],
      preconditionSummary: [],
      startedAt: now(),
    }
  }

  public appendOrUpdateStep(session: AgentSession, step: AgentStep) {
    const existing = session.steps.find((item) => item.id === step.id)
    if (existing) {
      Object.assign(existing, step)
    } else {
      session.steps.push({ ...step })
    }
    this.persistAndNotifyAgent(session)
  }

  public createManagedController(
    session: AgentSession,
    request: Record<string, unknown>,
    buildCheckpoint: () => Record<string, unknown>,
  ): TaskController {
    return this.tasks.create({
      kind: "agent",
      id: session.id,
      projectId: session.projectId,
      testCaseId: session.testCaseId,
      recoveryPolicy: "restart",
      request,
      buildCheckpoint,
      applyAction: (action) => {
        switch (action) {
          case "pause":
            return this.pauseAgent(session.id)
          case "resume":
            return this.resumeAgent(session.id)
          case "cancel":
            return this.cancelAgent(session.id)
          default:
            return false
        }
      },
    })
  }

  public unregister(sessionId: string) {
    this.tasks.unregister(sessionId)
  }
}