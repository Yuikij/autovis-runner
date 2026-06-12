import type { AutoVisDatabase } from "../db.js"
import { createId, now } from "./common.js"
import { log } from "../log.js"
import type { TaskControlRegistry } from "./task-control.js"
import type { RunService } from "./run.service.js"
import type {
  Task,
  TaskModeConfig,
  TaskRun,
  StartTaskRunRequest,
  AgentSession,
  RuntimeOutput,
} from "@autovis/shared"

/** 任务链中跨用例传递的会话状态：登录态 + 停留页面 + 已产出的 outputs。 */
interface TaskChainState {
  storageStateJson?: string
  landingUrl?: string
  runtimeOutputs: RuntimeOutput[]
}

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
  public runDirectAgentForTask: ((opts: { projectId: string; testCaseId: string; targetUrlId?: string; taskRunId: string; stealth?: boolean }) => Promise<AgentSession>) | null = null
  /** 注入后由 Store 填充，用于把子 run 的取消也记入 command log。 */
  public cancelRunCallback: ((runId: string) => boolean) | null = null
  /** 注入后由 AgentService 填充，用于取消正在运行的 agent。 */
  public cancelAgentCallback: ((sessionId: string) => boolean) | null = null
  /** 注入后由 AgentService 填充，用于查询 agent session 状态。 */
  public getAgentSessionCallback: ((sessionId: string) => AgentSession | undefined) | null = null
  /** 注入后由 AgentService 填充，用于恢复 direct-agent 子任务。 */
  public recoverAgentCallback: ((sessionId: string) => Promise<AgentSession | undefined>) | null = null

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

  private markTaskRunInterrupted(taskRunId: string, reason: string) {
    const taskRun = this.db.getTaskRun(taskRunId)
    if (!taskRun) return
    if (taskRun.status === "passed" || taskRun.status === "failed" || taskRun.status === "cancelled" || taskRun.status === "interrupted") {
      return
    }
    taskRun.status = "interrupted"
    taskRun.finishedAt = taskRun.finishedAt || now()
    taskRun.logs.push(`[${new Date().toLocaleTimeString()}] ${reason}`)
    taskRun.currentRunId = undefined
    taskRun.currentAgentId = undefined
    taskRun.runningCount = 0
    this.persistAndNotifyTaskRun(taskRun)
  }

  private createManagedTaskRunController(
    taskRun: TaskRun,
    opts: {
      projectId: string
      taskId: string
      scheduleTriggerId?: string
      attemptNo?: number
      parentTaskRunId?: string
      effectiveTaskMode: TaskModeConfig
      scriptTimeoutMs?: number
    },
  ) {
    return this.tasks.create({
      kind: "task-run",
      id: taskRun.id,
      projectId: opts.projectId,
      recoveryPolicy: "resume",
      request: {
        projectId: opts.projectId,
        taskId: opts.taskId,
        scheduleTriggerId: opts.scheduleTriggerId,
        attemptNo: opts.attemptNo,
        parentTaskRunId: opts.parentTaskRunId,
        taskMode: opts.effectiveTaskMode,
        scriptTimeoutMs: opts.scriptTimeoutMs,
      },
      buildCheckpoint: () => ({
        status: taskRun.status,
        totalCount: taskRun.totalCount,
        queuedCount: taskRun.queuedCount,
        runningCount: taskRun.runningCount,
        passedCount: taskRun.passedCount,
        failedCount: taskRun.failedCount,
        skippedCount: taskRun.skippedCount,
        currentRunId: taskRun.currentRunId ?? null,
        currentAgentId: taskRun.currentAgentId ?? null,
        lastAgentId: taskRun.lastAgentId ?? null,
        runIds: taskRun.runIds,
        attemptNo: taskRun.attemptNo ?? null,
      }),
      applyAction: (action) => {
        switch (action) {
          case "pause":
            return this.pauseTaskRun(taskRun.id)
          case "resume":
            return this.resumeTaskRun(taskRun.id)
          case "cancel":
            return this.cancelTaskRun(taskRun.id)
          default:
            return false
        }
      },
      onLeaseLost: (reason) => {
        this.markTaskRunInterrupted(taskRun.id, reason)
      },
    })
  }

  private applyRunResult(taskRun: TaskRun, testCaseCode: string, status: string) {
    taskRun.runningCount = 0
    taskRun.currentRunId = undefined
    if (status === "passed") {
      taskRun.passedCount += 1
      taskRun.logs.push(`${testCaseCode} 执行成功。`)
      return
    }
    if (status === "cancelled") {
      taskRun.logs.push(`${testCaseCode} 已取消。`)
      return
    }
    taskRun.failedCount += 1
    taskRun.logs.push(`${testCaseCode} 执行失败。`)
  }

  private applyAgentResult(taskRun: TaskRun, testCaseCode: string, status: string) {
    taskRun.runningCount = 0
    taskRun.currentRunId = undefined
    taskRun.currentAgentId = undefined
    if (status === "completed") {
      taskRun.passedCount += 1
      taskRun.logs.push(`${testCaseCode} AI 直接执行成功。`)
      return
    }
    if (status === "cancelled") {
      taskRun.logs.push(`${testCaseCode} 已取消。`)
      return
    }
    taskRun.failedCount += 1
    taskRun.logs.push(`${testCaseCode} AI 直接执行失败。`)
  }

  /** 快速失败：某个用例失败后终止任务，剩余未执行的用例全部计入 skipped。 */
  private failFastSkipRemaining(taskRun: TaskRun, remainingCount: number, failedCaseCode: string) {
    if (remainingCount > 0) {
      taskRun.skippedCount += remainingCount
      taskRun.queuedCount = 0
      taskRun.logs.push(`快速失败：${failedCaseCode} 执行失败，跳过剩余 ${remainingCount} 个用例并终止任务。`)
    } else {
      taskRun.logs.push(`快速失败：${failedCaseCode} 执行失败，终止任务。`)
    }
    this.persistAndNotifyTaskRun(taskRun)
  }

  private async executeTaskRunLoop(
    task: Task,
    taskRun: TaskRun,
    resolvedItems: Array<{ item: Task["items"][number]; testCase: ReturnType<AutoVisDatabase["getTestCase"]> }>,
    taskController: ReturnType<TaskRunService["createManagedTaskRunController"]>,
    opts: {
      projectId: string
      taskId: string
      scheduleTriggerId?: string
      attemptNo?: number
      parentTaskRunId?: string
      effectiveTaskMode: TaskModeConfig
      scriptTimeoutMs?: number
    },
    startIndex = 0,
  ) {
    void (async () => {
      if (taskRun.status !== "paused") {
        taskRun.status = "running"
        this.persistAndNotifyTaskRun(taskRun)
      }
      // 任务编排即显式执行链：用例自带前置一律跳过（前置仅服务于脚本生成与用例独立运行）。
      // chainState 在「续用会话」的相邻用例间传递登录态、停留页面与 outputs；快速失败时终止整条链。
      let chainState: TaskChainState | null = null
      try {
        for (let index = startIndex; index < resolvedItems.length; index += 1) {
          const { item, testCase } = resolvedItems[index]
          if (taskController.signal.aborted) break
          await taskController.waitIfPaused()

          if (!testCase) {
            taskRun.skippedCount += 1
            taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
            taskRun.logs.push(`跳过第 ${index + 1} 项：引用的用例不存在。`)
            this.persistAndNotifyTaskRun(taskRun)
            chainState = null
            continue
          }

          if (!testCase.latestScriptId) {
            if (this.runDirectAgentForTask) {
              taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
              taskRun.runningCount = 1
              taskRun.logs.push(`开始 AI 直接执行 ${testCase.caseCode}（无脚本）。`)
              this.persistAndNotifyTaskRun(taskRun)
              let agentFailed = false
              try {
                const agentSession = await this.runDirectAgentForTask({
                  projectId: opts.projectId,
                  testCaseId: testCase.id,
                  targetUrlId: item.targetUrlId,
                  taskRunId: taskRun.id,
                  stealth: item.stealth,
                })
                taskRun.currentAgentId = agentSession.id
                taskRun.lastAgentId = agentSession.id
                taskRun.currentRunId = agentSession.latestRunId ?? agentSession.warmupRunId
                this.persistAndNotifyTaskRun(taskRun)
                const finishedAgent = await this.waitForAgentCompletion(agentSession.id)
                this.applyAgentResult(taskRun, testCase.caseCode, finishedAgent.status)
                agentFailed = finishedAgent.status !== "completed"
              } catch (agentErr) {
                taskRun.runningCount = 0
                taskRun.currentRunId = undefined
                taskRun.currentAgentId = undefined
                taskRun.failedCount += 1
                taskRun.logs.push(`${testCase.caseCode} AI 直接执行异常: ${(agentErr as Error).message}`)
                agentFailed = true
              }
              this.persistAndNotifyTaskRun(taskRun)
              // AI 直接执行在独立沙盒中进行，无法向后续用例传递会话。
              chainState = null
              if (agentFailed && !taskController.signal.aborted) {
                this.failFastSkipRemaining(taskRun, resolvedItems.length - index - 1, testCase.caseCode)
                break
              }
            } else {
              taskRun.skippedCount += 1
              taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
              taskRun.logs.push(`跳过 ${testCase.caseCode}：缺少最新脚本。`)
              this.persistAndNotifyTaskRun(taskRun)
              chainState = null
            }
            continue
          }

          const wantsContinue = index > 0 && item.continueSession === true
          if (wantsContinue && !chainState) {
            taskRun.logs.push(`${testCase.caseCode} 配置了续用上一个用例的会话，但上游会话状态不可用（上一项非脚本执行或任务恢复后状态丢失），将以全新会话执行。`)
          }
          const activeChain = wantsContinue ? chainState : null
          // 仅当下一项配置了续用会话时才在本次 run 结束前捕获会话状态，避免无谓的 storage state 序列化。
          const nextWantsContinue = resolvedItems[index + 1]?.item.continueSession === true

          const run = await this.runService.startRun({
            projectId: opts.projectId,
            testCaseId: testCase.id,
            scriptId: testCase.latestScriptId,
            targetUrlId: item.targetUrlId,
            taskRunId: taskRun.id,
            batchOrder: index + 1,
            scriptTimeoutMs: opts.scriptTimeoutMs,
            skipPreconditions: true,
            stealthOverride: item.stealth,
            chain: {
              initialStorageStateJson: activeChain?.storageStateJson,
              initialLandingUrl: activeChain?.landingUrl,
              initialRuntimeOutputs: activeChain?.runtimeOutputs,
              captureChainState: nextWantsContinue,
            },
          })
          taskRun.runIds.push(run.id)
          taskRun.currentRunId = run.id
          taskRun.queuedCount = Math.max(0, taskRun.totalCount - taskRun.runIds.length - taskRun.skippedCount)
          taskRun.runningCount = 1
          taskRun.logs.push(`开始执行 ${testCase.caseCode}${activeChain ? "（续用上一个用例的会话）" : ""}。`)
          this.persistAndNotifyTaskRun(taskRun)

          const finishedRun = await this.runService.getRunStateService().waitForRunCompletion(run.id)
          this.applyRunResult(taskRun, testCase.caseCode, finishedRun.status)
          this.persistAndNotifyTaskRun(taskRun)

          if (finishedRun.status === "passed") {
            const captured = this.runService.consumeChainState(run.id)
            chainState = {
              storageStateJson: captured?.storageStateJson,
              landingUrl: captured?.landingUrl,
              runtimeOutputs: finishedRun.runtimeOutputs ?? [],
            }
          } else {
            chainState = null
            this.runService.consumeChainState(run.id)
            if (!taskController.signal.aborted && finishedRun.status === "failed") {
              this.failFastSkipRemaining(taskRun, resolvedItems.length - index - 1, testCase.caseCode)
              break
            }
          }
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
  }

  public async recoverTaskRun(taskRunId: string): Promise<TaskRun | undefined> {
    if (this.tasks.has(taskRunId)) {
      return this.db.getTaskRun(taskRunId)
    }

    const taskRun = this.db.getTaskRun(taskRunId)
    if (!taskRun) return undefined
    if (taskRun.status === "passed" || taskRun.status === "failed" || taskRun.status === "cancelled" || taskRun.status === "interrupted") {
      return taskRun
    }

    const leaseRequest = this.db.getTaskLease("task-run", taskRunId)?.request ?? {}
    const task = this.db.getTask(taskRun.taskId)
    if (!task) {
      throw new Error(`Task ${taskRun.taskId} not found for task run recovery`)
    }
    const effectiveTaskMode = (leaseRequest.taskMode as TaskModeConfig | undefined) ?? taskRun.effectiveTaskMode ?? task.executionMode ?? { kind: "oneshot" }
    const opts = {
      projectId: taskRun.projectId,
      taskId: taskRun.taskId,
      scheduleTriggerId: typeof leaseRequest.scheduleTriggerId === "string" ? leaseRequest.scheduleTriggerId : taskRun.scheduleTriggerId,
      attemptNo: typeof leaseRequest.attemptNo === "number" ? leaseRequest.attemptNo : taskRun.attemptNo,
      parentTaskRunId: typeof leaseRequest.parentTaskRunId === "string" ? leaseRequest.parentTaskRunId : taskRun.parentTaskRunId,
      effectiveTaskMode,
      scriptTimeoutMs: typeof leaseRequest.scriptTimeoutMs === "number" ? leaseRequest.scriptTimeoutMs : this.computeScriptTimeoutMsForMode(effectiveTaskMode),
    }
    const resolvedItems = task.items.map((item) => ({
      item,
      testCase: this.db.getTestCase(item.caseId),
    }))
    const taskController = this.createManagedTaskRunController(taskRun, opts)
    const previousStatus = taskRun.status
    taskRun.finishedAt = undefined
    taskRun.logs.push(`[${new Date().toLocaleTimeString()}] 检测到过期 lease，开始恢复任务执行。`)
    this.persistAndNotifyTaskRun(taskRun)

    if (taskRun.currentAgentId) {
      const currentAgent = this.getAgentSessionCallback?.(taskRun.currentAgentId)
      const currentLease = this.db.getTaskLease("agent", taskRun.currentAgentId)
      const leaseExpired = !currentLease?.leaseExpiresAt || Date.parse(currentLease.leaseExpiresAt) <= Date.now()
      if (currentAgent) {
        if (leaseExpired) {
          await this.recoverAgentCallback?.(currentAgent.id)
        }
        const finishedAgent = await this.waitForAgentCompletion(currentAgent.id)
        const testCaseCode = this.db.getTestCase(currentAgent.testCaseId)?.caseCode ?? currentAgent.testCaseId
        this.applyAgentResult(taskRun, testCaseCode, finishedAgent.status)
        this.persistAndNotifyTaskRun(taskRun)
      }
    }

    if (!taskRun.currentAgentId && taskRun.currentRunId) {
      const currentRun = this.db.getRun(taskRun.currentRunId)
      const currentLease = this.db.getTaskLease("run", taskRun.currentRunId)
      const leaseExpired = !currentLease?.leaseExpiresAt || Date.parse(currentLease.leaseExpiresAt) <= Date.now()
      if (currentRun) {
        if (currentRun.status !== "passed" && currentRun.status !== "failed" && currentRun.status !== "cancelled" && currentRun.status !== "interrupted" && leaseExpired) {
          await this.runService.recoverRun(currentRun.id)
        }
        const finishedRun = await this.runService.getRunStateService().waitForRunCompletion(currentRun.id)
        const testCaseCode = this.db.getTestCase(currentRun.testCaseId)?.caseCode ?? currentRun.testCaseId
        this.applyRunResult(taskRun, testCaseCode, finishedRun.status)
        this.persistAndNotifyTaskRun(taskRun)
      }
    }

    let startIndex = taskRun.passedCount + taskRun.failedCount + taskRun.skippedCount
    // 快速失败语义在恢复路径同样生效：已有失败则不再继续剩余用例。
    if (taskRun.failedCount > 0 && startIndex < resolvedItems.length) {
      this.failFastSkipRemaining(taskRun, resolvedItems.length - startIndex, "恢复前的用例")
      startIndex = resolvedItems.length
    }
    if (previousStatus === "paused") {
      taskController.pause()
      taskRun.status = "paused"
      this.persistAndNotifyTaskRun(taskRun)
    }
    this.executeTaskRunLoop(task, taskRun, resolvedItems, taskController, opts, startIndex)
    return taskRun
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
    log.info("task_run.started", {
      projectId: request.projectId,
      taskId: request.taskId,
      mode: describeTaskMode(effectiveTaskMode),
      scheduleTriggerId: request.scheduleTriggerId ?? null,
      parentTaskRunId: request.parentTaskRunId ?? null,
      attemptNo: request.attemptNo ?? 1,
    })

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
      log.info("task_run.polling_chain_started", {
        taskRunId: firstAttempt.id,
        projectId: firstAttempt.projectId,
        taskId: firstAttempt.taskId,
        maxAttempts: effectiveTaskMode.maxAttempts,
        intervalMs: effectiveTaskMode.intervalMs,
        stopOn: effectiveTaskMode.stopOn ?? "success",
      })
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
      log.info("task_run.polling_attempt_finished", {
        taskRunId: previous.id,
        projectId: finished.projectId,
        taskId: finished.taskId,
        attemptNo,
        status: finished.status,
        passedCount: finished.passedCount,
        totalCount: finished.totalCount,
      })
      if (finished.status === "cancelled" || finished.status === "interrupted") {
        log.info("task_run.polling_chain_aborted", {
          taskRunId: previous.id,
          projectId: finished.projectId,
          taskId: finished.taskId,
          attemptNo,
          status: finished.status,
        })
        return
      }
      if (stopOn === "success" && finished.status === "passed") {
        log.info("task_run.polling_chain_completed", {
          taskRunId: previous.id,
          projectId: finished.projectId,
          taskId: finished.taskId,
          attemptNo,
          stopOn,
        })
        return
      }
      attemptNo += 1
      if (intervalMs > 0) {
        log.info("task_run.polling_sleep", {
          taskRunId: previous.id,
          projectId: previous.projectId,
          taskId: previous.taskId,
          attemptNo,
          intervalMs,
        })
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
      log.info("task_run.polling_attempt_starting", {
        parentTaskRunId: previous.id,
        projectId: previous.projectId,
        taskId: previous.taskId,
        attemptNo,
      })

      const next = await this.runTaskRunOnce(task, {
        projectId: request.projectId,
        taskId: request.taskId,
        scheduleTriggerId: request.scheduleTriggerId,
        attemptNo,
        parentTaskRunId: previous.id,
        effectiveTaskMode: mode,
        scriptTimeoutMs: mode.attemptTimeoutMs,
      }).catch((err) => {
        log.warn("task_run.polling_attempt_failed", {
          parentTaskRunId: previous.id,
          projectId: previous.projectId,
          taskId: previous.taskId,
          attemptNo,
          error: err,
        })
        return undefined
      })
      if (!next) {
        log.warn("task_run.polling_chain_stopped", {
          parentTaskRunId: previous.id,
          projectId: previous.projectId,
          taskId: previous.taskId,
          attemptNo,
        })
        return
      }
      log.info("task_run.polling_attempt_started", {
        taskRunId: next.id,
        projectId: next.projectId,
        taskId: next.taskId,
        attemptNo,
      })
      previous = next
    }
    log.info("task_run.polling_chain_exhausted", {
      taskRunId: previous.id,
      projectId: previous.projectId,
      taskId: previous.taskId,
      maxAttempts,
    })
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
    log.info("task_run.attempt_created", {
      taskRunId: taskRun.id,
      projectId: taskRun.projectId,
      taskId: taskRun.taskId,
      itemCount: resolvedItems.length,
      effectiveMode: describeTaskMode(opts.effectiveTaskMode),
      scriptTimeoutMs: opts.scriptTimeoutMs ?? null,
      attemptNo: opts.attemptNo ?? 1,
      parentTaskRunId: opts.parentTaskRunId ?? null,
    })
    taskRun.logs.push("任务执行链：跳过用例自带前置；任一用例失败即快速失败终止。")
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

    const taskController = this.createManagedTaskRunController(taskRun, opts)
    this.executeTaskRunLoop(task, taskRun, resolvedItems, taskController, opts)

    return taskRun
  }
}
