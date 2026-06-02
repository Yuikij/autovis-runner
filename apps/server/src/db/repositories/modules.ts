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





export const listModules = (db: DatabaseSync, projectId: string): Module[] => {
  const rows = typedRows<ModuleRow>(db.prepare("SELECT * FROM modules WHERE project_id = ? ORDER BY name ASC").all(projectId))
  return rows.map(mapModule)
}


export const upsertModule = (db: DatabaseSync, input: UpsertModuleRequest & { id: string }): Module | undefined => {
  const existing = typedRow<ModuleRow>(db.prepare("SELECT * FROM modules WHERE id = ?").get(input.id))
  const timestamp = now()

  if (existing) {
    db.prepare("UPDATE modules SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(input.name, input.description, timestamp, input.id)
  } else {
    db.prepare("INSERT INTO modules (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.id, input.projectId, input.name, input.description, timestamp, timestamp)
  }

  const row = typedRow<ModuleRow>(db.prepare("SELECT * FROM modules WHERE id = ?").get(input.id))
  return row ? mapModule(row) : undefined
}


export const deleteModule = (db: DatabaseSync, moduleId: string): void => {
  db.prepare("UPDATE test_cases SET module_id = NULL WHERE module_id = ?").run(moduleId)
  db.prepare("DELETE FROM modules WHERE id = ?").run(moduleId)
}

