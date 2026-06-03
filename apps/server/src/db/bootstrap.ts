import { existsSync, readFileSync } from "node:fs"
import type { DatabaseSync } from "node:sqlite"

import { createSeedState } from "./seed.js"
import { buildLegacyLlmState, now } from "./shared.js"
import type { PersistedState } from "./types.js"

export const bootstrapDatabase = (db: DatabaseSync, stateFile: string, appOrigin: string) => {
  const count = db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number }
  if (count.count > 0) {
    return
  }

  if (existsSync(stateFile)) {
    try {
      const raw = readFileSync(stateFile, "utf8")
      importState(db, JSON.parse(raw) as PersistedState)
      return
    } catch {
      // Fall back to seed data when the legacy state cannot be read.
    }
  }

  importState(db, createSeedState(appOrigin))
}

export const importState = (db: DatabaseSync, state: PersistedState) => {
  const insertProject = db.prepare(`
    INSERT INTO projects (id, name, description, test_base_url, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, project_id, name, description, items_json, execution_mode, last_run_id, last_status, last_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTestCase = db.prepare(`
    INSERT INTO test_cases (
      id, project_id, case_code, module_name, module_id, purpose,
      dependency_case_ids, auth_profile_id, steps,
      expected_result, test_type, bug_id, note, ai_script, latest_script_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertScript = db.prepare(`
    INSERT INTO scripts (id, test_case_id, version, source, provider, prompt, code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertRun = db.prepare(`
    INSERT INTO runs (id, project_id, test_case_id, script_id, kind, task_run_id, batch_order, status, started_at, finished_at, current_viewport, logs, steps, artifacts, test_base_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTaskRun = db.prepare(`
    INSERT INTO task_runs (id, project_id, task_id, status, test_base_url, total_count, queued_count, running_count, passed_count, failed_count, skipped_count, run_ids, current_run_id, current_agent_id, last_agent_id, logs, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertRecorderSession = db.prepare(`
    INSERT INTO recorder_sessions (id, project_id, test_case_id, status, test_base_url, current_viewport, current_url, page_title, actions, artifacts, generated_script_id, started_at, finished_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const replaceSession = db.prepare(`
    INSERT OR REPLACE INTO llm_session (
      singleton_id, provider, proxy_endpoint, model, signed_in, connection_status, base_url, login_mode,
      last_synced_at, last_error, pending_device_auth, feature_flags, copilot_secrets, configs_json, llm_secrets_json, active_config_id
    ) VALUES (
      1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)

  const insertTargetUrl = db.prepare(`
    INSERT INTO target_urls (id, project_id, label, url, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec("BEGIN")
  try {
    state.projects.forEach((project) => {
      insertProject.run(project.id, project.name, project.description, project.testBaseUrl ?? "", project.version ?? "", project.createdAt, project.updatedAt)
      const primaryUrl = (project.testBaseUrl ?? "").trim()
      if (primaryUrl) {
        const urlId = `target-url-${project.id}-primary`
        insertTargetUrl.run(urlId, project.id, "主域名", primaryUrl, 1, project.createdAt, project.updatedAt)
      }
    })
    state.tasks.forEach((task) =>
      insertTask.run(
        task.id,
        task.projectId,
        task.name,
        task.description ?? null,
        JSON.stringify(task.items ?? []),
        task.executionMode ? JSON.stringify(task.executionMode) : null,
        task.lastRunId ?? null,
        task.lastStatus ?? null,
        task.lastRunAt ?? null,
        task.createdAt,
        task.updatedAt,
      ),
    )
    state.testCases.forEach((item) =>
      insertTestCase.run(
        item.id,
        item.projectId,
        item.caseCode,
        item.moduleName ?? null,
        item.moduleId ?? null,
        item.purpose,
        JSON.stringify(item.dependencyCaseIds ?? []),
        item.authProfileId ?? null,
        JSON.stringify(item.steps),
        item.expectedResult,
        item.testType,
        item.bugId ?? null,
        item.note ?? null,
        item.aiScript ?? null,
        item.latestScriptId ?? null,
        item.createdAt ?? now(),
        item.updatedAt ?? now(),
      ),
    )
    state.scripts.forEach((item) => insertScript.run(item.id, item.testCaseId, item.version, item.source, item.provider, item.prompt, item.code, item.createdAt))
    state.runs.forEach((item) =>
      insertRun.run(
        item.id,
        item.projectId,
        item.testCaseId,
        item.scriptId,
        item.kind ?? "execution",
        item.taskRunId ?? null,
        item.batchOrder ?? null,
        item.status,
        item.startedAt,
        item.finishedAt ?? null,
        item.currentViewport,
        JSON.stringify(item.logs),
        JSON.stringify(item.steps),
        JSON.stringify(item.artifacts),
        item.testBaseUrl ?? "http://localhost:8787/demo/admin",
      ),
    )
    state.taskRuns.forEach((item) =>
      insertTaskRun.run(
        item.id,
        item.projectId,
        item.taskId,
        item.status,
        item.testBaseUrl,
        item.totalCount,
        item.queuedCount,
        item.runningCount,
        item.passedCount,
        item.failedCount,
        item.skippedCount,
        JSON.stringify(item.runIds),
        item.currentRunId ?? null,
        item.currentAgentId ?? null,
        item.lastAgentId ?? null,
        JSON.stringify(item.logs),
        item.startedAt,
        item.finishedAt ?? null,
      ),
    )
    state.recorderSessions.forEach((item) =>
      insertRecorderSession.run(
        item.id,
        item.projectId,
        item.testCaseId,
        item.status,
        item.testBaseUrl,
        item.currentViewport,
        item.currentUrl ?? null,
        item.pageTitle ?? null,
        JSON.stringify(item.actions),
        JSON.stringify(item.artifacts),
        item.generatedScriptId ?? null,
        item.startedAt,
        item.finishedAt ?? null,
        item.error ?? null,
      ),
    )
    const llmState = state.llmState ?? buildLegacyLlmState(state.llmSession, state.llmSecrets?.copilot ?? {})
    replaceSession.run(
      state.llmSession.provider,
      state.llmSession.proxyEndpoint,
      state.llmSession.model,
      state.llmSession.signedIn ? 1 : 0,
      state.llmSession.connectionStatus,
      state.llmSession.baseUrl,
      state.llmSession.loginMode,
      state.llmSession.lastSyncedAt ?? null,
      state.llmSession.lastError ?? null,
      state.llmSession.pendingDeviceAuth ? JSON.stringify(state.llmSession.pendingDeviceAuth) : null,
      JSON.stringify(state.llmSession.featureFlags),
      JSON.stringify(state.llmSecrets?.copilot ?? {}),
      JSON.stringify(llmState),
      JSON.stringify(
        llmState.configs.reduce<Record<string, unknown>>((acc, item) => {
          acc[item.session.id] = item.secrets
          return acc
        }, {}),
      ),
      llmState.activeConfigId ?? state.llmSession.id,
    )
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}
