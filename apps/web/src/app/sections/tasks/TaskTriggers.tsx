import type { Dispatch, SetStateAction } from "react"

import type { ScheduleTrigger } from "@autovis/shared"

import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { Field, inputClassName } from "../../components/ui/field"
import { Badge } from "../../components/ui/badge"
import { describeTriggerKind, type TriggerFormState } from "./shared"
import { formatDateTime } from "../../utils"

type TaskTriggersProps = {
  busy: boolean
  deleteScheduleTrigger: (triggerId: string) => Promise<unknown>
  fireScheduleTrigger: (triggerId: string) => Promise<unknown>
  handleSaveTrigger: () => Promise<void>
  refreshHistory: () => Promise<void>
  refreshTriggers: () => Promise<void>
  setScheduleTriggerEnabled: (triggerId: string, enabled: boolean) => Promise<unknown>
  setTriggerForm: Dispatch<SetStateAction<TriggerFormState>>
  triggerForm: TriggerFormState
  triggers: ScheduleTrigger[]
}

export function TaskTriggers({
  busy,
  deleteScheduleTrigger,
  fireScheduleTrigger,
  handleSaveTrigger,
  refreshHistory,
  refreshTriggers,
  setScheduleTriggerEnabled,
  setTriggerForm,
  triggerForm,
  triggers,
}: TaskTriggersProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><span className="material-symbols-outlined text-primary text-lg">schedule</span>配置调度触发器</CardTitle>
        <CardDescription>支持为任务挂载一次性 (At) 或周期性 (Cron) 定时器。触发后会按上面设定的执行模式自动调起运行。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {triggers.length === 0 ? (
          <div className="relative rounded-xl border border-dashed border-border/80 bg-secondary/5 px-4 py-8 text-center flex flex-col items-center justify-center gap-2">
            <span className="material-symbols-outlined text-muted-foreground/60 text-xl">event_busy</span>
            <p className="text-xs text-muted-foreground">暂无活跃的触发器，请在下方新建。</p>
          </div>
        ) : (
          <div className="space-y-3">
            {triggers.map((trigger) => (
              <div key={trigger.id} className="relative overflow-hidden flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 hover:shadow-sm hover:border-primary/20 transition-all duration-200">
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${trigger.enabled ? "bg-emerald-500" : "bg-amber-500/50"}`} />

                <div className="min-w-0 pl-2.5 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong className="text-sm text-foreground font-semibold">{trigger.name || "未命名触发器"}</strong>
                    <Badge tone={trigger.enabled ? "success" : "warning"}>{trigger.enabled ? "已启用" : "已停用"}</Badge>
                    <span className="inline-flex items-center gap-1 text-[10px] bg-secondary border border-border/80 px-2 py-0.5 rounded-full text-muted-foreground font-mono">
                      <span className="material-symbols-outlined text-[11px] text-muted-foreground/60">{trigger.kind === "at" ? "calendar_today" : "autorenew"}</span>
                      {describeTriggerKind(trigger)}
                    </span>
                  </div>

                  <div className="flex gap-4 text-[10px] text-muted-foreground/80">
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[11px]">arrow_forward</span>下一次触发：<span className="font-mono">{trigger.nextFireAt ? formatDateTime(trigger.nextFireAt) : "—"}</span></span>
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[11px]">history</span>上一次触发：<span className="font-mono">{trigger.lastFiredAt ? formatDateTime(trigger.lastFiredAt) : "—"}</span></span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="ghost" className="h-8 px-2.5 border border-border/60 hover:bg-secondary rounded-lg text-xs" onClick={async () => { await fireScheduleTrigger(trigger.id); await refreshHistory() }}><span className="material-symbols-outlined text-sm mr-1 text-primary">play_arrow</span>测试触发</Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2.5 border border-border/60 hover:bg-secondary rounded-lg text-xs" onClick={async () => { await setScheduleTriggerEnabled(trigger.id, !trigger.enabled); await refreshTriggers() }}>{trigger.enabled ? "停用" : "启用"}</Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 px-0 border border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40 rounded-lg" onClick={async () => { await deleteScheduleTrigger(trigger.id); await refreshTriggers() }}><span className="material-symbols-outlined text-sm">delete</span></Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-border/80 bg-secondary/15 p-4 space-y-4">
          <span className="text-xs font-semibold text-foreground block">新建触发器</span>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">触发方式</span>
              <div className="grid grid-cols-2 p-1 rounded-lg bg-secondary border border-border/60">
                <button type="button" onClick={() => setTriggerForm((current) => ({ ...current, kind: "at" }))} className={`py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${triggerForm.kind === "at" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>单次触发 (At)</button>
                <button type="button" onClick={() => setTriggerForm((current) => ({ ...current, kind: "cron" }))} className={`py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${triggerForm.kind === "cron" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>周期性触发 (Cron)</button>
              </div>
            </div>

            <Field label="名称（可选）"><input className={inputClassName} value={triggerForm.name} onChange={(event) => setTriggerForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：每日 9 点跑早报" /></Field>

            {triggerForm.kind === "at" ? (
              <Field label="触发时间"><input className={inputClassName} type="datetime-local" value={triggerForm.atTime} onChange={(event) => setTriggerForm((current) => ({ ...current, atTime: event.target.value }))} /></Field>
            ) : (
              <Field label="cron 表达式" description="标准 Linux 5 字段 cron: 分 时 日 月 周"><input className={inputClassName} value={triggerForm.cronExpr} onChange={(event) => setTriggerForm((current) => ({ ...current, cronExpr: event.target.value }))} placeholder="0 9 * * *" /></Field>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" disabled={busy} onClick={() => void handleSaveTrigger()} className="rounded-lg shadow-sm"><span className="material-symbols-outlined text-sm">add</span>新建触发器</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}