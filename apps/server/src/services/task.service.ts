import { AutoVisDatabase } from "../db.js"
import { createId } from "./common.js"
import { type Task, type TaskItem, type UpsertTaskRequest } from "@autovis/shared"

/**
 * 任务（Task）：可持久化、可编辑的编排实体。负责 Task/TaskItem 的增删改查与校验。
 * 触发器（ScheduleTrigger）与执行（TaskRun）分别由 SchedulerService / RunService 处理。
 */
export class TaskService {
  constructor(private readonly db: AutoVisDatabase) {}

  public listTasks(projectId: string): Task[] {
    return this.db.listTasks(projectId)
  }

  public getTask(taskId: string): Task | undefined {
    return this.db.getTask(taskId)
  }

  public listTaskRunsForTask(taskId: string) {
    return this.db.listTaskRunsForTask(taskId)
  }

  private normalizeItems(projectId: string, items: TaskItem[]): TaskItem[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("任务至少需要编排一条测试用例。")
    }
    return items.map((item, index) => {
      const caseId = item.caseId?.trim()
      if (!caseId) {
        throw new Error(`任务第 ${index + 1} 项缺少测试用例。`)
      }
      const testCase = this.db.getTestCase(caseId)
      if (!testCase || testCase.projectId !== projectId) {
        throw new Error(`任务第 ${index + 1} 项引用的测试用例不存在或不属于当前项目。`)
      }
      let targetUrlId = item.targetUrlId?.trim() || undefined
      if (targetUrlId) {
        const targetUrl = this.db.getTargetUrl(targetUrlId)
        if (!targetUrl || targetUrl.projectId !== projectId) {
          throw new Error(`任务第 ${index + 1} 项的初始 URL 不存在或不属于当前项目。`)
        }
      }
      return { caseId, targetUrlId }
    })
  }

  public saveTask(input: UpsertTaskRequest): Task | undefined {
    const project = this.db.getProject(input.projectId)
    if (!project) {
      throw new Error("Project not found")
    }
    const name = input.name?.trim()
    if (!name) {
      throw new Error("任务名称不能为空。")
    }
    const items = this.normalizeItems(input.projectId, input.items)

    return this.db.upsertTask({
      ...input,
      name,
      items,
      id: input.id ?? createId("task"),
    })
  }

  public deleteTask(taskId: string): void {
    const task = this.db.getTask(taskId)
    if (!task) {
      throw new Error("Task not found")
    }
    this.db.deleteTask(taskId)
  }
}
