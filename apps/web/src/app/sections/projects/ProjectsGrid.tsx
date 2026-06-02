import type { ProjectsGridProps } from "./types"
import { formatDateTime, translateStatus } from "../../utils"

// Git Host Badge mapping
function getGitBadgeInfo(url: string | undefined) {
  if (!url || !url.trim()) return null
  const lower = url.toLowerCase()
  if (lower.includes("github.com")) {
    return { name: "GitHub", color: "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700/80", icon: "code" }
  }
  if (lower.includes("gitlab.com")) {
    return { name: "GitLab", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20", icon: "code_blocks" }
  }
  if (lower.includes("gitee.com")) {
    return { name: "Gitee", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20", icon: "terminal" }
  }
  return { name: "Git Repo", color: "bg-secondary text-secondary-foreground border-border", icon: "source_code" }
}

export function ProjectsGrid({ controller, setIsEditing, setEditTab, confirmDeleteId, setConfirmDeleteId }: ProjectsGridProps) {
  const { projects, selectedProject, projectWorkspace, busy, deleteProject, setSelectedProjectId, setProjectForm, setWorkspaceForm, setActiveSection } = controller
  
  return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {projects.map((project) => {
          const isActive = project.id === selectedProject.id
          const gitInfo = getGitBadgeInfo(projectWorkspace?.gitRepoUrl)

          // Status Badge Color
          let statusClass = "bg-secondary text-secondary-foreground"
          if (project.summary.lastRunStatus === "passed") {
            statusClass = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
          } else if (project.summary.lastRunStatus === "failed") {
            statusClass = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
          } else if (project.summary.lastRunStatus === "running" || project.summary.lastRunStatus === "queued") {
            statusClass = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse"
          } else if (project.summary.lastRunStatus === "awaiting_human") {
            statusClass = "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 animate-pulse"
          }

          return (
            <div
              key={project.id}
              className={`relative flex flex-col justify-between min-h-[250px] rounded-2xl p-6 backdrop-blur-sm transition-all duration-300 group overflow-hidden ${
                isActive
                  ? "border border-primary bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-[0_0_20px_rgba(var(--color-primary-rgb),0.12)]"
                  : "bg-card/40 border border-border/80 hover:border-border hover:bg-card/60 shadow-sm"
              }`}
            >
              {/* Selected Badge */}
              {isActive && (
                <span className="absolute top-0 right-0 rounded-bl-xl bg-primary px-2.5 py-0.5 text-[9px] font-bold text-primary-foreground tracking-wider uppercase shadow-sm">
                  当前活动
                </span>
              )}

              {/* Title & Status */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 max-w-[70%]">
                    <strong className="text-base font-bold text-foreground truncate group-hover:text-primary transition-colors">
                      {project.name}
                    </strong>
                    {project.version && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                        v{project.version}
                      </span>
                    )}
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium leading-none border ${statusClass}`}>
                    {translateStatus(project.summary.lastRunStatus)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2" title={project.description}>
                  {project.description}
                </p>
              </div>

              {/* Metadata rows */}
              <div className="mt-4 pt-4 border-t border-border/30 space-y-2.5">
                {/* Test URL */}
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <span className="material-symbols-outlined text-sm shrink-0">language</span>
                  <span className="text-muted-foreground/60 w-16 select-none shrink-0">测试网站</span>
                  {project.testBaseUrl ? (
                    <a
                      href={project.testBaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground hover:text-primary font-mono truncate hover:underline transition-colors flex-1"
                    >
                      {project.testBaseUrl}
                    </a>
                  ) : (
                    <span className="text-muted-foreground/40 italic">未配置</span>
                  )}
                </div>

                {/* Git URL */}
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <span className="material-symbols-outlined text-sm shrink-0">code</span>
                  <span className="text-muted-foreground/60 w-16 select-none shrink-0">工作区</span>
                  {project.id === selectedProject.id && projectWorkspace ? (
                    <div className="flex items-center gap-1.5 truncate flex-1">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0 bg-primary/10 text-primary border-primary/20">
                        {projectWorkspace.sourceKind}
                      </span>
                      <span className="font-mono truncate" title={projectWorkspace.managedRoot}>
                        {projectWorkspace.managedRoot}
                      </span>
                    </div>
                  ) : projectWorkspace?.gitRepoUrl ? (
                    <div className="flex items-center gap-1.5 truncate flex-1">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0 ${gitInfo?.color || "bg-secondary text-secondary-foreground border-border"}`}>
                        {gitInfo?.name || "Git"}
                      </span>
                      <span className="font-mono truncate" title={projectWorkspace?.gitRepoUrl}>
                        {projectWorkspace?.gitRepoUrl}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40 italic">未关联</span>
                  )}
                </div>

                {/* Local Path */}
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <span className="material-symbols-outlined text-sm shrink-0">sync</span>
                  <span className="text-muted-foreground/60 w-16 select-none shrink-0">同步状态</span>
                  {project.id === selectedProject.id && projectWorkspace ? (
                    <span className="font-mono text-foreground truncate flex-1" title={projectWorkspace.lastError ?? projectWorkspace.status}>
                      {projectWorkspace.status}{projectWorkspace.lastSyncedAt ? ` · ${formatDateTime(projectWorkspace.lastSyncedAt)}` : ""}
                    </span>
                  ) : projectWorkspace?.localSourcePath ? (
                    <span className="font-mono text-foreground truncate flex-1" title={projectWorkspace?.localSourcePath}>
                      {projectWorkspace?.localSourcePath}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40 italic">未指定</span>
                  )}
                </div>
              </div>

              {/* Case Count & Last Updated */}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground/80 mt-5 pt-3 border-t border-border/30 select-none">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[12px]">analytics</span>
                  {project.summary.totalCases} 个测试用例
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[12px]">schedule</span>
                  {formatDateTime(project.updatedAt)} 更新
                </span>
              </div>

              {/* Card Actions */}
              <div className="mt-5 flex items-center justify-between gap-2.5 min-h-[32px]">
                {confirmDeleteId === project.id ? (
                  <div className="w-full flex items-center justify-between bg-rose-500/5 border border-rose-500/20 p-1.5 rounded-xl animate-fade-in gap-2">
                    <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold truncate pl-1">确认永久删除项目？</span>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        className="px-2.5 py-1 text-[10px] font-bold rounded bg-rose-500 hover:bg-rose-600 text-white transition-all cursor-pointer"
                        onClick={async () => {
                          await deleteProject(project.id)
                          setConfirmDeleteId(null)
                        }}
                        disabled={busy}
                      >
                        确认
                      </button>
                      <button
                        type="button"
                        className="px-2.5 py-1 text-[10px] font-semibold rounded border border-border bg-card hover:bg-secondary text-muted-foreground transition-all cursor-pointer"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="flex-1 h-8 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
                      onClick={() => {
                        setSelectedProjectId(project.id)
                        setActiveSection("cases")
                      }}
                      disabled={busy}
                    >
                      <span className="material-symbols-outlined text-sm">login</span>
                      {isActive ? "进入项目 (活动)" : "进入项目"}
                    </button>
                    <button
                      type="button"
                      className="h-8 px-3.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all flex items-center justify-center gap-1 cursor-pointer"
                      onClick={() => {
                        setSelectedProjectId(project.id)
                        setProjectForm({
                          id: project.id,
                          name: project.name,
                          description: project.description,
                          testBaseUrl: project.testBaseUrl ?? "",
                          version: project.version ?? "",
                        })
                        setWorkspaceForm(project.id === selectedProject.id && projectWorkspace ? {
                          sourceKind: projectWorkspace.sourceKind,
                          gitRepoUrl: projectWorkspace.gitRepoUrl ?? "",
                          localSourcePath: projectWorkspace.localSourcePath ?? "",
                          branch: projectWorkspace.branch ?? "",
                          ref: projectWorkspace.ref ?? "",
                          gitAuthProfileId: projectWorkspace.gitAuthProfileId ?? "",
                        } : {
                          sourceKind: projectWorkspace?.gitRepoUrl ? "git" : "local_path",
                          gitRepoUrl: projectWorkspace?.gitRepoUrl ?? "",
                          localSourcePath: projectWorkspace?.localSourcePath ?? "",
                          branch: "",
                          ref: "",
                          gitAuthProfileId: "",
                        })
                        setEditTab("basic")
                        setIsEditing(true)
                      }}
                      disabled={busy}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="h-8 w-8 text-destructive/80 hover:text-destructive border border-destructive/10 hover:border-destructive/30 rounded-lg hover:bg-destructive/10 transition-all flex items-center justify-center cursor-pointer shrink-0"
                      onClick={() => setConfirmDeleteId(project.id)}
                      disabled={busy}
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
  )
}
