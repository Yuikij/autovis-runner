import { useCallback } from "react"
import type { WorkspaceActionParams } from "../types.js"
import { request } from "../../api.js"
import { apiRoutes } from "../../apiRoutes.js"
import { emptyProjectForm, emptyWorkspaceForm } from "../../workspaceForms.js"
import { useConfirm } from "../../components/ui/confirm.js"
import { t } from "../../../i18n/index.js"
import type { Module, Project, AuthProfile, TargetUrl, UpsertAuthProfileRequest } from "@autovis/shared"

export function useProjectActions(params: WorkspaceActionParams) {
  const confirm = useConfirm()
  const {
    selectedProjectId,
    selectedProject,
    projectForm,
    setProjectForm,
    setWorkspaceForm,
    setSelectedProjectId,
    setTasks,
    setTestCases,
    setProjectRuns,
    setTaskRuns,
    setRecorderSessions,
    setScripts,
    setProjectWorkspace,
    setGitAuthProfiles,
    setAuthProfiles,
    setWorkspaceTree,
    setWorkspaceSearchResults,
    setSelectedWorkspaceFile,
    setSelectedCaseId,
    setActiveRun,
    setBusy,
    setError,
    setSuccessMessage,
    setActiveSection,
    setModules,
    loadProjects,
    loadProjectResources,
    loadAllTestCases,
  } = params

  const refreshWorkspace = async (preferredProjectId?: string | null) => {
    const currentProjects = await loadProjects()
    const targetProjectId =
      preferredProjectId && currentProjects.some((item) => item.id === preferredProjectId)
        ? preferredProjectId
        : currentProjects[0]?.id ?? null

    setSelectedProjectId(targetProjectId)

    if (targetProjectId) {
      await loadProjectResources(targetProjectId)
      await Promise.all([loadAllTestCases()])
      return
    }

    setTasks([])
    setTestCases([])
    setProjectRuns([])
    setTaskRuns([])
    setRecorderSessions([])
    setScripts([])
    setProjectWorkspace(null)
    setGitAuthProfiles([])
    setAuthProfiles([])
    setWorkspaceTree([])
    setWorkspaceSearchResults([])
    setSelectedWorkspaceFile(null)
    setSelectedCaseId(null)
    setActiveRun(null)
  }

  const handleRefreshWorkspace = () => refreshWorkspace(selectedProjectId)

  const startNewProjectDraft = () => {
    setSelectedProjectId(null)
    setProjectForm(emptyProjectForm())
    setWorkspaceForm(emptyWorkspaceForm())
  }

  const saveProject = async () => {
    if (!projectForm.name.trim()) {
      setError(t("actions.projectNameRequired"))
      return
    }
    if (!projectForm.description.trim()) {
      setError(t("actions.projectDescRequired"))
      return
    }

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const result = await request<Project>(apiRoutes.projects.create(), {
        method: "POST",
        body: JSON.stringify(projectForm),
      })
      await refreshWorkspace(result.data?.id)
      if (result.data?.id) {
        setSelectedProjectId(result.data.id)
      }
      setSuccessMessage(t("actions.projectSaved"))
      setTimeout(() => setSuccessMessage(null), 3000)
      setActiveSection("projects")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deleteProject = async (projectId: string) => {
    if (!await confirm(t("actions.projectDeleteConfirm"))) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.projects.remove(projectId), { method: "DELETE" })
      await refreshWorkspace(selectedProjectId === projectId ? null : selectedProjectId)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const clearRuns = async (projectId: string) => {
    if (!await confirm(t("actions.clearRunsConfirm"))) {
      return
    }

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await request(apiRoutes.projects.runs(projectId), { method: "DELETE" })
      await refreshWorkspace(projectId)
      setSuccessMessage(t("actions.runsCleared"))
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deleteRun = async (runId: string): Promise<boolean> => {
    if (!await confirm(t("actions.runDeleteConfirm"))) {
      return false
    }

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await request(apiRoutes.runs.remove(runId), { method: "DELETE" })
      if (selectedProjectId) await loadProjectResources(selectedProjectId)
      setSuccessMessage(t("actions.runDeleted"))
      setTimeout(() => setSuccessMessage(null), 3000)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const deleteRunArtifacts = async (runId: string): Promise<boolean> => {
    if (!await confirm(t("actions.artifactsDeleteConfirm"))) {
      return false
    }

    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await request(apiRoutes.runs.artifacts(runId), { method: "DELETE" })
      if (selectedProjectId) await loadProjectResources(selectedProjectId)
      setSuccessMessage(t("actions.artifactsDeleted"))
      setTimeout(() => setSuccessMessage(null), 3000)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveModule = async (name: string, description: string, moduleId?: string) => {
    if (!selectedProject) return
    setBusy(true)
    setError(null)
    try {
      await request<Module>(apiRoutes.projects.modules(selectedProject.id), {
        method: "POST",
        body: JSON.stringify({ id: moduleId, name, description }),
      })
      const result = await request<Module[]>(apiRoutes.projects.modules(selectedProject.id))
      setModules(result.data)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deleteModule = async (moduleId: string) => {
    if (!selectedProject) return
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.modules.remove(moduleId), { method: "DELETE" })
      const result = await request<Module[]>(apiRoutes.projects.modules(selectedProject.id))
      setModules(result.data)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveAuthProfile = async (profile: UpsertAuthProfileRequest) => {
    if (!selectedProject) return
    setBusy(true)
    setError(null)
    try {
      await request<AuthProfile>(apiRoutes.authProfiles.create(), {
        method: "POST",
        body: JSON.stringify({ ...profile, projectId: selectedProject.id }),
      })
      const result = await request<AuthProfile[]>(apiRoutes.projects.authProfiles(selectedProject.id))
      setAuthProfiles(result.data)
      setSuccessMessage(t("actions.authProfileSaved"))
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const deleteAuthProfile = async (profileId: string) => {
    if (!selectedProject) return
    if (!await confirm(t("actions.authProfileDeleteConfirm"))) return
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.authProfiles.remove(profileId), { method: "DELETE" })
      const result = await request<AuthProfile[]>(apiRoutes.projects.authProfiles(selectedProject.id))
      setAuthProfiles(result.data)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const generateValidationScript = async (profileId: string, targetUrlId: string): Promise<string | null> => {
    if (!selectedProject) return null
    setBusy(true)
    setError(null)
    try {
      const result = await request<{ taskId: string }>(
        apiRoutes.authProfiles.generateValidationScript(profileId),
        { method: "POST", body: JSON.stringify({ projectId: selectedProject.id, targetUrlId }) },
      )
      setBusy(false)
      return result.data.taskId
    } catch (reason) {
      setError((reason as Error).message)
      setBusy(false)
      return null
    }
  }

  const refreshAuthProfiles = useCallback(async () => {
    if (!selectedProject) return
    const result = await request<AuthProfile[]>(apiRoutes.projects.authProfiles(selectedProject.id))
    setAuthProfiles(result.data)
  }, [selectedProject, setAuthProfiles])

  /**
   * 设置 / 清除某 (profile, targetUrl) 行的"登录后 URL"覆盖。
   * 传 null 表示清除覆盖，回退到自动采集值（postLoginUrlAuto）。
   */
  const setAuthProfilePostLoginUrl = async (
    profileId: string,
    targetUrlId: string,
    postLoginUrl: string | null,
  ): Promise<boolean> => {
    if (!selectedProject) return false
    setError(null)
    try {
      await request(apiRoutes.authProfiles.setPostLoginUrl(profileId, targetUrlId), {
        method: "PATCH",
        body: JSON.stringify({ postLoginUrl }),
      })
      const result = await request<AuthProfile[]>(apiRoutes.projects.authProfiles(selectedProject.id))
      setAuthProfiles(result.data)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    }
  }

  /**
   * 手动刷新登录态（按 targetUrl 维度）：跑该登录态的来源登录用例，把 storageState 写入 (profile, targetUrl) 行。
   */
  const refreshAuthProfileState = async (
    profileId: string,
    targetUrlId: string,
  ): Promise<{ runId: string; targetUrlId: string; testBaseUrl: string } | null> => {
    if (!selectedProject) return null
    setError(null)
    try {
      const result = await request<{ runId: string; targetUrlId: string; testBaseUrl: string }>(
        apiRoutes.authProfiles.refreshState(profileId),
        { method: "POST", body: JSON.stringify({ targetUrlId }) },
      )
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      return null
    }
  }

  /**
   * 触发"检查登录状态"重放任务（按 targetUrl）。
   */
  const checkLoginStatus = async (profileId: string, targetUrlId: string): Promise<string | null> => {
    if (!selectedProject) return null
    setError(null)
    try {
      const result = await request<{ taskId: string }>(
        apiRoutes.authProfiles.checkLoginStatus(profileId),
        { method: "POST", body: JSON.stringify({ projectId: selectedProject.id, targetUrlId }) },
      )
      return result.data.taskId
    } catch (reason) {
      setError((reason as Error).message)
      return null
    }
  }

  // ----- TargetUrl CRUD -----
  const listTargetUrls = async (projectId?: string): Promise<TargetUrl[]> => {
    const pid = projectId ?? selectedProject?.id
    if (!pid) return []
    const result = await request<TargetUrl[]>(apiRoutes.projects.targetUrls(pid))
    return result.data
  }

  const createTargetUrl = async (label: string, url: string, needsStealth?: boolean): Promise<TargetUrl | null> => {
    if (!selectedProject) return null
    setBusy(true)
    setError(null)
    try {
      const result = await request<TargetUrl>(apiRoutes.projects.targetUrls(selectedProject.id), {
        method: "POST",
        body: JSON.stringify({ label, url, needsStealth }),
      })
      await refreshWorkspace(selectedProject.id)
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const updateTargetUrl = async (id: string, patch: { label?: string; url?: string; needsStealth?: boolean }): Promise<TargetUrl | null> => {
    setBusy(true)
    setError(null)
    try {
      const result = await request<TargetUrl>(apiRoutes.targetUrls.update(id), {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      if (selectedProject) await refreshWorkspace(selectedProject.id)
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const deleteTargetUrl = async (id: string): Promise<boolean> => {
    if (!await confirm(t("actions.targetUrlDeleteConfirm"))) return false
    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.targetUrls.remove(id), { method: "DELETE" })
      if (selectedProject) await refreshWorkspace(selectedProject.id)
      return true
    } catch (reason) {
      setError((reason as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    handleRefreshWorkspace,
    startNewProjectDraft,
    saveProject,
    deleteProject,
    clearRuns,
    deleteRun,
    deleteRunArtifacts,
    saveModule,
    deleteModule,
    saveAuthProfile,
    deleteAuthProfile,
    generateValidationScript,
    refreshAuthProfiles,
    checkLoginStatus,
    refreshAuthProfileState,
    setAuthProfilePostLoginUrl,
    listTargetUrls,
    createTargetUrl,
    updateTargetUrl,
    deleteTargetUrl,
    refreshWorkspace, // Exposed internally for other actions
  }
}
