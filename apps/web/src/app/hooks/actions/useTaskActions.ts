import type { WorkspaceActionParams } from "../types"
import { request } from "../../api"
import { apiRoutes } from "../../apiRoutes"
import { emptyTaskForm } from "../../workspaceForms"
import { useConfirm } from "../../components/ui/confirm"
import type {
  ScheduleTrigger,
  StartTaskRunResponse,
  Task,
  TaskModeConfig,
  UpsertScheduleTriggerRequest,
} from "@autovis/shared"

export function useTaskActions(params: WorkspaceActionParams) {
  const confirm = useConfirm()
  const {
    selectedProjectId,
    selectedProject,
    taskForm,
    setBusy,
    setError,
    setSuccessMessage,
    setActiveSection,
    setSelectedTaskId,
    setTaskForm,
    setActiveTaskRunId,
    setActiveRecorderSessionId,
    setActiveRun,
    setWorkbenchVerificationRunId,
    setTaskRuns,
    loadTasks,
    loadProjectResources,
  } = params

  const startNewTaskDraft = () => {
    setSelectedTaskId(null)
    setTaskForm(emptyTaskForm())
    setActiveSection("tasks")
  }

  const saveTask = async () => {
    if (!selectedProject) return false
    if (!taskForm.name.trim()) {
      setError("保存失败：任务名称不能为空！")
      return false
    }
    if (!taskForm.items.length) {
      setError("保存失败：任务至少需要包含一条用例！")
      return false
    }

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const result = await request<Task>(apiRoutes.tasks.create(), {
        method: "POST",
        body: JSON.stringify({
          ...taskForm,
          name: taskForm.name.trim(),
          description: taskForm.description?.trim() || undefined,
          projectId: selectedProject.id,
        }),
      })
      await loadTasks(selectedProject.id)
      if (result.data?.id) {
        setSelectedTaskId(result.data.id)
      }
      setSuccessMessage("任务保存成功！")
      setTimeout(() => setSuccessMessage(null), 3000)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const deleteTask = async (taskId: string) => {
    if (!selectedProject) return false
    if (!await confirm("确定要删除该任务及其执行历史与调度触发器吗？此操作不可恢复。")) {
      return false
    }

    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.tasks.remove(taskId), { method: "DELETE" })
      await loadTasks(selectedProject.id)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const startTaskRun = async (taskId: string, taskModeOverride?: TaskModeConfig) => {
    if (!selectedProject) return false

    setBusy(true)
    setError(null)
    setActiveRun(null)
    setWorkbenchVerificationRunId(null)
    setActiveRecorderSessionId(null)
    try {
      const result = await request<StartTaskRunResponse>(apiRoutes.tasks.run(taskId), {
        method: "POST",
        body: JSON.stringify(taskModeOverride ? { taskMode: taskModeOverride } : {}),
      })
      setTaskRuns((current) => [result.data.taskRun, ...current.filter((item) => item.id !== result.data.taskRun.id)])
      setActiveTaskRunId(result.data.taskRun.id)
      setActiveSection("runs")
      await loadProjectResources(selectedProject.id)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveScheduleTrigger = async (input: UpsertScheduleTriggerRequest) => {
    setBusy(true)
    setError(null)
    try {
      const result = await request<ScheduleTrigger>(apiRoutes.scheduleTriggers.create(), {
        method: "POST",
        body: JSON.stringify(input),
      })
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const updateScheduleTrigger = async (id: string, input: UpsertScheduleTriggerRequest) => {
    setBusy(true)
    setError(null)
    try {
      const result = await request<ScheduleTrigger>(apiRoutes.scheduleTriggers.update(id), {
        method: "PUT",
        body: JSON.stringify(input),
      })
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const deleteScheduleTrigger = async (id: string) => {
    setError(null)
    try {
      await request(apiRoutes.scheduleTriggers.remove(id), { method: "DELETE" })
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    }
  }

  const setScheduleTriggerEnabled = async (id: string, enabled: boolean) => {
    setError(null)
    try {
      await request(apiRoutes.scheduleTriggers.setEnabled(id), {
        method: "POST",
        body: JSON.stringify({ enabled }),
      })
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    }
  }

  const fireScheduleTrigger = async (id: string) => {
    setError(null)
    try {
      const result = await request<{ id: string }>(apiRoutes.scheduleTriggers.fire(id), { method: "POST" })
      if (selectedProjectId) {
        await loadProjectResources(selectedProjectId)
      }
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      return null
    }
  }

  return {
    startNewTaskDraft,
    saveTask,
    deleteTask,
    startTaskRun,
    saveScheduleTrigger,
    updateScheduleTrigger,
    deleteScheduleTrigger,
    setScheduleTriggerEnabled,
    fireScheduleTrigger,
  }
}
