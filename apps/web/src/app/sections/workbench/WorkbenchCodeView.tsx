import { useEffect, useState } from "react"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { textareaClassName } from "../../components/ui/field"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

export type WorkbenchCodeViewProps = {
  controller: ReadyWorkspaceController
  isDirty: boolean
  setIsDirty: (isDirty: boolean) => void
}

export function WorkbenchCodeView({ controller, isDirty, setIsDirty }: WorkbenchCodeViewProps) {
  const {
    selectedScript,
    latestScript,
    agentSession,
    llmSession,
    generateScript,
    saveEditedScript,
    busy,
  } = controller

  const [editMode, setEditMode] = useState(false)
  const [draftCode, setDraftCode] = useState("")
  const [llmEditPrompt, setLlmEditPrompt] = useState("")
  const [llmMessages, setLlmMessages] = useState<Array<{ id: string; role: "user" | "assistant"; content: string }>>([])

  const currentScriptCode = selectedScript?.code ?? latestScript?.code ?? ""
  const isConnected = llmSession.connectionStatus === "connected"
  const agentRunning = agentSession?.status === "running"

  const handleLlmSubmit = async () => {
    const baseScriptId = selectedScript?.id ?? latestScript?.id
    if (!baseScriptId) return
    const userMessage = { id: `msg_${Date.now()}`, role: "user" as const, content: llmEditPrompt }
    setLlmMessages((current) => [...current, userMessage])
    await generateScript(baseScriptId)
    setLlmMessages((current) => [...current, { id: `msg_${Date.now()}_done`, role: "assistant", content: "已提交 AI 改写请求，生成完成后会产生新的脚本版本。" }])
    setLlmEditPrompt("")
  }

  useEffect(() => {
    setDraftCode(currentScriptCode)
    setEditMode(false)
    setIsDirty(false)
  }, [selectedScript?.id, latestScript?.id, currentScriptCode, setIsDirty])

  useEffect(() => {
    if (editMode && draftCode !== currentScriptCode) {
      setIsDirty(true)
    } else {
      setIsDirty(false)
    }
  }, [draftCode, currentScriptCode, editMode, setIsDirty])

  return (
    <div className="p-5 flex flex-col h-[40rem] gap-4">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr] flex-1 min-h-0">
        <div className="flex flex-col min-h-0 rounded-xl border border-border/60 bg-slate-50 dark:bg-slate-950/90 p-4">
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">脚本代码</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                当前选中脚本版本{selectedScript ? ` · v${selectedScript.version}` : latestScript ? ` · v${latestScript.version}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isDirty ? <Badge tone="warning">未保存修改</Badge> : null}
              {currentScriptCode ? (
                editMode ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs cursor-pointer"
                      disabled={busy || !isDirty}
                      onClick={async () => {
                        const saved = await saveEditedScript(draftCode, selectedScript?.id ?? latestScript?.id, `Manual editor save from ${selectedScript?.id ?? latestScript?.id ?? "draft"}`)
                        setDraftCode(saved.code)
                        setEditMode(false)
                        setIsDirty(false)
                      }}
                    >
                      保存为新版本
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs cursor-pointer"
                      disabled={busy}
                      onClick={() => {
                        setDraftCode(currentScriptCode)
                        setEditMode(false)
                        setIsDirty(false)
                      }}
                    >
                      放弃修改
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs cursor-pointer"
                    disabled={busy}
                    onClick={() => {
                      setDraftCode(currentScriptCode)
                      setEditMode(true)
                    }}
                  >
                    编辑
                  </Button>
                )
              ) : null}
            </div>
          </div>
          <div className="flex-1 overflow-auto font-mono text-xs leading-6 text-slate-800 dark:text-slate-200">
            {currentScriptCode ? (
              editMode ? (
                <textarea
                  className="h-full min-h-[24rem] w-full resize-none rounded-xl border border-border/40 bg-slate-100 dark:bg-slate-950/80 p-4 font-mono text-xs leading-6 text-slate-800 dark:text-slate-200 outline-none"
                  value={draftCode}
                  onChange={(event) => setDraftCode(event.target.value)}
                />
              ) : (
                <pre className="h-full w-full select-text whitespace-pre-wrap">
                  {currentScriptCode}
                </pre>
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
                <span className="material-symbols-outlined text-slate-400 dark:text-slate-500 text-4xl">code_off</span>
                <p>尚未生成自动化脚本。请选择左侧模式并开始生成或录制。</p>
              </div>
            )}
          </div>
        </div>

        <div className="relative min-h-0 flex flex-col h-full overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background/50 shadow-[0_0_40px_rgba(var(--primary),0.05)] backdrop-blur-xl">
          <div className="border-b border-primary/10 bg-background/60 backdrop-blur-md p-4 flex flex-row items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-base drop-shadow-[0_0_8px_rgba(var(--primary),0.8)]">auto_awesome</span>
              <h3 className="text-sm font-semibold text-foreground tracking-wide">AI 脚本改写</h3>
            </div>
            <Badge tone="default" className="font-mono text-[9px] py-0 px-1.5 border-border/60 bg-background/50">
              {selectedScript?.id || latestScript?.id ? `v${selectedScript?.version ?? latestScript?.version}` : "无版本"}
            </Badge>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 bg-transparent relative">
            {llmMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-4 animate-in fade-in duration-500">
                <div className="p-4 bg-primary/10 rounded-full text-primary shadow-[0_0_30px_rgba(var(--primary),0.2)]">
                  <span className="material-symbols-outlined text-2xl drop-shadow-[0_0_8px_rgba(var(--primary),0.8)]">smart_toy</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground tracking-wide">与智能体对话改写脚本</p>
                  <p className="text-xs text-muted-foreground mt-2 max-w-[240px] leading-relaxed">
                    输入修改意图，AI 将基于当前上下文进行改写并生成新版本。
                  </p>
                </div>
                {/* Quick suggestions */}
                <div className="w-full pt-6 space-y-2 max-w-[280px]">
                  {[
                    "增加步骤：点击页面右上角退出登录",
                    "修复网络延迟导致的元素找不到问题",
                    "在创建成功后，校验提示文本是否正确",
                  ].map((suggestion, i) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={busy || !currentScriptCode || isDirty}
                      onClick={() => setLlmEditPrompt(suggestion)}
                      className={`w-full text-left text-[11px] px-4 py-2.5 rounded-xl bg-background/40 hover:bg-primary/10 border border-border/40 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all cursor-pointer truncate shadow-sm animate-in fade-in slide-in-from-bottom-2`}
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 pr-1">
                {llmMessages.map((message) => {
                  const isUser = message.role === "user"
                  return (
                    <div key={message.id} className={`flex gap-3 max-w-[85%] animate-in fade-in slide-in-from-bottom-2 duration-300 ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                      {/* Avatar */}
                      <div className={`size-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold shadow-sm ${
                        isUser 
                          ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.3)]" 
                          : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.2)]"
                      }`}>
                        {isUser ? <span className="material-symbols-outlined text-[14px]">person</span> : <span className="material-symbols-outlined text-[14px]">smart_toy</span>}
                      </div>
                      {/* Bubble */}
                      <div className={`rounded-2xl px-4 py-2.5 text-xs shadow-sm border leading-relaxed backdrop-blur-md ${
                        isUser 
                          ? "bg-primary/15 border-primary/20 text-foreground rounded-tr-sm" 
                          : "bg-background/80 border-border/40 text-muted-foreground rounded-tl-sm"
                      }`}>
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      </div>
                    </div>
                  )
                })}
                {agentRunning && (
                  <div className="flex gap-3 max-w-[85%] mr-auto animate-in fade-in duration-300">
                    <div className="size-7 rounded-full shrink-0 flex items-center justify-center bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.2)] animate-pulse">
                      <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                    </div>
                    <div className="rounded-2xl px-4 py-2.5 text-xs shadow-sm border border-border/40 bg-background/80 rounded-tl-sm flex items-center gap-1.5 h-9">
                      <span className="flex size-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="flex size-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="flex size-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sticky chat input at the bottom */}
          <div className="p-4 border-t border-primary/10 bg-background/40 backdrop-blur-md shrink-0 space-y-3">
            <div className="relative flex items-end group">
              <textarea
                className={`${textareaClassName} h-24 text-xs resize-none pr-12 pl-4 py-3 bg-background/50 hover:bg-background/80 focus:bg-background/90 border-border/50 group-hover:border-primary/30 transition-colors shadow-inner rounded-xl`}
                disabled={busy || !currentScriptCode || isDirty}
                onChange={(event) => setLlmEditPrompt(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    if (!busy && isConnected && llmEditPrompt.trim() && currentScriptCode && !isDirty && !agentRunning) {
                      handleLlmSubmit()
                    }
                  }
                }}
                placeholder={
                  isDirty 
                    ? "请先保存或放弃当前手动修改" 
                    : !currentScriptCode 
                    ? "请先生成或录制基础版本脚本..."
                    : "输入改写指令，回车发送..."
                }
                value={llmEditPrompt}
              />
              <div className="absolute bottom-2 right-2">
                <Button
                  size="sm"
                  className="size-8 rounded-xl cursor-pointer flex items-center justify-center p-0 shrink-0 bg-primary/90 hover:bg-primary shadow-sm hover:shadow-md transition-all hover:scale-105"
                  disabled={busy || !isConnected || !llmEditPrompt.trim() || !currentScriptCode || isDirty || agentRunning}
                  onClick={handleLlmSubmit}
                >
                  <span className="material-symbols-outlined text-[15px]">send</span>
                </Button>
              </div>
            </div>
            
            <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 select-none">
              <div className="flex items-center gap-1.5">
                <span className={`size-1.5 rounded-full ${isDirty ? "bg-amber-500" : isConnected ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" : "bg-red-500 animate-pulse"}`} />
                <span>
                  {isDirty 
                    ? "存在未保存的手动修改" 
                    : isConnected 
                    ? "智能体已就绪" 
                    : "智能体未连接"}
                </span>
              </div>
              {agentRunning && (
                <span className="text-primary font-medium animate-pulse flex items-center gap-1">
                  <span className="size-1 rounded-full bg-primary" />
                  正在思考改写...
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
