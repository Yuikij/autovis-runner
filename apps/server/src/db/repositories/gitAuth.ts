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





export const listGitAuthProfiles = (db: DatabaseSync): GitAuthProfile[] => {
  const rows = typedRows<GitAuthProfileRow>(db.prepare("SELECT * FROM git_auth_profiles ORDER BY name COLLATE NOCASE ASC").all())
  return rows.map(mapGitAuthProfile)
}


export const getGitAuthProfile = (db: DatabaseSync, profileId: string): GitAuthProfile | undefined => {
  const row = typedRow<GitAuthProfileRow>(db.prepare("SELECT * FROM git_auth_profiles WHERE id = ?").get(profileId))
  return row ? mapGitAuthProfile(row) : undefined
}


export const upsertGitAuthProfile = (db: DatabaseSync, input: UpsertGitAuthProfileRequest & { id: string }) => {
  const existing = getGitAuthProfile(db, input.id)
  const timestamp = now()

  if (existing) {
    db.prepare("UPDATE git_auth_profiles SET name = ?, kind = ?, host_pattern = ?, username = ?, secret = ?, updated_at = ? WHERE id = ?")
      .run(input.name, input.kind, input.hostPattern, input.username ?? null, input.secret ?? null, timestamp, input.id)
  } else {
    db.prepare("INSERT INTO git_auth_profiles (id, name, kind, host_pattern, username, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.name, input.kind, input.hostPattern, input.username ?? null, input.secret ?? null, timestamp, timestamp)
  }

  return getGitAuthProfile(db, input.id)
}


export const deleteGitAuthProfile = (db: DatabaseSync, profileId: string): void => {
  db.prepare("UPDATE project_workspaces SET git_auth_profile_id = NULL WHERE git_auth_profile_id = ?").run(profileId)
  db.prepare("DELETE FROM git_auth_profiles WHERE id = ?").run(profileId)
}


