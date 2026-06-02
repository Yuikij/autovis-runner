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





export const listScriptsForTestCase = (db: DatabaseSync, testCaseId: string): ScriptArtifact[] => {
  const rows = typedRows<ScriptRow>(db.prepare("SELECT * FROM scripts WHERE test_case_id = ? ORDER BY version DESC, created_at DESC").all(testCaseId))
  return rows.map(mapScript)
}


export const getScript = (db: DatabaseSync, scriptId: string): ScriptArtifact | undefined => {
  const row = typedRow<ScriptRow>(db.prepare("SELECT * FROM scripts WHERE id = ?").get(scriptId))
  return row ? mapScript(row) : undefined
}


export const insertScript = (db: DatabaseSync, script: ScriptArtifact) => {
  db.exec("BEGIN")
  try {
    db.prepare(`
          INSERT INTO scripts (id, test_case_id, version, source, provider, prompt, code, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
      .run(script.id, script.testCaseId, script.version, script.source, script.provider, script.prompt, script.code, script.createdAt)
    db.prepare("UPDATE test_cases SET latest_script_id = ?, ai_script = ? WHERE id = ?").run(script.id, script.code, script.testCaseId)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export const deleteScript = (db: DatabaseSync, scriptId: string) => {
  db.exec("BEGIN")
  try {
    const scriptRow = db.prepare("SELECT test_case_id FROM scripts WHERE id = ?").get(scriptId) as { test_case_id: string } | undefined
    if (scriptRow) {
      db.prepare("DELETE FROM scripts WHERE id = ?").run(scriptId)
      
      const latestRow = db.prepare("SELECT id, code FROM scripts WHERE test_case_id = ? ORDER BY version DESC LIMIT 1").get(scriptRow.test_case_id) as { id: string, code: string } | undefined
      if (latestRow) {
        db.prepare("UPDATE test_cases SET latest_script_id = ?, ai_script = ? WHERE id = ?").run(latestRow.id, latestRow.code, scriptRow.test_case_id)
      } else {
        db.prepare("UPDATE test_cases SET latest_script_id = NULL, ai_script = NULL WHERE id = ?").run(scriptRow.test_case_id)
      }
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

