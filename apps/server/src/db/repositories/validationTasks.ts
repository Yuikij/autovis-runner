import { type DatabaseSync } from "node:sqlite"
import { type ValidationTask } from "@autovis/shared"

export const upsertValidationTask = (db: DatabaseSync, task: ValidationTask) => {
  const statement = db.prepare(`
    INSERT INTO validation_tasks (
      id, profile_id, kind, target_url_id, status, steps_json,
      error, check_result_json, result_profile_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      kind = excluded.kind,
      target_url_id = excluded.target_url_id,
      status = excluded.status,
      steps_json = excluded.steps_json,
      error = excluded.error,
      check_result_json = excluded.check_result_json,
      result_profile_json = excluded.result_profile_json,
      updated_at = excluded.updated_at
  `)
  statement.run(
    task.id,
    task.profileId,
    task.kind ?? "generate",
    task.targetUrlId ?? null,
    task.status,
    JSON.stringify(task.steps),
    task.error ?? null,
    task.checkResult ? JSON.stringify(task.checkResult) : null,
    task.resultProfile ? JSON.stringify(task.resultProfile) : null,
    new Date().toISOString(),
    new Date().toISOString()
  )
}

export const getValidationTask = (db: DatabaseSync, id: string): ValidationTask | undefined => {
  const row = db.prepare(`SELECT * FROM validation_tasks WHERE id = ?`).get(id) as any
  if (!row) return undefined
  return {
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind,
    targetUrlId: row.target_url_id ?? undefined,
    status: row.status,
    steps: JSON.parse(row.steps_json),
    error: row.error ?? undefined,
    checkResult: row.check_result_json ? JSON.parse(row.check_result_json) : undefined,
    resultProfile: row.result_profile_json ? JSON.parse(row.result_profile_json) : undefined,
  }
}

export const listActiveValidationTasks = (db: DatabaseSync): ValidationTask[] => {
  const rows = db.prepare(`SELECT * FROM validation_tasks WHERE status = 'running'`).all() as any[]
  return rows.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    kind: row.kind,
    targetUrlId: row.target_url_id ?? undefined,
    status: row.status,
    steps: JSON.parse(row.steps_json),
    error: row.error ?? undefined,
    checkResult: row.check_result_json ? JSON.parse(row.check_result_json) : undefined,
    resultProfile: row.result_profile_json ? JSON.parse(row.result_profile_json) : undefined,
  }))
}

export const deleteValidationTask = (db: DatabaseSync, id: string) => {
  db.prepare(`DELETE FROM validation_tasks WHERE id = ?`).run(id)
}
