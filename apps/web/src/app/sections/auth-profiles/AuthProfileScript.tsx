import type { AuthProfile } from "@autovis/shared"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { EmptyState } from "../../components/empty-state"
import { formatDateTime } from "../../utils"
import { t } from "../../../i18n/index.js"

export function AuthProfileScript({
  profile,
  onCopy,
  copied,
  onGenerate,
  busy,
}: {
  profile: AuthProfile
  onCopy: () => void
  copied: boolean
  onGenerate: () => void
  busy: boolean
}) {
  if (!profile.validationScript) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("auth.scriptEmptyTitle")}
          description={t("auth.scriptEmptyDescription")}
          actionLabel={busy ? t("auth.generating") : t("auth.generateNow")}
          onAction={busy ? undefined : onGenerate}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2 bg-secondary/20">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="material-symbols-outlined text-base">javascript</span>
          <span>{t("auth.scriptPaneTitle")}</span>
          {profile.validationScriptGeneratedAt ? (
            <Badge tone="default">{formatDateTime(profile.validationScriptGeneratedAt)}</Badge>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
          onClick={onCopy}
        >
          <span className="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
          {copied ? t("auth.copied") : t("auth.copyScript")}
        </Button>
      </div>
      <pre className="flex-1 m-0 p-4 text-[12px] leading-relaxed font-mono text-foreground/90 bg-background/40 overflow-auto whitespace-pre-wrap break-all">
        {profile.validationScript}
      </pre>
    </div>
  )
}
