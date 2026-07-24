import type { CaseDetailsProps } from "./types"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { inputClassName } from "../../components/ui/field"
import { formatDateTime, formatDuration, translateStatus, translateTestType, resolveUrl } from "../../utils"
import { BrowserFrame } from "../../components/browser-frame"
import { LogPanel } from "../../components/log-panel"
import { RunStatusBar } from "../../components/run-status-bar"
import { TaskControlBar } from "../../components/TaskControlBar"
import { CaseApiPanel } from "./CaseApiPanel"
import { t } from "../../../i18n/index.js"

const translateRunPhase = (phase?: any) => {
  if (phase === "preconditions") return t("cases.phasePreconditions")
  if (phase === "target") return t("cases.phaseTarget")
  if (phase === "archive") return t("cases.phaseArchive")
  return t("cases.phaseNone")
}

export function CaseDetails(props: CaseDetailsProps) {
  const { controller, setIsEditing, activeTab, setActiveTab, copied, setCopied, quickRunTargetUrlId, setQuickRunTargetUrlId, quickRunHumanInput, setQuickRunHumanInput, temporaryRun, temporaryReplayVideo, caseRuns, handleDeleteCase } = props
  const {
    selectedCase,
    selectedProject,
    selectedScript,
    selectedCaseDependencies,
    projects,
    busy,
    startRun,
    startDirectAgent,
    submitRunHumanInput,
    setActiveRun,
    setActiveTaskRunId,
    setActiveSection,
  } = controller

  if (!selectedCase) return null

  const hasScript = !!selectedCase?.latestScriptId || !!selectedCase?.aiScript || !!selectedScript?.code
  const targetUrls = selectedProject?.targetUrls ?? []

  return (
    <div className="space-y-6">
      <div className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold font-mono tracking-tight text-foreground">{selectedCase.caseCode}</h2>
              <Badge tone={selectedCase.testType === "smoke" ? "warning" : selectedCase.testType === "regression" ? "info" : "default"}>
                {translateTestType(selectedCase.testType)}
              </Badge>
              {selectedCase.moduleName && (
                <Badge tone="success">
                  {selectedCase.moduleName}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{t("cases.lastUpdatedAt", { time: formatDateTime(selectedCase.updatedAt) })}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setIsEditing(true)} size="sm">
              <span className="material-symbols-outlined text-sm">edit</span>
              {t("cases.editCase")}
            </Button>
            <Button onClick={() => setActiveSection("workbench")} variant="ghost" size="sm">
              <span className="material-symbols-outlined text-sm">smart_toy</span>
              {t("cases.aiWorkbench")}
            </Button>
            <Button
              onClick={() => handleDeleteCase(selectedCase.id)}
              variant="ghost"
              size="sm"
              className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-500/10 shrink-0"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
            </Button>
          </div>
        </div>
      </div>
      
      <div className="space-y-6">
        {/* Quick Run Control Bar */}
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border border-primary/20 bg-primary/5">
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-primary select-none">language</span>
              <select
                className={`${inputClassName} h-8 text-xs font-mono bg-background/50 border-primary/10`}
                value={quickRunTargetUrlId}
                onChange={(e) => setQuickRunTargetUrlId(e.target.value)}
              >
                <option value="">{t("cases.selectTargetUrl")}</option>
                {targetUrls.map((u) => (
                  <option key={u.id} value={u.id}>{u.label} · {u.url}</option>
                ))}
              </select>
            </div>
          </div>
          <Button
            size="sm"
            disabled={busy || !hasScript || !quickRunTargetUrlId}
            onClick={() => startRun(quickRunTargetUrlId)}
          >
            <span className="material-symbols-outlined text-sm">play_arrow</span>
            {t("cases.tempRun")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !quickRunTargetUrlId}
            onClick={() => {
              setActiveSection("workbench")
              startDirectAgent(quickRunTargetUrlId)
            }}
            title={t("cases.directAgentTitle")}
          >
            <span className="material-symbols-outlined text-sm text-purple-500">smart_toy</span>
            {t("cases.aiDirectRun")}
          </Button>
        </div>

        {temporaryRun ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-4 animate-fade-in">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground">{t("cases.tempRunResult")}</span>
                  <Badge tone={temporaryRun.status === "passed" ? "success" : temporaryRun.status === "failed" ? "danger" : "warning"}>
                    {translateStatus(temporaryRun.status)}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">{temporaryRun.id}</span>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 select-none">
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">schedule</span>{formatDateTime(temporaryRun.startedAt)}</span>
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">language</span>{temporaryRun.testBaseUrl}</span>
                  {temporaryRun.finishedAt ? <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">timer</span>{formatDuration(temporaryRun.startedAt, temporaryRun.finishedAt)}</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <TaskControlBar kind="run" id={temporaryRun.id} status={temporaryRun.status} />
                {temporaryRun.status === "failed" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-primary border border-primary/30 hover:bg-primary/10 gap-1.5"
                    disabled={busy}
                    onClick={() => {
                      controller.repairScriptRun(temporaryRun.id)
                      setActiveSection("workbench")
                    }}
                  >
                    <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                    {t("cases.aiRepair")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setActiveRun(null)}>
                  {t("cases.clearTempResult")}
                </Button>
              </div>
            </div>

            <div className="space-y-5">
              <BrowserFrame
                title={t("cases.tempRunView")}
                emptyText={t("cases.tempRunViewEmpty")}
                noCard
                url={temporaryRun.testBaseUrl}
                viewport={temporaryRun.currentViewport}
                replayVideoUrl={temporaryReplayVideo}
                liveViewport={temporaryRun.liveViewport}
                className="w-full bg-transparent"
                contentClassName="min-h-[18rem] md:min-h-[24rem]"
                imageClassName="max-h-[28rem] w-full object-contain"
                fullscreenExtras={
                  <RunStatusBar
                    status={temporaryRun.status}
                    title={selectedCase.caseCode}
                    subtitle={temporaryRun.steps.at(-1)?.title}
                    logs={temporaryRun.logs.join("\n")}
                    controls={<TaskControlBar kind="run" id={temporaryRun.id} status={temporaryRun.status} />}
                  />
                }
              />

              <div className="grid gap-4 xl:grid-cols-2 grid-cols-1">
                <div className="space-y-3">
                  {temporaryRun.pendingHumanHandoff ? (
                    <Card className="border-warning/40 bg-warning/5 shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">{t("cases.waitingHumanInput")}</CardTitle>
                        <CardDescription>
                          {temporaryRun.pendingHumanHandoff.scope === "precondition" ? t("cases.humanInputPrecondition") : t("cases.humanInputTarget")}
                          {" "}
                          {temporaryRun.pendingHumanHandoff.instruction}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {(temporaryRun.pendingHumanHandoff.imageUrl ?? temporaryRun.currentViewport) ? (
                          <div className="overflow-hidden rounded-xl border border-border/60 bg-slate-100 dark:bg-black/20">
                            <img
                              alt={temporaryRun.pendingHumanHandoff.inputLabel ?? t("cases.humanInputImageAlt")}
                              className="max-h-52 w-full object-contain bg-slate-200 dark:bg-black"
                              src={temporaryRun.pendingHumanHandoff.imageUrl ?? temporaryRun.currentViewport}
                            />
                          </div>
                        ) : null}
                        <div className="flex gap-2">
                          <input
                            className={`${inputClassName} text-xs flex-1 bg-secondary/20 border-border/60`}
                            onChange={(event) => setQuickRunHumanInput(event.target.value)}
                            placeholder={temporaryRun.pendingHumanHandoff.placeholder ?? temporaryRun.pendingHumanHandoff.inputLabel ?? t("cases.humanInputPlaceholder")}
                            value={quickRunHumanInput}
                          />
                          <Button
                            className="cursor-pointer"
                            disabled={busy || !quickRunHumanInput.trim()}
                            onClick={async () => {
                              await submitRunHumanInput(temporaryRun.id, temporaryRun.pendingHumanHandoff!.id, quickRunHumanInput)
                              setQuickRunHumanInput("")
                            }}
                          >
                            {temporaryRun.pendingHumanHandoff.confirmText ?? t("cases.confirmAndContinue")}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}

                  {temporaryRun.steps.length > 0 ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground select-none">
                        {t("cases.currentPhase", { phase: translateRunPhase(temporaryRun.orchestrationPhase) })}
                        {temporaryRun.preconditionSummary?.length ? t("cases.preconditionList", { list: temporaryRun.preconditionSummary.join(t("cases.listSeparator")) }) : ""}
                      </div>
                      <div className="space-y-2 max-h-[18rem] overflow-y-auto pr-1">
                        {temporaryRun.steps.map((step: any) => (
                          <div key={step.id} className="rounded-xl border border-border/50 bg-background/40 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <strong className="text-xs text-foreground font-medium">{step.title}</strong>
                              <Badge tone={step.status === "passed" ? "success" : step.status === "failed" ? "danger" : "warning"}>
                                {translateStatus(step.status)}
                              </Badge>
                            </div>
                            {step.log ? <p className="mt-1.5 text-xs text-muted-foreground leading-normal">{step.log}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground select-none">
                      {t("cases.tempRunCreated")}
                    </div>
                  )}
                </div>

                <div className="flex flex-col">
                  <LogPanel
                    noCard
                    title={t("cases.tempRunLogs")}
                    content={temporaryRun.logs.join("\n")}
                    className="flex-1 max-h-[22rem] min-h-[14rem]"
                  />
                </div>
              </div>
            </div>

            {temporaryRun.artifacts.length > 0 ? (
              <div className="space-y-2 pt-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("cases.artifactsTitle")}</div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {temporaryRun.artifacts.map((artifact: any) => (
                    <a
                      key={artifact.name}
                      href={resolveUrl(artifact.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-3 py-2 text-xs transition hover:bg-secondary/40"
                    >
                      <strong>{artifact.kind === "video" ? t("cases.artifactVideo") : artifact.kind === "trace" ? t("cases.artifactTrace") : t("cases.artifactScreenshot")}</strong>
                      <span className="truncate text-muted-foreground text-[10px] max-w-[140px]">{artifact.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Tabs Selector */}
        <div className="flex border-b border-border/60 gap-6 select-none">
          {(["info", "script", "history", "api"] as const).map((tab) => (
            <button
              key={tab}
              className={`pb-3 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "info" && t("cases.tabInfo")}
              {tab === "script" && t("cases.tabScript")}
              {tab === "history" && t("cases.tabHistory")}
              {tab === "api" && "API"}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        {activeTab === "info" && (
          <div className="space-y-5 animate-fade-in">
            <div className="p-4 rounded-xl border border-border bg-secondary/10 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1 select-none">
                <span className="material-symbols-outlined text-xs">target</span>
                {t("cases.purpose")}
              </h4>
              <p className="text-sm font-medium text-foreground leading-relaxed">{selectedCase.purpose}</p>
            </div>

            <div className="p-4 rounded-xl border border-border bg-secondary/10 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1 select-none">
                <span className="material-symbols-outlined text-xs text-emerald-500">check_circle</span>
                {t("cases.expectedResult")}
              </h4>
              <p className="text-sm font-medium text-foreground leading-relaxed">{selectedCase.expectedResult}</p>
            </div>

            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 select-none">
                <span className="material-symbols-outlined text-xs">format_list_numbered</span>
                {t("cases.stepsTitle")}
              </h4>
              <div className="grid gap-2.5">
                {selectedCase.steps.map((step, index) => (
                  <label
                    key={index}
                    className="flex items-start gap-3 p-3 rounded-xl border border-border/40 bg-secondary/5 hover:bg-secondary/15 transition-colors cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 rounded border-border/80 bg-background text-primary focus:ring-primary/20 cursor-pointer"
                    />
                    <div className="text-sm text-foreground leading-relaxed flex items-start">
                      <span className="inline-flex items-center justify-center size-5 rounded-full bg-secondary text-[10px] font-mono font-bold text-muted-foreground mr-2 shrink-0 select-none">
                        {index + 1}
                      </span>
                      <span className="flex-1 font-medium">{step}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {selectedCaseDependencies.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1 select-none">
                  <span className="material-symbols-outlined text-xs">account_tree</span>
                  {t("cases.preconditionCases")}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedCaseDependencies.map((item) => {
                    const proj = projects.find((p) => p.id === item.projectId)
                    return (
                      <div key={item.id} className="p-3.5 rounded-xl border border-border/80 bg-secondary/20 text-xs space-y-1">
                        <p className="font-semibold text-foreground">{item.caseCode}</p>
                        <p className="text-[10px] text-muted-foreground">{item.purpose || item.expectedResult || t("cases.noDescription")}</p>
                        <p className="text-[10px] text-muted-foreground">{proj?.name}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/40 text-xs text-muted-foreground select-none">
              <div>
                <span className="font-semibold">Bug ID: </span>
                <span className="font-mono text-foreground">{selectedCase.bugId || t("cases.none")}</span>
              </div>
              <div>
                <span className="font-semibold">{t("cases.createdAtLabel")}</span>
                <span>{formatDateTime(selectedCase.createdAt)}</span>
              </div>
              {selectedCase.note && (
                <div className="col-span-2 mt-2">
                  <span className="font-semibold block mb-1">{t("cases.noteInfoLabel")}</span>
                  <p className="text-foreground leading-relaxed p-3 bg-secondary/5 rounded-lg border border-border/30 whitespace-pre-wrap">{selectedCase.note}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "script" && (
          <div className="space-y-4 animate-fade-in">
            {selectedScript?.code || selectedCase.aiScript ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center select-none">
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono">
                    <span className="material-symbols-outlined text-sm">code</span>
                    ID: {selectedScript?.id || "AI_GENERATED"}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedScript?.code || selectedCase.aiScript || "")
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className="px-3 py-1 text-xs font-semibold bg-secondary hover:bg-secondary/80 text-foreground border border-border rounded-lg flex items-center gap-1.5 cursor-pointer transition-all"
                  >
                    <span className="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
                    {copied ? t("cases.copied") : t("cases.copyCode")}
                  </button>
                </div>
                <div className="relative rounded-xl border border-border/80 overflow-hidden bg-slate-50 dark:bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-800 dark:text-slate-200">
                  <pre className="overflow-auto max-h-[400px] whitespace-pre-wrap select-text">{selectedScript?.code || selectedCase.aiScript}</pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-6 border border-dashed border-border/60 rounded-xl text-center bg-secondary/5">
                <span className="material-symbols-outlined text-4xl text-muted-foreground/60 mb-2">code_off</span>
                <p className="text-sm font-semibold text-muted-foreground mb-4">{t("cases.noScriptEmpty")}</p>
                <Button onClick={() => setActiveSection("workbench")} size="sm">
                  <span className="material-symbols-outlined text-base">smart_toy</span>
                  {t("cases.goWorkbenchGenerate")}
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-3 animate-fade-in">
            {caseRuns.length === 0 ? (
              <div className="text-center py-16 text-sm text-muted-foreground italic border border-dashed border-border/40 rounded-xl bg-secondary/5">
                {t("cases.noRunHistory")}
              </div>
            ) : (
              caseRuns.map((run) => (
                <div key={run.id} className="flex items-center justify-between p-4 rounded-xl border border-border/80 bg-secondary/20 hover:bg-secondary/35 transition-all">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{run.id}</span>
                      <Badge tone={run.status === "passed" ? "success" : run.status === "failed" ? "danger" : "warning"}>
                        {translateStatus(run.status)}
                      </Badge>
                      <Badge tone={run.kind === "verification" ? "info" : "default"}>
                        {run.kind === "verification" ? t("cases.runKindVerification") : t("cases.runKindExecution")}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 select-none">
                      <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">schedule</span>{formatDateTime(run.startedAt)}</span>
                      <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">timer</span>{formatDuration(run.startedAt, run.finishedAt)}</span>
                      <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">language</span>{run.testBaseUrl}</span>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      setActiveTaskRunId(null)
                      setActiveRun(run)
                      setActiveSection("runs")
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {t("cases.viewLogs")}
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "api" && (
          <CaseApiPanel selectedCase={selectedCase} targetUrls={targetUrls} />
        )}
      </div>
    </div>
  )
}
