import { useEffect, useState } from "react"
import { request } from "../api"
import { apiRoutes } from "../apiRoutes"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { formatDateTime, formatDuration, translateStatus } from "../utils"

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
