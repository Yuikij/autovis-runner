import { useMemo, useState, useEffect } from "react"
import type { AuthProfile, AuthProfileState, StorageStateSummary, TargetUrl } from "@autovis/shared"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { formatDateTime } from "../../utils"
import type { ActiveRefresh } from "./useAuthProfilesState"

export function StatusTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone: "success" | "danger" | "warning" | "info" | "default"
}) {
  const toneClass: Record<typeof tone, string> = {
    success: "border-emerald-500/30 bg-emerald-500/5",
    danger: "border-rose-500/30 bg-rose-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    info: "border-blue-500/30 bg-blue-500/5",
    default: "border-border bg-card/40",
  }
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground truncate" title={value}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{hint}</p> : null}
    </div>
  )
}

function formatCookieExpires(expires?: number) {
  if (expires === undefined || expires < 0) return "Session"
  try {
    return new Date(expires * 1000).toLocaleString()
  } catch {
    return "-"
  }
}

export function runStatusLabel(status?: string) {
  switch (status) {
    case "queued": return "排队中"
    case "running": return "执行中"
    case "paused": return "已暂停"
    case "cancelling": return "取消中"
    case "cancelled": return "已取消"
    case "interrupted": return "已中断"
    case "passed": return "已完成"
    case "failed": return "失败"
    default: return "启动中"
  }
}

