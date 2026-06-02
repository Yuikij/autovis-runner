import { type TaskKind } from "@autovis/shared"

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
}

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
  private readonly controllers = new Map<string, TaskController>()

  public create(opts: CreateOptions): TaskController {
    const ctrl = makeController(opts)
    this.controllers.set(ctrl.id, ctrl)
    return ctrl
  }

  public get(id: string): TaskController | undefined {
    return this.controllers.get(id)
  }

  public has(id: string): boolean {
    return this.controllers.has(id)
  }

  public unregister(id: string): void {
    this.controllers.delete(id)
  }

  public list(): TaskController[] {
    return Array.from(this.controllers.values())
  }

  public listByKind(kind: TaskKind): TaskController[] {
    return this.list().filter((ctrl) => ctrl.kind === kind)
  }

  public findActiveForCase(kind: TaskKind, testCaseId: string): TaskController | undefined {
    return this.list().find((ctrl) => ctrl.kind === kind && ctrl.testCaseId === testCaseId)
  }
}

export const taskControlRegistry = new TaskControlRegistry()
