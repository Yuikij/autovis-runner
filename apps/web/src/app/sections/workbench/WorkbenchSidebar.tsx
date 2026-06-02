import { useMemo, useState } from "react"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { inputClassName, textareaClassName } from "../../components/ui/field"
import { translateStatus } from "../../utils"
import type { RecorderInteractionRequest } from "@autovis/shared"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

export type WorkbenchSidebarProps = {
  controller: ReadyWorkspaceController
  mode: "generate" | "record"
  setMode: (mode: "generate" | "record") => void
  targetUrlId: string
  setTargetUrlId: (id: string) => void
  setWorkspaceTab: (tab: "code" | "repo" | "sandbox") => void
}

export function WorkbenchSidebar({ 
  controller, 
  mode, 
  setMode, 
  targetUrlId, 
  setTargetUrlId,
  setWorkspaceTab
}: WorkbenchSidebarProps) {
  const {
    testCases,
    selectedCase,
    selectedProject,
    prompt,
    setPrompt,
    agentSession,
    generateScript,
    busy,
    setSelectedCaseId,
    setSelectedScriptId,
    selectedCaseId,
    llmSession,
    activeRecorderSession,
    sendRecorderInteraction,
  } = controller
  const targetUrls = selectedProject.targetUrls ?? []
  const selectedTargetUrl = targetUrls.find((u) => u.id === targetUrlId)
  const navigateUrl = selectedTargetUrl?.url ?? ""

  const [interactionValue, setInteractionValue] = useState("")

  const isConnected = llmSession.connectionStatus === "connected"
  const agentRunning = agentSession?.status === "running"
  const recorderRunning = activeRecorderSession?.status === "running" || activeRecorderSession?.status === "starting"

  const lastRecordedTarget = useMemo(() => {
    const actions = activeRecorderSession?.actions ?? []
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      const action = actions[index]
      if (action.selector || action.label || action.placeholder || action.text) {
        return action
      }
    }
    return null
  }, [activeRecorderSession?.actions])

  const handleCaseChange = (caseId: string) => {
    setSelectedCaseId(caseId || null)
    setSelectedScriptId(null)
  }

  const sendInteraction = async (interaction: RecorderInteractionRequest) => {
    if (!activeRecorderSession) {
      return
    }
    await sendRecorderInteraction(activeRecorderSession.id, interaction)
  }

  if (!selectedCase) return null

  return (
    <>
      <aside className="lg:sticky lg:top-6 space-y-5 border border-border/80 bg-card/50 backdrop-blur-md rounded-2xl p-5 shadow-sm">
      {/* Header Context Selectors */}
      <div className="space-y-3 pb-4 border-b border-border/40">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">当前用例</span>
          {selectedCase.moduleName ? (
            <Badge className="bg-secondary text-secondary-foreground font-mono">{selectedCase.moduleName}</Badge>
          ) : null}
        </div>
        
        <div className="space-y-2">
          {/* Case selector */}
          <div className="flex items-center justify-between text-sm py-1 border-b border-dashed border-border/30">
            <span className="text-muted-foreground text-xs">测试用例：</span>
            <select 
              className="bg-transparent hover:bg-secondary/40 border-0 focus:ring-0 cursor-pointer font-medium text-foreground py-0.5 px-2 rounded-lg text-xs max-w-[200px] text-right truncate outline-none"
              onChange={(event) => handleCaseChange(event.target.value)} 
              value={selectedCaseId ?? ""}
            >
              <option value="">选择测试用例...</option>
              {testCases.map((testCase) => (
                <option key={testCase.id} value={testCase.id}>{testCase.caseCode} - {testCase.moduleName}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="text-xs text-muted-foreground pt-1">
          <span className="font-semibold text-foreground">预期结果：</span>{selectedCase.expectedResult}
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="space-y-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">运行模式</span>
        <div className="relative flex rounded-xl bg-secondary/50 p-1 border border-border/40">
          <button 
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg z-10 transition-all cursor-pointer ${mode === "generate" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setMode("generate")}
            type="button"
          >
            AI 生成
          </button>
          <button 
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg z-10 transition-all cursor-pointer ${mode === "record" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => {
              setMode("record")
              setWorkspaceTab("sandbox") // Auto-switch right side tab to sandbox
            }}
            type="button"
          >
            手动录制
          </button>
        </div>
      </div>

      {/* Dynamic Inputs */}
      <div className="space-y-3 pb-2">
        {mode === "generate" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">目标 URL</label>
              <select
                className={`${inputClassName} text-xs bg-secondary/20 border-border/60`}
                onChange={(event) => setTargetUrlId(event.target.value)}
                value={targetUrlId}
                disabled={agentRunning}
              >
                <option value="">请选择一个目标 URL</option>
                {targetUrls.map((url) => (
                  <option key={url.id} value={url.id}>{url.label} · {url.url}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">生成脚本会在该 URL 上启动浏览器，并作为脚本里 <code className="font-mono">getBaseUrl()</code> 的取值。</p>
            </div>

            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">生成指令</span>
            <textarea 
              className={`${textareaClassName} h-24 text-xs resize-none bg-secondary/20 border-border/60 focus:bg-background`}
              disabled={agentRunning} 
              onChange={(event) => setPrompt(event.target.value)} 
              placeholder="补充生成指令（如：使用特定账号登录、校验特定信息等），留空将按测试用例默认生成。" 
              value={prompt} 
            />
            {!isConnected && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-amber-200">
                Copilot 未连接，当前无法生成脚本。
              </div>
            )}
            {targetUrls.length === 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-amber-200">
                当前项目还没有任何目标 URL，请先到「目标网址」里新增一条。
              </div>
            )}
            <Button 
              disabled={busy || agentRunning || !isConnected || !targetUrlId} 
              onClick={() => {
                setWorkspaceTab("sandbox")
                generateScript()
              }}
              className="w-full cursor-pointer h-9 text-xs"
            >
              <span className="material-symbols-outlined text-sm mr-1.5">code</span>
              {agentRunning ? "生成中..." : !targetUrlId ? "请先选择目标 URL" : "生成脚本"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">录制配置</span>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">录制 URL</label>
                <div className="flex gap-2">
                  <select
                    className={`${inputClassName} text-xs flex-1 bg-secondary/20 border-border/60`}
                    onChange={(event) => setTargetUrlId(event.target.value)}
                    value={targetUrlId}
                    disabled={recorderRunning}
                  >
                    <option value="">选择目标 URL</option>
                    {targetUrls.map((url) => (
                      <option key={url.id} value={url.id}>{url.label} · {url.url}</option>
                    ))}
                  </select>
                  {recorderRunning && (
                    <Button 
                      disabled={!activeRecorderSession || !navigateUrl} 
                      onClick={() => sendInteraction({ type: "navigate", url: navigateUrl })} 
                      variant="ghost"
                      size="sm"
                      className="h-8 border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                    >
                      前往
                    </Button>
                  )}
                </div>
              </div>
              
              {recorderRunning && (
                <div className="space-y-2 pt-2 border-t border-border/30">
                  <label className="text-[10px] text-muted-foreground">输入文本发送</label>
                  {lastRecordedTarget && (
                    <div className="rounded-lg border border-border/50 bg-secondary/20 px-2.5 py-2 text-[10px] text-muted-foreground">
                      当前输入目标：{lastRecordedTarget.selector ?? lastRecordedTarget.label ?? lastRecordedTarget.placeholder ?? lastRecordedTarget.text ?? (lastRecordedTarget.x != null && lastRecordedTarget.y != null ? `最近点击坐标 (${lastRecordedTarget.x}, ${lastRecordedTarget.y})` : "最近点击元素")}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      className={`${inputClassName} text-xs flex-1 bg-secondary/20 border-border/60`}
                      onChange={(event) => setInteractionValue(event.target.value)}
                      placeholder="输入文本..."
                      value={interactionValue}
                    />
                    <Button
                      disabled={!interactionValue}
                      onClick={async () => {
                        await sendInteraction({ type: "input", value: interactionValue })
                        setInteractionValue("")
                      }}
                      variant="ghost"
                      size="sm"
                      className="h-8 border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                    >
                      输入
                    </Button>
                    <Button
                      onClick={() => sendInteraction({ type: "keydown", key: "Enter" })}
                      variant="ghost"
                      size="sm"
                      className="h-8 border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                    >
                      Enter
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
    </>
  )
}