export function StorageStateCompact({ summary }: { summary: StorageStateSummary }) {
  const [expanded, setExpanded] = useState(false)
  if (summary.cookieCount === 0 && summary.originCount === 0) return null
  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="material-symbols-outlined text-[12px]">{expanded ? "expand_less" : "expand_more"}</span>
        {expanded ? "收起" : "展开"} StorageState 详情
      </button>
      {expanded ? (
        <div className="mt-1.5 space-y-2 pl-2 border-l-2 border-border/40">
          {summary.cookies.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Cookies ({summary.cookieCount})</p>
              <div className="max-h-36 overflow-auto rounded-lg border border-border/40 bg-background/40">
                <table className="w-full text-[10px]">
                  <thead className="bg-secondary/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-0.5 text-left font-medium">名称</th>
                      <th className="px-2 py-0.5 text-left font-medium">域</th>
                      <th className="px-2 py-0.5 text-left font-medium">过期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.cookies.map((cookie) => (
                      <tr key={`${cookie.domain}-${cookie.name}`} className="border-t border-border/30">
                        <td className="px-2 py-0.5 font-mono text-foreground truncate max-w-[140px]" title={cookie.name}>{cookie.name}</td>
                        <td className="px-2 py-0.5 font-mono text-muted-foreground truncate max-w-[140px]" title={cookie.domain}>{cookie.domain}</td>
                        <td className="px-2 py-0.5 text-muted-foreground">{formatCookieExpires(cookie.expires)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {summary.origins.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">localStorage ({summary.originCount})</p>
              {summary.origins.map((origin) => (
                <div key={origin.origin} className="rounded-lg border border-border/40 bg-background/40 px-2 py-1 text-[10px] mb-1">
                  <p className="font-mono text-foreground">{origin.origin}</p>
                  <p className="text-muted-foreground">{origin.localStorageKeys.length} keys{origin.localStorageKeys.length > 0 ? `: ${origin.localStorageKeys.slice(0, 5).join(", ")}${origin.localStorageKeys.length > 5 ? "…" : ""}` : ""}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function PostLoginUrlEditor({
  targetUrl,
  state,
  onSubmit,
  disabled,
}: {
  targetUrl: string
  state: AuthProfileState | undefined
  onSubmit: (value: string | null) => Promise<boolean>
  disabled: boolean
}) {
  const effective = state?.postLoginUrl
  const autoValue = state?.postLoginUrlAuto
  const overrideValue = state?.postLoginUrlOverride
  const isOverridden = Boolean(overrideValue && overrideValue.trim())

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(effective ?? "")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(effective ?? "")
  }, [effective, editing])

  const handleSave = async () => {
    const trimmed = draft.trim()
    setSaving(true)
    const ok = await onSubmit(trimmed === "" ? null : trimmed)
    setSaving(false)
    if (ok) setEditing(false)
  }

  const handleResetAuto = async () => {
    setSaving(true)
    const ok = await onSubmit(null)
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <div className="mt-2 rounded-lg border border-border/30 bg-background/40 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-[14px] text-muted-foreground shrink-0">my_location</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">登录后 URL</span>
          {effective ? (
            isOverridden ? (
              <Badge tone="info">手动</Badge>
            ) : (
              <Badge tone="default">自动</Badge>
            )
          ) : (
            <Badge tone="warning">未设置</Badge>
          )}
        </div>
        {!editing ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="text-[10px] text-primary hover:underline cursor-pointer disabled:opacity-50"
              onClick={() => setEditing(true)}
              disabled={disabled || saving}
            >
              {effective ? "改写" : "设置"}
            </button>
            {isOverridden ? (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer ml-1 disabled:opacity-50"
                onClick={handleResetAuto}
                disabled={disabled || saving}
                title={autoValue ? `回退到自动采集值：${autoValue}` : "清除手动覆盖（当前没有自动采集值）"}
              >
                {saving ? "重置中…" : "重置为自动"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!editing ? (
        <p className="mt-0.5 text-[11px] font-mono text-foreground/90 break-all leading-relaxed" title={effective ?? `未设置时回退到 ${targetUrl}`}>
          {effective ?? <span className="text-muted-foreground italic">未设置 · 回放将回退到 {targetUrl}</span>}
        </p>
      ) : (
        <div className="mt-1 space-y-1.5">
          <input
            className="block w-full rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-[11px] font-mono text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"
            placeholder={autoValue ?? targetUrl}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            autoFocus
          />
          {autoValue && draft !== autoValue ? (
            <p className="text-[10px] text-muted-foreground leading-tight">
              自动采集值：<span className="font-mono">{autoValue}</span>
              <button
                type="button"
                className="ml-1 text-primary hover:underline cursor-pointer"
                onClick={() => setDraft(autoValue)}
                disabled={saving}
              >
                填回
              </button>
            </p>
          ) : null}
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded border border-border/60 hover:bg-secondary/60 cursor-pointer disabled:opacity-50"
              onClick={() => { setEditing(false); setDraft(effective ?? "") }}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50"
              onClick={handleSave}
              disabled={saving || draft.trim() === (effective ?? "")}
            >
              {saving ? "保存中…" : (draft.trim() === "" ? "清除覆盖" : "保存为手动覆盖")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AuthProfileOverview({
  profile,
  caseLabel,
  targetUrls,
  onDelete,
  onEdit,
  onRefreshState,
  onSetPostLoginUrl,
  onOpenSandbox,
  onOpenRuns,
  activeRefresh,
  busy,
}: {
  profile: AuthProfile
  caseLabel: string | null
  targetUrls: TargetUrl[]
  onDelete: () => void
  onEdit: () => void
  onRefreshState: (targetUrlId: string) => void
  onSetPostLoginUrl: (targetUrlId: string, value: string | null) => Promise<boolean>
  onOpenSandbox: (targetUrlId: string, targetLabel: string) => void
  onOpenRuns: () => void
  activeRefresh: ActiveRefresh | null
  busy: boolean
}) {
  const hasScript = Boolean(profile.validationScript)
  const stateMap = useMemo(
    () => new Map(profile.states.map((s) => [s.targetUrlId, s])),
    [profile.states],
  )

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold tracking-tight">{profile.name}</h3>
          {profile.description ? (
            <p className="text-sm text-muted-foreground max-w-2xl">{profile.description}</p>
          ) : (
            <p className="text-xs text-muted-foreground/70 italic">未填写描述</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
            onClick={onEdit}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-base">edit</span>
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 cursor-pointer"
            onClick={onDelete}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-base">delete</span>
            删除
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile
          label="来源登录用例"
          tone="default"
          value={caseLabel ?? "未绑定"}
          hint={`profileId · ${profile.id}`}
        />
        <StatusTile
          label="失效校验脚本"
          tone={hasScript ? "info" : "warning"}
          value={hasScript ? "已生成" : "未生成"}
          hint={hasScript ? `生成时间 ${formatDateTime(profile.validationScriptGeneratedAt)}` : "用于在执行前检测登录态是否仍然有效"}
        />
        <StatusTile
          label="URL 状态数"
          tone={profile.states.length > 0 ? "success" : "danger"}
          value={`${profile.states.filter((s) => Boolean(s.storageStateJson)).length} / ${targetUrls.length} 已注入`}
          hint="每个 URL 独立采集和维护 storageState"
        />
      </div>

      {/* Per-TargetUrl state matrix */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground">grid_view</span>
            登录态 × URL 矩阵
          </CardTitle>
          <CardDescription className="text-[11px] leading-relaxed">
            每个项目 URL 对应一份独立的 storageState。点击"刷新"可独立跑来源登录用例采集该 URL 的登录数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {targetUrls.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">项目还没有配置任何 URL，请先在项目设置里添加。</p>
          ) : (
            targetUrls.map((tu) => {
              const state = stateMap.get(tu.id)
              const hasState = Boolean(state?.storageStateJson)
              const isRefreshing = activeRefresh?.targetUrlId === tu.id && activeRefresh.profileId === profile.id
              const refreshRun = isRefreshing ? activeRefresh?.run : null
              const refreshRunning = isRefreshing && (!refreshRun || refreshRun.status === "queued" || refreshRun.status === "running")
              const refreshTerminal = refreshRun && (refreshRun.status === "passed" || refreshRun.status === "failed" || refreshRun.status === "cancelled" || refreshRun.status === "interrupted")

              return (
                <div key={tu.id} className={`rounded-xl border px-4 py-3 ${hasState ? "border-emerald-500/20 bg-emerald-500/5" : "border-border/40 bg-background/40"}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`size-2 rounded-full shrink-0 ${hasState ? "bg-emerald-500" : "bg-rose-500"}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{tu.label}{tu.isPrimary ? " (主)" : ""}</p>
                        <p className="text-[10px] font-mono text-muted-foreground truncate" title={tu.url}>{tu.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasState ? (
                        <span className="text-[10px] text-muted-foreground">
                          {state!.storageStateSummary ? `${state!.storageStateSummary.cookieCount} cookie · ${state!.storageStateSummary.originCount} origin` : "已注入"}
                          {state!.lastRefreshedAt ? ` · ${formatDateTime(state!.lastRefreshedAt)}` : ""}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">未采集</span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 rounded-lg border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                        onClick={() => onOpenSandbox(tu.id, tu.label)}
                        disabled={busy}
                        title="打开真浏览器手动登录，保存登录态"
                      >
                        <span className="material-symbols-outlined text-sm mr-0.5">login</span>
                        {hasState ? "续期" : "手动登录"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 rounded-lg border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                        onClick={() => onRefreshState(tu.id)}
                        disabled={busy || refreshRunning}
                        title="跑来源登录用例自动采集登录态"
                      >
                        <span className="material-symbols-outlined text-sm mr-0.5">play_arrow</span>
                        {refreshRunning ? "刷新中…" : "刷新"}
                      </Button>
                    </div>
                  </div>

                  {/* Refresh status inline */}
                  {isRefreshing ? (
                    <div className="mt-2 rounded-lg border border-border/30 bg-background/40 px-3 py-1.5 text-[11px] space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge tone={
                          refreshRun?.status === "passed" ? "success" :
                            refreshRun?.status === "failed" || refreshRun?.status === "cancelled" || refreshRun?.status === "interrupted" ? "danger" :
                              "warning"
                        }>
                          {runStatusLabel(refreshRun?.status)}
                        </Badge>
                      </div>
                      {refreshTerminal && refreshRun?.status === "passed" ? (
                        <p className="text-emerald-600 dark:text-emerald-400">storageState 已写回</p>
                      ) : refreshTerminal ? (
                        <p className="text-rose-600 dark:text-rose-400">来源登录用例未通过，storageState 未更新</p>
                      ) : null}
                      <button type="button" className="text-primary hover:underline cursor-pointer" onClick={onOpenRuns}>
                        查看详情 →
                      </button>
                    </div>
                  ) : null}

                  {/* Post-login URL editor: 跟 storageState 1:1，回放时优先用它 */}
                  <PostLoginUrlEditor
                    targetUrl={tu.url}
                    state={state}
                    onSubmit={(value) => onSetPostLoginUrl(tu.id, value)}
                    disabled={busy}
                  />

                  {/* Inline storage state summary expandable */}
                  {hasState && state!.storageStateSummary ? (
                    <StorageStateCompact summary={state!.storageStateSummary} />
                  ) : null}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Injection behavior */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground">info</span>
            注入行为约定
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed list-disc list-inside">
            <li>用例执行时，Playwright 用 <span className="font-mono text-foreground">newContext(&#123;storageState&#125;)</span> 整体注入：<strong className="text-foreground">全部 cookie 和 origin 的 localStorage 会被替换覆盖</strong>。</li>
            <li>注入完成后浏览器首跳到<strong className="text-foreground">"登录后 URL"</strong>（若未配置则回退到 targetUrl 根域名），脚本看到的是用户登录完成后的真实落地页。</li>
            <li>"登录后 URL"在刷新登录态时自动采集（取来源测试集跑完后浏览器停留的页面）；也可以在下方手动覆盖，刷新不会冲掉手改。</li>
            <li>每个 URL 的 storageState 和登录后 URL 都独立维护，刷新一个不会影响其他 URL 的数据。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
