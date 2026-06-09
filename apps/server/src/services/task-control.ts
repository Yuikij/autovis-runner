import type { PersistedTaskControlCommand, TaskControlAction, TaskKind } from "@autovis/shared"

import type { AutoVisDatabase } from "../db.js"
import { now } from "../db/shared.js"
import type { TaskRecoveryPolicy, TaskLeaseStatus } from "../db/shared.js"

export type TaskControllerState = "running" | "paused" | "cancelling"

export interface TaskController {
  readonly kind: TaskKind
  readonly id: string
  readonly projectId?: string
  readonly testCaseId?: string
  readonly signal: AbortSignal
  state: TaskControllerState
  waitIfPaused(): Promise<void>
  pause(): boolean
  resume(): boolean
  cancel(reason?: string): boolean
  onCancel(handler: () => void | Promise<void>): void
  onPauseChange(handler: (paused: boolean) => void): () => void
}

interface CreateOptions {
  kind: TaskKind
  id: string
  projectId?: string
  testCaseId?: string
  recoveryPolicy?: TaskRecoveryPolicy
  request?: Record<string, unknown>
  buildCheckpoint?: () => Record<string, unknown>
  applyAction?: (action: TaskControlAction) => boolean | Promise<boolean>
  onLeaseLost?: (reason: string) => void | Promise<void>
  leaseDurationMs?: number
}

interface ManagedTaskController {
  controller: TaskController
  recoveryPolicy: TaskRecoveryPolicy
  request?: Record<string, unknown>
  buildCheckpoint?: () => Record<string, unknown>
  applyAction?: (action: TaskControlAction) => boolean | Promise<boolean>
  onLeaseLost?: (reason: string) => void | Promise<void>
  leaseDurationMs: number
  heartbeatTimer?: ReturnType<typeof setInterval>
  commandTimer?: ReturnType<typeof setInterval>
  processingCommands: boolean
}

const DEFAULT_LEASE_DURATION_MS = 15_000
const DEFAULT_HEARTBEAT_MS = 5_000
const DEFAULT_COMMAND_POLL_MS = 1_000

function makeController(opts: CreateOptions): TaskController {
  const abortController = new AbortController()
  let state: TaskControllerState = "running"
  let pausePromise: Promise<void> | null = null
  let pauseResolver: (() => void) | null = null
  const cancelHandlers: Array<() => void | Promise<void>> = []
  const pauseListeners = new Set<(paused: boolean) => void>()

  const notifyPause = (paused: boolean) => {
    for (const listener of pauseListeners) {
      try {
        listener(paused)
      } catch {
        // listener errors should not affect the controller
      }
    }
  }

  const ctrl: TaskController = {
    kind: opts.kind,
    id: opts.id,
    projectId: opts.projectId,
    testCaseId: opts.testCaseId,
    signal: abortController.signal,
    get state() {
      return state
    },
    set state(value: TaskControllerState) {
      state = value
    },
    async waitIfPaused() {
      if (abortController.signal.aborted) {
        throw new Error("Task cancelled")
      }
      if (pausePromise) {
        await pausePromise
      }
      if (abortController.signal.aborted) {
        throw new Error("Task cancelled")
      }
    },
    pause() {
      if (state !== "running") return false
      state = "paused"
      pausePromise = new Promise<void>((resolve) => {
        pauseResolver = resolve
      })
      notifyPause(true)
      return true
    },
    resume() {
      if (state !== "paused") return false
      state = "running"
      const resolver = pauseResolver
      pauseResolver = null
      pausePromise = null
      notifyPause(false)
      resolver?.()
      return true
    },
    cancel(reason?: string) {
      if (abortController.signal.aborted) return false
      state = "cancelling"
      abortController.abort(reason ? new Error(reason) : undefined)
      // If currently paused, release the gate so the loop can observe the abort
      const resolver = pauseResolver
      pauseResolver = null
      pausePromise = null
      resolver?.()
      // Fire cancel side-effects (e.g. closing browser, rejecting human-input promises)
      for (const handler of cancelHandlers) {
        try {
          const ret = handler()
          if (ret && typeof (ret as Promise<unknown>).then === "function") {
            void (ret as Promise<unknown>).catch(() => undefined)
          }
        } catch {
          // ignore
        }
      }
      return true
    },
    onCancel(handler) {
      cancelHandlers.push(handler)
    },
    onPauseChange(handler) {
      pauseListeners.add(handler)
      return () => {
        pauseListeners.delete(handler)
      }
    },
  }
  return ctrl
}

