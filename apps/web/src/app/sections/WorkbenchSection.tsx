import { useState } from "react"
import { EmptyState } from "../components/empty-state"
import { Button } from "../components/ui/button"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { WorkbenchSidebar } from "./workbench/WorkbenchSidebar"
import { WorkbenchCodeView } from "./workbench/WorkbenchCodeView"
import { WorkbenchRepoView } from "./workbench/WorkbenchRepoView"
import { WorkbenchSandbox } from "./workbench/WorkbenchSandbox"
import { WorkbenchHistoryModal } from "./workbench/WorkbenchHistoryModal"

type WorkbenchSectionProps = {
  controller: ReadyWorkspaceController
}

export function WorkbenchSection({ controller }: WorkbenchSectionProps) {
  const {
    selectedCase,
    selectedProject,
    latestScript,
    selectedScript,
    scripts,
    startVerification,
    busy,
    activeRecorderSession,
    lastTargetUrlId,
    setLastTargetUrlId,
    startRecorder,
    stopRecorder,
  } = controller

  const targetUrls = selectedProject.targetUrls ?? []
  const [mode, setMode] = useState<"generate" | "record">("generate")
  const [targetUrlId, setTargetUrlId] = useState<string>(() =>
    lastTargetUrlId || targetUrls.find((u) => u.isPrimary)?.id || targetUrls[0]?.id || "",
  )
  const selectedTargetUrl = targetUrls.find((u) => u.id === targetUrlId)
  const navigateUrl = selectedTargetUrl?.url ?? ""
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [workspaceTab, setWorkspaceTab] = useState<"code" | "repo" | "sandbox">("code")
  const [isDirty, setIsDirty] = useState(false)

  const handleCopy = () => {
    const code = selectedScript?.code ?? latestScript?.code
    if (code) {
      navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const recorderRunning = activeRecorderSession?.status === "running" || activeRecorderSession?.status === "starting"
  const verificationScriptId = selectedCase?.latestScriptId ?? latestScript?.id

  if (!selectedCase) {
    return (
      <EmptyState
        actionLabel="前往测试集与用例"
        description="选择测试用例后，可生成脚本、保存录制结果、查看历史版本，并在当前工作台内直接验证已有脚本。"
        onAction={() => controller.setActiveSection("cases")}
        title="AI 自动化脚本工作台"
      />
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-xs text-muted-foreground select-none pb-2 border-b border-border/30">
        <span className="hover:text-foreground cursor-pointer transition-colors" onClick={() => controller.setActiveSection("cases")}>测试集与用例</span>
        <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
        <span className="font-mono bg-secondary/80 text-secondary-foreground px-2 py-0.5 rounded border border-border/40 font-semibold text-[10px]">
          {selectedCase.caseCode}
        </span>
        <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
        <span className="truncate text-foreground font-medium max-w-[300px] sm:max-w-[500px]" title={selectedCase.purpose}>
          {selectedCase.purpose}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr] items-start">
        {/* Left Panel: Sticky Sidebar */}
        <WorkbenchSidebar 
          controller={controller} 
          mode={mode} 
          setMode={setMode} 
          targetUrlId={targetUrlId} 
          setTargetUrlId={(next) => {
            setTargetUrlId(next)
            setLastTargetUrlId(next)
            if (typeof window !== "undefined") {
              if (next) localStorage.setItem("autovis_last_target_url_id", next)
              else localStorage.removeItem("autovis_last_target_url_id")
            }
          }}
          setWorkspaceTab={setWorkspaceTab}
        />

        {/* Right Panel: Tabbed Workspace */}
        <main className="flex flex-col border border-border/80 bg-card/20 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm">
          {/* Header Tab selector and actions */}
          <div className="flex border-b border-border bg-secondary/10 px-4 py-2 justify-between items-center flex-wrap gap-3">
            <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-xl border border-border/40">
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${workspaceTab === "code" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setWorkspaceTab("code")}
                type="button"
              >
                代码视图
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${workspaceTab === "repo" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setWorkspaceTab("repo")}
                type="button"
              >
                仓库文件
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${workspaceTab === "sandbox" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setWorkspaceTab("sandbox")}
                type="button"
              >
                沙盒控制台
              </button>
            </div>

            {workspaceTab === "code" ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsHistoryOpen(true)}
                  className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">history</span>
                  历史版本
                  {scripts.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-secondary-foreground/10 text-muted-foreground font-mono">
                      {scripts.length}
                    </span>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopy}
                  className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
                  disabled={!(selectedScript?.code ?? latestScript?.code)}
                >
                  <span className="material-symbols-outlined text-base">
                    {copied ? "check" : "content_copy"}
                  </span>
                  {copied ? "已复制" : "复制代码"}
                </Button>
              </div>
            ) : workspaceTab === "repo" ? (
              <div className="text-xs text-muted-foreground">查看仓库目录、搜索结果与文件内容。</div>
            ) : (
              <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
                {mode === "generate" ? (
                  <>
                    <select
                      className="h-8 rounded-xl border border-border/60 bg-secondary/80 px-2 text-xs text-foreground w-full sm:w-[240px]"
                      value={targetUrlId}
                      onChange={(event) => {
                        const next = event.target.value
                        setTargetUrlId(next)
                        setLastTargetUrlId(next)
                        if (typeof window !== "undefined") {
                          if (next) localStorage.setItem("autovis_last_target_url_id", next)
                          else localStorage.removeItem("autovis_last_target_url_id")
                        }
                      }}
                    >
                      <option value="">选择目标 URL</option>
                      {targetUrls.map((url) => (
                        <option key={url.id} value={url.id}>{url.label} · {url.url}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={busy || !verificationScriptId || !targetUrlId || isDirty}
                      onClick={() => verificationScriptId && startVerification(verificationScriptId, targetUrlId)}
                      className="rounded-lg shadow-sm shrink-0 cursor-pointer h-8 px-3"
                    >
                      <span className="material-symbols-outlined text-sm mr-1">play_arrow</span>
                      启动验证
                    </Button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-secondary/40 border border-border/40 rounded-xl px-3 py-1.5 w-full sm:w-[240px] select-none">
                      <span className="material-symbols-outlined text-muted-foreground text-xs mr-1.5">language</span>
                      <div className="w-full bg-transparent text-xs text-muted-foreground truncate font-mono">
                        {activeRecorderSession?.currentUrl || navigateUrl || "未启动录制"}
                      </div>
                    </div>
                    {recorderRunning ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 font-medium bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded-lg mr-1 select-none">
                          <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
                          录制中
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || !verificationScriptId || !targetUrlId || isDirty}
                          onClick={() => verificationScriptId && startVerification(verificationScriptId, targetUrlId)}
                          className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm mr-1">play_arrow</span>
                          单独验证
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => stopRecorder(activeRecorderSession!.id, false)}
                          className="h-8 px-2.5 rounded-lg cursor-pointer bg-red-650 hover:bg-red-700 text-white"
                        >
                          <span className="material-symbols-outlined text-sm mr-1">save</span>
                          停止并保存
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => stopRecorder(activeRecorderSession!.id, true)}
                          variant="ghost"
                          className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm mr-1">verified</span>
                          保存并验证
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        size="sm" 
                        disabled={busy || !targetUrlId} 
                        onClick={() => startRecorder(targetUrlId)}
                        className="h-8 px-3 rounded-lg cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm mr-1">fiber_manual_record</span>
                        启动远程录制
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Workspace content */}
          <div className="flex-1 bg-card/10">
            {workspaceTab === "code" && (
              <WorkbenchCodeView controller={controller} isDirty={isDirty} setIsDirty={setIsDirty} />
            )}
            {workspaceTab === "repo" && (
              <WorkbenchRepoView controller={controller} />
            )}
            {workspaceTab === "sandbox" && (
              <WorkbenchSandbox 
                controller={controller} 
                mode={mode} 
                setMode={setMode} 
                navigateUrl={navigateUrl} 
                lastPointer={lastPointer}
                setLastPointer={setLastPointer}
                setWorkspaceTab={setWorkspaceTab}
              />
            )}
          </div>
        </main>
      </div>

      {isHistoryOpen && (
        <WorkbenchHistoryModal controller={controller} onClose={() => setIsHistoryOpen(false)} />
      )}
    </div>
  )
}
