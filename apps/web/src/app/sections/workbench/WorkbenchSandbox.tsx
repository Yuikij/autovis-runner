import { useEffect, useMemo, useState } from "react"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { inputClassName } from "../../components/ui/field"
import { EmptyState } from "../../components/empty-state"
import { BrowserFrame } from "../../components/browser-frame"
import { LogPanel } from "../../components/log-panel"
import { TaskControlBar } from "../../components/TaskControlBar"
import { translateStatus, translateArtifactKind, resolveUrl } from "../../utils"
import type { AgentStep } from "@autovis/shared"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

const stageLabel: Record<string, string> = {
  code: "代码",
  page: "页面",
  generation: "生成",
  verification: "验证",
}

function getAgentStepVisuals(step: AgentStep) {
  if (step.status === "error" || step.type === "error") {
    return {
      icon: <span className="material-symbols-outlined text-rose-500 text-sm drop-shadow-[0_0_8px_rgba(244,63,94,0.8)]">cancel</span>,
      bg: "bg-rose-500/10 border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.1)]",
      textClass: "text-rose-500 font-semibold",
      lineClass: "bg-rose-500/40",
      dotClass: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
    }
  }

  if (step.status === "running") {
    return {
      icon: <span className="material-symbols-outlined text-indigo-400 text-sm animate-pulse drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]">psychology</span>,
      bg: "bg-indigo-500/10 border-indigo-500/40 shadow-[0_0_20px_rgba(99,102,241,0.15)]",
      textClass: "text-indigo-400 font-semibold",
      lineClass: "bg-indigo-500/50 animate-pulse",
      dotClass: "bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.8)] animate-ping"
    }
  }

  if (step.type === "verification") {
    return {
      icon: <span className="material-symbols-outlined text-emerald-500 text-sm drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]">check_circle</span>,
      bg: "bg-emerald-500/5 border-emerald-500/20",
      textClass: "text-emerald-500 font-medium",
      lineClass: "bg-emerald-500/30",
      dotClass: "bg-emerald-500"
    }
  }

  if (step.type === "tool_call") {
    return {
      icon: <span className="material-symbols-outlined text-amber-500/80 text-xs">build</span>,
      bg: "bg-amber-500/5 border-amber-500/20 opacity-80",
      textClass: "text-amber-500/90",
      lineClass: "bg-amber-500/20",
      dotClass: "bg-amber-500/80"
    }
  }

  return {
    icon: <span className="material-symbols-outlined text-slate-400 text-xs">radio_button_checked</span>,
    bg: "bg-secondary/20 border-border/40",
    textClass: "text-foreground",
    lineClass: "bg-border/40",
    dotClass: "bg-slate-400"
  }
}

export type WorkbenchSandboxProps = {
  controller: ReadyWorkspaceController
  mode: "generate" | "record"
  setMode: (mode: "generate" | "record") => void
  navigateUrl: string
  lastPointer: { x: number; y: number } | null
  setLastPointer: (pointer: { x: number; y: number } | null) => void
  setWorkspaceTab: (tab: "code" | "repo" | "sandbox") => void
}

