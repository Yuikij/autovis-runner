import { lazy, Suspense } from "react"

import { appName, appVersion, navItems } from "./constants"
import { lang, setLang, t } from "../i18n/index.js"
import { FrontendErrorBoundary } from "./FrontendErrorBoundary"
import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { PageHeader } from "./components/page-header"
import type { ReadyWorkspaceController } from "./useWorkspaceController"
import { DashboardSection } from "./sections/DashboardSection"
import type { AuthSession } from "../App"

const ProjectsSection = lazy(async () => ({ default: (await import("./sections/ProjectsSection")).ProjectsSection }))
const CasesSection = lazy(async () => ({ default: (await import("./sections/CasesSection")).CasesSection }))
const WorkbenchSection = lazy(async () => ({ default: (await import("./sections/WorkbenchSection")).WorkbenchSection }))
const RunsSection = lazy(async () => ({ default: (await import("./sections/RunsSection")).RunsSection }))
const OutboxSection = lazy(async () => ({ default: (await import("./sections/OutboxSection")).OutboxSection }))
const AuthProfilesSection = lazy(async () => ({ default: (await import("./sections/auth-profiles")).AuthProfilesSection }))
const TargetUrlsSection = lazy(async () => ({ default: (await import("./sections/TargetUrlsSection")).TargetUrlsSection }))
const DataTablesSection = lazy(async () => ({ default: (await import("./sections/DataTablesSection")).DataTablesSection }))
const KnowledgeSection = lazy(async () => ({ default: (await import("./sections/KnowledgeSection")).KnowledgeSection }))
const TasksSection = lazy(async () => ({ default: (await import("./sections/TasksSection")).TasksSection }))
const LlmConnectionsSection = lazy(async () => ({ default: (await import("./sections/LlmConnectionsSection")).LlmConnectionsSection }))

const sectionCopyFor = (section: string): { title: string; description: string } => ({
  title: t(`shell.sec.${section}.title`),
  description: t(`shell.sec.${section}.desc`),
})

type WorkspaceShellProps = {
  authSession: AuthSession
  controller: ReadyWorkspaceController
  onLogout: () => Promise<void>
}

function SectionLoadingState({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/50 px-6 py-8 text-sm text-muted-foreground shadow-sm">
      {t("shell.loadingSection", { title })}
    </div>
  )
}

export function WorkspaceShell({ authSession, controller, onLogout }: WorkspaceShellProps) {
  const {
    activeSection, llmSession, selectedProject, error, successMessage,
    setActiveSection, setActiveRun, setActiveTaskRunId, setActiveRecorderSessionId,
    startNewTaskDraft,
  } = controller
  const currentSection = sectionCopyFor(activeSection)

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
            {t("shell.newTask")}
          </Button>
          <div className="rounded-2xl border border-border/80 bg-card/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("shell.modelConnection")}</p>
                <p className="mt-1 text-sm font-medium">{llmSession.provider === "copilot-proxy" ? "Copilot" : "LLM API"} {llmSession.signedIn ? t("shell.connected") : t("shell.pendingConnection")}</p>
              </div>
              <Badge tone={llmSession.signedIn ? "success" : "warning"}>{llmSession.signedIn ? t("shell.online") : t("shell.offline")}</Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{llmSession.model}</p>
          </div>
        </div>

        <nav className="mt-8 flex flex-col gap-2" aria-label={t("shell.mainNav")}>
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
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("shell.currentProject")}</p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight">{selectedProject.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{selectedProject.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{selectedProject.version || t("shell.noVersion")}</Badge>
            <Badge>{t("shell.caseCount", { count: selectedProject.summary.totalCases })}</Badge>
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
                  onClick={() => setLang(lang === "zh" ? "en" : "zh")}
                  className="flex items-center justify-center h-9 px-2.5 gap-1 rounded-xl border border-border bg-card hover:bg-secondary text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-sm"
                  title={t("shell.switchLang")}
                  type="button"
                >
                  <span className="material-symbols-outlined text-lg">translate</span>
                  <span className="text-xs font-medium">{lang === "zh" ? "中" : "EN"}</span>
                </button>
                <button
                  onClick={() => controller.setTheme(controller.theme === "dark" ? "light" : "dark")}
                  className="flex items-center justify-center size-9 rounded-xl border border-border bg-card hover:bg-secondary text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-sm"
                  title={controller.theme === "dark" ? t("shell.switchToLight") : t("shell.switchToDark")}
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
                <button onClick={() => controller.setError?.(null)} className="flex shrink-0 p-1 opacity-70 hover:opacity-100 transition-opacity" title={t("common.close")}>
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            ) : null}
            {successMessage ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 shrink-0">check_circle</span>
                <span className="flex-1">{successMessage}</span>
                <button onClick={() => controller.setSuccessMessage?.(null)} className="flex shrink-0 p-1 opacity-70 hover:opacity-100 transition-opacity" title={t("common.close")}>
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            ) : null}
            <FrontendErrorBoundary section={activeSection} onGoDashboard={() => setActiveSection("dashboard")}>
              <Suspense fallback={<SectionLoadingState title={currentSection.title} />}>
                {activeSection === "dashboard" ? <DashboardSection controller={controller} /> : null}
                {activeSection === "projects" ? <ProjectsSection controller={controller} /> : null}
                {activeSection === "cases" ? <CasesSection controller={controller} /> : null}
                {activeSection === "tasks" ? <TasksSection controller={controller} /> : null}
                {activeSection === "targetUrls" ? <TargetUrlsSection controller={controller} /> : null}
                {activeSection === "dataTables" ? <DataTablesSection controller={controller} /> : null}
                {activeSection === "knowledge" ? <KnowledgeSection controller={controller} /> : null}
                {activeSection === "authProfiles" ? <AuthProfilesSection controller={controller} /> : null}
                {activeSection === "workbench" ? <WorkbenchSection controller={controller} /> : null}
                {activeSection === "runs" ? <RunsSection controller={controller} /> : null}
                {activeSection === "outbox" ? <OutboxSection controller={controller} /> : null}
                {activeSection === "llmConnections" ? <LlmConnectionsSection controller={controller} /> : null}
              </Suspense>
            </FrontendErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
