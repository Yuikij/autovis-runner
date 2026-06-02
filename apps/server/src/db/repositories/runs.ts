import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { ExecutionRun } from "@autovis/shared"
import { mapRun, type RunRow } from "../mappers.js"

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]
const typedRow = <TRow>(row: Record<string, SQLOutputValue> | undefined): TRow | undefined => row as TRow | undefined

export const listRuns = (db: DatabaseSync, projectId: string): ExecutionRun[] => {
  const rows = typedRows<RunRow>(db.prepare("SELECT * FROM runs WHERE project_id = ? AND kind != 'temporary' ORDER BY started_at DESC").all(projectId))
  return rows.map(mapRun)
}

export const listAllRuns = (db: DatabaseSync): ExecutionRun[] => {
  const rows = typedRows<RunRow>(db.prepare("SELECT * FROM runs ORDER BY started_at DESC").all())
  return rows.map(mapRun)
}

export const listActiveRunsForProject = (db: DatabaseSync, projectId: string): ExecutionRun[] => {
  const rows = typedRows<RunRow>(db.prepare("SELECT * FROM runs WHERE project_id = ? AND status IN ('running','paused','cancelling','awaiting_human','queued') ORDER BY started_at DESC").all(projectId))
  return rows.map(mapRun)
}

export const deleteRunById = (db: DatabaseSync, runId: string) => {
  db.prepare("DELETE FROM runs WHERE id = ?").run(runId)
}

export const getRun = (db: DatabaseSync, runId: string): ExecutionRun | undefined => {
  const row = typedRow<RunRow>(db.prepare("SELECT * FROM runs WHERE id = ?").get(runId))
  return row ? mapRun(row) : undefined
}

export const upsertRun = (db: DatabaseSync, run: ExecutionRun) => {
  db.prepare(`
        INSERT OR REPLACE INTO runs (
          id, project_id, test_case_id, script_id, kind, task_run_id, batch_order, status, started_at, finished_at, current_viewport, live_viewport, pending_human_handoff,
          orchestration_phase, current_precondition_case_id, completed_precondition_case_ids, precondition_summary, runtime_outputs,
          logs, steps, artifacts, test_base_url, target_url_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    .run(
      run.id,
      run.projectId,
      run.testCaseId,
      run.scriptId,
      run.kind,
      run.taskRunId ?? null,
      run.batchOrder ?? null,
      run.status,
      run.startedAt,
      run.finishedAt ?? null,
      run.currentViewport,
      run.liveViewport ? JSON.stringify(run.liveViewport) : null,
      run.pendingHumanHandoff ? JSON.stringify(run.pendingHumanHandoff) : null,
      run.orchestrationPhase ?? null,
      run.currentPreconditionCaseId ?? null,
      run.completedPreconditionCaseIds ? JSON.stringify(run.completedPreconditionCaseIds) : null,
      run.preconditionSummary ? JSON.stringify(run.preconditionSummary) : null,
      run.runtimeOutputs ? JSON.stringify(run.runtimeOutputs) : null,
      JSON.stringify(run.logs),
      JSON.stringify(run.steps),
      JSON.stringify(run.artifacts),
      run.testBaseUrl,
      run.targetUrlId ?? null,
    )
}

export const clearRuns = (db: DatabaseSync, projectId: string): void => {
  db.prepare("DELETE FROM runs WHERE project_id = ? AND status IN ('passed', 'failed')").run(projectId)
  db.prepare("DELETE FROM task_runs WHERE project_id = ? AND status IN ('passed', 'failed')").run(projectId)
}