export class TaskControlRegistry {
  private readonly controllers = new Map<string, ManagedTaskController>()

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly leaseOwner = `lease_owner_${process.pid}_${Math.random().toString(36).slice(2, 10)}`,
  ) {}

  private buildCheckpoint(managed: ManagedTaskController) {
    return {
      controllerState: managed.controller.state,
      signalAborted: managed.controller.signal.aborted,
      projectId: managed.controller.projectId ?? null,
      testCaseId: managed.controller.testCaseId ?? null,
      updatedAt: now(),
      ...(managed.buildCheckpoint?.() ?? {}),
    }
  }

  private stopLoops(managed: ManagedTaskController) {
    if (managed.heartbeatTimer) {
      clearInterval(managed.heartbeatTimer)
      managed.heartbeatTimer = undefined
    }
    if (managed.commandTimer) {
      clearInterval(managed.commandTimer)
      managed.commandTimer = undefined
    }
  }

  private async processPendingCommandsFor(managed: ManagedTaskController) {
    if (managed.processingCommands) return
    managed.processingCommands = true
    try {
      const commands = this.db.listRequestedTaskControlCommandsForTask(managed.controller.kind, managed.controller.id)
      for (const command of commands) {
        let applied = false
        let note: string | undefined
        try {
          if (managed.applyAction) {
            applied = await managed.applyAction(command.action)
          } else {
            applied = this.applyControllerAction(managed.controller, command.action)
          }
          if (!applied) {
            note = "Task controller unavailable or state transition rejected."
          }
        } catch (error) {
          note = error instanceof Error ? error.message : String(error)
        }
        this.db.resolveTaskControlCommand(command.id, applied ? "applied" : "rejected", note)
      }
    } finally {
      managed.processingCommands = false
    }
  }

  private applyControllerAction(controller: TaskController, action: PersistedTaskControlCommand["action"]) {
    switch (action) {
      case "pause":
        return controller.pause()
      case "resume":
        return controller.resume()
      case "cancel":
        return controller.cancel("Task cancelled by command log consumer.")
      default:
        return false
    }
  }

  private heartbeat(managed: ManagedTaskController) {
    const ok = this.db.renewTaskLease({
      taskKind: managed.controller.kind,
      taskId: managed.controller.id,
      leaseOwner: this.leaseOwner,
      leaseDurationMs: managed.leaseDurationMs,
      checkpoint: this.buildCheckpoint(managed),
    })
    if (!ok) {
      this.stopLoops(managed)
      managed.controller.cancel("Task lease lost")
      this.controllers.delete(managed.controller.id)
      void managed.onLeaseLost?.("Task lease lost")
    }
  }

  private startLoops(managed: ManagedTaskController) {
    const heartbeatTimer = setInterval(() => this.heartbeat(managed), DEFAULT_HEARTBEAT_MS)
    heartbeatTimer.unref?.()
    managed.heartbeatTimer = heartbeatTimer

    const commandTimer = setInterval(() => {
      void this.processPendingCommandsFor(managed)
    }, DEFAULT_COMMAND_POLL_MS)
    commandTimer.unref?.()
    managed.commandTimer = commandTimer

    void this.processPendingCommandsFor(managed)
  }

  public create(opts: CreateOptions): TaskController {
    const ctrl = makeController(opts)
    const managed: ManagedTaskController = {
      controller: ctrl,
      recoveryPolicy: opts.recoveryPolicy ?? "restart",
      request: opts.request,
      buildCheckpoint: opts.buildCheckpoint,
      applyAction: opts.applyAction,
      onLeaseLost: opts.onLeaseLost,
      leaseDurationMs: opts.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
      processingCommands: false,
    }

    const acquired = this.db.acquireTaskLease({
      taskKind: ctrl.kind,
      taskId: ctrl.id,
      recoveryPolicy: managed.recoveryPolicy,
      leaseOwner: this.leaseOwner,
      leaseDurationMs: managed.leaseDurationMs,
      checkpoint: this.buildCheckpoint(managed),
      request: managed.request,
    })
    if (!acquired) {
      const error = new Error("该任务已有一个正在运行的实例（任务锁被占用）。如果确认上一次执行已经中断，请稍候片刻让其锁自动过期后重试，或先取消进行中的任务。") as Error & { code?: string }
      error.code = "TASK_LEASE_CONFLICT"
      throw error
    }

    this.controllers.set(ctrl.id, managed)
    this.startLoops(managed)
    return ctrl
  }

  public get(id: string): TaskController | undefined {
    return this.controllers.get(id)?.controller
  }

  public has(id: string): boolean {
    return this.controllers.has(id)
  }

  public poke(taskKind: TaskKind, taskId: string): void {
    const managed = this.controllers.get(taskId)
    if (!managed || managed.controller.kind !== taskKind) return
    void this.processPendingCommandsFor(managed)
  }

  public unregister(id: string, finalStatus: Exclude<TaskLeaseStatus, "active"> = "released"): void {
    const managed = this.controllers.get(id)
    if (!managed) return
    this.stopLoops(managed)
    this.db.finalizeTaskLease({
      taskKind: managed.controller.kind,
      taskId: managed.controller.id,
      leaseOwner: this.leaseOwner,
      status: finalStatus,
      checkpoint: this.buildCheckpoint(managed),
    })
    this.controllers.delete(id)
  }

  public list(): TaskController[] {
    return Array.from(this.controllers.values()).map((item) => item.controller)
  }

  public listByKind(kind: TaskKind): TaskController[] {
    return this.list().filter((ctrl) => ctrl.kind === kind)
  }

  public findActiveForCase(kind: TaskKind, testCaseId: string): TaskController | undefined {
    return this.list().find((ctrl) => ctrl.kind === kind && ctrl.testCaseId === testCaseId)
  }
}
