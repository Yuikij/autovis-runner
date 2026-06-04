import { appName, appVersion, navItems } from "./constants"
import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { PageHeader } from "./components/page-header"
import type { ReadyWorkspaceController } from "./useWorkspaceController"
import { DashboardSection } from "./sections/DashboardSection"
import { ProjectsSection } from "./sections/ProjectsSection"
import { CasesSection } from "./sections/CasesSection"
import { WorkbenchSection } from "./sections/WorkbenchSection"
import { RunsSection } from "./sections/RunsSection"
import { AuthProfilesSection } from "./sections/auth-profiles"
import { TargetUrlsSection } from "./sections/TargetUrlsSection"
import { TasksSection } from "./sections/TasksSection"
import type { AuthSession } from "../App"

const sectionCopy: Record<string, { title: string; description: string }> = {
  dashboard: { title: "总览", description: "集中查看项目健康度、模型连接状态和最近活动。" },
  projects: { title: "项目", description: "管理测试项目、仓库来源和模块信息。" },
  cases: { title: "测试用例", description: "管理项目下的测试用例与有序前置用例。" },
  tasks: { title: "任务", description: "编排有序用例、配置执行模式与调度触发器，并查看执行历史。" },
  targetUrls: { title: "目标网址管理", description: "为项目配置多个目标网址，供执行、录制、登录态等场景下拉选择。" },
  authProfiles: { title: "登录状态管理", description: "管理需要在用例中注入的持久化身份鉴权状态。" },
  workbench: { title: "AI 工作台", description: "生成脚本、手动录制、查看历史脚本并在工作台内直接验证。" },
  runs: { title: "执行记录", description: "查看任务执行历史、实时浏览器回放与执行产物。" },
}

type WorkspaceShellProps = {
  authSession: AuthSession
  controller: ReadyWorkspaceController
  onLogout: () => Promise<void>
}

export function WorkspaceShell({ authSession, controller, onLogout }: WorkspaceShellProps) {
  const {
    activeSection, llmSession, selectedProject, error, successMessage,
    setActiveSection, setActiveRun, setActiveTaskRunId, setActiveRecorderSessionId,
    startNewTaskDraft,
  } = controller
  const currentSection = sectionCopy[activeSection]

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background text-foreground lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-border/80 bg-slate-50/80 dark:bg-slate-950/80 px-5 py-6 backdrop-blur lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-xl font-semibold text-primary">A</div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{appName}</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{appVersion}</p>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <Button className="w-full justify-start" onClick={startNewTaskDraft}>
            <span className="material-symbols-outlined text-base">add</span>
            新建任务
          </Button>
          <div className="rounded-2xl border border-border/80 bg-card/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">模型连接</p>
                <p className="mt-1 text-sm font-medium">{llmSession.provider === "copilot-proxy" ? "Copilot" : "LLM API"} {llmSession.signedIn ? "已连接" : "待连接"}</p>
              </div>
              <Badge tone={llmSession.signedIn ? "success" : "warning"}>{llmSession.signedIn ? "在线" : "未连接"}</Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{llmSession.model}</p>
          </div>
        </div>

        <nav className="mt-8 flex flex-col gap-2" aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={item.id === activeSection ? "flex items-center gap-3 rounded-xl bg-primary/15 px-4 py-3 text-left text-sm font-medium text-primary" : "flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"}
              onClick={() => {
                if (item.id === "runs") {
                  setActiveRun(null)
                  setActiveTaskRunId(null)
                  setActiveRecorderSessionId(null)
                }
                setActiveSection(item.id)
              }}
              type="button"
            >
              <span className="material-symbols-outlined text-base">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="mt-8 rounded-2xl border border-border/80 bg-card/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前项目</p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight">{selectedProject.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{selectedProject.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{selectedProject.version || "未标记版本"}</Badge>
            <Badge>{selectedProject.summary.totalCases} 条用例</Badge>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border/80 bg-background/80 px-6 py-5 backdrop-blur lg:px-10">
          <PageHeader
            description={currentSection.description}
            eyebrow="AutoVis Workspace"
            title={currentSection.title}
            actions={
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => controller.setTheme(controller.theme === "dark" ? "light" : "dark")}
                  className="flex items-center justify-center size-9 rounded-xl border border-border bg-card hover:bg-secondary text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-sm"
                  title={controller.theme === "dark" ? "切换为亮色模式" : "切换为暗色模式"}
                  type="button"
                >
                  <span className="material-symbols-outlined text-lg">
                    {controller.theme === "dark" ? "light_mode" : "dark_mode"}
                  </span>
                </button>
                <Badge>{llmSession.provider}</Badge>
                {authSession.authEnabled && authSession.user ? (
                  <button className="ghost-button small" type="button" onClick={() => void onLogout()}>
                    <span className="material-symbols-outlined text-sm">logout</span>
                    {authSession.user.username}
                  </button>
                ) : null}
              </div>
            }
          />
        </header>

        <main className="flex-1 px-6 py-6 lg:px-10 lg:py-8">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
            {error ? (
              <div className="flex items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-800 dark:text-red-200 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                <span className="material-symbols-outlined text-destructive shrink-0">error</span>
                <span className="flex-1 break-all">{error}</span>
                <button onClick={() => controller.setError?.(null)} className="flex shrink-0 p-1 opacity-70 hover:opacity-100 transition-opacity" title="关闭">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            ) : null}
            {successMessage ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 shrink-0">check_circle</span>
                <span className="flex-1">{successMessage}</span>
                <button onClick={() => controller.setSuccessMessage?.(null)} className="flex shrink-0 p-1 opacity-70 hover:opacity-100 transition-opacity" title="关闭">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            ) : null}
            {activeSection === "dashboard" ? <DashboardSection controller={controller} /> : null}
            {activeSection === "projects" ? <ProjectsSection controller={controller} /> : null}
            {activeSection === "cases" ? <CasesSection controller={controller} /> : null}
            {activeSection === "tasks" ? <TasksSection controller={controller} /> : null}
            {activeSection === "targetUrls" ? <TargetUrlsSection controller={controller} /> : null}
            {activeSection === "authProfiles" ? <AuthProfilesSection controller={controller} /> : null}
            {activeSection === "workbench" ? <WorkbenchSection controller={controller} /> : null}
            {activeSection === "runs" ? <RunsSection controller={controller} /> : null}
          </div>
        </main>
      </div>
    </div>
  )
}
