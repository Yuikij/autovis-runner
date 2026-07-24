import { useMemo, useState, useEffect } from "react"
import type { AuthProfile, AuthProfileState, StorageStateSummary, TargetUrl } from "@autovis/shared"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { formatDateTime } from "../../utils"
import { t } from "../../../i18n/index.js"
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
    case "queued": return t("auth.statusQueued")
    case "running": return t("auth.statusRunning")
    case "paused": return t("auth.statusPaused")
    case "cancelling": return t("auth.statusCancelling")
    case "cancelled": return t("auth.statusCancelled")
    case "interrupted": return t("auth.statusInterrupted")
    case "passed": return t("auth.statusCompleted")
    case "failed": return t("auth.statusFailed")
    default: return t("auth.statusStarting")
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
        {expanded ? t("auth.collapseStorageState") : t("auth.expandStorageState")}
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
                      <th className="px-2 py-0.5 text-left font-medium">{t("auth.cookieName")}</th>
                      <th className="px-2 py-0.5 text-left font-medium">{t("auth.cookieDomain")}</th>
                      <th className="px-2 py-0.5 text-left font-medium">{t("auth.cookieExpires")}</th>
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
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">{t("auth.postLoginUrl")}</span>
          {effective ? (
            isOverridden ? (
              <Badge tone="info">{t("auth.manual")}</Badge>
            ) : (
              <Badge tone="default">{t("auth.auto")}</Badge>
            )
          ) : (
            <Badge tone="warning">{t("auth.notSet")}</Badge>
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
              {effective ? t("auth.override") : t("auth.set")}
            </button>
            {isOverridden ? (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer ml-1 disabled:opacity-50"
                onClick={handleResetAuto}
                disabled={disabled || saving}
                title={autoValue ? t("auth.resetAutoTitleWithValue", { value: autoValue }) : t("auth.resetAutoTitleNoValue")}
              >
                {saving ? t("auth.resetting") : t("auth.resetToAuto")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!editing ? (
        <p className="mt-0.5 text-[11px] font-mono text-foreground/90 break-all leading-relaxed" title={effective ?? t("auth.fallbackTitle", { url: targetUrl })}>
          {effective ?? <span className="text-muted-foreground italic">{t("auth.notSetFallback", { url: targetUrl })}</span>}
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
              {t("auth.autoValueLabel")}<span className="font-mono">{autoValue}</span>
              <button
                type="button"
                className="ml-1 text-primary hover:underline cursor-pointer"
                onClick={() => setDraft(autoValue)}
                disabled={saving}
              >
                {t("auth.fillBack")}
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
              {t("auth.cancel")}
            </button>
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50"
              onClick={handleSave}
              disabled={saving || draft.trim() === (effective ?? "")}
            >
              {saving ? t("auth.urlSaving") : (draft.trim() === "" ? t("auth.clearOverride") : t("auth.saveOverride"))}
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

  const [selectedTargetUrlId, setSelectedTargetUrlId] = useState<string>(targetUrls[0]?.id ?? "")

  useEffect(() => {
    if (targetUrls.length > 0 && (!selectedTargetUrlId || !targetUrls.find(t => t.id === selectedTargetUrlId))) {
      setSelectedTargetUrlId(targetUrls[0].id)
    }
  }, [targetUrls, selectedTargetUrlId])

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold tracking-tight">{profile.name}</h3>
          {profile.description ? (
            <p className="text-sm text-muted-foreground max-w-2xl">{profile.description}</p>
          ) : (
            <p className="text-xs text-muted-foreground/70 italic">{t("auth.noDescription")}</p>
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
            {t("auth.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 cursor-pointer"
            onClick={onDelete}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-base">delete</span>
            {t("auth.delete")}
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile
          label={t("auth.sourceCase")}
          tone="default"
          value={caseLabel ?? t("auth.notBound")}
          hint={`profileId · ${profile.id}`}
        />
        <StatusTile
          label={t("auth.validationScript")}
          tone={hasScript ? "info" : "warning"}
          value={hasScript ? t("auth.generated") : t("auth.notGenerated")}
          hint={hasScript ? t("auth.generatedAt", { time: formatDateTime(profile.validationScriptGeneratedAt) }) : t("auth.validationScriptHint")}
        />
        <StatusTile
          label={t("auth.urlStateCount")}
          tone={profile.states.length > 0 ? "success" : "danger"}
          value={t("auth.injectedRatio", { injected: profile.states.filter((s) => Boolean(s.storageStateJson)).length, total: targetUrls.length })}
          hint={t("auth.urlStateCountHint")}
        />
      </div>

      {/* Per-TargetUrl state matrix */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground">grid_view</span>
            {t("auth.matrixTitle")}
          </CardTitle>
          <CardDescription className="text-[11px] leading-relaxed">
            {t("auth.matrixDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {targetUrls.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">{t("auth.noUrlsConfigured")}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <select
                  className="flex-1 rounded-md border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={selectedTargetUrlId}
                  onChange={(e) => setSelectedTargetUrlId(e.target.value)}
                >
                  {targetUrls.map((tu) => (
                    <option key={tu.id} value={tu.id}>
                      {tu.label} {tu.isPrimary ? t("auth.primaryMark") : ""} · {tu.url}
                    </option>
                  ))}
                </select>
              </div>
              {(() => {
                const tu = targetUrls.find((t) => t.id === selectedTargetUrlId)
                if (!tu) return null

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
                          <p className="text-xs font-medium text-foreground truncate">{tu.label}{tu.isPrimary ? ` ${t("auth.primaryMark")}` : ""}</p>
                          <p className="text-[10px] font-mono text-muted-foreground truncate" title={tu.url}>{tu.url}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {hasState ? (
                          <span className="text-[10px] text-muted-foreground">
                            {state!.storageStateSummary ? `${state!.storageStateSummary.cookieCount} cookie · ${state!.storageStateSummary.originCount} origin` : t("auth.injected")}
                            {state!.lastRefreshedAt ? ` · ${formatDateTime(state!.lastRefreshedAt)}` : ""}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">{t("auth.notCollected")}</span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 rounded-lg border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                          onClick={() => onOpenSandbox(tu.id, tu.label)}
                          disabled={busy}
                          title={t("auth.sandboxButtonTitle")}
                        >
                          <span className="material-symbols-outlined text-sm mr-0.5">login</span>
                          {hasState ? t("auth.renew") : t("auth.manualLogin")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 rounded-lg border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                          onClick={() => onRefreshState(tu.id)}
                          disabled={busy || refreshRunning}
                          title={t("auth.refreshButtonTitle")}
                        >
                          <span className="material-symbols-outlined text-sm mr-0.5">play_arrow</span>
                          {refreshRunning ? t("auth.refreshing") : t("auth.refresh")}
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
                          <p className="text-emerald-600 dark:text-emerald-400">{t("auth.storageStateWritten")}</p>
                        ) : refreshTerminal ? (
                          <p className="text-rose-600 dark:text-rose-400">{t("auth.refreshFailed")}</p>
                        ) : null}
                        <button type="button" className="text-primary hover:underline cursor-pointer" onClick={onOpenRuns}>
                          {t("auth.viewDetails")}
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
              })()}
            </>
          )}
        </CardContent>
      </Card>

      {/* Injection behavior */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground">info</span>
            {t("auth.injectionTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed list-disc list-inside">
            <li>{t("auth.injectionLi1a")}<span className="font-mono text-foreground">newContext(&#123;storageState&#125;)</span>{t("auth.injectionLi1b")}<strong className="text-foreground">{t("auth.injectionLi1c")}</strong>{t("auth.injectionLi1d")}</li>
            <li>{t("auth.injectionLi2a")}<strong className="text-foreground">{t("auth.injectionLi2b")}</strong>{t("auth.injectionLi2c")}</li>
            <li>{t("auth.injectionLi3")}</li>
            <li>{t("auth.injectionLi4")}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
