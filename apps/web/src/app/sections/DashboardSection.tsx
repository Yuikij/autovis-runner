import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { formatDateTime, formatDuration, translateStatus } from "../utils"
import { clearFrontendDiagnostics, type FrontendDiagnosticEntry, useFrontendDiagnostics } from "../frontendDiagnostics"

type DashboardSectionProps = {
  controller: ReadyWorkspaceController
}

export function DashboardSection({ controller }: DashboardSectionProps) {
  const {
    projects,
    testCases,
    executionRate,
    activeCount,
    llmSession,
    llmConfigs,
    activeLlmConfigId,
    activeVisionConfigId,
    llmConfigForm,
    setLlmConfigForm,
    busy,
    copilotPolling,
    pendingDeviceAuth,
    pendingExpiresInSeconds,
    projectRuns,
    disconnectCopilot,
    saveLlmConfig,
    activateLlmConfig,
    activateVisionConfig,
    deleteLlmConfig,
    startCopilotDeviceFlow,
    pollCopilotDeviceFlow,
    setActiveRun,
    setActiveTaskRunId,
    setActiveSection,
  } = controller
  const frontendDiagnostics = useFrontendDiagnostics()
  const latestDiagnostic = frontendDiagnostics.items[0] ?? null

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero Welcome Section */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-primary/10 via-accent/5 to-transparent p-6 shadow-sm">
        <div className="absolute right-4 top-4 opacity-10 select-none">
          <span className="material-symbols-outlined text-[120px] text-foreground">deployed_code</span>
        </div>
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-widest">系统仪表盘</p>
          <h2 className="text-xl font-bold text-foreground">智能自动化测试中枢</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            围绕项目、测试集、测试用例、AI 工作台与任务执行，统一管理自动化测试脚本的生成、录制、版本回滚、验证与回放。
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Projects */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/40 backdrop-blur-sm p-5 shadow-sm hover:border-border transition-all duration-300 group">
          <div className="absolute right-3 top-3 text-muted-foreground/20 group-hover:text-muted-foreground/30 transition-colors">
            <span className="material-symbols-outlined text-4xl">folder</span>
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">测试项目</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground font-mono">{projects.length}</span>
            <span className="text-xs text-muted-foreground">个活跃项目</span>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1 cursor-pointer hover:text-primary transition-colors" onClick={() => setActiveSection("projects")}>
            查看所有项目 <span className="material-symbols-outlined text-[10px]">arrow_forward</span>
          </div>
        </div>

        {/* Card 2: Test Cases */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/40 backdrop-blur-sm p-5 shadow-sm hover:border-border transition-all duration-300 group">
          <div className="absolute right-3 top-3 text-muted-foreground/20 group-hover:text-muted-foreground/30 transition-colors">
            <span className="material-symbols-outlined text-4xl">fact_check</span>
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">用例总数</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground font-mono">{testCases.length}</span>
            <span className="text-xs text-muted-foreground">条测试用例</span>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1 cursor-pointer hover:text-primary transition-colors" onClick={() => setActiveSection("cases")}>
            设计测试集用例 <span className="material-symbols-outlined text-[10px]">arrow_forward</span>
          </div>
        </div>

        {/* Card 3: Execution Success Rate */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent p-5 shadow-sm hover:border-emerald-500/40 transition-all duration-300 group">
          <div className="absolute right-3 top-3 text-emerald-500/20 group-hover:text-emerald-500/30 transition-colors">
            <span className="material-symbols-outlined text-4xl">analytics</span>
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">执行通过率</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground font-mono">{executionRate}%</span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center font-medium">
              <span className="material-symbols-outlined text-[12px] mr-0.5">trending_up</span>
              平均值
            </span>
          </div>
          <div className="mt-3 w-full bg-secondary h-1 rounded-full overflow-hidden">
            <div 
              className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
              style={{ width: `${executionRate}%` }}
            />
          </div>
        </div>

        {/* Card 4: Active / Running Runs */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/40 backdrop-blur-sm p-5 shadow-sm hover:border-border transition-all duration-300 group">
          <div className="absolute right-3 top-3 text-muted-foreground/20 group-hover:text-muted-foreground/30 transition-colors">
            <span className="material-symbols-outlined text-4xl animate-pulse">play_circle</span>
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">运行中任务</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground font-mono">{activeCount}</span>
            <span className="text-xs text-muted-foreground">个验证实例</span>
          </div>
          <div
            className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1 cursor-pointer hover:text-primary transition-colors"
            onClick={() => {
              setActiveRun(null)
              setActiveTaskRunId(null)
              setActiveSection("runs")
            }}
          >
            进入运行监控 <span className="material-symbols-outlined text-[10px]">arrow_forward</span>
          </div>
        </div>
      </div>

      {/* Main Details Grid */}
      <div className="grid grid-cols-1 gap-6">
        <div className="rounded-2xl border border-border/80 bg-card/50 p-5 shadow-sm backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-lg">diagnosis</span>
              <div>
                <h3 className="text-sm font-semibold text-foreground">前端运行诊断</h3>
                <p className="text-[11px] text-muted-foreground">
                  收集浏览器未捕获异常、Promise 拒绝、React 渲染错误，以及已处理的 API 请求失败。
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                最近 {frontendDiagnostics.items.length} 条
              </span>
              <button
                type="button"
                onClick={() => clearFrontendDiagnostics()}
                disabled={frontendDiagnostics.items.length === 0}
                className="rounded-lg border border-border/60 bg-background px-3 py-1.5 text-[11px] text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                清空诊断
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <DiagnosticStatCard
                label="未捕获异常"
                value={countDiagnostics(frontendDiagnostics.items, ["window-error", "unhandled-rejection", "react-error-boundary"])}
                tone="danger"
              />
              <DiagnosticStatCard
                label="API 失败"
                value={countDiagnostics(frontendDiagnostics.items, ["api-request"])}
                tone="warning"
              />
              <DiagnosticStatCard
                label="最近路径"
                value={latestDiagnostic?.path ?? "-"}
                tone="default"
              />
            </div>

            <div className="min-h-[15rem] rounded-2xl border border-border/60 bg-background/40 p-3">
              {frontendDiagnostics.items.length === 0 ? (
                <div className="flex h-full min-h-[13rem] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <span className="material-symbols-outlined text-3xl text-emerald-500">verified</span>
                  <p className="text-sm font-medium text-foreground">当前未记录到前端异常</p>
                  <p className="max-w-lg text-[11px] leading-relaxed">
                    当页面出现未捕获异常、Promise 拒绝、React 渲染错误，或 API 请求返回失败状态时，这里会自动留下诊断记录。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {frontendDiagnostics.items.map((item) => (
                    <DiagnosticEntryCard key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent runs */}
        <div className="rounded-2xl border border-border/80 bg-card/50 backdrop-blur-md p-5 flex flex-col shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-border/40 mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-lg">history_toggle_off</span>
              <h3 className="text-sm font-semibold text-foreground">项目最近运行轨迹</h3>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border/40">
              历史共 {projectRuns.length} 次
            </span>
          </div>

          {/* Execution list Table */}
          <div className="flex-1 overflow-x-auto min-h-[16rem]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/40 text-[10px] uppercase font-semibold tracking-wider text-muted-foreground select-none">
                  <th className="pb-3 pl-2">运行 ID</th>
                  <th className="pb-3">执行状态</th>
                  <th className="pb-3">触发时间</th>
                  <th className="pb-3 pr-2">运行耗时</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20 text-xs">
                {projectRuns.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-muted-foreground italic">
                      目前尚无运行历史。选择用例后，在工作台中启动验证，运行结果将归档于此。
                    </td>
                  </tr>
                ) : (
                  projectRuns.slice(0, 10).map((run) => {
                    let statusClass = "bg-secondary text-secondary-foreground"
                    if (run.status === "passed") {
                      statusClass = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                    } else if (run.status === "failed") {
                      statusClass = "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                    } else {
                      statusClass = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse"
                    }

                    return (
                      <tr 
                        key={run.id}
                        onClick={() => {
                          setActiveTaskRunId(null)
                          setActiveRun(run)
                          setActiveSection("runs")
                        }}
                        className="hover:bg-secondary/20 cursor-pointer transition-colors group"
                      >
                        <td className="py-3 pl-2 font-mono font-semibold text-foreground group-hover:text-primary transition-colors">
                          {run.id}
                        </td>
                        <td className="py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium leading-none ${statusClass}`}>
                            {translateStatus(run.status)}
                          </span>
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {formatDateTime(run.startedAt)}
                        </td>
                        <td className="py-3 pr-2 text-muted-foreground font-mono">
                          {formatDuration(run.startedAt, run.finishedAt)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function DiagnosticStatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone: "default" | "warning" | "danger"
}) {
  const toneClass = tone === "danger"
    ? "border-rose-500/30 bg-rose-500/5"
    : tone === "warning"
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-border/60 bg-card/40"

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 break-all font-mono text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}

function DiagnosticEntryCard({ item }: { item: FrontendDiagnosticEntry }) {
  const toneClass = item.level === "error"
    ? "border-rose-500/30 bg-rose-500/5"
    : "border-amber-500/30 bg-amber-500/5"

  return (
    <details className={`rounded-2xl border p-3 ${toneClass}`}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                {item.source}
              </span>
              <span className="text-[10px] text-muted-foreground">{formatDateTime(item.timestamp)}</span>
            </div>
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
            <p className="break-all text-[11px] leading-relaxed text-muted-foreground">{item.message}</p>
          </div>
          <span className="material-symbols-outlined text-muted-foreground">expand_more</span>
        </div>
      </summary>

      <div className="mt-3 space-y-3 border-t border-border/40 pt-3 text-[11px]">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">路径</p>
            <p className="mt-1 break-all font-mono text-foreground">{item.path}</p>
          </div>
          {item.meta ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">上下文</p>
              <pre className="mt-1 whitespace-pre-wrap break-all rounded-xl border border-border/40 bg-background/60 p-2 font-mono text-foreground/90">
                {JSON.stringify(item.meta, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
        {item.componentStack ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">组件栈</p>
            <pre className="mt-1 whitespace-pre-wrap break-all rounded-xl border border-border/40 bg-background/60 p-2 font-mono text-foreground/90">
              {item.componentStack}
            </pre>
          </div>
        ) : null}
        {item.stack ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">错误堆栈</p>
            <pre className="mt-1 whitespace-pre-wrap break-all rounded-xl border border-border/40 bg-background/60 p-2 font-mono text-foreground/90">
              {item.stack}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  )
}

function countDiagnostics(
  items: FrontendDiagnosticEntry[],
  sources: FrontendDiagnosticEntry["source"][],
) {
  return items.filter((item) => sources.includes(item.source)).length
}
