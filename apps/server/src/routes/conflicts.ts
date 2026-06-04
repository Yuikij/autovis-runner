import type { ConflictTaskResponse, TaskKind } from "@autovis/shared"

export type TaskConflictError = Error & {
  code?: string
  conflictId?: string
  conflictKind?: string
  conflictStatus?: string
}

const taskKinds = new Set<TaskKind>(["agent", "run", "task-run", "recorder"])

const isTaskKind = (value: unknown): value is TaskKind => typeof value === "string" && taskKinds.has(value as TaskKind)

export const isTaskConflictError = (error: unknown): error is TaskConflictError => {
  if (!error || typeof error !== "object") {
    return false
  }

  const candidate = error as TaskConflictError
  return candidate.code === "TASK_CONFLICT" && typeof candidate.conflictId === "string" && candidate.conflictId.length > 0
}

export const buildTaskConflictResponse = (error: TaskConflictError): ConflictTaskResponse => ({
  conflict: true,
  kind: isTaskKind(error.conflictKind) ? error.conflictKind : "run",
  id: error.conflictId ?? "",
  status: typeof error.conflictStatus === "string" && error.conflictStatus.length > 0 ? error.conflictStatus : "running",
})