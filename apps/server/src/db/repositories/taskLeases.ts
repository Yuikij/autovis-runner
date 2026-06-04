import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { PersistedTaskLease, TaskLeaseStatus, TaskRecoveryPolicy } from "../shared.js"
import { now, parseJson } from "../shared.js"

type TaskLeaseRow = {
  task_kind: string
  task_id: string
  status: TaskLeaseStatus
  recovery_policy: TaskRecoveryPolicy
  lease_owner: string | null
  lease_acquired_at: string | null
  lease_heartbeat_at: string | null
  lease_expires_at: string | null
  checkpoint_json: string | null
  request_json: string | null
  recovery_attempts: number
  last_recovery_started_at: string | null
  last_recovered_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()

const mapTaskLease = (row: TaskLeaseRow): PersistedTaskLease => ({
  taskKind: row.task_kind as PersistedTaskLease["taskKind"],
  taskId: row.task_id,
  status: row.status,
  recoveryPolicy: row.recovery_policy,
  leaseOwner: row.lease_owner ?? undefined,
  leaseAcquiredAt: row.lease_acquired_at ?? undefined,
  leaseHeartbeatAt: row.lease_heartbeat_at ?? undefined,
  leaseExpiresAt: row.lease_expires_at ?? undefined,
  checkpoint: parseJson<Record<string, unknown>>(row.checkpoint_json, {}),
  request: parseJson<Record<string, unknown>>(row.request_json, {}),
  recoveryAttempts: row.recovery_attempts,
  lastRecoveryStartedAt: row.last_recovery_started_at ?? undefined,
  lastRecoveredAt: row.last_recovered_at ?? undefined,
  lastError: row.last_error ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export interface AcquireTaskLeaseInput {
  taskKind: PersistedTaskLease["taskKind"]
  taskId: string
  recoveryPolicy: TaskRecoveryPolicy
  leaseOwner: string
  leaseDurationMs: number
  checkpoint?: Record<string, unknown>
  request?: Record<string, unknown>
  nowAt?: string
  lastError?: string
}

export interface UpdateTaskLeaseHeartbeatInput {
  taskKind: PersistedTaskLease["taskKind"]
  taskId: string
  leaseOwner: string
  leaseDurationMs: number
  checkpoint?: Record<string, unknown>
  nowAt?: string
}

export interface FinalizeTaskLeaseInput {
  taskKind: PersistedTaskLease["taskKind"]
  taskId: string
  leaseOwner?: string
  status: Exclude<TaskLeaseStatus, "active"> 
  checkpoint?: Record<string, unknown>
  nowAt?: string
  lastError?: string
}

export interface MarkTaskLeaseRecoveryInput {
  taskKind: PersistedTaskLease["taskKind"]
  taskId: string
  leaseOwner: string
  leaseDurationMs: number
  nowAt?: string
}

export const getTaskLease = (db: DatabaseSync, taskKind: PersistedTaskLease["taskKind"], taskId: string): PersistedTaskLease | undefined => {
  const row = db.prepare("SELECT * FROM task_leases WHERE task_kind = ? AND task_id = ?").get(taskKind, taskId) as TaskLeaseRow | undefined
  return row ? mapTaskLease(row) : undefined
}

export const listTaskLeases = (db: DatabaseSync, status?: TaskLeaseStatus): PersistedTaskLease[] => {
  const rows = status
    ? typedRows<TaskLeaseRow>(db.prepare("SELECT * FROM task_leases WHERE status = ? ORDER BY updated_at DESC").all(status))
    : typedRows<TaskLeaseRow>(db.prepare("SELECT * FROM task_leases ORDER BY updated_at DESC").all())
  return rows.map(mapTaskLease)
}

export const listExpiredActiveTaskLeases = (db: DatabaseSync, nowAt = now()): PersistedTaskLease[] => {
  const rows = typedRows<TaskLeaseRow>(
    db.prepare("SELECT * FROM task_leases WHERE status = 'active' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? ORDER BY lease_expires_at ASC").all(nowAt),
  )
  return rows.map(mapTaskLease)
}

export const acquireTaskLease = (db: DatabaseSync, input: AcquireTaskLeaseInput): boolean => {
  const nowAt = input.nowAt ?? now()
  const expiresAt = addMs(nowAt, input.leaseDurationMs)
  const serializedCheckpoint = input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint)
  const serializedRequest = input.request === undefined ? null : JSON.stringify(input.request)

  const result = db.prepare(`
    INSERT INTO task_leases (
      task_kind,
      task_id,
      status,
      recovery_policy,
      lease_owner,
      lease_acquired_at,
      lease_heartbeat_at,
      lease_expires_at,
      checkpoint_json,
      request_json,
      recovery_attempts,
      last_recovery_started_at,
      last_recovered_at,
      last_error,
      created_at,
      updated_at
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)
    ON CONFLICT(task_kind, task_id) DO UPDATE SET
      status = 'active',
      recovery_policy = excluded.recovery_policy,
      lease_owner = excluded.lease_owner,
      lease_acquired_at = excluded.lease_acquired_at,
      lease_heartbeat_at = excluded.lease_heartbeat_at,
      lease_expires_at = excluded.lease_expires_at,
      checkpoint_json = COALESCE(excluded.checkpoint_json, task_leases.checkpoint_json),
      request_json = COALESCE(excluded.request_json, task_leases.request_json),
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
    WHERE task_leases.status IN ('released', 'expired', 'terminated')
      OR task_leases.lease_owner = ?
      OR task_leases.lease_expires_at IS NULL
      OR task_leases.lease_expires_at <= ?
  `).run(
    input.taskKind,
    input.taskId,
    input.recoveryPolicy,
    input.leaseOwner,
    nowAt,
    nowAt,
    expiresAt,
    serializedCheckpoint,
    serializedRequest,
    input.lastError ?? null,
    nowAt,
    nowAt,
    input.leaseOwner,
    nowAt,
  )

  return Number(result.changes) > 0
}

export const renewTaskLease = (db: DatabaseSync, input: UpdateTaskLeaseHeartbeatInput): boolean => {
  const nowAt = input.nowAt ?? now()
  const expiresAt = addMs(nowAt, input.leaseDurationMs)
  const serializedCheckpoint = input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint)
  const result = db.prepare(`
    UPDATE task_leases
    SET
      status = 'active',
      lease_heartbeat_at = ?,
      lease_expires_at = ?,
      checkpoint_json = COALESCE(?, checkpoint_json),
      updated_at = ?,
      last_error = NULL
    WHERE task_kind = ?
      AND task_id = ?
      AND lease_owner = ?
      AND status IN ('active', 'recovering')
  `).run(nowAt, expiresAt, serializedCheckpoint, nowAt, input.taskKind, input.taskId, input.leaseOwner)

  return Number(result.changes) > 0
}

export const markTaskLeaseRecovering = (db: DatabaseSync, input: MarkTaskLeaseRecoveryInput): boolean => {
  const nowAt = input.nowAt ?? now()
  const expiresAt = addMs(nowAt, input.leaseDurationMs)
  const result = db.prepare(`
    UPDATE task_leases
    SET
      status = 'recovering',
      lease_owner = ?,
      lease_acquired_at = ?,
      lease_heartbeat_at = ?,
      lease_expires_at = ?,
      recovery_attempts = recovery_attempts + 1,
      last_recovery_started_at = ?,
      updated_at = ?
    WHERE task_kind = ?
      AND task_id = ?
      AND status = 'active'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= ?
  `).run(input.leaseOwner, nowAt, nowAt, expiresAt, nowAt, nowAt, input.taskKind, input.taskId, nowAt)

  return Number(result.changes) > 0
}

export const finalizeTaskLease = (db: DatabaseSync, input: FinalizeTaskLeaseInput): boolean => {
  const nowAt = input.nowAt ?? now()
  const serializedCheckpoint = input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint)
  const clauses = ["task_kind = ?", "task_id = ?"]
  const values: Array<string | null> = [input.taskKind, input.taskId]
  if (input.leaseOwner) {
    clauses.push("lease_owner = ?")
    values.push(input.leaseOwner)
  }
  const result = db.prepare(`
    UPDATE task_leases
    SET
      status = ?,
      lease_owner = NULL,
      lease_heartbeat_at = NULL,
      lease_expires_at = NULL,
      checkpoint_json = COALESCE(?, checkpoint_json),
      last_recovered_at = CASE WHEN status = 'recovering' THEN ? ELSE last_recovered_at END,
      last_error = ?,
      updated_at = ?
    WHERE ${clauses.join(" AND ")}
  `).run(input.status, serializedCheckpoint, nowAt, input.lastError ?? null, nowAt, ...values)

  return Number(result.changes) > 0
}