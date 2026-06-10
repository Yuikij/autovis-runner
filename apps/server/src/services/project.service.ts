import { AutoVisDatabase } from "../db.js"
import { WorkspaceService } from "../workspace.js"
import { createId, now } from "./common.js"
import { type SuiteService } from "./suite.service.js"
import { type LlmConfigService } from "./llm-config.service.js"
import {
  type GitAuthProfile,
  type ImportLocalWorkspaceRequest,
  type SyncProjectWorkspaceRequest,
  type TestCase,
  type UpsertGitAuthProfileRequest,
  type UpsertModuleRequest,
  type UpsertProjectRequest,
  type UpsertProjectWorkspaceRequest,
  type UpsertTestCaseRequest,
  type UpsertAuthProfileRequest,
  type AuthProfile,
} from "@autovis/shared"

export class ProjectService {
  constructor(
    private readonly db: AutoVisDatabase,
    private readonly workspace: WorkspaceService,
    private readonly suiteService: SuiteService,
    private readonly llmService: LlmConfigService
  ) {}

  private resolveProjectSource(input: { gitRepoUrl?: string; localRepoPath?: string }) {
    return input.localRepoPath?.trim() || input.gitRepoUrl?.trim() || ""
  }

  public getWorkspaceConfig(projectId: string) {
    return this.db.getProjectWorkspace(projectId)
  }

  private normalizeWorkspaceInput(input: UpsertProjectWorkspaceRequest): UpsertProjectWorkspaceRequest {
    const gitRepoUrl = input.gitRepoUrl?.trim() ?? ""
    const localSourcePath = input.localSourcePath?.trim() ?? ""
    if (gitRepoUrl && !localSourcePath) {
      return { ...input, sourceKind: "git", gitRepoUrl }
    }
    if (localSourcePath && !gitRepoUrl) {
      return { ...input, sourceKind: "local_path", localSourcePath }
    }
    return {
      ...input,
      gitRepoUrl,
      localSourcePath,
    }
  }

  public async ensureWorkspace(projectId: string) {
    const workspace = this.db.getProjectWorkspace(projectId)
    if (!workspace) {
      throw new Error("项目尚未配置源码工作区。")
    }
    return workspace
  }

  public async resolveWorkspaceAuth(workspace: Awaited<ReturnType<ProjectService["ensureWorkspace"]>>): Promise<GitAuthProfile | undefined> {
    return workspace.gitAuthProfileId ? this.db.getGitAuthProfile(workspace.gitAuthProfileId) : undefined
  }

  public async getWorkspaceCodeContext(projectId: string) {
    const workspace = this.db.getProjectWorkspace(projectId)
    const hasWorkspace = workspace && await this.workspace.hasWorkspace(projectId)
    if (!workspace || !hasWorkspace) {
      return [] as Array<{ path: string; content: string }>
    }

    const candidatePaths = await this.workspace.globPaths(projectId, "**/*.{ts,tsx,js,jsx,vue}").catch(() => [])
    const paths = candidatePaths.slice(0, 10)
    const contents = await Promise.all(paths.map(async (path) => {
      const file = await this.workspace.readWorkspaceFile(projectId, path, 0, 160).catch(() => undefined)
      return file ? { path, content: file.content } : undefined
    }))
    return contents.filter(Boolean) as Array<{ path: string; content: string }>
  }

  public async hasWorkspace(projectId: string) {
    const workspace = this.db.getProjectWorkspace(projectId)
    if (!workspace) return false
    return this.workspace.hasWorkspace(projectId)
  }

  public async syncProjectFiles(projectId: string, sourcePathOrUrl: string) {
    if (!sourcePathOrUrl || !sourcePathOrUrl.trim()) {
      return { syncedCount: 0, totalFound: 0 }
    }

    const trimmedSource = sourcePathOrUrl.trim()
    const sourceKind = trimmedSource.startsWith("http://") || trimmedSource.startsWith("https://") || trimmedSource.startsWith("git@") || trimmedSource.endsWith(".git")
      ? "git"
      : "local_path"
    const workspaceInput: UpsertProjectWorkspaceRequest = sourceKind === "git"
      ? { sourceKind, gitRepoUrl: trimmedSource }
      : { sourceKind, localSourcePath: trimmedSource }

    await this.saveProjectWorkspace(projectId, workspaceInput)
    const summary = sourceKind === "git"
      ? await this.syncProjectWorkspace(projectId, {})
      : await this.importLocalWorkspace(projectId, { localPath: trimmedSource })

    return {
      syncedCount: summary.totalFiles,
      totalFound: summary.totalFiles,
    }
  }

  public async saveProject(input: UpsertProjectRequest) {
    return await this.db.upsertProject({
      ...input,
      id: input.id ?? createId("project"),
    })
  }

