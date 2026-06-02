import type { WorkspaceActionParams } from "../types"
import { request } from "../../api"
import { apiRoutes } from "../../apiRoutes"
import type { CopilotSessionResponse } from "@autovis/shared"

export function useLlmActions(params: WorkspaceActionParams) {
  const {
    llmSessionLoaded,
    selectedProjectId,
    copilotModel,
    llmConfigForm,
    setBusy,
    setError,
    setSuccessMessage,
    loadLlmSession,
    loadProjectResources,
  } = params

  const saveLlmConfig = async () => {
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.llm.configs(), {
        method: "POST",
        body: JSON.stringify(llmConfigForm),
      })
      await loadLlmSession()
      setSuccessMessage("AI 配置已保存。")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const activateLlmConfig = async (configId: string) => {
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.llm.activateConfig(), {
        method: "POST",
        body: JSON.stringify({ configId }),
      })
      await loadLlmSession()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const activateVisionConfig = async (configId: string | null) => {
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.llm.activateVisionConfig(), {
        method: "POST",
        body: JSON.stringify({ configId }),
      })
      await loadLlmSession()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deleteLlmConfig = async (configId: string) => {
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.llm.config(configId), { method: "DELETE" })
      await loadLlmSession()
      setSuccessMessage("AI 配置已删除。")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startCopilotDeviceFlow = async () => {
    setBusy(true)
    setError(null)
    try {
      await request<CopilotSessionResponse>(apiRoutes.llm.copilotDeviceStart(), {
        method: "POST",
        body: JSON.stringify({ model: copilotModel }),
      })
      await loadLlmSession()
      if (selectedProjectId) {
        await loadProjectResources(selectedProjectId)
      }
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pollCopilotDeviceFlow = async () => {
    setBusy(true)
    setError(null)
    try {
      await request<CopilotSessionResponse>(apiRoutes.llm.copilotDevicePoll(), {
        method: "POST",
        body: JSON.stringify({ model: copilotModel }),
      })
      await loadLlmSession()
      if (selectedProjectId) {
        await loadProjectResources(selectedProjectId)
      }
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const disconnectCopilot = async () => {
    if (!llmSessionLoaded) return

    setBusy(true)
    setError(null)
    try {
      await request<CopilotSessionResponse>(apiRoutes.llm.copilotDisconnect(), { method: "POST", body: JSON.stringify({}) })
      await loadLlmSession()
      if (selectedProjectId) {
        await loadProjectResources(selectedProjectId)
      }
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return {
    saveLlmConfig,
    activateLlmConfig,
    activateVisionConfig,
    deleteLlmConfig,
    startCopilotDeviceFlow,
    pollCopilotDeviceFlow,
    disconnectCopilot,
  }
}
