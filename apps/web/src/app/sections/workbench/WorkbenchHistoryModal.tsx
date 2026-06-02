import { useState } from "react"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { EmptyState } from "../../components/empty-state"
import { formatDateTime } from "../../utils"
import { useConfirm } from "../../components/ui/confirm"
import type { ScriptArtifact } from "@autovis/shared"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

function scriptLabel(script: ScriptArtifact) {
  return script.source === "manual" ? "手动录制" : "AI 生成"
}

export type WorkbenchHistoryModalProps = {
  controller: ReadyWorkspaceController
  onClose: () => void
}

export function WorkbenchHistoryModal({ controller, onClose }: WorkbenchHistoryModalProps) {
  const { scripts, selectedScript, setSelectedScriptId, deleteScriptVersion, deleteScriptVersions } = controller
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const confirm = useConfirm()

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return
    const confirmed = await confirm(`确定要删除选中的 ${selectedIds.length} 个脚本版本吗？此操作不可恢复。`)
    if (!confirmed) return
    try {
      await deleteScriptVersions(selectedIds)
      setSelectedIds([])
    } catch (e) {
      // Error is already logged / set by action
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-300 cursor-pointer"
        onClick={onClose}
      />
      <Card className="relative w-full max-w-2xl max-h-[80vh] flex flex-col shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6)] border border-border/80 bg-card/95 overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/80 px-6 py-4">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">history</span>
              脚本历史版本
            </CardTitle>
            <CardDescription className="mt-1">
              选择一个已保存的版本，切换后可以直接在右侧进行验证或查阅。
            </CardDescription>
          </div>
          <button
            type="button"
            className="size-8 rounded-full bg-secondary/80 border border-border/60 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
            onClick={onClose}
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3 min-h-0">
          {scripts.length === 0 ? (
            <EmptyState 
              title="暂无已保存脚本" 
              description="生成或录制并保存后，这里会出现脚本历史版本。" 
            />
          ) : (
            <>
              {/* Batch Actions Row */}
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={scripts.length > 0 && selectedIds.length === scripts.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(scripts.map(s => s.id))
                      } else {
                        setSelectedIds([])
                      }
                    }}
                    className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary shrink-0"
                  />
                  <span className="text-xs text-muted-foreground">
                    全选 ({selectedIds.length}/{scripts.length})
                  </span>
                </label>
                {selectedIds.length > 0 && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={handleBatchDelete}
                    className="cursor-pointer flex items-center gap-1 h-8 text-xs px-3"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                    批量删除
                  </Button>
                )}
              </div>

              {/* Scripts List */}
              <div className="grid gap-3 flex-1 overflow-y-auto pr-1">
                {scripts.map((script) => {
                  const active = script.id === selectedScript?.id
                  const isChecked = selectedIds.includes(script.id)
                  return (
                    <div
                      key={script.id}
                      onClick={() => {
                        if (isChecked) {
                          setSelectedIds(selectedIds.filter(id => id !== script.id))
                        } else {
                          setSelectedIds([...selectedIds, script.id])
                        }
                      }}
                      className={`flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                        active 
                          ? "border-primary bg-primary/5 shadow-sm" 
                          : isChecked
                          ? "border-primary/45 bg-primary/5"
                          : "border-border bg-secondary/20 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            e.stopPropagation()
                            if (e.target.checked) {
                              setSelectedIds([...selectedIds, script.id])
                            } else {
                              setSelectedIds(selectedIds.filter(id => id !== script.id))
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="size-4 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary shrink-0"
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-sm text-foreground">
                              v{script.version}
                            </span>
                            <Badge tone={script.source === "manual" ? "default" : "success"}>
                              {scriptLabel(script)}
                            </Badge>
                            {active && (
                              <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] py-0 px-1.5 h-4 flex items-center">
                                当前载入
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            创建时间: {formatDateTime(script.createdAt)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {!active ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelectedScriptId(script.id)
                              onClose()
                            }}
                            className="cursor-pointer"
                          >
                            载入此版本
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground flex items-center justify-center p-2">
                            <span className="material-symbols-outlined text-sm text-success">check_circle</span>
                            已载入
                          </span>
                        )}
                        
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer h-8 w-8 p-0"
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (await confirm("确定要删除此脚本版本吗？此操作不可恢复。")) {
                              await deleteScriptVersion(script.id)
                            }
                          }}
                          title="删除此版本"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
        
        <div className="border-t border-border/80 px-6 py-4 flex justify-end bg-secondary/10">
          <Button variant="ghost" onClick={onClose} className="cursor-pointer">
            关闭窗口
          </Button>
        </div>
      </Card>
    </div>
  )
}