  public async saveProjectWorkspace(projectId: string, input: UpsertProjectWorkspaceRequest) {
    const project = this.db.getProject(projectId)
    if (!project) {
      throw new Error("Project not found")
    }
    return this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), this.normalizeWorkspaceInput(input))
  }

  public async importLocalWorkspace(projectId: string, input: ImportLocalWorkspaceRequest) {
    const current = await this.ensureWorkspace(projectId)
    const nextWorkspace = this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
      ...current,
      sourceKind: "local_path",
      localSourcePath: input.localPath,
    }, {
      status: "importing",
      lastError: undefined,
    })
    if (!nextWorkspace) throw new Error("保存工作区配置失败。")

    try {
      const summary = await this.workspace.importLocalDirectory(projectId, input.localPath)
      this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
        sourceKind: "local_path",
        localSourcePath: input.localPath,
        gitRepoUrl: current.gitRepoUrl,
        branch: current.branch,
        ref: current.ref,
        gitAuthProfileId: current.gitAuthProfileId,
      }, {
        status: "ready",
        lastSyncedAt: now(),
        lastError: undefined,
      })
      return summary
    } catch (error) {
      this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
        sourceKind: "local_path",
        localSourcePath: input.localPath,
        gitRepoUrl: current.gitRepoUrl,
        branch: current.branch,
        ref: current.ref,
        gitAuthProfileId: current.gitAuthProfileId,
      }, {
        status: "error",
        lastError: error instanceof Error ? error.message : "本地目录导入失败",
      })
      throw error
    }
  }

  public async syncProjectWorkspace(projectId: string, input: SyncProjectWorkspaceRequest) {
    const current = await this.ensureWorkspace(projectId)
    const auth = await this.resolveWorkspaceAuth(current)
    const next = this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
      sourceKind: current.sourceKind,
      gitRepoUrl: current.gitRepoUrl,
      localSourcePath: current.localSourcePath,
      branch: input.branch ?? current.branch,
      ref: input.ref ?? current.ref,
      gitAuthProfileId: current.gitAuthProfileId,
    }, {
      status: "syncing",
      lastError: undefined,
    })
    if (!next) {
      throw new Error("保存工作区状态失败。")
    }

    try {
      const summary = await this.workspace.syncGitWorkspace(projectId, next, auth)
      this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
        sourceKind: next.sourceKind,
        gitRepoUrl: next.gitRepoUrl,
        localSourcePath: next.localSourcePath,
        branch: next.branch,
        ref: next.ref,
        gitAuthProfileId: next.gitAuthProfileId,
      }, {
        status: "ready",
        lastSyncedAt: now(),
        lastCommitSha: summary.commit,
        lastError: undefined,
      })
      return summary
    } catch (error) {
      this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
        sourceKind: next.sourceKind,
        gitRepoUrl: next.gitRepoUrl,
        localSourcePath: next.localSourcePath,
        branch: next.branch,
        ref: next.ref,
        gitAuthProfileId: next.gitAuthProfileId,
      }, {
        status: "error",
        lastError: error instanceof Error ? error.message : "Git 同步失败",
      })
      throw error
    }
  }

  public async importUploadedWorkspace(projectId: string, uploadedDir: string) {
    const current = await this.ensureWorkspace(projectId)
    const nextWorkspace = this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
      sourceKind: "upload",
      localSourcePath: current.localSourcePath,
      gitRepoUrl: current.gitRepoUrl,
      branch: current.branch,
      ref: current.ref,
      gitAuthProfileId: current.gitAuthProfileId,
    }, {
      status: "importing",
      lastError: undefined,
    })
    if (!nextWorkspace) throw new Error("保存工作区配置失败。")

    try {
      const summary = await this.workspace.importUploadedDirectory(projectId, uploadedDir)
      this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
        sourceKind: "upload",
        localSourcePath: current.localSourcePath,
        gitRepoUrl: current.gitRepoUrl,
        branch: current.branch,
        ref: current.ref,
        gitAuthProfileId: current.gitAuthProfileId,
      }, {
        status: "ready",
        lastSyncedAt: now(),
        lastError: undefined,
      })
      return summary
    } catch (error) {
      this.db.upsertProjectWorkspace(projectId, this.workspace.getManagedRoot(projectId), {
        sourceKind: "upload",
        localSourcePath: current.localSourcePath,
        gitRepoUrl: current.gitRepoUrl,
        branch: current.branch,
        ref: current.ref,
        gitAuthProfileId: current.gitAuthProfileId,
      }, {
        status: "error",
        lastError: error instanceof Error ? error.message : "上传目录导入失败",
      })
      throw error
    }
  }

  public async listWorkspaceTree(projectId: string, path = "") {
    return this.workspace.listTree(projectId, path)
  }

  public async globWorkspacePaths(projectId: string, pattern: string) {
    return this.workspace.globPaths(projectId, pattern)
  }

  public async searchWorkspaceCode(projectId: string, query: string, path = "", limit = 20) {
    return this.workspace.searchCode(projectId, query, path, limit)
  }

  public async readWorkspaceFile(projectId: string, path: string, offset = 0, limit = 200) {
    return this.workspace.readWorkspaceFile(projectId, path, offset, limit)
  }

  public async deleteProject(projectId: string) {
    await this.workspace.removeWorkspace(projectId)
    this.db.deleteProject(projectId)
  }

  public async clearRuns(projectId: string) {
    this.db.clearRuns(projectId)
  }

  public async saveTestCase(input: UpsertTestCaseRequest) {
    let caseCode = input.caseCode
    if (!caseCode || !caseCode.trim()) {
      const existing = this.db.listTestCases(input.projectId)
      caseCode = `CASE_${String(existing.length + 1).padStart(3, "0")}`
    }

    const normalizedDependencyCaseIds = this.suiteService.normalizeDependencyCaseIds(input.dependencyCaseIds)

    if (normalizedDependencyCaseIds.length > 0) {
      // 校验前置用例图（拓扑 + 查环 + 脚本可执行）。
      const draftCase: TestCase = {
        id: input.id ?? createId("case_draft"),
        projectId: input.projectId,
        caseCode,
        moduleName: input.moduleName,
        moduleId: input.moduleId,
        purpose: input.purpose ?? "",
        dependencyCaseIds: normalizedDependencyCaseIds,
        authProfileId: input.authProfileId,
        defaultTargetUrlId: input.defaultTargetUrlId,
        steps: input.steps,
        expectedResult: input.expectedResult,
        testType: input.testType,
        bugId: input.bugId,
        note: input.note,
        aiScript: input.aiScript,
      }
      this.suiteService.buildPreconditionPlan(draftCase)
    }

    return this.db.upsertTestCase({
      ...input,
      dependencyCaseIds: normalizedDependencyCaseIds,
      caseCode,
      id: input.id ?? createId("case"),
    })
  }

  public async deleteTestCase(testCaseId: string) {
    const targetCase = this.db.getTestCase(testCaseId)
    if (!targetCase) {
      throw new Error("Test case not found")
    }

    const dependentCases = this.db.listDependentTestCasesForCase(testCaseId)
    if (dependentCases.length > 0) {
      throw new Error(`该测试用例已被以下用例作为依赖用例引用，无法删除：${dependentCases.map((item) => item.caseCode).join(", ")}`)
    }

    this.db.deleteTestCase(testCaseId)
  }

  public async listModules(projectId: string) {
    return this.db.listModules(projectId)
  }

  public async saveModule(input: UpsertModuleRequest) {
    return this.db.upsertModule({
      ...input,
      id: input.id ?? createId("mod"),
    })
  }

  public async deleteModule(moduleId: string) {
    this.db.deleteModule(moduleId)
  }

  public async getDashboard(projectId?: string) {
    const projects = this.db.listProjects()
    const activeProjectId = projectId ?? projects[0]?.id
    const llmState = await this.llmService.getLlmState()
    const targetUrlsByProject: Record<string, ReturnType<typeof this.db.listTargetUrls>> = {}
    for (const project of projects) {
      targetUrlsByProject[project.id] = this.db.listTargetUrls(project.id)
    }
    return {
      projects,
      modules: activeProjectId ? this.db.listModules(activeProjectId) : [],
      tasks: activeProjectId ? this.db.listTasks(activeProjectId) : [],
      testCases: activeProjectId ? this.db.listTestCases(activeProjectId) : [],
      authProfiles: activeProjectId ? this.db.listAuthProfiles(activeProjectId) : [],
      targetUrlsByProject,
      scripts: activeProjectId
        ? this.db
            .listTestCases(activeProjectId)
            .flatMap((item) => this.db.listScriptsForTestCase(item.id))
        : [],
      runs: activeProjectId ? this.db.listRuns(activeProjectId) : [],
      taskRuns: activeProjectId ? this.db.listTaskRuns(activeProjectId) : [],
      recorderSessions: activeProjectId ? this.db.listRecorderSessions(activeProjectId) : [],
      llmSession: llmState.session,
      llmConfigs: llmState.configs,
      activeLlmConfigId: llmState.activeConfigId,
    }
  }

  public async saveGitAuthProfile(input: UpsertGitAuthProfileRequest) {
    return this.db.upsertGitAuthProfile({
      ...input,
      id: input.id ?? createId("git_auth"),
    })
  }

  public async deleteGitAuthProfile(profileId: string) {
    this.db.deleteGitAuthProfile(profileId)
  }

  public async saveAuthProfile(input: UpsertAuthProfileRequest) {
    const existing = input.id ? this.db.getAuthProfile(input.id) : undefined
    return this.db.upsertAuthProfile({
      id: input.id ?? createId("auth_profile"),
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      sourceCaseId: input.sourceCaseId,
      validationScriptId: input.validationScriptId,
      validationScript: existing?.validationScript,
      validationScriptGeneratedAt: existing?.validationScriptGeneratedAt,
      states: existing?.states ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AuthProfile)
  }
}