export function WorkbenchSandbox({ 
  controller, 
  mode, 
  setMode, 
  navigateUrl, 
  lastPointer, 
  setLastPointer, 
  setWorkspaceTab 
}: WorkbenchSandboxProps) {
  const {
    selectedCase,
    activeRun,
    workbenchVerificationRunId,
    activeRecorderSession,
    agentSession,
    submitRunHumanInput,
    sendRecorderInteraction,
    busy,
  } = controller

  const [sandboxTab, setSandboxTab] = useState<"steps" | "logs">("steps")
  const [humanInputValue, setHumanInputValue] = useState("")
  const [isLogExpanded, setIsLogExpanded] = useState(false)
  const [expandedAgentStepId, setExpandedAgentStepId] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const verificationRun = useMemo(() => {
    if (!activeRun || activeRun.kind !== "temporary") return null
    if (!workbenchVerificationRunId || activeRun.id !== workbenchVerificationRunId) return null
    if (activeRun.testCaseId !== selectedCase?.id) return null
    return activeRun
  }, [activeRun, workbenchVerificationRunId, selectedCase?.id])

  const verificationReplayVideo = useMemo(
    () => verificationRun?.artifacts.find((artifact) => artifact.kind === "video")?.url,
    [verificationRun?.artifacts],
  )

  const verificationNeedsHumanInput = verificationRun?.status === "awaiting_human" ? verificationRun.pendingHumanHandoff : undefined

  useEffect(() => {
    if (!verificationNeedsHumanInput) return
    setMode("generate")
    setWorkspaceTab("sandbox")
    setSandboxTab("steps")
    setIsLogExpanded(true)
  }, [verificationNeedsHumanInput, setMode, setWorkspaceTab])

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!activeRecorderSession) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1440)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 960)
    setLastPointer({ x, y })
    sendRecorderInteraction(activeRecorderSession.id, { type: "click", x, y })
  }

  const isShowingAgent = mode === "generate" && (!verificationRun || agentSession?.status === "running")
  const latestAgentStepWithImage = useMemo(() => agentSession?.steps.slice().reverse().find(s => s.screenshotUrl), [agentSession?.steps])

  const displayUrl = mode === "record" 
    ? (activeRecorderSession?.currentUrl || navigateUrl)
    : isShowingAgent 
      ? (latestAgentStepWithImage?.url || navigateUrl) 
      : (verificationRun?.testBaseUrl || "--")

  const displayViewport = mode === "record"
    ? activeRecorderSession?.currentViewport
    : isShowingAgent
      ? latestAgentStepWithImage?.screenshotUrl
      : verificationRun?.currentViewport

  const displayLiveViewport = mode === "generate" && !isShowingAgent
    ? verificationRun?.liveViewport
    : undefined

  const displayTitle = mode === "record" ? "录制浏览器画面" : isShowingAgent ? "生成过程实时画面" : "验证浏览器画面"
  const displayEmptyText = mode === "record" ? "启动录制后，这里会显示远程浏览器画面。" : isShowingAgent ? "启动生成后，此窗口将实时展示智能体的操作画面。" : "执行验证后，此窗口将实时展示浏览器画面。"

  const latestVerifyStep = verificationRun?.steps.at(-1)
  const latestAgentStep = agentSession?.steps.at(-1)
  const latestAction = activeRecorderSession?.actions.at(-1)

  return (
    <div className="relative flex flex-col h-[40rem] border-t border-border bg-slate-100 dark:bg-slate-950 overflow-hidden">
      {/* 实时浏览占全部 */}
      <div className="absolute inset-0 z-0 flex items-center justify-center p-4">
        <BrowserFrame
          noCard
          emptyText={displayEmptyText}
          title={displayTitle}
          url={displayUrl}
          viewport={displayViewport}
          liveViewport={displayLiveViewport}
          replayVideoUrl={!isShowingAgent && mode === "generate" ? verificationReplayVideo : undefined}
          className="w-full h-full flex flex-col bg-transparent border-0"
          contentClassName="flex-1 h-full flex items-center justify-center p-0 bg-transparent"
          imageClassName="max-h-full max-w-full object-contain"
          onImageClick={mode === "record" ? handleImageClick : undefined}
        />
        {/* Top-left corner small status indicator for last pointer */}
        {lastPointer && mode === "record" && (
          <div className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-xl bg-background/80 backdrop-blur border border-border/60 shadow-sm text-[10px] text-muted-foreground font-mono pointer-events-none">
            上次点击: ({lastPointer.x}, {lastPointer.y})
          </div>
        )}
      </div>

      {/* 日志在上部滚动，点击可查看全部 */}
      <div className="absolute top-4 left-4 right-4 z-10 flex justify-center pointer-events-none">
        <div 
          className={`pointer-events-auto bg-background/85 dark:bg-slate-900/85 backdrop-blur-xl border border-border/60 shadow-2xl rounded-2xl overflow-hidden transition-all duration-500 ease-in-out flex flex-col ${isLogExpanded ? 'w-full max-w-4xl h-[36rem]' : 'w-full max-w-2xl h-14 hover:bg-background/95 hover:shadow-primary/10 cursor-pointer hover:border-primary/40'}`}
          onClick={() => { if (!isLogExpanded) setIsLogExpanded(true) }}
        >
          {/* Collapsed Ticker Header */}
          <div className="flex items-center justify-between px-4 h-14 shrink-0 select-none">
            <div className="flex flex-col flex-1 min-w-0 justify-center">
              {mode === "generate" ? (
                isShowingAgent ? (
                  <div className="flex items-center gap-3">
                    {agentSession?.status === "running" ? (
                      <span className="flex size-2 rounded-full bg-indigo-500 animate-pulse shrink-0 drop-shadow-[0_0_5px_rgba(99,102,241,0.8)]" />
                    ) : (
                      <span className="flex size-2 rounded-full bg-slate-400 shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-foreground truncate max-w-[200px] shrink-0">
                      {latestAgentStep?.title || "等待生成开始..."}
                    </span>
                    <span className="text-xs text-muted-foreground truncate hidden sm:block">
                      {latestAgentStep?.content || ""}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {verificationRun?.status === "running" ? (
                      <span className="flex size-2 rounded-full bg-primary animate-pulse shrink-0" />
                    ) : (
                      <span className="flex size-2 rounded-full bg-slate-400 shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-foreground truncate max-w-[200px] shrink-0">
                      {latestVerifyStep?.title || "等待验证开始..."}
                    </span>
                    <span className="text-xs text-muted-foreground truncate hidden sm:block">
                      {latestVerifyStep?.log || ""}
                    </span>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-3">
                  {activeRecorderSession?.status === "running" ? (
                    <span className="flex size-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  ) : (
                    <span className="flex size-2 rounded-full bg-slate-400 shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-foreground truncate max-w-[200px] shrink-0">
                    {latestAction?.type || "录制就绪"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate hidden sm:block">
                    {latestAction?.detail || latestAction?.url || "在下方画面中进行操作..."}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
              {mode === "generate" && isShowingAgent && agentSession?.id && (
                <TaskControlBar kind="agent" id={agentSession.id} status={agentSession.status} />
              )}
              {mode === "generate" && !isShowingAgent && verificationRun?.id && (
                <TaskControlBar kind="run" id={verificationRun.id} status={verificationRun.status} />
              )}
              {mode === "record" && activeRecorderSession?.id && (
                <TaskControlBar kind="recorder" id={activeRecorderSession.id} status={activeRecorderSession.status} />
              )}
              {isLogExpanded ? (
                <Button variant="ghost" size="sm" className="ml-2 shrink-0 rounded-full size-8 p-0 hover:bg-muted" onClick={(e) => { e.stopPropagation(); setIsLogExpanded(false); }}>
                  <span className="material-symbols-outlined text-base">close</span>
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground hidden sm:inline font-medium tracking-wide">点击展开全部</span>
                  <span className="material-symbols-outlined text-muted-foreground shrink-0 text-sm">expand_more</span>
                </div>
              )}
            </div>
          </div>

          {/* Expanded Content */}
          <div className={`flex-1 min-h-0 flex flex-col border-t border-border/40 bg-secondary/30 transition-opacity duration-300 ${isLogExpanded ? 'opacity-100' : 'opacity-0'}`}>
            {/* Sub tab header */}
            <div className="flex border-b border-border/40 bg-card/50 p-2 gap-2">
              <button
                type="button"
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  sandboxTab === 'steps' 
                    ? 'bg-background text-foreground shadow-sm' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setSandboxTab('steps')}
              >
                {mode === "generate" ? (isShowingAgent ? "智能体思考链" : "验证步骤") : "录制动作"}
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  sandboxTab === 'logs' 
                    ? 'bg-background text-foreground shadow-sm' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setSandboxTab('logs')}
              >
                {mode === "generate" ? "输出日志" : "动作日志"}
              </button>
            </div>

            {/* Sub tab contents */}
            <div className="flex-1 overflow-y-auto p-4 min-h-0 relative">
              {sandboxTab === 'steps' ? (
                mode === "generate" ? (
                  isShowingAgent ? (
                    !agentSession || agentSession.steps.length === 0 ? (
                      <EmptyState 
                        title="暂无生成步骤" 
                        description="点击“生成脚本”开始让智能体接管。" 
                      />
                    ) : (
                      <div className="space-y-4 pl-2 pr-1 pb-4">
                        {agentSession.steps.map((step, idx) => {
                          const visuals = getAgentStepVisuals(step)
                          const isExpanded = expandedAgentStepId === step.id || step.status === "running"
                          return (
                            <div key={step.id} className="relative flex gap-4 animate-in slide-in-from-bottom-2 fade-in duration-300">
                              {/* Timeline Line */}
                              {idx < agentSession.steps.length - 1 && (
                                <div className={`absolute left-[11px] top-6 bottom-[-16px] w-[2px] rounded-full ${visuals.lineClass}`} />
                              )}
                              {/* Timeline Dot */}
                              <div className="relative z-10 flex flex-col items-center mt-1">
                                <div className={`flex items-center justify-center size-6 rounded-full bg-background border-2 ${step.status === "running" ? "border-indigo-500" : "border-border"}`}>
                                  <div className={`size-2.5 rounded-full ${visuals.dotClass}`} />
                                </div>
                              </div>
                              {/* Step Card */}
                              <div className={`flex-1 rounded-2xl border p-4 transition-all duration-300 ${visuals.bg} backdrop-blur-md`}>
                                <div 
                                  className="flex items-start justify-between gap-3 cursor-pointer select-none"
                                  onClick={() => setExpandedAgentStepId(current => current === step.id ? null : step.id)}
                                >
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                      {visuals.icon}
                                      <span className={`text-sm tracking-wide ${visuals.textClass}`}>{step.title}</span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground font-mono bg-background/50 px-2 py-0.5 rounded border border-border/40 inline-block w-fit">
                                      {step.type.toUpperCase()} {step.stage ? `· ${stageLabel[step.stage] || step.stage}` : ""}
                                    </span>
                                  </div>
                                  <Badge 
                                    tone={step.status === "completed" ? "success" : step.status === "error" ? "danger" : "default"}
                                    className="scale-90 origin-top-right shadow-sm"
                                  >
                                    {translateStatus(step.status)}
                                  </Badge>
                                </div>
                                
                                {step.content && (
                                  <div className={`mt-3 text-xs leading-relaxed text-muted-foreground/90 whitespace-pre-wrap pl-1 border-l-2 border-border/50 transition-all duration-300 ${isExpanded ? "" : "line-clamp-2"}`}>
                                    {step.content}
                                  </div>
                                )}

                                {isExpanded && (
                                  <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
                                    {step.detail && (
                                      <div className="rounded-xl bg-rose-950/20 border border-rose-500/20 p-3 font-mono text-[11px] text-rose-400 max-h-48 overflow-y-auto whitespace-pre-wrap shadow-inner">
                                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-500/80 uppercase tracking-wider mb-2">
                                          <span className="material-symbols-outlined text-xs">warning</span>
                                          Error Logs
                                        </div>
                                        {step.detail}
                                      </div>
                                    )}
                                    {step.payloadJson && (
                                      <div className="rounded-xl bg-black/40 border border-border/40 p-3 font-mono text-[11px] text-indigo-300/90 max-h-48 overflow-y-auto shadow-inner">
                                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                          <span className="material-symbols-outlined text-xs">data_object</span>
                                          Payload
                                        </div>
                                        <pre className="whitespace-pre-wrap">{step.payloadJson}</pre>
                                      </div>
                                    )}
                                    {step.screenshotUrl && (
                                      <div 
                                        className="mt-3 relative rounded-xl overflow-hidden border border-border/50 group max-w-sm aspect-[16/10] bg-black/40 cursor-zoom-in shadow-md"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setLightboxUrl(resolveUrl(step.screenshotUrl!))
                                        }}
                                      >
                                        <img
                                          src={resolveUrl(step.screenshotUrl)}
                                          alt={step.title}
                                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm">
                                          <span className="material-symbols-outlined text-white text-2xl drop-shadow-md">zoom_in</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  ) : (
                    !verificationRun ? (
                      <EmptyState 
                        title="未执行验证" 
                        description="在顶部输入 URL 并启动验证后，这里会显示步骤检查项。" 
                      />
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-border/40">
                          <div className="flex items-center gap-2">
                            <Badge tone={verificationRun.status === "passed" ? "success" : verificationRun.status === "failed" ? "danger" : "warning"}>
                              {translateStatus(verificationRun.status)}
                            </Badge>
                            <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]">
                              {verificationRun.id}
                            </span>
                            {verificationRun.orchestrationPhase ? (
                              <Badge>{verificationRun.orchestrationPhase === "preconditions" ? "前置依赖中" : verificationRun.orchestrationPhase === "target" ? "目标脚本中" : "归档中"}</Badge>
                            ) : null}
                          </div>
                        </div>
                        {verificationNeedsHumanInput ? (
                          <Card className="border-warning/40 bg-warning/5 shadow-sm">
                            <CardHeader className="pb-3">
                              <CardTitle className="text-sm">等待人工输入</CardTitle>
                              <CardDescription>
                                {verificationNeedsHumanInput.scope === "precondition" ? "前置依赖执行中需要人工输入。" : "目标脚本执行中需要人工输入。"}
                                {" "}
                                {verificationNeedsHumanInput.instruction}
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="overflow-hidden rounded-xl border border-border/60 bg-slate-100 dark:bg-black/20">
                                <img
                                  alt={verificationNeedsHumanInput.inputLabel ?? "人工输入参考图"}
                                  className="max-h-52 w-full object-contain bg-slate-200 dark:bg-black"
                                  src={verificationNeedsHumanInput.imageUrl ?? verificationRun.currentViewport}
                                />
                              </div>
                              <div className="flex gap-2">
                                <input
                                  className={`${inputClassName} text-xs flex-1 bg-secondary/20 border-border/60`}
                                  onChange={(event) => setHumanInputValue(event.target.value)}
                                  placeholder={verificationNeedsHumanInput.placeholder ?? verificationNeedsHumanInput.inputLabel ?? "请输入内容"}
                                  value={humanInputValue}
                                />
                                <Button
                                  className="cursor-pointer"
                                  disabled={busy || !humanInputValue.trim()}
                                  onClick={async () => {
                                    await submitRunHumanInput(verificationRun.id, verificationNeedsHumanInput.id, humanInputValue)
                                    setHumanInputValue("")
                                  }}
                                >
                                  {verificationNeedsHumanInput.confirmText ?? "确定并继续"}
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ) : null}
                        <div className="space-y-2">
                          {verificationRun.steps.map((step) => (
                            <div 
                              className={`rounded-xl border p-3 transition-all ${
                                step.status === "running" 
                                  ? "border-primary/40 bg-primary/5 shadow-sm" 
                                  : "border-border/60 bg-card/60"
                              }`} 
                              key={step.id}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <strong className="text-xs text-foreground font-medium">{step.title}</strong>
                                <Badge tone={step.status === "passed" ? "success" : step.status === "failed" ? "danger" : "warning"}>
                                  {translateStatus(step.status)}
                                </Badge>
                              </div>
                              {step.log && (
                                <p className="mt-1.5 text-xs text-muted-foreground leading-normal">
                                  {step.log}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                        {verificationRun.artifacts.length > 0 && (
                          <div className="space-y-2 pt-2 border-t border-border/40">
                            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">验证产物</div>
                            {verificationRun.artifacts.map((artifact) => (
                              <a 
                                className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-3 py-2 text-xs transition hover:bg-secondary/40 animate-fade-in" 
                                href={resolveUrl(artifact.url)} 
                                key={artifact.name} 
                                rel="noreferrer" 
                                target="_blank"
                              >
                                <strong>{translateArtifactKind(artifact.kind)}</strong>
                                <span className="truncate text-muted-foreground text-[10px] max-w-[120px]">{artifact.name}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  )
                ) : (
                  !(activeRecorderSession?.actions ?? []).length ? (
                    <EmptyState 
                      title="暂无录制动作" 
                      description="在左侧浏览器画面中进行点击、输入等操作，此处会实时显示录制动作。" 
                    />
                  ) : (
                    <div className="space-y-2">
                      {(activeRecorderSession?.actions ?? []).map((action) => (
                        <div className="rounded-xl border border-border/60 bg-card/60 p-3 shadow-sm" key={action.id}>
                          <div className="flex items-center justify-between gap-3">
                            <strong className="text-xs text-foreground font-medium">{action.type}</strong>
                            <Badge>{action.timestamp.slice(11, 19)}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground leading-normal">{action.detail ?? action.url}</p>
                        </div>
                      ))}
                    </div>
                  )
                )
              ) : (
                mode === "generate" ? (
                  isShowingAgent ? (
                      <LogPanel 
                      noCard 
                      title="智能体日志" 
                      content={agentSession?.steps?.map(s => s.content).filter(Boolean).join("\n") || "无输出日志"} 
                      className="h-full bg-transparent dark:bg-transparent p-0 max-h-none border-0 shadow-none text-xs leading-5"
                    />
                  ) : (
                    <LogPanel 
                      noCard 
                      title="验证日志" 
                      content={verificationRun?.logs.join("\n") || "无输出日志"} 
                      className="h-full bg-transparent dark:bg-transparent p-0 max-h-none border-0 shadow-none text-xs leading-5"
                    />
                  )
                ) : (
                  <LogPanel 
                    noCard 
                    title="录制日志" 
                    content={(activeRecorderSession?.actions ?? []).map((action) => `${action.timestamp.slice(11, 19)} · ${action.type} · ${action.detail ?? action.url}`).join("\n")} 
                    className="h-full bg-transparent dark:bg-transparent p-0 max-h-none border-0 shadow-none text-xs leading-5"
                  />
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox modal overlay */}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200"
          onClick={() => setLightboxUrl(null)}
        >
          <img 
            src={lightboxUrl} 
            alt="Screenshot detail view" 
            className="max-w-full max-h-[95vh] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] object-contain border border-white/10" 
          />
          <button 
            className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-3 rounded-full cursor-pointer transition-all hover:scale-110"
            onClick={() => setLightboxUrl(null)}
          >
            <span className="material-symbols-outlined text-2xl drop-shadow-md">close</span>
          </button>
        </div>
      )}
    </div>
  )
}
