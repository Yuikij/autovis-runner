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
  mapTargetUrl,
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
  type TargetUrlRow,
  type TestCaseRow,
} from "../mappers.js"
import { now, toPublicLlmState, type PersistedLlmState } from "../shared.js"

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]
const typedRow = <TRow>(row: Record<string, SQLOutputValue> | undefined): TRow | undefined => row as TRow | undefined





export const listProjects = (db: DatabaseSync): Project[] => {
  const rows = typedRows<ProjectRow>(db.prepare("SELECT * FROM projects ORDER BY created_at ASC").all())
  return rows.map((row) => getProjectSummary(db, row))
}


export const getProject = (db: DatabaseSync, projectId: string): Project | undefined => {
  const row = typedRow<ProjectRow>(db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId))
  return row ? getProjectSummary(db, row) : undefined
}


export const getProjectWorkspace = (db: DatabaseSync, projectId: string): ProjectWorkspace | undefined => {
  const row = typedRow<ProjectWorkspaceRow>(db.prepare("SELECT * FROM project_workspaces WHERE project_id = ?").get(projectId))
  return row ? mapProjectWorkspace(row) : undefined
}


export const upsertProject = (db: DatabaseSync, input: UpsertProjectRequest & { id: string }) => {
  const existing = getProject(db, input.id)
  const timestamp = now()

  if (existing) {
    db.prepare("UPDATE projects SET name = ?, description = ?, test_base_url = ?, version = ?, updated_at = ? WHERE id = ?")
      .run(input.name, input.description, input.testBaseUrl ?? "", input.version ?? "", timestamp, input.id)
  } else {
    db.prepare("INSERT INTO projects (id, name, description, test_base_url, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.name, input.description, input.testBaseUrl ?? "", input.version ?? "", timestamp, timestamp)
  }

  syncPrimaryTargetUrl(db, input.id, input.testBaseUrl ?? "")
  return getProject(db, input.id)
}


export const upsertProjectWorkspace = (
  db: DatabaseSync,
  projectId: string,
  managedRoot: string,
  input: UpsertProjectWorkspaceRequest,
  overrides?: Partial<Pick<ProjectWorkspace, "status" | "lastSyncedAt" | "lastError" | "lastCommitSha">>,
) => {
  const existing = getProjectWorkspace(db, projectId)
  const timestamp = now()
  const nextStatus = overrides?.status ?? existing?.status ?? "missing"
  const nextLastSyncedAt = Object.prototype.hasOwnProperty.call(overrides ?? {}, "lastSyncedAt")
    ? overrides?.lastSyncedAt
    : existing?.lastSyncedAt ?? undefined
  const nextLastError = Object.prototype.hasOwnProperty.call(overrides ?? {}, "lastError")
    ? overrides?.lastError
    : existing?.lastError ?? undefined
  const nextLastCommitSha = Object.prototype.hasOwnProperty.call(overrides ?? {}, "lastCommitSha")
    ? overrides?.lastCommitSha
    : existing?.lastCommitSha ?? undefined

  if (existing) {
    db.prepare(`
      UPDATE project_workspaces
      SET source_kind = ?, managed_root = ?, git_repo_url = ?, local_source_path = ?, branch = ?, ref = ?,
          last_commit_sha = ?, git_auth_profile_id = ?, status = ?, last_synced_at = ?, last_error = ?, updated_at = ?
      WHERE project_id = ?
    `).run(
      input.sourceKind,
      managedRoot,
      input.gitRepoUrl ?? "",
      input.localSourcePath ?? "",
      input.branch ?? "",
      input.ref ?? "",
      nextLastCommitSha ?? null,
      input.gitAuthProfileId ?? null,
      nextStatus,
      nextLastSyncedAt ?? null,
      nextLastError ?? null,
      timestamp,
      projectId,
    )
  } else {
    db.prepare(`
      INSERT INTO project_workspaces (
        project_id, source_kind, managed_root, git_repo_url, local_source_path, branch, ref, last_commit_sha,
        git_auth_profile_id, status, last_synced_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      input.sourceKind,
      managedRoot,
      input.gitRepoUrl ?? "",
      input.localSourcePath ?? "",
      input.branch ?? "",
      input.ref ?? "",
      nextLastCommitSha ?? null,
      input.gitAuthProfileId ?? null,
      nextStatus,
      nextLastSyncedAt ?? null,
      nextLastError ?? null,
      timestamp,
      timestamp,
    )
  }

  return getProjectWorkspace(db, projectId)
}


export const deleteProject = (db: DatabaseSync, projectId: string) => {
  db.exec("BEGIN")
  try {
    db.prepare("DELETE FROM agent_steps WHERE session_id IN (SELECT id FROM agent_sessions WHERE project_id = ?)").run(projectId)
    db.prepare("DELETE FROM agent_sessions WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM recorder_sessions WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM runs WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM suite_runs WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM auth_profile_states WHERE auth_profile_id IN (SELECT id FROM auth_profiles WHERE project_id = ?)").run(projectId)
    db.prepare("DELETE FROM auth_profiles WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM target_urls WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM scripts WHERE test_case_id IN (SELECT id FROM test_cases WHERE project_id = ?)").run(projectId)
    db.prepare("DELETE FROM test_cases WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM test_suites WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM modules WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM project_workspaces WHERE project_id = ?").run(projectId)
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}


const listTargetUrlsByProject = (db: DatabaseSync, projectId: string) => {
  const rows = typedRows<TargetUrlRow>(db.prepare("SELECT * FROM target_urls WHERE project_id = ? ORDER BY is_primary DESC, created_at ASC").all(projectId))
  return rows.map(mapTargetUrl)
}

const getProjectSummary = (db: DatabaseSync, row: ProjectRow): Project => {
  const counts = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM test_cases WHERE project_id = ?) AS totalCases,
          (SELECT COUNT(*) FROM scripts WHERE test_case_id IN (SELECT id FROM test_cases WHERE project_id = ?)) AS totalScripts,
          COALESCE((SELECT status FROM runs WHERE project_id = ? AND kind != 'temporary' ORDER BY started_at DESC LIMIT 1), 'idle') AS lastRunStatus
      `)
    .get(row.id, row.id, row.id) as {
    totalCases: number
    totalScripts: number
    lastRunStatus: Project["summary"]["lastRunStatus"]
  }

  const targetUrls = listTargetUrlsByProject(db, row.id)
  return mapProject(row, counts, targetUrls)
}

/**
 * 把项目主域名同步到 target_urls 表中的"主域名"行（isPrimary=1）。
 * 没有主行时插入；存在但 URL 变化时更新；URL 为空则删除主行。
 */
const syncPrimaryTargetUrl = (db: DatabaseSync, projectId: string, url: string) => {
  const trimmed = (url ?? "").trim()
  const primaryRow = typedRow<TargetUrlRow>(
    db.prepare("SELECT * FROM target_urls WHERE project_id = ? AND is_primary = 1").get(projectId),
  )
  const timestamp = now()
  if (!trimmed) {
    if (primaryRow) db.prepare("DELETE FROM target_urls WHERE id = ?").run(primaryRow.id)
    return
  }
  if (primaryRow) {
    if (primaryRow.url !== trimmed) {
      // 若新 url 已经作为非主行存在，先把它合并：删除冗余非主行后再更新主行。
      db.prepare("DELETE FROM target_urls WHERE project_id = ? AND url = ? AND is_primary = 0").run(projectId, trimmed)
      db.prepare("UPDATE target_urls SET url = ?, updated_at = ? WHERE id = ?").run(trimmed, timestamp, primaryRow.id)
    }
  } else {
    const id = `target-url-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    db.prepare(
      "INSERT OR REPLACE INTO target_urls (id, project_id, label, url, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
    ).run(id, projectId, "主域名", trimmed, timestamp, timestamp)
  }
}


