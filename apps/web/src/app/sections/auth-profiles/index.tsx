import { Button } from "../../components/ui/button"
import { EmptyState } from "../../components/empty-state"
import { AuthSandboxModal } from "../../components/auth-sandbox-modal"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

import { useAuthProfilesState } from "./useAuthProfilesState"
import { AuthProfileSidebar } from "./AuthProfileSidebar"
import { AuthProfileForm } from "./AuthProfileForm"
import { AuthProfileToolbar } from "./AuthProfileToolbar"
import { AuthProfileOverview } from "./AuthProfileOverview"
import { AuthProfileScript } from "./AuthProfileScript"
import { AuthProfileTimeline } from "./AuthProfileTimeline"

export type AuthProfilesSectionProps = {
  controller: ReadyWorkspaceController
}

export function AuthProfilesSection({ controller }: AuthProfilesSectionProps) {
  const state = useAuthProfilesState(controller)
  const { busy, selectedProject, refreshAuthProfiles, authProfiles, deleteAuthProfile, setAuthProfilePostLoginUrl } = controller

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 pb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground select-none">
          <span className="font-medium">{selectedProject.name}</span>
          <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
          <span className="font-medium text-foreground">登录状态管理</span>
          {state.selectedProfile ? (
            <>
              <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
              <span className="font-mono bg-secondary/80 text-secondary-foreground px-2 py-0.5 rounded border border-border/40 font-semibold text-[10px]">
                {state.selectedProfile.name}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
            onClick={() => refreshAuthProfiles()}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            刷新
          </Button>
          <Button
            size="sm"
            className="h-8 px-3 rounded-lg cursor-pointer"
            onClick={() => (state.showForm ? state.setShowForm(false) : state.openCreateForm())}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-sm mr-1">{state.showForm ? "close" : "add"}</span>
            {state.showForm ? "取消" : "新建登录态"}
          </Button>
        </div>
      </div>

      {state.showForm ? (
        <AuthProfileForm
          editingProfile={state.editingProfile}
          cases={state.projectCases}
          onCancel={() => { state.setShowForm(false) }}
          onSubmit={state.handleSubmitForm}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr] items-start">
        <AuthProfileSidebar
          profiles={authProfiles}
          selectedId={state.effectiveProfileId}
          onSelect={state.setSelectedProfileId}
          onEdit={state.openEditForm}
        />

        <main className="flex min-h-[480px] flex-col border border-border/80 bg-card/20 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm">
          {!state.selectedProfile ? (
            <EmptyState
              title="选择一个登录状态"
              description="左侧列表里没有可选项？请先新建一个登录态并绑定来源登录用例，再回来继续。"
            />
          ) : (
            <>
              <AuthProfileToolbar
                detailTab={state.detailTab}
                onChangeTab={state.setDetailTab}
                onGenerate={() => state.handleGenerate(state.selectedProfile!, state.effectiveTargetUrlId)}
                onCheck={() => state.handleCheck(state.selectedProfile!, state.effectiveTargetUrlId)}
                profile={state.selectedProfile}
                targetUrls={state.targetUrls}
                activeTargetUrlId={state.effectiveTargetUrlId}
                setActiveTargetUrlId={state.setActiveTargetUrlId}
                generationInProgress={state.generationInProgress}
                checkInProgress={state.checkInProgress}
                busy={busy}
              />

              <div className="flex-1 bg-card/10 overflow-hidden">
                {state.detailTab === "overview" ? (
                  <AuthProfileOverview
                    profile={state.selectedProfile}
                    caseLabel={state.caseLabel}
                    targetUrls={state.targetUrls}
                    onDelete={() => deleteAuthProfile(state.selectedProfile!.id)}
                    onEdit={() => state.openEditForm(state.selectedProfile!)}
                    onRefreshState={(targetUrlId) => state.handleRefreshState(state.selectedProfile!, targetUrlId)}
                    onSetPostLoginUrl={(targetUrlId, value) =>
                      setAuthProfilePostLoginUrl(state.selectedProfile!.id, targetUrlId, value)
                    }
                    onOpenSandbox={(targetUrlId, targetLabel) =>
                      state.setSandbox({ authProfileId: state.selectedProfile!.id, targetUrlId, targetLabel })
                    }
                    onOpenRuns={() => {
                      controller.setActiveRun(null)
                      controller.setActiveTaskRunId(null)
                      controller.setActiveRecorderSessionId(null)
                      controller.setActiveSection("runs")
                    }}
                    activeRefresh={state.activeRefresh && state.activeRefresh.profileId === state.selectedProfile.id ? state.activeRefresh : null}
                    busy={busy}
                  />
                ) : null}
                {state.detailTab === "script" ? (
                  <AuthProfileScript
                    profile={state.selectedProfile}
                    onCopy={state.handleCopyScript}
                    copied={state.copiedScript}
                    onGenerate={() => state.handleGenerate(state.selectedProfile!, state.effectiveTargetUrlId)}
                    busy={busy || state.generationInProgress}
                  />
                ) : null}
                {state.detailTab === "timeline" ? (
                  <AuthProfileTimeline
                    profile={state.selectedProfile}
                    task={state.isTaskForCurrent ? state.activeTask : null}
                  />
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>

      {state.sandbox ? (
        <AuthSandboxModal
          projectId={selectedProject.id}
          authProfileId={state.sandbox.authProfileId}
          targetUrlId={state.sandbox.targetUrlId}
          targetLabel={state.sandbox.targetLabel}
          onClose={() => state.setSandbox(null)}
          onSaved={() => {
            state.setSandbox(null)
            void refreshAuthProfiles()
          }}
        />
      ) : null}
    </div>
  )
}
