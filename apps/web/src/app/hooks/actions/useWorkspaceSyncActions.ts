import type { WorkspaceActionParams } from "../types"
import { request } from "../../api"
import { apiRoutes } from "../../apiRoutes"
import type {
  GitAuthProfile,
  ProjectWorkspace,
  UploadWorkspaceResponse,
  UpsertGitAuthProfileRequest,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceTreeEntry,
} from "@autovis/shared"

export function useWorkspaceSyncActions(params: WorkspaceActionParams) {
  const {
    selectedProjectId,
    selectedProject,
    workspaceForm,
    setBusy,
    setError,
    setSuccessMessage,
    setWorkspaceTree,
    setWorkspaceSearchResults,
    setSelectedWorkspaceFile,
    loadProjectResources,
  } = params

  const saveWorkspace = async () => {
    if (!selectedProject) {
      setError("请先选择项目。")
      return
    }

    setBusy(true)
    setError(null)
    try {
      await request<ProjectWorkspace>(apiRoutes.projects.workspace(selectedProject.id), {
        method: "POST",
        body: JSON.stringify({
          ...workspaceForm,
          gitAuthProfileId: workspaceForm.gitAuthProfileId || undefined,
        }),
      })
      await loadProjectResources(selectedProject.id)
      setSuccessMessage("工作区配置已保存！")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const importLocalWorkspace = async (localPath?: string) => {
    if (!selectedProject) {
      setError("请先选择项目。")
      return
    }
    const nextPath = (localPath ?? workspaceForm.localSourcePath ?? "").trim()
    if (!nextPath) {
      setError("请先填写本地目录路径。")
      return
    }

    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.projects.workspaceImportLocal(selectedProject.id), {
        method: "POST",
        body: JSON.stringify({ localPath: nextPath }),
      })
      await loadProjectResources(selectedProject.id)
      setSuccessMessage("本地目录已导入到托管工作区！")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const syncWorkspace = async () => {
    if (!selectedProject) {
      setError("请先选择项目。")
      return
    }

    setBusy(true)
    setError(null)
    try {
      await request(apiRoutes.projects.workspaceSync(selectedProject.id), {
        method: "POST",
        body: JSON.stringify({ branch: workspaceForm.branch || undefined, ref: workspaceForm.ref || undefined }),
      })
      await loadProjectResources(selectedProject.id)
      setSuccessMessage("工作区同步成功！")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const uploadWorkspace = async (file: File) => {
    if (!selectedProject) {
      setError("请先选择项目。")
      return
    }

    const formData = new FormData()
    formData.append("file", file)

    setBusy(true)
    setError(null)
    try {
      await request<UploadWorkspaceResponse>(apiRoutes.projects.workspaceUpload(selectedProject.id), {
        method: "POST",
        body: formData,
      })
      await loadProjectResources(selectedProject.id)
      setSuccessMessage("上传目录已导入到托管工作区！")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveGitAuthProfile = async (input: UpsertGitAuthProfileRequest) => {
    setBusy(true)
    setError(null)
    try {
      await request<GitAuthProfile>(apiRoutes.gitAuthProfiles.create(), {
        method: "POST",
        body: JSON.stringify(input),
      })
      if (selectedProjectId) {
        await loadProjectResources(selectedProjectId)
      }
      setSuccessMessage("鉴权配置已保存！")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const removeGitAuthProfile = async (profileId: string) => {
    setBusy(true)
    setError(null)
    try {
      await request<boolean>(apiRoutes.gitAuthProfiles.remove(profileId), { method: "DELETE" })
      if (selectedProjectId) {
        await loadProjectResources(selectedProjectId)
      }
      setSuccessMessage("鉴权配置已删除！")
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const browseWorkspaceTree = async (path = "") => {
    if (!selectedProject) return
    try {
      const result = await request<WorkspaceTreeEntry[]>(apiRoutes.projects.workspaceTree(selectedProject.id, path || undefined))
      setWorkspaceTree(result.data)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const searchWorkspace = async (query: string, path = "") => {
    if (!selectedProject) return
    try {
      const result = await request<WorkspaceSearchMatch[]>(apiRoutes.projects.workspaceSearch(selectedProject.id), {
        method: "POST",
        body: JSON.stringify({ query, path: path || undefined }),
      })
      setWorkspaceSearchResults(result.data)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const openWorkspaceFile = async (path: string) => {
    if (!selectedProject) return
    try {
      const result = await request<WorkspaceFileContent>(apiRoutes.projects.workspaceFile(selectedProject.id, path))
      setSelectedWorkspaceFile(result.data)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  return {
    saveWorkspace,
    importLocalWorkspace,
    syncWorkspace,
    uploadWorkspace,
    saveGitAuthProfile,
    removeGitAuthProfile,
    browseWorkspaceTree,
    searchWorkspace,
    openWorkspaceFile,
  }
}
