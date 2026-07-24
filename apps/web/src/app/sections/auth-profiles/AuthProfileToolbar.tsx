import type { AuthProfile, TargetUrl } from "@autovis/shared"
import { Button } from "../../components/ui/button"
import type { DetailTab } from "./useAuthProfilesState"

export function DetailTabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer bg-background text-foreground shadow-sm"
          : "px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  )
}

export function AuthProfileToolbar({
  detailTab,
  onChangeTab,
  onGenerate,
  onCheck,
  profile,
  targetUrls,
  activeTargetUrlId,
  setActiveTargetUrlId,
  generationInProgress,
  checkInProgress,
  busy,
}: {
  detailTab: DetailTab
  onChangeTab: (tab: DetailTab) => void
  onGenerate: () => void
  onCheck: () => void
  profile: AuthProfile
  targetUrls: TargetUrl[]
  activeTargetUrlId: string
  setActiveTargetUrlId: (id: string) => void
  generationInProgress: boolean
  checkInProgress: boolean
  busy: boolean
}) {
  const taskBusy = generationInProgress || checkInProgress
  const activeState = profile.states.find((s) => s.targetUrlId === activeTargetUrlId)
  const canCheck = Boolean(profile.validationScript && activeState?.storageStateJson)
  
  return (
    <div className="flex flex-wrap items-center gap-3 justify-between border-b border-border bg-secondary/10 px-4 py-2">
      <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-xl border border-border/40">
        <DetailTabButton active={detailTab === "overview"} onClick={() => onChangeTab("overview")}>概览</DetailTabButton>
        <DetailTabButton active={detailTab === "script"} onClick={() => onChangeTab("script")}>失效校验脚本</DetailTabButton>
        <DetailTabButton active={detailTab === "timeline"} onClick={() => onChangeTab("timeline")}>
          执行日志
          {taskBusy ? (
            <span className="ml-1 size-1.5 rounded-full bg-rose-500 animate-pulse inline-block align-middle" />
          ) : null}
        </DetailTabButton>
      </div>

      <div className="flex items-center gap-2">
        <select
          className="h-7 rounded-lg border border-border/60 bg-background/40 px-2 text-[11px] text-foreground"
          value={activeTargetUrlId}
          onChange={(e) => setActiveTargetUrlId(e.target.value)}
        >
          <option value="">选择 URL</option>
          {targetUrls.map((u) => (
            <option key={u.id} value={u.id}>{u.label} · {u.url}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
          onClick={onCheck}
          disabled={busy || !canCheck || taskBusy || !activeTargetUrlId}
        >
          <span className="material-symbols-outlined text-base">policy</span>
          {checkInProgress ? "检查中…" : "检查登录状态"}
        </Button>
        <Button
          size="sm"
          className="h-8 px-3 rounded-lg cursor-pointer"
          onClick={onGenerate}
          disabled={busy || taskBusy || !activeTargetUrlId}
        >
          <span className="material-symbols-outlined text-sm mr-1">smart_toy</span>
          {profile.validationScript ? "重新生成失效条件" : "生成失效条件"}
        </Button>
      </div>
    </div>
  )
}
