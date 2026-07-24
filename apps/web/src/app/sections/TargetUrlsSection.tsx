import { useState } from "react"
import type { TargetUrl } from "@autovis/shared"
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
        title="目标网址管理"
        description="为当前项目配置多个目标网址（如测试环境、预发环境、生产环境等），所有需要选 URL 的地方都会以下拉框形式引用这些配置。"
        actions={
          <Button
            size="sm"
            onClick={() => setShowCreate((v) => !v)}
            disabled={busy}
            className="cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm mr-1">{showCreate ? "close" : "add"}</span>
            {showCreate ? "取消" : "添加网址"}
          </Button>
        }
      />

      {showCreate ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">新增目标网址</CardTitle>
            <CardDescription className="text-[11px]">
              添加后，任务执行、AI 工作台、录制、登录态刷新等操作均可选择此 URL。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">标签</label>
                <input
                  className={inputCls}
                  placeholder="例如：测试环境"
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
                创建
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
                使用真实浏览器（反检测有头回放）
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  仅京东等反检测敏感站点需要开启；内网/普通站点保持关闭即可后台无头执行。任务编排里可对单个用例单独覆盖。
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      ) : null}

      {targetUrls.length === 0 ? (
        <EmptyState
          title="暂无目标网址"
          description="点击上方『添加网址』按钮，为项目配置第一个目标网址。项目设置里的『主域名』会自动同步成主网址，但日常 AI 生成 / 运行 / 录制都改在工作台下拉显式选 URL。"
          actionLabel="添加网址"
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
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">标签</label>
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
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          className="h-8 rounded-lg cursor-pointer border border-border/60"
                        >
                          取消
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
                          使用真实浏览器（反检测有头回放）
                          <span className="block text-[10px] text-muted-foreground mt-0.5">
                            仅京东等反检测敏感站点需要开启；内网/普通站点保持关闭即可后台无头执行。
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
                              <Badge tone="info" className="text-[9px]">主域名</Badge>
                            ) : null}
                            {tu.needsStealth ? (
                              <Badge tone="warning" className="text-[9px]">真实浏览器</Badge>
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
                          <span className="text-[10px] text-muted-foreground/60 italic">主域名不可删除</span>
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
            使用说明
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed list-disc list-inside">
            <li><strong className="text-foreground">主域名</strong> 来自项目设置里的「主域名」字段，仅在首次创建项目时自动同步，不可删除。</li>
            <li><strong className="text-foreground">project.testBaseUrl 已不再作为业务运行 URL 兜底</strong>：AI 生成 / 录制 / 任务执行均必须在工作台下拉里显式选一个目标 URL。</li>
            <li>所有"选择 URL"的下拉框（任务执行、AI 工作台、录制、登录态管理等）都引用此处的网址列表。</li>
            <li>登录状态按 URL 维度独立存储 storageState，新增 URL 后可以到『登录状态』页面为其单独刷新登录态。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
