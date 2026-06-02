import type { ProjectEditModalProps, EditTab } from "./types"
import { formatDateTime } from "../../utils"

export function ProjectEditModal({ controller, isEditing, setIsEditing, editTab, setEditTab, newModuleName, setNewModuleName, newModuleDesc, setNewModuleDesc, authForm, setAuthForm }: ProjectEditModalProps) {
  const {
    busy,
    modules,
    selectedProject,
    projectWorkspace,
    gitAuthProfiles,
    projectForm,
    workspaceForm,
    saveProject,
    saveWorkspace,
    importLocalWorkspace,
    uploadWorkspace,
    syncWorkspace,
    browseWorkspaceTree,
    saveGitAuthProfile,
    removeGitAuthProfile,
    setWorkspaceForm,
    saveModule,
    deleteModule,
    setProjectForm,
    setActiveSection,
  } = controller

  if (!isEditing) return null

  return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-slate-950/60 backdrop-blur-md animate-fade-in"
          onClick={() => setIsEditing(false)}
        >
          <div
            className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border/80 bg-card dark:bg-slate-900/95 p-6 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border/40 mb-4">
              <h3 className="text-base font-bold text-foreground">
                {projectForm.id ? "编辑项目" : "新建项目"}
              </h3>
              <button
                className="text-muted-foreground hover:text-foreground hover:bg-secondary/60 p-1.5 rounded-lg transition-colors cursor-pointer flex items-center justify-center"
                onClick={() => setIsEditing(false)}
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Modal Tab Switcher */}
            {projectForm.id && (
              <div className="flex gap-1.5 p-1 bg-secondary/40 border border-border/40 rounded-xl mb-5">
                {(["basic", "modules"] as EditTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setEditTab(tab)}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      editTab === tab
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "basic" ? "基本信息" : "模块管理"}
                  </button>
                ))}
              </div>
            )}

            {/* Basic Information Tab */}
            {editTab === "basic" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    项目名称
                  </label>
                  <input
                    className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="例如：在线商城自动化测试"
                    value={projectForm.name}
                    onChange={(event) => setProjectForm((current: any) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    项目描述
                  </label>
                  <textarea
                    className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20 min-h-[5rem] resize-none"
                    placeholder="主要用于测试商城登录、加购、结算等全链路核心流程。"
                    value={projectForm.description}
                    onChange={(event) => setProjectForm((current: any) => ({ ...current, description: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    主域名（仅用于初始化主目标 URL）
                  </label>
                  <input
                    className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="例: https://admin.example.com"
                    value={projectForm.testBaseUrl}
                    onChange={(event) => setProjectForm((current: any) => ({ ...current, testBaseUrl: event.target.value }))}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    此字段仅在首次创建项目时同步成主「目标网址」。日常生成 / 录制 / 运行请到「目标网址」管理多套环境，并在工作台下拉显式选择。
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      工作区来源
                    </label>
                    <select
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={workspaceForm.sourceKind}
                      onChange={(event) => setWorkspaceForm((current: any) => ({ ...current, sourceKind: event.target.value as typeof current.sourceKind }))}
                    >
                      <option value="git">Git 仓库</option>
                      <option value="local_path">本地路径</option>
                      <option value="upload">上传目录（预留）</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      鉴权配置
                    </label>
                    <select
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                      value={workspaceForm.gitAuthProfileId ?? ""}
                      onChange={(event) => setWorkspaceForm((current: any) => ({ ...current, gitAuthProfileId: event.target.value }))}
                      disabled={workspaceForm.sourceKind !== "git"}
                    >
                      <option value="">无</option>
                      {gitAuthProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.name} ({profile.kind})</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      {workspaceForm.sourceKind !== "git"
                        ? "只有 Git 仓库来源才需要鉴权配置。"
                        : gitAuthProfiles.length === 0
                        ? "当前还没有保存任何鉴权配置，所以上面只能选“无”。先在下方新增一个，再回来选择。"
                        : "这里选择的是已保存的全局鉴权配置；下方用于新增或删除配置。"}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold text-foreground">Git 鉴权配置管理</div>
                      <div className="text-[10px] text-muted-foreground mt-1">先在这里保存配置，再到上面的“鉴权配置”下拉里选择。</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground shrink-0">已保存 {gitAuthProfiles.length} 个</div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3 py-2 text-xs text-foreground"
                      placeholder="配置名称"
                      value={authForm.name}
                      onChange={(event) => setAuthForm((current: any) => ({ ...current, name: event.target.value }))}
                    />
                    <select
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3 py-2 text-xs text-foreground"
                      value={authForm.kind}
                      onChange={(event) => setAuthForm((current: any) => ({ ...current, kind: event.target.value }))}
                    >
                      <option value="http_token">HTTP Token</option>
                      <option value="http_basic">HTTP Basic</option>
                      <option value="ssh_key">SSH Key</option>
                      <option value="none">None</option>
                    </select>
                    <input
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3 py-2 text-xs text-foreground"
                      placeholder="Host Pattern，例如 github.com"
                      value={authForm.hostPattern}
                      onChange={(event) => setAuthForm((current: any) => ({ ...current, hostPattern: event.target.value }))}
                    />
                    <input
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3 py-2 text-xs text-foreground"
                      placeholder="用户名（可选）"
                      value={authForm.username}
                      onChange={(event) => setAuthForm((current: any) => ({ ...current, username: event.target.value }))}
                    />
                  </div>
                  <textarea
                    className="block w-full rounded-xl border border-border/60 bg-background/30 px-3 py-2 text-xs text-foreground min-h-[4rem] resize-none"
                    placeholder={authForm.kind === "ssh_key" ? "粘贴 SSH 私钥" : "粘贴 token 或密码"}
                    value={authForm.secret}
                    onChange={(event) => setAuthForm((current: any) => ({ ...current, secret: event.target.value }))}
                  />
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <button
                      className="h-8 px-3 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-50"
                      type="button"
                      disabled={busy || !authForm.name.trim() || !authForm.hostPattern.trim()}
                      onClick={async () => {
                        await saveGitAuthProfile({
                          name: authForm.name.trim(),
                          kind: authForm.kind as "none" | "http_token" | "http_basic" | "ssh_key",
                          hostPattern: authForm.hostPattern.trim(),
                          username: authForm.username.trim() || undefined,
                          secret: authForm.secret.trim() || undefined,
                        })
                        setAuthForm({ name: "", kind: "http_token", hostPattern: "", username: "", secret: "" })
                      }}
                    >
                      保存鉴权配置
                    </button>
                    {gitAuthProfiles.length > 0 && (
                      <div className="flex-1 min-w-full space-y-2 max-h-32 overflow-auto pr-1">
                        {gitAuthProfiles.map((profile) => (
                          <div key={profile.id} className="flex items-center justify-between rounded-lg border border-border/40 bg-background/20 px-3 py-2 text-xs">
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">{profile.name} ({profile.kind})</div>
                              <div className="text-[10px] text-muted-foreground truncate">{profile.hostPattern}</div>
                            </div>
                            <button
                              type="button"
                              className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer p-1 rounded hover:bg-rose-500/10 transition-colors"
                              onClick={() => removeGitAuthProfile(profile.id)}
                              disabled={busy}
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Git 仓库地址
                    </label>
                    <input
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                      placeholder="https://github.com/..."
                      value={workspaceForm.gitRepoUrl ?? ""}
                      onChange={(event) => setWorkspaceForm((current: any) => ({
                        ...current,
                        sourceKind: event.target.value.trim() ? "git" : current.localSourcePath?.trim() ? "local_path" : current.sourceKind,
                        gitRepoUrl: event.target.value,
                      }))}
                      disabled={workspaceForm.sourceKind === "local_path" && Boolean(workspaceForm.localSourcePath?.trim())}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      本地目录路径
                    </label>
                    <input
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                      placeholder="D:\\code\\my-app"
                      value={workspaceForm.localSourcePath ?? ""}
                      onChange={(event) => setWorkspaceForm((current: any) => ({
                        ...current,
                        sourceKind: event.target.value.trim() ? "local_path" : current.gitRepoUrl?.trim() ? "git" : current.sourceKind,
                        localSourcePath: event.target.value,
                      }))}
                      disabled={workspaceForm.sourceKind === "git" && Boolean(workspaceForm.gitRepoUrl?.trim())}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      分支
                    </label>
                    <input
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="main"
                      value={workspaceForm.branch ?? ""}
                      onChange={(event) => setWorkspaceForm((current: any) => ({ ...current, branch: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      引用 / Commit
                    </label>
                    <input
                      className="block w-full rounded-xl border border-border/60 bg-background/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 shadow-sm transition-all focus:border-primary/80 focus:bg-background/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="可选"
                      value={workspaceForm.ref ?? ""}
                      onChange={(event) => setWorkspaceForm((current: any) => ({ ...current, ref: event.target.value }))}
                    />
                  </div>
                </div>

                {projectForm.id && (
                  <div className="rounded-xl border border-border/40 bg-secondary/15 p-3 space-y-3">
                    <div className="text-[11px] text-muted-foreground">
                      当前状态：<span className="font-mono text-foreground">{projectWorkspace?.status ?? "missing"}</span>
                      {projectWorkspace?.lastSyncedAt ? ` · 最近同步 ${formatDateTime(projectWorkspace.lastSyncedAt)}` : ""}
                    </div>
                    {projectWorkspace?.lastError && (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400 break-all">{projectWorkspace.lastError}</div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="h-8 px-3 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-50"
                        type="button"
                        onClick={saveWorkspace}
                        disabled={busy}
                      >
                        保存工作区
                      </button>
                      <button
                        className="h-8 px-3 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-50"
                        type="button"
                        onClick={() => importLocalWorkspace()}
                        disabled={busy || workspaceForm.sourceKind !== "local_path"}
                      >
                        导入本地目录
                      </button>
                      <button
                        className="h-8 px-3 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-50"
                        type="button"
                        onClick={() => {
                          const input = document.createElement("input")
                          input.type = "file"
                          input.webkitdirectory = true
                          input.multiple = true
                          input.onchange = async () => {
                            const file = input.files?.[0]
                            if (file) {
                              await uploadWorkspace(file)
                            }
                          }
                          input.click()
                        }}
                        disabled={busy || workspaceForm.sourceKind !== "upload"}
                      >
                        上传目录
                      </button>
                      <button
                        className="h-8 px-3 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-50"
                        type="button"
                        onClick={syncWorkspace}
                        disabled={busy || workspaceForm.sourceKind !== "git"}
                      >
                        同步 Git
                      </button>
                      <button
                        className="h-8 px-3 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer disabled:opacity-50"
                        type="button"
                        onClick={async () => {
                          await browseWorkspaceTree()
                          setActiveSection("workbench")
                        }}
                        disabled={busy || !projectWorkspace}
                      >
                        浏览代码
                      </button>
                    </div>
                  </div>
                )}

                {/* Form Actions */}
                <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 pt-4 border-t border-border/40 mt-6 bg-card dark:bg-slate-900/95">
                  <button
                    className="h-9 px-4 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                    type="button"
                    onClick={() => setIsEditing(false)}
                  >
                    取消
                  </button>
                  <button
                    className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                    type="button"
                    onClick={async () => {
                      await saveProject()
                      setIsEditing(false)
                    }}
                    disabled={busy}
                  >
                    <span className="material-symbols-outlined text-sm">save</span>
                    保存项目
                  </button>
                </div>
              </div>
            )}

            {/* Module Management Tab */}
            {editTab === "modules" && (
              <div className="space-y-4">
                <div className="flex items-end gap-3 p-4 bg-secondary/20 border border-border/40 rounded-xl">
                  <div className="flex-1 space-y-1.5">
                    <label className="block text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                      模块名称
                    </label>
                    <input
                      placeholder="登录模块"
                      value={newModuleName}
                      onChange={(e) => setNewModuleName(e.target.value)}
                      className="block w-full rounded-xl border border-border/60 bg-background/40 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="block text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                      模块描述 (可选)
                    </label>
                    <input
                      placeholder="描述该模块的业务功能"
                      value={newModuleDesc}
                      onChange={(e) => setNewModuleDesc(e.target.value)}
                      className="block w-full rounded-xl border border-border/60 bg-background/40 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <button
                    className="h-8.5 px-4 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1 shrink-0"
                    type="button"
                    disabled={busy || !newModuleName.trim()}
                    onClick={async () => {
                      await saveModule(newModuleName.trim(), newModuleDesc.trim())
                      setNewModuleName("")
                      setNewModuleDesc("")
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    添加
                  </button>
                </div>

                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {modules.map((mod) => (
                    <div
                      className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-card/10 hover:bg-card/20 transition-colors"
                      key={mod.id}
                    >
                      <div className="space-y-0.5">
                        <strong className="text-xs font-semibold text-foreground">{mod.name}</strong>
                        {mod.description && <p className="text-[10px] text-muted-foreground">{mod.description}</p>}
                      </div>
                      <button
                        className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer p-1.5 rounded hover:bg-rose-500/10 transition-colors flex items-center justify-center"
                        type="button"
                        onClick={() => deleteModule(mod.id)}
                        disabled={busy}
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  ))}
                  {modules.length === 0 && (
                    <div className="py-10 text-center text-xs text-muted-foreground italic bg-secondary/5 border border-dashed border-border/40 rounded-xl">
                      暂无业务模块，请通过上方输入栏创建。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
  )
}
