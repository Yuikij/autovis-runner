import type { WorkspaceActionParams } from "../types.js"
import { request, type RequestError } from "../../api.js"
import { apiRoutes } from "../../apiRoutes.js"
import { useConfirm } from "../../components/ui/confirm.js"
import { t } from "../../../i18n/index.js"
import type {
  AgentSession,
  ConflictTaskResponse,
  CreateScriptVersionResponse,
  ExecutionRun,
  GenerateScriptResponse,
  RewriteChatMessage,
  RewriteChatResponse,
  RewritePlanResponse,
  StartRunResponse,
  TestCase,
} from "@autovis/shared"

type StartupConflictPayload = ConflictTaskResponse & {
  run?: ExecutionRun
  sessionId?: string
}

const isStartupConflictPayload = (value: unknown): value is StartupConflictPayload => {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<StartupConflictPayload>
  return candidate.conflict === true
    && typeof candidate.kind === "string"
    && typeof candidate.id === "string"
    && typeof candidate.status === "string"
}

const getStartupConflict = (reason: unknown): StartupConflictPayload | null => {
  const err = reason as RequestError<StartupConflictPayload>
  return err.status === 409 && isStartupConflictPayload(err.data) ? err.data : null
}

const buildFallbackAgentSession = (
  conflict: StartupConflictPayload,
  input: {
    projectId: string
    testCaseId: string
    mode: AgentSession["mode"]
  },
): AgentSession => ({
  id: conflict.id,
  projectId: input.projectId,
  testCaseId: input.testCaseId,
  mode: input.mode,
  status: conflict.status as AgentSession["status"],
  verificationStatus: "idle",
  steps: [],
  preconditionSummary: [],
  startedAt: new Date().toISOString(),
})

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

  // Single path for "the case already has an in-flight task" (HTTP 409). Adopts
  // the existing entity so the user lands on the live task instead of an error.
  const adoptAgentConflict = async (
    reason: unknown,
    mode: AgentSession["mode"],
    ctx: { projectId: string; testCaseId: string },
  ): Promise<boolean> => {
    const conflict = getStartupConflict(reason)
    if (conflict?.kind !== "agent") return false
    const adopted = await request<AgentSession>(apiRoutes.agent.detail(conflict.id))
      .then((result) => result.data)
      .catch(() => buildFallbackAgentSession(conflict, { ...ctx, mode }))
    setAgentSession(adopted)
    setError(t(mode === "direct" ? "actions.adoptedAgentDirect" : "actions.adoptedAgentGenerate", { status: conflict.status }))
    return true
  }

  const adoptRunConflict = async (reason: unknown): Promise<boolean> => {
    const conflict = getStartupConflict(reason)
    if (conflict?.kind !== "run") return false
    const adoptedRun = await request<ExecutionRun>(apiRoutes.runs.detail(conflict.id)).then((result) => result.data)
    setActiveRun(adoptedRun)
    setWorkbenchVerificationRunId(adoptedRun.id)
    setError(t("actions.adoptedRun", { status: conflict.status }))
    return true
  }

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
      setSuccessMessage(t("actions.caseSaved"))
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

    if (!await confirm(t("actions.caseDeleteConfirm"))) {
      return false
    }

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await request(apiRoutes.testCases.remove(testCaseId), { method: "DELETE" })
      await Promise.all([loadTestCases(selectedProject.id), loadAllTestCases(), loadProjectResources(selectedProject.id)])
      setSuccessMessage(t("actions.caseDeleted"))
      setTimeout(() => setSuccessMessage(null), 3000)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  // AI 改写「对话」阶段：纯文本多轮对话，不启动浏览器。前端持有 messages 历史逐轮回传。
  const rewriteChat = async (messages: RewriteChatMessage[], baseScriptId?: string): Promise<string> => {
    if (!selectedProject || !selectedCase) {
      throw new Error(t("actions.selectCaseFirst"))
    }
    const result = await request<RewriteChatResponse>(apiRoutes.scripts.rewriteChat(), {
      method: "POST",
      body: JSON.stringify({
        projectId: selectedProject.id,
        testCaseId: selectedCase.id,
        baseScriptId,
        messages,
      }),
    })
    return result.data.reply
  }

  // AI 改写「计划」阶段：把对话整理成可执行的改写方案，供用户确认。
  const rewritePlan = async (messages: RewriteChatMessage[], baseScriptId?: string): Promise<string> => {
    if (!selectedProject || !selectedCase) {
      throw new Error(t("actions.selectCaseFirst"))
    }
    const result = await request<RewritePlanResponse>(apiRoutes.scripts.rewritePlan(), {
      method: "POST",
      body: JSON.stringify({
        projectId: selectedProject.id,
        testCaseId: selectedCase.id,
        baseScriptId,
        messages,
      }),
    })
    return result.data.plan
  }

  const generateScript = async (baseScriptId?: string, promptOverride?: string) => {
    if (!selectedProject || !selectedCase) {
      setError(t("actions.selectCaseBeforeGenerate"))
      return
    }
    if (!lastTargetUrlId) {
      setError(t("actions.selectTargetUrlFirst"))
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
          prompt: promptOverride ?? prompt,
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
      if (await adoptAgentConflict(reason, "generate", { projectId: selectedProject.id, testCaseId: selectedCase.id })) {
        return
      }
      setAgentSession(null)
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const repairScriptRun = async (runId: string) => {
    setBusy(true)
    setError(null)
    setAgentSession(null)
    try {
      // 用例信息从 run 本身获取：从运行页深链接进入时可能没有“当前选中用例”，
      // 且失败的 run 也未必属于当前选中的用例。
      const run = (await request<ExecutionRun>(apiRoutes.runs.detail(runId))).data
      setSelectedCaseId(run.testCaseId)
      const result = await request<GenerateScriptResponse>(apiRoutes.runs.repair(runId), {
        method: "POST",
      })
      setAgentSession({
        id: result.data.sessionId,
        projectId: run.projectId,
        testCaseId: run.testCaseId,
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
      setError(t("actions.selectCaseBeforeDirect"))
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
      if (await adoptAgentConflict(reason, "direct", { projectId: selectedProject.id, testCaseId: selectedCase.id })) {
        return
      }
      setAgentSession(null)
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startVerification = async (scriptId: string, targetUrlId: string) => {
    if (!selectedProject || !selectedCase) {
      setError(t("actions.selectCaseScriptFirst"))
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
      if (await adoptRunConflict(reason)) return
      setError((reason as Error).message)
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
      if (await adoptRunConflict(reason)) return
      setError((reason as Error).message)
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
      throw new Error(t("actions.selectCaseFirst"))
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
      throw new Error(t("actions.selectCaseFirst"))
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
      throw new Error(t("actions.selectCaseFirst"))
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
    rewriteChat,
    rewritePlan,
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
