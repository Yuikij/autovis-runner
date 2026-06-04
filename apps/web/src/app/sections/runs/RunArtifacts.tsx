import type { ExecutionRun } from "@autovis/shared"

import { EmptyState } from "../../components/empty-state"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { formatDateTime, formatDuration, resolveUrl, translateArtifactKind, translateStatus } from "../../utils"

const translateRunPhase = (phase?: ExecutionRun["orchestrationPhase"]) => {
  if (phase === "preconditions") return "前置依赖中"
  if (phase === "target") return "目标脚本中"
  if (phase === "archive") return "归档中"
  return "未分阶段"
}

type RunArtifactsProps = {
  executionActiveRun: ExecutionRun | null
  onRepairRun: (runId: string) => void
}

export function RunArtifacts({ executionActiveRun, onRepairRun }: RunArtifactsProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-border/40">
        <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">运行诊断与产物</span>
      </div>

      {executionActiveRun ? (
        <Card className="border-border bg-card/65 shadow-md rounded-xl overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/40 bg-secondary/10">
            <CardTitle className="text-xs font-bold text-foreground">当前运行元数据</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-xs space-y-3">
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">开始时间</span><span className="font-semibold text-foreground mt-0.5">{formatDateTime(executionActiveRun.startedAt)}</span></div>
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">运行时长</span><span className="font-semibold text-foreground mt-0.5">{formatDuration(executionActiveRun.startedAt, executionActiveRun.finishedAt)}</span></div>
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">状态</span><span className="font-semibold text-foreground mt-0.5">{translateStatus(executionActiveRun.status)}</span></div>
              <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">执行阶段</span><span className="font-semibold text-foreground mt-0.5">{translateRunPhase(executionActiveRun.orchestrationPhase)}</span></div>
            </div>
            {executionActiveRun.preconditionSummary?.length ? (
              <div className="mt-2 pt-2 border-t border-border/30">
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide block mb-1">前置依赖</span>
                <p className="text-foreground leading-relaxed font-medium">{executionActiveRun.preconditionSummary.join("、")}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {executionActiveRun?.status === "failed" ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3 shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-500">auto_fix_high</span>
            <strong className="text-xs font-semibold text-foreground">脚本执行失败！建议使用 AI 诊断与修复</strong>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed font-sans">
            智能体可以在您的代码库中自动定位报错脚本、匹配报错日志、分析 DOM 快照，并修复异常的指令与 Selector 路径。
          </p>
          <Button
            onClick={() => onRepairRun(executionActiveRun.id)}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-750 hover:to-indigo-750 text-white shadow-md border-0 py-2.5 rounded-xl transition duration-200 cursor-pointer font-semibold text-xs"
          >
            <span className="material-symbols-outlined text-sm animate-pulse">auto_fix_high</span>
            一键进行 AI 智能修复
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">下载执行产物 ({executionActiveRun?.artifacts.length ?? 0})</div>
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
          <EmptyState description="执行完成后，这里会显示 trace、video、截图等产物。" title="未产生任何产物" />
        )}
      </div>
    </div>
  )
}