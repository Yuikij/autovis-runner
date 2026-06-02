import type { WorkspaceActionParams } from "../types"
import { request, type RequestError } from "../../api"
import { apiRoutes } from "../../apiRoutes"
import { useConfirm } from "../../components/ui/confirm"
import type {
  CreateScriptVersionResponse,
  ExecutionRun,
  GenerateScriptResponse,
  StartRunResponse,
  TestCase,
} from "@autovis/shared"

export function useTestActions(params: WorkspaceActionParams, refreshWorkspace: (id?: string | null) => Promise<void>) {
  const confirm = useConfirm()
  const {
    selectedProjectId,
    selectedProject,
    selectedCase,
    prompt,
    caseForm,
    lastTargetUrlId,
    setBusy,
    setError,
    setSuccessMessage,
    setSelectedCaseId,
    setSelectedScriptId,
    setActiveRun,
    setWorkbenchVerificationRunId,
    setActiveTaskRunId,
    setActiveRecorderSessionId,
    setAgentSession,
    loadTestCases,
    loadAllTestCases,
    loadScripts,
    loadProjectResources,
  } = params

  const saveTestCase = async () => {
    if (!selectedProject) return false

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const result = await request<TestCase>(apiRoutes.testCases.create(), {
        method: "POST",
        body: JSON.stringify({
          ...caseForm,
          projectId: selectedProject.id,
          bugId: caseForm.bugId || undefined,
          note: caseForm.note || undefined,
          aiScript: caseForm.aiScript || undefined,
          steps: caseForm.steps.filter(Boolean),
        }),
      })
      await refreshWorkspace(selectedProject.id)
      await Promise.all([
        loadTestCases(selectedProject.id),
        loadAllTestCases(),
      ])
      if (result.data?.id) {
        setSelectedCaseId(result.data.id)
      }
      setSuccessMessage("测试用例保存成功！")
      setTimeout(() => setSuccessMessage(null), 3000)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const deleteTestCase = async (testCaseId: string) => {
    if (!selectedProject) return false

    if (!await confirm("确定要删除该测试用例及其脚本、版本和运行记录吗？此操作不可恢复。")) {
      return false
    }

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await request(apiRoutes.testCases.remove(testCaseId), { method: "DELETE" })
      await Promise.all([loadTestCases(selectedProject.id), loadAllTestCases(), loadProjectResources(selectedProject.id)])
      setSuccessMessage("测试用例删除成功！")
      setTimeout(() => setSuccessMessage(null), 3000)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const generateScript = async (baseScriptId?: string) => {
    if (!selectedProject || !selectedCase) {
      setError("请先选择测试用例后再生成脚本。")
      return
    }
    if (!lastTargetUrlId) {
      setError("请先在生成模式侧栏的下拉框里选择一个目标 URL，再开始生成脚本。")
      return
    }

    setBusy(true)
    setError(null)
    setAgentSession(null)
    try {
      const result = await request<GenerateScriptResponse>(apiRoutes.scripts.generate(), {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProject.id,
          testCaseId: selectedCase.id,
          prompt,
          runTargetUrlId: lastTargetUrlId,
          baseScriptId,
        }),
      })
      setAgentSession({
        id: result.data.sessionId,
        projectId: selectedProject.id,
        testCaseId: selectedCase.id,
        mode: "generate",
        status: "running",
        verificationStatus: "idle",
        steps: [],
        preconditionSummary: [],
        startedAt: new Date().toISOString(),
      })
    } catch (reason) {
      setAgentSession(null)
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const repairScriptRun = async (runId: string) => {
    if (!selectedProject || !selectedCase) {
      setError("环境异常：无法获取当前用例。")
      return
    }

    setBusy(true)
    setError(null)
    setAgentSession(null)
    try {
      const result = await request<GenerateScriptResponse>(apiRoutes.runs.repair(runId), {
        method: "POST",
      })
      setAgentSession({
        id: result.data.sessionId,
        projectId: selectedProject.id,
        testCaseId: selectedCase.id,
        mode: "generate",
        status: "running",
        verificationStatus: "idle",
        steps: [],
        preconditionSummary: [],
        startedAt: new Date().toISOString(),
      })
    } catch (reason) {
      setAgentSession(null)
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startDirectAgent = async (targetUrlId: string) => {
    if (!selectedProject || !selectedCase) {
      setError("请先选择测试用例后再开始直接执行。")
      return
    }

    setBusy(true)
    setError(null)
    setAgentSession(null)
    try {
      const result = await request<GenerateScriptResponse>(apiRoutes.scripts.directExecute(), {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProject.id,
          testCaseId: selectedCase.id,
          prompt,
          runTargetUrlId: targetUrlId,
        }),
      })
      setAgentSession({
        id: result.data.sessionId,
        projectId: selectedProject.id,
        testCaseId: selectedCase.id,
        mode: "direct",
        status: "running",
        verificationStatus: "idle",
        steps: [],
        preconditionSummary: [],
        startedAt: new Date().toISOString(),
      })
    } catch (reason) {
      setAgentSession(null)
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startVerification = async (scriptId: string, targetUrlId: string) => {
    if (!selectedProject || !selectedCase) {
      setError("请先选择测试用例和脚本后再执行验证。")
      return
    }

    setBusy(true)
    setError(null)
    setActiveTaskRunId(null)
    setActiveRecorderSessionId(null)
    setActiveRun(null)
    setWorkbenchVerificationRunId(null)
    try {
      const result = await request<StartRunResponse>(apiRoutes.runs.create(), {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProject.id,
          testCaseId: selectedCase.id,
          scriptId,
          targetUrlId,
          kind: "temporary",
        }),
      })
      setActiveRun(result.data.run)
      setWorkbenchVerificationRunId(result.data.run.id)
    } catch (reason) {
      const err = reason as RequestError<StartRunResponse>
      if (err.status === 409 && err.data?.run) {
        setActiveRun(err.data.run)
        setWorkbenchVerificationRunId(err.data.run.id)
        setError(`该用例已有进行中的运行任务（${err.data.run.status}），已自动接管。`)
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const startRun = async (targetUrlId: string) => {
    if (!selectedProject || !selectedCase?.latestScriptId) return

    setBusy(true)
    setError(null)
    setActiveTaskRunId(null)
    setActiveRecorderSessionId(null)
    setActiveRun(null)
    setWorkbenchVerificationRunId(null)
    try {
      const result = await request<StartRunResponse>(apiRoutes.runs.create(), {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProject.id,
          testCaseId: selectedCase.id,
          scriptId: selectedCase.latestScriptId,
          targetUrlId,
          kind: "temporary",
        }),
      })
      setActiveRun(result.data.run)
    } catch (reason) {
      const err = reason as RequestError<StartRunResponse>
      if (err.status === 409 && err.data?.run) {
        setActiveRun(err.data.run)
        setWorkbenchVerificationRunId(err.data.run.id)
        setError(`该用例已有进行中的运行任务（${err.data.run.status}），已自动接管。`)
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const submitRunHumanInput = async (runId: string, handoffId: string, value: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await request<ExecutionRun>(apiRoutes.runs.humanInput(runId), {
        method: "POST",
        body: JSON.stringify({ handoffId, value }),
      })
      setActiveRun(result.data)
      if (selectedProject && result.data.kind !== "temporary") {
        await loadProjectResources(selectedProject.id)
      }
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      throw reason
    } finally {
      setBusy(false)
    }
  }

  const saveEditedScript = async (code: string, baseScriptId?: string, editPrompt?: string) => {
    if (!selectedCase) {
      throw new Error("请先选择测试用例。")
    }
    setBusy(true)
    setError(null)
    try {
      const result = await request<CreateScriptVersionResponse>(apiRoutes.testCases.createScriptVersion(selectedCase.id), {
        method: "POST",
        body: JSON.stringify({ code, baseScriptId, prompt: editPrompt }),
      })
      await loadScripts(selectedCase.id)
      setSelectedScriptId(result.data.script.id)
      if (selectedProject) {
        await loadProjectResources(selectedProject.id)
      }
      return result.data.script
    } catch (reason) {
      setError((reason as Error).message)
      throw reason
    } finally {
      setBusy(false)
    }
  }

  const deleteScriptVersion = async (scriptId: string) => {
    if (!selectedCase) {
      throw new Error("请先选择测试用例。")
    }
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.testCases.script(selectedCase.id, scriptId), {
        method: "DELETE",
      })
      await loadScripts(selectedCase.id)
      if (selectedProject) {
        await loadProjectResources(selectedProject.id)
      }
    } catch (reason) {
      setError((reason as Error).message)
      throw reason
    } finally {
      setBusy(false)
    }
  }

  const deleteScriptVersions = async (scriptIds: string[]) => {
    if (!selectedCase) {
      throw new Error("请先选择测试用例。")
    }
    setBusy(true)
    setError(null)
    try {
      await Promise.all(
        scriptIds.map((scriptId) =>
          request(apiRoutes.testCases.script(selectedCase.id, scriptId), {
            method: "DELETE",
          })
        )
      )
      await loadScripts(selectedCase.id)
      if (selectedProject) {
        await loadProjectResources(selectedProject.id)
      }
    } catch (reason) {
      setError((reason as Error).message)
      throw reason
    } finally {
      setBusy(false)
    }
  }

  return {
    saveTestCase,
    deleteTestCase,
    generateScript,
    startVerification,
    startRun,
    submitRunHumanInput,
    saveEditedScript,
    deleteScriptVersion,
    deleteScriptVersions,
    repairScriptRun,
    startDirectAgent,
  }
}
