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





export const listRecorderSessions = (db: DatabaseSync, projectId: string): RecorderSession[] => {
  const rows = typedRows<RecorderSessionRow>(db.prepare("SELECT * FROM recorder_sessions WHERE project_id = ? ORDER BY started_at DESC").all(projectId))
  return rows.map(mapRecorderSession)
}

export const listAllRecorderSessions = (db: DatabaseSync): RecorderSession[] => {
  const rows = typedRows<RecorderSessionRow>(db.prepare("SELECT * FROM recorder_sessions ORDER BY started_at DESC").all())
  return rows.map(mapRecorderSession)
}

export const listActiveRecorderSessionsForProject = (db: DatabaseSync, projectId: string): RecorderSession[] => {
  const rows = typedRows<RecorderSessionRow>(db.prepare("SELECT * FROM recorder_sessions WHERE project_id = ? AND status IN ('starting','running','paused','cancelling','stopping') ORDER BY started_at DESC").all(projectId))
  return rows.map(mapRecorderSession)
}


export const getRecorderSession = (db: DatabaseSync, sessionId: string): RecorderSession | undefined => {
  const row = typedRow<RecorderSessionRow>(db.prepare("SELECT * FROM recorder_sessions WHERE id = ?").get(sessionId))
  return row ? mapRecorderSession(row) : undefined
}


export const upsertRecorderSession = (db: DatabaseSync, session: RecorderSession) => {
  db.prepare(`
      INSERT OR REPLACE INTO recorder_sessions (
        id, project_id, test_case_id, status, test_base_url, target_url_id, current_viewport, current_url, page_title,
        actions, artifacts, generated_script_id, started_at, finished_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
    session.id,
    session.projectId,
    session.testCaseId,
    session.status,
    session.testBaseUrl,
    session.targetUrlId ?? null,
    session.currentViewport,
    session.currentUrl ?? null,
    session.pageTitle ?? null,
    JSON.stringify(session.actions),
    JSON.stringify(session.artifacts),
    session.generatedScriptId ?? null,
    session.startedAt,
    session.finishedAt ?? null,
    session.error ?? null,
  )
}


export const clearRecorderSession = (db: DatabaseSync, sessionId: string) => {
  db.prepare("DELETE FROM recorder_sessions WHERE id = ?").run(sessionId)
}


