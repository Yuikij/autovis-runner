import { useEffect, useState } from "react"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { textareaClassName } from "../../components/ui/field"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

export type WorkbenchCodeViewProps = {
  controller: ReadyWorkspaceController
  isDirty: boolean
  setIsDirty: (isDirty: boolean) => void
  setWorkspaceTab: (tab: "code" | "repo" | "sandbox") => void
}

type ChatMessage = { id: string; role: "user" | "assistant"; content: string }

export function WorkbenchCodeView({ controller, isDirty, setIsDirty, setWorkspaceTab }: WorkbenchCodeViewProps) {
  const {
    selectedScript,
    latestScript,
    agentSession,
    llmSession,
    generateScript,
    rewriteChat,
    rewritePlan,
    saveEditedScript,
    lastTargetUrlId,
    setError,
    busy,
  } = controller

  const [editMode, setEditMode] = useState(false)
  const [draftCode, setDraftCode] = useState("")
  const [chatInput, setChatInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)

  const currentScriptCode = selectedScript?.code ?? latestScript?.code ?? ""
  const baseScriptId = selectedScript?.id ?? latestScript?.id
  const isConnected = llmSession.connectionStatus === "connected"
  const agentRunning = agentSession?.status === "running"
  const hasUserTurn = messages.some((m) => m.role === "user")
  const interactionLocked = chatBusy || planBusy || agentRunning

  const toHistory = (list: ChatMessage[]) => list.map((m) => ({ role: m.role, content: m.content }))

  const handleSend = async () => {
    const text = chatInput.trim()
    if (!text || interactionLocked || !isConnected || !baseScriptId) return
    const userMessage: ChatMessage = { id: `msg_${Date.now()}`, role: "user", content: text }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setChatInput("")
    setChatBusy(true)
    try {
      const reply = await rewriteChat(toHistory(nextMessages), baseScriptId)
      setMessages((current) => [...current, { id: `msg_${Date.now()}_a`, role: "assistant", content: reply }])
    } catch (reason) {
      setError((reason as Error).message)
      setMessages((current) => current.filter((m) => m.id !== userMessage.id))
      setChatInput(text)
    } finally {
      setChatBusy(false)
    }
  }

  const handleExecuteRewrite = async () => {
    const text = chatInput.trim()
    if ((!text && !hasUserTurn) || !baseScriptId || interactionLocked || !isConnected) return
    if (!lastTargetUrlId) {
      setError("请先在「沙盒控制台」生成模式选择一个目标 URL，再执行改写。")
      return
    }
    const nextMessages = text
      ? [...messages, { id: `msg_${Date.now()}`, role: "user" as const, content: text }]
      : messages
    if (text) {
      setMessages(nextMessages)
    }
    setPlanBusy(true)
    try {
      const plan = await rewritePlan(toHistory(nextMessages), baseScriptId)
      setMessages((current) => [
        ...current,
        { id: `msg_${Date.now()}_plan`, role: "assistant", content: `改写执行方案：\n${plan}` },
      ])
      setChatInput("")
      setWorkspaceTab("sandbox")
      await generateScript(baseScriptId, plan)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setPlanBusy(false)
    }
  }

  const handleResetInstruction = () => {
    if (interactionLocked) return
    setChatInput("")
    setMessages([])
  }

  useEffect(() => {
    setDraftCode(currentScriptCode)
    setEditMode(false)
    setIsDirty(false)
  }, [selectedScript?.id, latestScript?.id, currentScriptCode, setIsDirty])

  // 切换脚本/用例时重置改写会话，避免把旧脚本的讨论带到新脚本。
  useEffect(() => {
    setChatInput("")
    setMessages([])
  }, [selectedScript?.id, latestScript?.id])

  useEffect(() => {
    if (editMode && draftCode !== currentScriptCode) {
      setIsDirty(true)
    } else {
      setIsDirty(false)
    }
  }, [draftCode, currentScriptCode, editMode, setIsDirty])

  return (
    <div className="p-5 flex flex-col h-auto xl:h-[40rem] gap-4">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr] flex-1 min-h-0">
        <div className="flex flex-col min-h-[30rem] xl:min-h-0 rounded-xl border border-border/60 bg-slate-50 dark:bg-slate-950/90 p-4">
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

        <div className="relative min-h-[30rem] xl:min-h-0 flex flex-col h-full overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background/50 shadow-[0_0_40px_rgba(var(--primary),0.05)] backdrop-blur-xl">
          <div className="border-b border-primary/10 bg-background/60 backdrop-blur-md p-4 flex flex-row items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-base drop-shadow-[0_0_8px_rgba(var(--primary),0.8)]">auto_awesome</span>
              <h3 className="text-sm font-semibold text-foreground tracking-wide">AI 脚本改写</h3>
            </div>
            <Badge tone="default" className="font-mono text-[9px] py-0 px-1.5 border-border/60 bg-background/50">
              {selectedScript?.id || latestScript?.id ? `v${selectedScript?.version ?? latestScript?.version}` : "无版本"}
            </Badge>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-transparent relative">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-4 animate-in fade-in duration-500">
                <div className="p-4 bg-primary/10 rounded-full text-primary shadow-[0_0_30px_rgba(var(--primary),0.2)]">
                  <span className="material-symbols-outlined text-2xl drop-shadow-[0_0_8px_rgba(var(--primary),0.8)]">auto_fix_high</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground tracking-wide">可对话，也可直接执行</p>
                  <p className="text-xs text-muted-foreground mt-2 max-w-[280px] leading-relaxed">
                    直接点「执行方案」会自动整理方案并开始改写；点发送可先继续讨论。
                  </p>
                </div>
                <div className="w-full pt-2 space-y-2 max-w-[280px]">
                  {[
                    "增加步骤：点击页面右上角退出登录",
                    "修复网络延迟导致的元素找不到问题",
                    "在创建成功后，校验提示文本是否正确",
                  ].map((suggestion, i) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={interactionLocked || !currentScriptCode || isDirty}
                      onClick={() => setChatInput(suggestion)}
                      className="w-full text-left text-[11px] px-4 py-2.5 rounded-xl bg-background/40 hover:bg-primary/10 border border-border/40 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all cursor-pointer truncate shadow-sm animate-in fade-in slide-in-from-bottom-2"
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 pr-1">
                {messages.map((message) => {
                  const isUser = message.role === "user"
                  const isPlan = !isUser && message.content.startsWith("改写执行方案：")
                  return (
                    <div key={message.id} className={`flex gap-3 max-w-[88%] animate-in fade-in slide-in-from-bottom-2 duration-300 ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                      <div className={`size-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold shadow-sm ${
                        isUser 
                          ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.3)]" 
                          : isPlan
                          ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
                          : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.2)]"
                      }`}>
                        <span className="material-symbols-outlined text-[14px]">{isUser ? "person" : isPlan ? "checklist" : "smart_toy"}</span>
                      </div>
                      <div className={`rounded-2xl px-4 py-2.5 text-xs shadow-sm border leading-relaxed backdrop-blur-md ${
                        isUser 
                          ? "bg-primary/15 border-primary/20 text-foreground rounded-tr-sm" 
                          : isPlan
                          ? "bg-emerald-500/10 border-emerald-500/20 text-foreground rounded-tl-sm"
                          : "bg-background/80 border-border/40 text-muted-foreground rounded-tl-sm"
                      }`}>
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      </div>
                    </div>
                  )
                })}
                {(chatBusy || planBusy) && (
                  <div className="flex gap-3 max-w-[85%] mr-auto animate-in fade-in duration-300">
                    <div className="size-7 rounded-full shrink-0 flex items-center justify-center bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 animate-pulse">
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

          {/* Sticky footer: rewrite instruction input */}
          <div className="p-4 border-t border-primary/10 bg-background/40 backdrop-blur-md shrink-0 space-y-3">
            <textarea
              className={`${textareaClassName} h-24 text-xs resize-none px-4 py-3 bg-background/50 hover:bg-background/80 focus:bg-background/90 border-border/50 transition-colors shadow-inner rounded-xl`}
              disabled={interactionLocked || !currentScriptCode || isDirty}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  if (!interactionLocked && isConnected && chatInput.trim() && currentScriptCode && !isDirty) {
                    handleSend()
                  }
                }
              }}
              placeholder={
                isDirty 
                  ? "请先保存或放弃当前手动修改" 
                  : !currentScriptCode 
                  ? "请先生成或录制基础版本脚本..."
                  : "描述要怎么改写当前脚本，回车可先对话..."
              }
              value={chatInput}
            />

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-xl border border-border/60 text-[11px] cursor-pointer"
                disabled={interactionLocked || (!chatInput && messages.length === 0)}
                onClick={handleResetInstruction}
                title="清空输入和对话"
              >
                <span className="material-symbols-outlined text-[14px]">restart_alt</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-xl border border-border/60 text-[11px] cursor-pointer"
                disabled={interactionLocked || !chatInput.trim() || !isConnected || !currentScriptCode || isDirty || !baseScriptId}
                onClick={handleSend}
                title="发送对话"
              >
                <span className="material-symbols-outlined text-[14px]">send</span>
              </Button>
              <Button
                size="sm"
                className="h-8 flex-1 rounded-xl cursor-pointer text-xs bg-indigo-500/90 hover:bg-indigo-500 text-white shadow-sm"
                disabled={interactionLocked || (!chatInput.trim() && !hasUserTurn) || !isConnected || !currentScriptCode || isDirty || !baseScriptId || !lastTargetUrlId}
                onClick={handleExecuteRewrite}
              >
                <span className="material-symbols-outlined text-[15px] mr-1">play_arrow</span>
                {planBusy ? "正在执行方案..." : "执行方案"}
              </Button>
            </div>
            {!lastTargetUrlId && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 px-1">
                请先在「沙盒控制台」生成模式选择一个目标 URL，再执行改写。
              </p>
            )}

            <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1 select-none">
              <div className="flex items-center gap-1.5">
                <span className={`size-1.5 rounded-full ${isDirty ? "bg-amber-500" : isConnected ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" : "bg-red-500 animate-pulse"}`} />
                <span>
                  {isDirty 
                    ? "存在未保存的手动修改" 
                    : isConnected 
                    ? "输入要求后可直接执行改写" 
                    : "智能体未连接"}
                </span>
              </div>
              {(planBusy || agentRunning) && (
                <span className="text-primary font-medium animate-pulse flex items-center gap-1">
                  <span className="size-1 rounded-full bg-primary" />
                  {agentRunning ? "正在改写脚本..." : "正在整理方案..."}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
