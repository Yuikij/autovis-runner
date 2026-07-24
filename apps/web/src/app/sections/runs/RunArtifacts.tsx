import type { ExecutionRun } from "@autovis/shared"

import { EmptyState } from "../../components/empty-state"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { formatDateTime, formatDuration, resolveUrl, translateArtifactKind, translateStatus } from "../../utils"
import { t } from "../../../i18n/index.js"

const translateRunPhase = (phase?: ExecutionRun["orchestrationPhase"]) => {
  if (phase === "preconditions") return t("runs.phasePreconditions")
  if (phase === "target") return t("runs.phaseTarget")
  if (phase === "archive") return t("runs.phaseArchive")
  return t("runs.phaseNone")
}

const ACTIVE_RUN_STATUSES: ExecutionRun["status"][] = ["idle", "queued", "running", "paused", "cancelling", "awaiting_human"]

type RunArtifactsProps = {
  executionActiveRun: ExecutionRun | null
  onRepairRun: (runId: string) => void
  onDeleteRun?: (runId: string) => void
  onDeleteArtifacts?: (runId: string) => void
  busy?: boolean
}

export function RunArtifacts({ executionActiveRun, onRepairRun, onDeleteRun, onDeleteArtifacts, busy }: RunArtifactsProps) {
  const isRunActive = executionActiveRun ? ACTIVE_RUN_STATUSES.includes(executionActiveRun.status) : false
  const hasArtifacts = (executionActiveRun?.artifacts.length ?? 0) > 0
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-border/40">
        <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">{t("runs.diagnosticsAndArtifacts")}</span>
      </div>

      {executionActiveRun ? (
        <Card className="border-border bg-card/65 shadow-md rounded-xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/40 bg-secondary/10">
            <CardTitle className="text-xs font-bold text-foreground">{t("runs.currentRunMeta")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-xs space-y-3">
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{t("runs.startTime")}</span><span className="font-semibold text-foreground mt-0.5">{formatDateTime(executionActiveRun.startedAt)}</span></div>
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{t("runs.duration")}</span><span className="font-semibold text-foreground mt-0.5">{formatDuration(executionActiveRun.startedAt, executionActiveRun.finishedAt)}</span></div>
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{t("runs.status")}</span><span className="font-semibold text-foreground mt-0.5">{translateStatus(executionActiveRun.status)}</span></div>
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{t("runs.executionPhase")}</span><span className="font-semibold text-foreground mt-0.5">{translateRunPhase(executionActiveRun.orchestrationPhase)}</span></div>
            </div>
            {executionActiveRun.preconditionSummary?.length ? (
              <div className="mt-2 pt-2 border-t border-border/30">
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide block mb-1">{t("runs.preconditions")}</span>
                <p className="text-foreground leading-relaxed font-medium">{executionActiveRun.preconditionSummary.join(t("runs.listSeparator"))}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {executionActiveRun?.status === "failed" ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3 shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-500">auto_fix_high</span>
            <strong className="text-xs font-semibold text-foreground">{t("runs.repairBannerTitle")}</strong>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed font-sans">
            {t("runs.repairBannerDescription")}
          </p>
          <Button
            onClick={() => onRepairRun(executionActiveRun.id)}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-750 hover:to-indigo-750 text-white shadow-md border-0 py-2.5 rounded-xl transition duration-200 cursor-pointer font-semibold text-xs"
          >
            <span className="material-symbols-outlined text-sm animate-pulse">auto_fix_high</span>
            {t("runs.repairBannerAction")}
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t("runs.downloadArtifacts", { count: executionActiveRun?.artifacts.length ?? 0 })}</div>
        {executionActiveRun?.artifacts.length ? (
          <div className="grid gap-2.5">
            {executionActiveRun.artifacts.map((artifact) => {
              let artifactIcon = "file_present"
              if (artifact.kind === "video") artifactIcon = "videocam"
              if (artifact.kind === "trace") artifactIcon = "analytics"
              if (artifact.kind === "screenshot") artifactIcon = "image"

              return (
                <a
                  className="flex items-center justify-between rounded-xl border border-border/80 bg-card hover:bg-secondary/40 px-4 py-3 text-xs transition hover:shadow-sm"
                  href={resolveUrl(artifact.url)}
                  key={artifact.name}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="material-symbols-outlined text-primary text-base shrink-0">{artifactIcon}</span>
                    <div className="truncate text-left">
                      <p className="font-semibold text-foreground">{translateArtifactKind(artifact.kind)}</p>
                      <p className="text-[10px] text-muted-foreground truncate max-w-[200px] mt-0.5">{artifact.name}</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-muted-foreground text-sm shrink-0">download</span>
                </a>
              )
            })}
          </div>
        ) : (
          <EmptyState description={t("runs.noArtifactsDescription")} title={t("runs.noArtifactsTitle")} />
        )}
      </div>

      {executionActiveRun && (onDeleteRun || onDeleteArtifacts) ? (
        <div className="space-y-3 pt-2 border-t border-border/40">
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t("runs.dangerZone")}</div>
          {isRunActive ? (
            <p className="text-[11px] text-muted-foreground italic">{t("runs.deleteLockedHint")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2.5">
            {onDeleteArtifacts ? (
              <Button
                variant="ghost"
                disabled={busy || isRunActive || !hasArtifacts}
                onClick={() => onDeleteArtifacts(executionActiveRun.id)}
                className="rounded-xl border border-border hover:bg-secondary/60 text-xs h-9 cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">mop</span>
                {t("runs.deleteArtifactsOnly")}
              </Button>
            ) : null}
            {onDeleteRun ? (
              <Button
                variant="ghost"
                disabled={busy || isRunActive}
                onClick={() => onDeleteRun(executionActiveRun.id)}
                className="rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10 text-xs h-9 cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">delete</span>
                {t("runs.deleteRunRecord")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}