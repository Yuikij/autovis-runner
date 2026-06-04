import { useState } from "react"
import type { AuthProfile, ValidationProgressStep, ValidationTask } from "@autovis/shared"
import { Badge } from "../../components/ui/badge"
import { EmptyState } from "../../components/empty-state"

const STEP_ICON: Record<NonNullable<ValidationProgressStep["kind"]>, string> = {
  init: "settings",
  browser: "open_in_browser",
  navigate: "explore",
  snapshot: "filter_center_focus",
  llm: "smart_toy",
  verify: "rule",
  save: "save",
  result: "flag",
}

export function TimelineStep({ step, isLast }: { step: ValidationProgressStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(step.status === "error" || step.status === "running")
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const dotClass = step.status === "done"
    ? "bg-emerald-500"
    : step.status === "error"
      ? "bg-rose-500"
      : step.status === "skipped"
        ? "bg-muted-foreground"
        : "bg-indigo-500 animate-pulse"
  const textClass = step.status === "error" ? "text-rose-600 dark:text-rose-400" : "text-foreground"
  const icon = step.kind ? STEP_ICON[step.kind] : "circle"
  const hasExpandable = Boolean(step.detail || step.codePreview || step.screenshotUrl || step.metaJson)

  return (
    <li className="relative flex gap-3">
      {!isLast ? <div className="absolute left-[11px] top-6 bottom-[-12px] w-[2px] rounded-full bg-border/70" /> : null}
      <div className="relative z-10 flex flex-col items-center mt-0.5">
        <div className={`flex items-center justify-center size-6 rounded-full bg-background border-2 ${step.status === "running" ? "border-indigo-500" : "border-border"}`}>
          <div className={`size-2.5 rounded-full ${dotClass}`} />
        </div>
      </div>
      <div className="flex-1 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
        <div
          className={`flex items-center justify-between gap-2 ${hasExpandable ? "cursor-pointer" : ""}`}
          onClick={() => hasExpandable && setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-base text-muted-foreground shrink-0">{icon}</span>
            <span className={`text-xs font-medium truncate ${textClass}`}>{step.label}</span>
            {step.iteration ? (
              <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded shrink-0">#{step.iteration}</span>
            ) : null}
          </div>
          {hasExpandable ? (
            <span className="material-symbols-outlined text-sm text-muted-foreground shrink-0">{expanded ? "expand_less" : "expand_more"}</span>
          ) : null}
        </div>

        {expanded && hasExpandable ? (
          <div className="mt-2 space-y-2">
            {step.detail ? (
              <p className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all ${step.status === "error" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
                {step.detail}
              </p>
            ) : null}
            {step.screenshotUrl ? (
              <div
                className="rounded-xl overflow-hidden border border-border/40 bg-black/40 max-w-md cursor-zoom-in group"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightboxUrl(step.screenshotUrl!)
                }}
              >
                <img src={step.screenshotUrl} alt={step.label} className="w-full h-auto max-h-64 object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
              </div>
            ) : null}
            {step.codePreview ? (
              <pre className="text-[11px] font-mono leading-relaxed text-foreground/90 bg-background/60 border border-border/40 rounded-lg p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {step.codePreview}
              </pre>
            ) : null}
            {step.metaJson ? (
              <details className="text-[11px] font-mono text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground select-none">meta</summary>
                <pre className="mt-1 p-2 bg-background/40 border border-border/30 rounded leading-relaxed whitespace-pre-wrap break-all">{step.metaJson}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur p-6 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="screenshot" className="max-w-full max-h-full rounded-2xl shadow-2xl" />
        </div>
      ) : null}
    </li>
  )
}

export function AuthProfileTimeline({ profile, task }: { profile: AuthProfile; task: ValidationTask | null }) {
  if (!task) {
    return (
      <div className="p-6">
        <EmptyState
          title="暂无执行日志"
          description={
            profile.validationScript
              ? "上一次生成结果已落库到『失效校验脚本』标签页。再次点击『生成』或『检查登录状态』时，这里会实时展示每一步过程。"
              : "点击右上角『生成失效条件』开始，AI 会在这里逐步展示双对照采集 → LLM → 验证回归 → 落库的执行过程。"
          }
        />
      </div>
    )
  }

  const titleByKind = task.kind === "check" ? "登录状态重放" : "失效校验脚本生成"

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-foreground">{titleByKind}</h4>
          <Badge tone={task.status === "completed" ? "success" : task.status === "error" ? "danger" : "warning"}>
            {task.status === "running" ? "执行中" : task.status === "completed" ? "已完成" : "失败"}
          </Badge>
          {task.kind === "check" && task.checkResult ? (
            <Badge tone={task.checkResult.valid ? "success" : "danger"}>
              {task.checkResult.valid ? "登录有效" : "登录无效"}
            </Badge>
          ) : null}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px]" title={task.id}>{task.id}</span>
      </div>

      <ol className="space-y-3">
        {task.steps.map((step, idx) => (
          <TimelineStep key={`${idx}-${step.label}`} step={step} isLast={idx === task.steps.length - 1} />
        ))}
        {task.steps.length === 0 ? (
          <li className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="size-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            正在启动…
          </li>
        ) : null}
      </ol>

      {task.status === "error" && task.error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-3 py-2">
          <p className="text-xs font-medium text-rose-700 dark:text-rose-300">任务终止</p>
          <p className="mt-1 text-[11px] font-mono text-rose-600 dark:text-rose-400 break-all">{task.error}</p>
        </div>
      ) : null}
    </div>
  )
}
