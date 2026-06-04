import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { PersistedTaskControlCommand, TaskControlCommandStatus } from "../shared.js"
import { now } from "../shared.js"

type TaskControlCommandRow = {
  id: string
  task_kind: string
  task_id: string
  action: string
  status: TaskControlCommandStatus
  requested_at: string
  resolved_at: string | null
  note: string | null
}

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]

export interface TaskControlCommandListInput {
  projectId?: string
  taskKind?: PersistedTaskControlCommand["taskKind"]
  taskId?: string
  status?: TaskControlCommandStatus
  limit?: number
}

const mapTaskControlCommand = (row: TaskControlCommandRow): PersistedTaskControlCommand => ({
  id: row.id,
  taskKind: row.task_kind as PersistedTaskControlCommand["taskKind"],
  taskId: row.task_id,
  action: row.action as PersistedTaskControlCommand["action"],
  status: row.status,
  requestedAt: row.requested_at,
  resolvedAt: row.resolved_at ?? undefined,
  note: row.note ?? undefined,
})

export const insertTaskControlCommand = (db: DatabaseSync, command: PersistedTaskControlCommand) => {
  db.prepare(`
    INSERT INTO task_control_commands (
      id, task_kind, task_id, action, status, requested_at, resolved_at, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    command.id,
    command.taskKind,
    command.taskId,
    command.action,
    command.status,
    command.requestedAt,
    command.resolvedAt ?? null,
    command.note ?? null,
  )
}

export const resolveTaskControlCommand = (
  db: DatabaseSync,
  input: { id: string; status: Exclude<TaskControlCommandStatus, "requested">; note?: string },
) => {
  db.prepare("UPDATE task_control_commands SET status = ?, resolved_at = ?, note = ? WHERE id = ?")
    .run(input.status, now(), input.note ?? null, input.id)
}

export const listPendingTaskControlCommands = (db: DatabaseSync): PersistedTaskControlCommand[] => {
  const rows = typedRows<TaskControlCommandRow>(db.prepare("SELECT * FROM task_control_commands WHERE status = 'requested' ORDER BY requested_at ASC").all())
  return rows.map(mapTaskControlCommand)
}

export const orphanPendingTaskControlCommands = (db: DatabaseSync, note: string) => {
  db.prepare("UPDATE task_control_commands SET status = 'orphaned', resolved_at = ?, note = ? WHERE status = 'requested'")
    .run(now(), note)
}

export const listTaskControlCommands = (db: DatabaseSync, input: TaskControlCommandListInput = {}): PersistedTaskControlCommand[] => {
  const clauses: string[] = []
  const values: Array<string | number> = []

  if (input.projectId) {
    clauses.push(`(
      (task_kind = 'run' AND EXISTS (SELECT 1 FROM runs WHERE runs.id = task_control_commands.task_id AND runs.project_id = ?))
      OR (task_kind = 'task-run' AND EXISTS (SELECT 1 FROM task_runs WHERE task_runs.id = task_control_commands.task_id AND task_runs.project_id = ?))
      OR (task_kind = 'agent' AND EXISTS (SELECT 1 FROM agent_sessions WHERE agent_sessions.id = task_control_commands.task_id AND agent_sessions.project_id = ?))
      OR (task_kind = 'recorder' AND EXISTS (SELECT 1 FROM recorder_sessions WHERE recorder_sessions.id = task_control_commands.task_id AND recorder_sessions.project_id = ?))
    )`)
    values.push(input.projectId, input.projectId, input.projectId, input.projectId)
  }

  if (input.taskKind) {
    clauses.push("task_kind = ?")
    values.push(input.taskKind)
  }

  if (input.taskId) {
    clauses.push("task_id = ?")
    values.push(input.taskId)
  }

  if (input.status) {
    clauses.push("status = ?")
    values.push(input.status)
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  values.push(limit)

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : ""
  const rows = typedRows<TaskControlCommandRow>(
    db.prepare(`SELECT * FROM task_control_commands${where} ORDER BY requested_at DESC LIMIT ?`).all(...values),
  )

  return rows.map(mapTaskControlCommand)
}