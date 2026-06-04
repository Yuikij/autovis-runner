import type { AutoVisDatabase } from "../db.js"
import { createId, now } from "./common.js"
import type { ExecutionRun, HumanHandoffRequest } from "@autovis/shared"

export class RunStateService {
  private readonly subscribers = new Map<string, Set<(run: ExecutionRun) => void>>()
  private readonly liveViewportSubscribers = new Map<string, Set<(chunk: Uint8Array) => void>>()
  private readonly pendingRunHumanInputs = new Map<
    string,
    { handoffId: string; resolve: (value: string) => void; reject: (error: Error) => void }
  >()

  constructor(private readonly db: AutoVisDatabase) {}

  public saveRunSnapshot(run: ExecutionRun) {
    this.db.upsertRun(run)
  }

  public getRunSnapshot(runId: string) {
    return this.db.getRun(runId)
  }

  public async getRun(runId: string) {
    return this.getRunSnapshot(runId)
  }

  public notifyRun(run: ExecutionRun) {
    this.subscribers.get(run.id)?.forEach((listener) => listener(run))
  }

  public notifyLiveViewport(runId: string, chunk: Uint8Array) {
    this.liveViewportSubscribers.get(runId)?.forEach((listener) => listener(chunk))
  }

  public subscribe(runId: string, listener: (run: ExecutionRun) => void) {
    const set = this.subscribers.get(runId) ?? new Set<(run: ExecutionRun) => void>()
    set.add(listener)
    this.subscribers.set(runId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.subscribers.delete(runId)
      }
    }
  }

  public subscribeLiveViewport(runId: string, listener: (chunk: Uint8Array) => void) {
    const set = this.liveViewportSubscribers.get(runId) ?? new Set<(chunk: Uint8Array) => void>()
    set.add(listener)
    this.liveViewportSubscribers.set(runId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.liveViewportSubscribers.delete(runId)
      }
    }
  }

  public async requestRunHumanInput(
    run: ExecutionRun,
    request: Omit<HumanHandoffRequest, "id" | "kind" | "createdAt">,
  ) {
    const handoffId = createId("handoff")
    run.status = "awaiting_human"
    run.pendingHumanHandoff = {
      id: handoffId,
      kind: "text_input",
      createdAt: now(),
      ...request,
    }
    this.saveRunSnapshot(run)
    this.notifyRun(run)

    return await new Promise<string>((resolve, reject) => {
      this.pendingRunHumanInputs.set(run.id, { handoffId, resolve, reject })
    })
  }

  public rejectPendingHumanInput(runId: string, reason: string) {
    const pending = this.pendingRunHumanInputs.get(runId)
    if (!pending) return
    this.pendingRunHumanInputs.delete(runId)
    try {
      pending.reject(new Error(reason))
    } catch {
      // ignore
    }
  }

  public async submitRunHumanInput(runId: string, handoffId: string, value: string) {
    const run = this.getRunSnapshot(runId)
    if (!run) {
      throw new Error("Run not found")
    }
    if (run.status !== "awaiting_human" || !run.pendingHumanHandoff) {
      throw new Error("当前运行未在等待人工输入。")
    }
    const pending = this.pendingRunHumanInputs.get(runId)
    if (!pending || pending.handoffId !== handoffId || run.pendingHumanHandoff.id !== handoffId) {
      throw new Error("人工输入请求已失效，请重新执行。")
    }
    pending.resolve(value)
    return this.getRunSnapshot(runId) ?? run
  }

  public async waitForRunCompletion(runId: string): Promise<ExecutionRun> {
    for (;;) {
      const run = this.getRunSnapshot(runId)
      if (!run) {
        return {
          id: runId,
          projectId: "",
          testCaseId: "",
          scriptId: "",
          kind: "execution",
          status: "failed",
          startedAt: now(),
          finishedAt: now(),
          currentViewport: "",
          logs: ["运行记录在执行完成前被清理。"],
          steps: [],
          artifacts: [],
          testBaseUrl: "",
        }
      }
      if (
        run.status === "passed" ||
        run.status === "failed" ||
        run.status === "cancelled" ||
        run.status === "interrupted"
      ) {
        return run
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}
