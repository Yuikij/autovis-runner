import type { AutoVisDatabase } from "../db.js"
import { createId, now } from "./common.js"
import type { TaskControlRegistry } from "./task-control.js"
import type { RunService } from "./run.service.js"
import type {
  Task,
  TaskModeConfig,
  TaskRun,
  StartTaskRunRequest,
  AgentSession,
} from "@autovis/shared"

function describeTaskMode(mode: TaskModeConfig): string {
  switch (mode.kind) {
    case "oneshot":
      return "oneshot"
    case "polling":
      return `polling(interval=${mode.intervalMs}ms,max=${mode.maxAttempts},stopOn=${mode.stopOn ?? "success"},attemptTimeout=${mode.attemptTimeoutMs ?? "(runner default)"})`
    case "deadline":
      return `deadline(at=${mode.at},extra=${mode.extraTimeoutMs ?? 600000}ms)`
    default:
      return "(unknown)"
  }
}

export class TaskRunService {
  private readonly taskRunSubscribers = new Map<string, Set<(taskRun: TaskRun) => void>>()

  /** 注入后由 AgentService 填充，用于任务中无脚本用例的 AI 直接执行路径。 */
  public runDirectAgentForTask: ((opts: { projectId: string; testCaseId: string; targetUrlId?: string; taskRunId: string }) => Promise<AgentSession>) | null = null
  /** 注入后由 Store 填充，用于把子 run 的取消也记入 command log。 */
  public cancelRunCallback: ((runId: string) => boolean) | null = null
  /** 注入后由 AgentService 填充，用于取消正在运行的 agent。 */
  public cancelAgentCallback: ((sessionId: string) => boolean) | null = null
  /** 注入后由 AgentService 填充，用于查询 agent session 状态。 */
  public getAgentSessionCallback: ((sessionId: string) => AgentSession | undefined) | null = null

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly tasks: TaskControlRegistry,
    private readonly runService: RunService,
  ) {}

  public listActiveTaskRuns(projectId?: string): TaskRun[] {
    return this.tasks
      .listByKind("task-run")
      .map((ctrl) => this.db.getTaskRun(ctrl.id))
      .filter((taskRun): taskRun is TaskRun => Boolean(taskRun) && (!projectId || taskRun!.projectId === projectId))
  }

  public persistAndNotifyTaskRun(taskRun: TaskRun) {
    this.db.upsertTaskRun(taskRun)
    this.taskRunSubscribers.get(taskRun.id)?.forEach((listener) => listener(taskRun))
  }

  public subscribeTaskRun(taskRunId: string, listener: (taskRun: TaskRun) => void) {
    const set = this.taskRunSubscribers.get(taskRunId) ?? new Set<(taskRun: TaskRun) => void>()
    set.add(listener)
    this.taskRunSubscribers.set(taskRunId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.taskRunSubscribers.delete(taskRunId)
      }
    }
  }

  public createTaskRun(projectId: string, taskId: string, testBaseUrl: string, totalCount: number, targetUrlId?: string): TaskRun {
    return {
      id: createId("task_run"),
      projectId,
      taskId,
      status: "queued",
      targetUrlId,
      testBaseUrl,
      totalCount,
      queuedCount: totalCount,
      runningCount: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      runIds: [],
      logs: ["任务已创建，等待执行。"],
      startedAt: now(),
    }
  }

  private resolveTargetUrlOrThrow(projectId: string, targetUrlId?: string): { id?: string; url: string } {
    const resolved = this.db.resolveTargetUrl(projectId, targetUrlId)
    if (!resolved) {
      throw new Error("无法解析目标 URL：请先在项目设置中配置主域名或添加 TargetUrl。")
    }
    return resolved
  }

  public pauseTaskRun(taskRunId: string): boolean {
    const ctrl = this.tasks.get(taskRunId)
    if (!ctrl || ctrl.kind !== "task-run") return false
    if (!ctrl.pause()) return false
    const taskRun = this.db.getTaskRun(taskRunId)
    if (taskRun) {
      taskRun.status = "paused"
      this.persistAndNotifyTaskRun(taskRun)
    }
    return true
  }

  public resumeTaskRun(taskRunId: string): boolean {
    const ctrl = this.tasks.get(taskRunId)
    if (!ctrl || ctrl.kind !== "task-run") return false
    if (!ctrl.resume()) return false
    const taskRun = this.db.getTaskRun(taskRunId)
    if (taskRun) {
      taskRun.status = "running"
      this.persistAndNotifyTaskRun(taskRun)
    }
    return true
  }

  public cancelTaskRun(taskRunId: string): boolean {
    const ctrl = this.tasks.get(taskRunId)
    if (!ctrl || ctrl.kind !== "task-run") return false
    const taskRun = this.db.getTaskRun(taskRunId)
    if (taskRun) {
      taskRun.status = "cancelling"
      this.persistAndNotifyTaskRun(taskRun)
    }
    const childRun = taskRun?.currentRunId
    if (childRun) {
      this.cancelRunCallback?.(childRun) ?? this.runService.cancelRun(childRun)
    }
    const childAgent = taskRun?.currentAgentId
    if (childAgent) {
      this.cancelAgentCallback?.(childAgent)
    }
    return ctrl.cancel("Task run cancelled by user.")
  }

  public async waitForTaskRunCompletion(taskRunId: string): Promise<TaskRun> {
    for (;;) {
      const taskRun = this.db.getTaskRun(taskRunId)
      if (!taskRun) {
        throw new Error("Task run not found")
      }
      if (
        taskRun.status === "passed" ||
        taskRun.status === "failed" ||
        taskRun.status === "cancelled" ||
        taskRun.status === "interrupted"
      ) {
        return taskRun
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  public async waitForAgentCompletion(sessionId: string): Promise<AgentSession> {
    for (;;) {
      const session = this.getAgentSessionCallback?.(sessionId)
      if (!session) {
        throw new Error("Agent session not found")
      }
      if (session.status === "completed" || session.status === "cancelled" || session.status === "error" || session.status === "interrupted") {
        return session
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  public async startTaskRun(request: StartTaskRunRequest): Promise<TaskRun> {
    const task = this.db.getTask(request.taskId)
    if (!task) {
      throw new Error("Task not found")
    }

    const effectiveTaskMode: TaskModeConfig = request.taskMode ?? task.executionMode ?? { kind: "oneshot" }
    console.log(`[task-run] startTaskRun project=${request.projectId} task=${request.taskId} mode=${describeTaskMode(effectiveTaskMode)} scheduleTriggerId=${request.scheduleTriggerId ?? "(none)"} parentTaskRunId=${request.parentTaskRunId ?? "(none)"} attemptNo=${request.attemptNo ?? 1}`)

    if (effectiveTaskMode.kind === "polling" && !request.parentTaskRunId) {
      const firstAttempt = await this.runTaskRunOnce(task, {
        projectId: request.projectId,
        taskId: request.taskId,
        scheduleTriggerId: request.scheduleTriggerId,
        attemptNo: request.attemptNo ?? 1,
        parentTaskRunId: undefined,
        effectiveTaskMode,
        scriptTimeoutMs: effectiveTaskMode.attemptTimeoutMs,
      })
      console.log(`[task-run] polling chain started taskRunId=${firstAttempt.id} maxAttempts=${effectiveTaskMode.maxAttempts} intervalMs=${effectiveTaskMode.intervalMs} stopOn=${effectiveTaskMode.stopOn ?? "success"}`)
      void this.driveTaskPollingChain(firstAttempt, effectiveTaskMode, task, request)
      return firstAttempt
    }

    return this.runTaskRunOnce(task, {
      projectId: request.projectId,
      taskId: request.taskId,
      scheduleTriggerId: request.scheduleTriggerId,
      attemptNo: request.attemptNo,
      parentTaskRunId: request.parentTaskRunId,
      effectiveTaskMode,
      scriptTimeoutMs: this.computeScriptTimeoutMsForMode(effectiveTaskMode),
    })
  }

  private computeScriptTimeoutMsForMode(mode: TaskModeConfig): number | undefined {
    if (mode.kind === "deadline") {
      const targetMs = Date.parse(mode.at)
      const extra = mode.extraTimeoutMs ?? 10 * 60 * 1000
      if (Number.isFinite(targetMs)) {
        const remaining = Math.max(0, targetMs - Date.now())
        return remaining + extra
      }
      return undefined
    }
    if (mode.kind === "polling") {
      return mode.attemptTimeoutMs
    }
    return undefined
  }

  private async driveTaskPollingChain(
    firstAttempt: TaskRun,
    mode: TaskModeConfig,
    task: Task,
    request: StartTaskRunRequest,
  ) {
    if (mode.kind !== "polling") return
    const maxAttempts = Math.max(1, mode.maxAttempts)
    const intervalMs = Math.max(0, mode.intervalMs)
    const stopOn = mode.stopOn ?? "success"
    let previous = firstAttempt
    let attemptNo = (previous.attemptNo ?? 1)

    while (attemptNo < maxAttempts) {
      const finished = await this.waitForTaskRunCompletion(previous.id)
      console.log(`[polling] attempt#${attemptNo} taskRun=${previous.id} finished status=${finished.status} passed=${finished.passedCount}/${finished.totalCount}`)
      if (finished.status === "cancelled" || finished.status === "interrupted") {
        console.log(`[polling] chain abort because attempt#${attemptNo} status=${finished.status}`)
        return
      }
      if (stopOn === "success" && finished.status === "passed") {
        console.log(`[polling] chain done (stopOn=success met) after attempt#${attemptNo}`)
        return
      }
      attemptNo += 1
      if (intervalMs > 0) {
        console.log(`[polling] sleeping ${intervalMs}ms before attempt#${attemptNo}`)
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
      console.log(`[polling] starting attempt#${attemptNo} (parent=${previous.id})`)

      const next = await this.runTaskRunOnce(task, {
        projectId: request.projectId,
        taskId: request.taskId,
        scheduleTriggerId: request.scheduleTriggerId,
        attemptNo,
        parentTaskRunId: previous.id,
        effectiveTaskMode: mode,
        scriptTimeoutMs: mode.attemptTimeoutMs,
      }).catch((err) => {
        console.warn(`[polling] attempt#${attemptNo} runTaskRunOnce failed:`, err instanceof Error ? err.stack || err.message : err)
        return undefined
      })
      if (!next) {
        console.log(`[polling] chain aborted: attempt#${attemptNo} could not start`)
        return
      }
      console.log(`[polling] attempt#${attemptNo} started taskRunId=${next.id}`)
      previous = next
    }
    console.log(`[polling] chain exhausted maxAttempts=${maxAttempts}`)
  }

  private async runTaskRunOnce(
    task: Task,
    opts: {
      projectId: string
      taskId: string
      scheduleTriggerId?: string
      attemptNo?: number
      parentTaskRunId?: string
      effectiveTaskMode: TaskModeConfig
      scriptTimeoutMs?: number
    },
  ): Promise<TaskRun> {
    const resolvedItems = task.items.map((item) => {
      const testCase = this.db.getTestCase(item.caseId)
      return { item, testCase }
    })

    const displayTarget = this.resolveTargetUrlOrThrow(opts.projectId, task.items[0]?.targetUrlId)
    const taskRun = this.createTaskRun(opts.projectId, opts.taskId, displayTarget.url, resolvedItems.length, displayTarget.id)
    taskRun.scheduleTriggerId = opts.scheduleTriggerId
    taskRun.attemptNo = opts.attemptNo
    taskRun.parentTaskRunId = opts.parentTaskRunId
    taskRun.effectiveTaskMode = opts.effectiveTaskMode
    console.log(`[task-run] runTaskRunOnce taskRunId=${taskRun.id} items=${resolvedItems.length} effectiveMode=${describeTaskMode(opts.effectiveTaskMode)} scriptTimeoutMs=${opts.scriptTimeoutMs ?? "(runner default 300s)"} attemptNo=${opts.attemptNo ?? 1}`)
    if (opts.attemptNo && opts.attemptNo > 1) {
      taskRun.logs.push(`polling · 第 ${opts.attemptNo} 轮（上一轮: ${opts.parentTaskRunId ?? "?"}）。`)
    }
    if (opts.effectiveTaskMode.kind === "deadline") {
      taskRun.logs.push(`deadline · 目标时刻 ${opts.effectiveTaskMode.at}，脚本内请使用 schedule.waitUntil 卡到精确时间。`)
    }

    if (resolvedItems.length === 0) {
      taskRun.status = "failed"
      taskRun.finishedAt = now()
      taskRun.logs.push("该任务没有编排任何测试用例。")
      this.persistAndNotifyTaskRun(taskRun)
      return taskRun
    }

    this.persistAndNotifyTaskRun(taskRun)

    const taskController = this.tasks.create({
      kind: "task-run",
      id: taskRun.id,
      projectId: opts.projectId,
    })

    void (async () => {
      taskRun.status = "running"
      this.persistAndNotifyTaskRun(taskRun)
      try {
        for (const [index, { item, testCase }] of resolvedItems.entries()) {
          if (taskController.signal.aborted) break
          await taskController.waitIfPaused()

          if (!testCase) {
            taskRun.skippedCount += 1
            taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
            taskRun.logs.push(`跳过第 ${index + 1} 项：引用的用例不存在。`)
            this.persistAndNotifyTaskRun(taskRun)
            continue
          }
          if (!testCase.latestScriptId) {
            if (this.runDirectAgentForTask) {
              taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
              taskRun.runningCount = 1
              taskRun.logs.push(`开始 AI 直接执行 ${testCase.caseCode}（无脚本）。`)
              this.persistAndNotifyTaskRun(taskRun)
              let agentSession: AgentSession | undefined
              try {
                agentSession = await this.runDirectAgentForTask({
                  projectId: opts.projectId,
                  testCaseId: testCase.id,
                  targetUrlId: item.targetUrlId,
                  taskRunId: taskRun.id,
                })
                taskRun.currentAgentId = agentSession.id
                taskRun.lastAgentId = agentSession.id
                taskRun.currentRunId = agentSession.latestRunId ?? agentSession.warmupRunId
                this.persistAndNotifyTaskRun(taskRun)
                const finishedAgent = await this.waitForAgentCompletion(agentSession.id)
                taskRun.runningCount = 0
                taskRun.currentRunId = undefined
                taskRun.currentAgentId = undefined
                if (finishedAgent.status === "completed") {
                  taskRun.passedCount += 1
                  taskRun.logs.push(`${testCase.caseCode} AI 直接执行成功。`)
                } else if (finishedAgent.status === "cancelled") {
                  taskRun.logs.push(`${testCase.caseCode} 已取消。`)
                } else {
                  taskRun.failedCount += 1
                  taskRun.logs.push(`${testCase.caseCode} AI 直接执行失败。`)
                }
              } catch (agentErr) {
                taskRun.runningCount = 0
                taskRun.currentRunId = undefined
                taskRun.currentAgentId = undefined
                taskRun.failedCount += 1
                taskRun.logs.push(`${testCase.caseCode} AI 直接执行异常: ${(agentErr as Error).message}`)
              }
              this.persistAndNotifyTaskRun(taskRun)
            } else {
              taskRun.skippedCount += 1
              taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
              taskRun.logs.push(`跳过 ${testCase.caseCode}：缺少最新脚本。`)
              this.persistAndNotifyTaskRun(taskRun)
            }
            continue
          }

          const run = await this.runService.startRun({
            projectId: opts.projectId,
            testCaseId: testCase.id,
            scriptId: testCase.latestScriptId,
            targetUrlId: item.targetUrlId,
            taskRunId: taskRun.id,
            batchOrder: index + 1,
            scriptTimeoutMs: opts.scriptTimeoutMs,
          })
          taskRun.runIds.push(run.id)
          taskRun.currentRunId = run.id
          taskRun.queuedCount = Math.max(0, taskRun.totalCount - taskRun.runIds.length - taskRun.skippedCount)
          taskRun.runningCount = 1
          taskRun.logs.push(`开始执行 ${testCase.caseCode}。`)
          this.persistAndNotifyTaskRun(taskRun)

          const finishedRun = await this.runService.getRunStateService().waitForRunCompletion(run.id)
          taskRun.runningCount = 0
          taskRun.currentRunId = undefined
          if (finishedRun.status === "passed") {
            taskRun.passedCount += 1
            taskRun.logs.push(`${testCase.caseCode} 执行成功。`)
          } else if (finishedRun.status === "cancelled") {
            taskRun.logs.push(`${testCase.caseCode} 已取消。`)
          } else {
            taskRun.failedCount += 1
            taskRun.logs.push(`${testCase.caseCode} 执行失败。`)
          }
          this.persistAndNotifyTaskRun(taskRun)
        }

        if (taskController.signal.aborted) {
          taskRun.status = "cancelled"
          taskRun.logs.push("任务已取消。")
        } else {
          taskRun.status = taskRun.failedCount > 0 ? "failed" : "passed"
        }
      } catch (error) {
        taskRun.status = taskController.signal.aborted ? "cancelled" : "failed"
        taskRun.logs.push(`任务执行异常: ${(error as Error).message}`)
      } finally {
        taskRun.finishedAt = now()
        taskRun.currentRunId = undefined
        taskRun.currentAgentId = undefined
        taskRun.runningCount = 0
        const isPollingMidAttempt = opts.effectiveTaskMode.kind === "polling" && !!opts.parentTaskRunId
        if (!isPollingMidAttempt) {
          this.db.updateTaskLastRun({
            taskId: task.id,
            lastRunId: taskRun.id,
            lastStatus: taskRun.status,
            lastRunAt: taskRun.finishedAt,
          })
        }
        this.persistAndNotifyTaskRun(taskRun)
        this.tasks.unregister(taskRun.id)
      }
    })()

    return taskRun
  }
}
