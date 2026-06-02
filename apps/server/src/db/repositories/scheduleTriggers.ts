import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { ScheduleTrigger, UpsertScheduleTriggerRequest } from "@autovis/shared"
import { mapScheduleTrigger, type ScheduleTriggerRow } from "../mappers.js"
import { now } from "../shared.js"

const typedRows = <T>(rows: Record<string, SQLOutputValue>[]): T[] => rows as unknown as T[]
const typedRow = <T>(row: Record<string, SQLOutputValue> | undefined): T | undefined => row as T | undefined

export const listScheduleTriggers = (db: DatabaseSync, projectId?: string): ScheduleTrigger[] => {
  const rows = projectId
    ? typedRows<ScheduleTriggerRow>(db.prepare("SELECT * FROM schedule_triggers WHERE project_id = ? ORDER BY created_at DESC").all(projectId))
    : typedRows<ScheduleTriggerRow>(db.prepare("SELECT * FROM schedule_triggers ORDER BY created_at DESC").all())
  return rows.map(mapScheduleTrigger)
}

export const listScheduleTriggersForTask = (db: DatabaseSync, taskId: string): ScheduleTrigger[] => {
  const rows = typedRows<ScheduleTriggerRow>(db.prepare("SELECT * FROM schedule_triggers WHERE task_id = ? ORDER BY created_at DESC").all(taskId))
  return rows.map(mapScheduleTrigger)
}

export const listAllScheduleTriggers = (db: DatabaseSync): ScheduleTrigger[] => {
  const rows = typedRows<ScheduleTriggerRow>(db.prepare("SELECT * FROM schedule_triggers ORDER BY created_at DESC").all())
  return rows.map(mapScheduleTrigger)
}

export const getScheduleTrigger = (db: DatabaseSync, id: string): ScheduleTrigger | undefined => {
  const row = typedRow<ScheduleTriggerRow>(db.prepare("SELECT * FROM schedule_triggers WHERE id = ?").get(id))
  return row ? mapScheduleTrigger(row) : undefined
}

export const upsertScheduleTrigger = (db: DatabaseSync, input: UpsertScheduleTriggerRequest & { id: string }): ScheduleTrigger | undefined => {
  const existing = typedRow<ScheduleTriggerRow>(db.prepare("SELECT * FROM schedule_triggers WHERE id = ?").get(input.id))
  const timestamp = now()
  const enabledVal = input.enabled === false ? 0 : 1

  if (existing) {
    db.prepare(`
      UPDATE schedule_triggers
        SET project_id = ?, task_id = ?, name = ?, kind = ?, at_time = ?, cron_expr = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.projectId,
      input.taskId,
      input.name ?? "",
      input.kind,
      input.atTime ?? null,
      input.cronExpr ?? null,
      enabledVal,
      timestamp,
      input.id,
    )
  } else {
    db.prepare(`
      INSERT INTO schedule_triggers (
        id, project_id, task_id, name, kind, at_time, cron_expr, enabled, last_fired_at, next_fire_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run(
      input.id,
      input.projectId,
      input.taskId,
      input.name ?? "",
      input.kind,
      input.atTime ?? null,
      input.cronExpr ?? null,
      enabledVal,
      timestamp,
      timestamp,
    )
  }

  return getScheduleTrigger(db, input.id)
}

export const deleteScheduleTrigger = (db: DatabaseSync, id: string) => {
  db.prepare("DELETE FROM schedule_triggers WHERE id = ?").run(id)
}

export const updateScheduleTriggerFiredAt = (db: DatabaseSync, id: string, lastFiredAt: string, nextFireAt: string | null) => {
  db.prepare("UPDATE schedule_triggers SET last_fired_at = ?, next_fire_at = ?, updated_at = ? WHERE id = ?")
    .run(lastFiredAt, nextFireAt, now(), id)
}

export const updateScheduleTriggerNextFireAt = (db: DatabaseSync, id: string, nextFireAt: string | null) => {
  db.prepare("UPDATE schedule_triggers SET next_fire_at = ?, updated_at = ? WHERE id = ?")
    .run(nextFireAt, now(), id)
}

export const setScheduleTriggerEnabled = (db: DatabaseSync, id: string, enabled: boolean) => {
  db.prepare("UPDATE schedule_triggers SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, now(), id)
}
