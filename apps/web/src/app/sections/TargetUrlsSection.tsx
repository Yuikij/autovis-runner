import { useState } from "react"
import type { TargetUrl } from "@browsewright/shared"
import { t } from "../../i18n/index.js"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { EmptyState } from "../components/empty-state"
import { PageHeader } from "../components/page-header"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { formatDateTime } from "../utils"

type Props = { controller: ReadyWorkspaceController }

const inputCls =
  "block w-full rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"

export function TargetUrlsSection({ controller }: Props) {
  const { selectedProject, busy, createTargetUrl, updateTargetUrl, deleteTargetUrl } = controller
  const targetUrls: TargetUrl[] = selectedProject.targetUrls ?? []

  const [showCreate, setShowCreate] = useState(false)
  const [createLabel, setCreateLabel] = useState("")
  const [createUrl, setCreateUrl] = useState("")
  const [createNeedsStealth, setCreateNeedsStealth] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editUrl, setEditUrl] = useState("")
  const [editNeedsStealth, setEditNeedsStealth] = useState(false)

  const handleCreate = async () => {
    if (!createLabel.trim() || !createUrl.trim()) return
    await createTargetUrl(createLabel.trim(), createUrl.trim(), createNeedsStealth)
    setCreateLabel("")
    setCreateUrl("")
    setCreateNeedsStealth(false)
    setShowCreate(false)
  }

  const startEdit = (tu: TargetUrl) => {
    setEditingId(tu.id)
    setEditLabel(tu.label)
    setEditUrl(tu.url)
    setEditNeedsStealth(Boolean(tu.needsStealth))
  }

  const handleUpdate = async () => {
    if (!editingId || !editLabel.trim() || !editUrl.trim()) return
    await updateTargetUrl(editingId, { label: editLabel.trim(), url: editUrl.trim(), needsStealth: editNeedsStealth })
    setEditingId(null)
  }

  const handleDelete = async (id: string) => {
    await deleteTargetUrl(id)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Target URLs"
        title={t("urls.title")}
        description={t("urls.description")}
        actions={
          <Button
            size="sm"
            onClick={() => setShowCreate((v) => !v)}
            disabled={busy}
            className="cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm mr-1">{showCreate ? "close" : "add"}</span>
            {showCreate ? t("urls.cancel") : t("urls.addUrl")}
          </Button>
        }
      />

      {showCreate ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("urls.createTitle")}</CardTitle>
            <CardDescription className="text-[11px]">
              {t("urls.createDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t("urls.labelField")}</label>
                <input
                  className={inputCls}
                  placeholder={t("urls.labelPlaceholder")}
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">URL</label>
                <input
                  className={inputCls}
                  placeholder="https://test.example.com"
                  value={createUrl}
                  onChange={(e) => setCreateUrl(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={busy || !createLabel.trim() || !createUrl.trim()}
                className="h-9 rounded-lg cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm mr-1">add</span>
                {t("urls.create")}
              </Button>
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 size-3.5 cursor-pointer accent-primary"
                checked={createNeedsStealth}
                onChange={(e) => setCreateNeedsStealth(e.target.checked)}
              />
              <span>
                {t("urls.stealthLabel")}
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  {t("urls.stealthHintCreate")}
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      ) : null}

      {targetUrls.length === 0 ? (
        <EmptyState
          title={t("urls.emptyTitle")}
          description={t("urls.emptyDescription")}
          actionLabel={t("urls.addUrl")}
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-3">
          {targetUrls.map((tu) => {
            const isEditing = editingId === tu.id
            return (
              <Card key={tu.id} className={`border-border/60 bg-card/50 transition-all ${isEditing ? "ring-1 ring-primary/30" : ""}`}>
                <CardContent className="py-4 px-5">
                  {isEditing ? (
                    <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] items-end">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t("urls.labelField")}</label>
                        <input
                          className={inputCls}
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">URL</label>
                        <input
                          className={inputCls}
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={handleUpdate}
                          disabled={busy || !editLabel.trim() || !editUrl.trim()}
                          className="h-8 rounded-lg cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm mr-1">save</span>
                          {t("urls.save")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          className="h-8 rounded-lg cursor-pointer border border-border/60"
                        >
                          {t("urls.cancel")}
                        </Button>
                      </div>
                      <label className="sm:col-span-3 flex items-start gap-2 text-xs text-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-3.5 cursor-pointer accent-primary"
                          checked={editNeedsStealth}
                          onChange={(e) => setEditNeedsStealth(e.target.checked)}
                        />
                        <span>
                          {t("urls.stealthLabel")}
                          <span className="block text-[10px] text-muted-foreground mt-0.5">
                            {t("urls.stealthHintEdit")}
                          </span>
                        </span>
                      </label>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="material-symbols-outlined text-lg text-muted-foreground shrink-0">language</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <strong className="text-sm font-semibold text-foreground">{tu.label}</strong>
                            {tu.isPrimary ? (
                              <Badge tone="info" className="text-[9px]">{t("urls.primaryBadge")}</Badge>
                            ) : null}
                            {tu.needsStealth ? (
                              <Badge tone="warning" className="text-[9px]">{t("urls.stealthBadge")}</Badge>
                            ) : null}
                          </div>
                          <p className="text-xs font-mono text-muted-foreground truncate mt-0.5" title={tu.url}>{tu.url}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground">{formatDateTime(tu.updatedAt)}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(tu)}
                          disabled={busy}
                          className="h-7 px-2 rounded-lg border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </Button>
                        {!tu.isPrimary ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(tu.id)}
                            disabled={busy}
                            className="h-7 px-2 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/60 italic">{t("urls.primaryCannotDelete")}</span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Usage hint */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground">info</span>
            {t("urls.usageTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed list-disc list-inside">
            <li><strong className="text-foreground">{t("urls.usagePrimaryTerm")}</strong> {t("urls.usagePrimaryDesc")}</li>
            <li><strong className="text-foreground">{t("urls.usageBaseUrlTerm")}</strong>{t("urls.usageBaseUrlDesc")}</li>
            <li>{t("urls.usageDropdown")}</li>
            <li>{t("urls.usageStorageState")}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
