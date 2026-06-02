import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { Task, TaskRun, UpsertTaskRequest } from "@autovis/shared"
import { mapTask, mapTaskRun, type TaskRow, type TaskRunRow } from "../mappers.js"
import { now } from "../shared.js"

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]
const typedRow = <TRow>(row: Record<string, SQLOutputValue> | undefined): TRow | undefined => row as TRow | undefined

// ---- Task ----

export const listTasks = (db: DatabaseSync, projectId?: string): Task[] => {
  const rows = projectId
    ? typedRows<TaskRow>(db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC").all(projectId))
    : typedRows<TaskRow>(db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC, created_at DESC").all())
  return rows.map(mapTask)
}

export const getTask = (db: DatabaseSync, taskId: string): Task | undefined => {
  const row = typedRow<TaskRow>(db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId))
  return row ? mapTask(row) : undefined
}

export const upsertTask = (db: DatabaseSync, input: UpsertTaskRequest & { id: string }): Task | undefined => {
  const existing = typedRow<TaskRow>(db.prepare("SELECT * FROM tasks WHERE id = ?").get(input.id))
  const timestamp = now()
  const itemsJson = JSON.stringify(input.items ?? [])
  const executionModeJson = input.executionMode ? JSON.stringify(input.executionMode) : null

  if (existing) {
    db.prepare("UPDATE tasks SET project_id = ?, name = ?, description = ?, items_json = ?, execution_mode = ?, updated_at = ? WHERE id = ?")
      .run(input.projectId, input.name, input.description ?? null, itemsJson, executionModeJson, timestamp, input.id)
  } else {
    db.prepare("INSERT INTO tasks (id, project_id, name, description, items_json, execution_mode, last_run_id, last_status, last_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)")
      .run(input.id, input.projectId, input.name, input.description ?? null, itemsJson, executionModeJson, timestamp, timestamp)
  }

  return getTask(db, input.id)
}

export const deleteTask = (db: DatabaseSync, taskId: string) => {
  db.exec("BEGIN")
  try {
    db.prepare("DELETE FROM schedule_triggers WHERE task_id = ?").run(taskId)
    db.prepare("DELETE FROM task_runs WHERE task_id = ?").run(taskId)
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export const updateTaskLastRun = (
  db: DatabaseSync,
  input: { taskId: string; lastRunId?: string; lastStatus?: TaskRun["status"]; lastRunAt?: string },
) => {
  db.prepare("UPDATE tasks SET last_run_id = ?, last_status = ?, last_run_at = ?, updated_at = ? WHERE id = ?")
    .run(input.lastRunId ?? null, input.lastStatus ?? null, input.lastRunAt ?? null, now(), input.taskId)
}

// ---- TaskRun ----

export const listTaskRuns = (db: DatabaseSync, projectId: string): TaskRun[] => {
  const rows = typedRows<TaskRunRow>(db.prepare("SELECT * FROM task_runs WHERE project_id = ? ORDER BY started_at DESC").all(projectId))
  return rows.map(mapTaskRun)
}

export const listTaskRunsForTask = (db: DatabaseSync, taskId: string): TaskRun[] => {
  const rows = typedRows<TaskRunRow>(db.prepare("SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC").all(taskId))
  return rows.map(mapTaskRun)
}

export const listAllTaskRuns = (db: DatabaseSync): TaskRun[] => {
  const rows = typedRows<TaskRunRow>(db.prepare("SELECT * FROM task_runs ORDER BY started_at DESC").all())
  return rows.map(mapTaskRun)
}

export const listActiveTaskRunsForProject = (db: DatabaseSync, projectId: string): TaskRun[] => {
  const rows = typedRows<TaskRunRow>(db.prepare("SELECT * FROM task_runs WHERE project_id = ? AND status IN ('running','paused','cancelling','queued') ORDER BY started_at DESC").all(projectId))
  return rows.map(mapTaskRun)
}

export const getTaskRun = (db: DatabaseSync, taskRunId: string): TaskRun | undefined => {
  const row = typedRow<TaskRunRow>(db.prepare("SELECT * FROM task_runs WHERE id = ?").get(taskRunId))
  return row ? mapTaskRun(row) : undefined
}

export const upsertTaskRun = (db: DatabaseSync, taskRun: TaskRun) => {
  db.prepare(`
      INSERT OR REPLACE INTO task_runs (
        id, project_id, task_id, status, test_base_url, target_url_id, total_count, queued_count, running_count, passed_count, failed_count,
        skipped_count, run_ids, current_run_id, logs, started_at, finished_at,
        schedule_trigger_id, attempt_no, parent_task_run_id, effective_task_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
    taskRun.id,
    taskRun.projectId,
    taskRun.taskId,
    taskRun.status,
    taskRun.testBaseUrl,
    taskRun.targetUrlId ?? null,
    taskRun.totalCount,
    taskRun.queuedCount,
    taskRun.runningCount,
    taskRun.passedCount,
    taskRun.failedCount,
    taskRun.skippedCount,
    JSON.stringify(taskRun.runIds),
    taskRun.currentRunId ?? null,
    JSON.stringify(taskRun.logs),
    taskRun.startedAt,
    taskRun.finishedAt ?? null,
    taskRun.scheduleTriggerId ?? null,
    taskRun.attemptNo ?? null,
    taskRun.parentTaskRunId ?? null,
    taskRun.effectiveTaskMode ? JSON.stringify(taskRun.effectiveTaskMode) : null,
  )
}
