import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { CopilotSecretState } from "../../copilot.js"
import type {
  AgentSession,
  AgentStep,
  ExecutionRun,
  GitAuthProfile,
  LlmSessionConfig,
  Module,
  Project,
  ProjectWorkspace,
  RecorderSession,
  ScriptArtifact,
  TestCase,
  UpsertGitAuthProfileRequest,
  UpsertModuleRequest,
  UpsertProjectRequest,
  UpsertProjectWorkspaceRequest,
  UpsertTestCaseRequest,
} from "@autovis/shared"
import {
  mapAgentSession,
  mapAgentStep,
  mapGitAuthProfile,
  mapPersistedLlmState,
  mapLlmState,
  mapModule,
  mapProject,
  mapProjectWorkspace,
  mapRecorderSession,
  mapRun,
  mapScript,
  mapTestCase,
  type AgentSessionRow,
  type AgentStepRow,
  type GitAuthProfileRow,
  type LlmSessionRow,
  type ModuleRow,
  type ProjectRow,
  type ProjectWorkspaceRow,
  type RecorderSessionRow,
  type RunRow,
  type ScriptRow,
  type TestCaseRow,
} from "../mappers.js"
import { now, toPublicLlmState, type PersistedLlmState } from "../shared.js"

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]
const typedRow = <TRow>(row: Record<string, SQLOutputValue> | undefined): TRow | undefined => row as TRow | undefined





export const listAgentSessions = (db: DatabaseSync, projectId: string): AgentSession[] => {
  const rows = typedRows<AgentSessionRow>(db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY started_at DESC").all(projectId))
  return rows.map((row) => mapAgentSession(row, listAgentSteps(db, row.id)))
}

export const listAllAgentSessions = (db: DatabaseSync): AgentSession[] => {
  const rows = typedRows<AgentSessionRow>(db.prepare("SELECT * FROM agent_sessions ORDER BY started_at DESC").all())
  return rows.map((row) => mapAgentSession(row, listAgentSteps(db, row.id)))
}

export const listActiveAgentSessionsForProject = (db: DatabaseSync, projectId: string): AgentSession[] => {
  const rows = typedRows<AgentSessionRow>(db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? AND status IN ('running','paused','cancelling') ORDER BY started_at DESC").all(projectId))
  return rows.map((row) => mapAgentSession(row, listAgentSteps(db, row.id)))
}


export const getAgentSession = (db: DatabaseSync, sessionId: string): AgentSession | undefined => {
  const row = typedRow<AgentSessionRow>(db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(sessionId))
  return row ? mapAgentSession(row, listAgentSteps(db, row.id)) : undefined
}


export const listAgentSteps = (db: DatabaseSync, sessionId: string): AgentStep[] => {
  const rows = typedRows<AgentStepRow>(db.prepare("SELECT * FROM agent_steps WHERE session_id = ? ORDER BY position ASC, timestamp ASC").all(sessionId))
  return rows.map(mapAgentStep)
}


export const upsertAgentSession = (db: DatabaseSync, session: AgentSession) => {
  db.prepare(`
      INSERT OR REPLACE INTO agent_sessions (
        id, project_id, test_case_id, mode, status, verification_status, result_script_id, latest_script_id,
        latest_run_id, warmup_run_id, task_run_id, precondition_summary, final_summary, direct_result, error, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
    session.id,
    session.projectId,
    session.testCaseId,
    session.mode,
    session.status,
    session.verificationStatus,
    session.resultScriptId ?? null,
    session.latestScriptId ?? null,
    session.latestRunId ?? null,
    session.warmupRunId ?? null,
    session.taskRunId ?? null,
    session.preconditionSummary ? JSON.stringify(session.preconditionSummary) : null,
    session.finalSummary ?? null,
    session.directResult ? JSON.stringify(session.directResult) : null,
    session.error ?? null,
    session.startedAt,
    session.finishedAt ?? null,
  )
}


export const replaceAgentSteps = (db: DatabaseSync, sessionId: string, steps: AgentStep[]) => {
  db.exec("BEGIN")
  try {
    db.prepare("DELETE FROM agent_steps WHERE session_id = ?").run(sessionId)
    const statement = db.prepare(`
        INSERT INTO agent_steps (
          id, session_id, type, stage, title, content, detail, status, tool_name, timestamp,
          payload_json, screenshot_url, url, file_name, selector, run_id, script_id, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

    steps.forEach((step, index) => {
      statement.run(
        step.id,
        sessionId,
        step.type,
        step.stage ?? null,
        step.title,
        step.content,
        step.detail ?? null,
        step.status,
        step.toolName ?? null,
        step.timestamp,
        step.payloadJson ?? null,
        step.screenshotUrl ?? null,
        step.url ?? null,
        step.fileName ?? null,
        step.selector ?? null,
        step.runId ?? null,
        step.scriptId ?? null,
        index,
      )
    })

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}


export const clearAgentSession = (db: DatabaseSync, sessionId: string) => {
  db.prepare("DELETE FROM agent_steps WHERE session_id = ?").run(sessionId)
  db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(sessionId)
}


