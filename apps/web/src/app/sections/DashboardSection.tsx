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

  const [copilotModels, setCopilotModels] = useState<{ id: string; name: string; vendor: string }[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [testingConnectivity, setTestingConnectivity] = useState(false)
  const [loadingConfigModels, setLoadingConfigModels] = useState(false)
  const [configModels, setConfigModels] = useState<{ id: string; name: string; vendor: string }[]>([])

  const handleTestConnectivity = async () => {
    setTestingConnectivity(true)
    try {
      await request(apiRoutes.llm.testConfig(), {
        method: "POST",
        body: JSON.stringify(llmConfigForm),
      })
      alert("连通性测试成功！通道已畅通。")
    } catch (err) {
      alert("连通性测试失败: " + (err as Error).message)
    } finally {
      setTestingConnectivity(false)
    }
  }

  const handleFetchModels = async () => {
    setLoadingConfigModels(true)
    try {
      let result
      if (llmConfigForm.id && !llmConfigForm.apiKey) {
        result = await request<{ id: string; name: string; vendor: string }[]>(apiRoutes.llm.models({ configId: llmConfigForm.id }))
      } else {
        result = await request<{ id: string; name: string; vendor: string }[]>(apiRoutes.llm.testConfig(), {
          method: "POST",
          body: JSON.stringify(llmConfigForm),
        })
      }
      setConfigModels(result.data)
      alert(`已成功获取该提供商的 ${result.data.length} 个可用模型列表。`)
    } catch (err) {
      alert("拉取模型列表失败: " + (err as Error).message)
    } finally {
      setLoadingConfigModels(false)
    }
  }

  useEffect(() => {
    if (llmSession.connectionStatus === "connected") {
      setLoadingModels(true)
      request<{ id: string; name: string; vendor: string }[]>(apiRoutes.llm.models())
        .then((result) => {
          setCopilotModels(result.data)
        })
        .catch((err) => {
          console.error("Failed to load Copilot models:", err)
        })
        .finally(() => {
          setLoadingModels(false)
        })
    } else {
      setCopilotModels([])
    }
  }, [llmSession.connectionStatus])

  useEffect(() => {
    if (llmConfigForm.id && llmConfigForm.provider !== "copilot-proxy") {
      setLoadingConfigModels(true)
      request<{ id: string; name: string; vendor: string }[]>(apiRoutes.llm.models({ configId: llmConfigForm.id }))
        .then((result) => {
          setConfigModels(result.data)
        })
        .catch((err) => {
          console.error("Failed to load models for config:", err)
        })
        .finally(() => {
          setLoadingConfigModels(false)
        })
    } else {
      setConfigModels([])
    }
  }, [llmConfigForm.id, llmConfigForm.provider])

  const handleModelChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModel = event.target.value
    try {
      await request(apiRoutes.llm.sessionModel(), {
        method: "POST",
        body: JSON.stringify({ model: nextModel }),
      })
      await controller.loadLlmSession()
    } catch (err) {
      alert("更新模型失败: " + (err as Error).message)
    }
  }

  const activeIsCopilot = llmSession.provider === "copilot-proxy"

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side: Copilot session */}
        <div className="rounded-2xl border border-border/80 bg-card/50 backdrop-blur-md p-5 flex flex-col shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-border/40 mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-lg">smart_toy</span>
              <h3 className="text-sm font-semibold text-foreground">大模型连接中心</h3>
            </div>
            
             {llmSession.connectionStatus === "connected" ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg select-none">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                在线已连接
              </span>
            ) : llmSession.connectionStatus === "authorizing" ? (
              <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-lg select-none">
                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                授权核对中
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 font-medium bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-lg select-none">
                <span className="size-1.5 rounded-full bg-rose-500" />
                未连接
              </span>
            )}
          </div>

          <div className="space-y-4 flex-1">
            <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-3">
              <div className="text-[11px] font-semibold text-foreground">AI 配置管理</div>
              <div className="space-y-2">
                {llmConfigs.map((config) => (
                  <div key={config.id} className="rounded-lg border border-border/40 bg-background/80 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground truncate flex items-center gap-2 flex-wrap">
                          {config.name}
                          {activeLlmConfigId === config.id && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                              通用配置
                            </span>
                          )}
                          {activeVisionConfigId === config.id && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 whitespace-nowrap">
                              识图模型
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{config.provider}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <button 
                          type="button" 
                          className={`px-2 py-1 text-[10px] rounded-md transition-all ${
                            activeLlmConfigId === config.id 
                              ? "bg-secondary text-muted-foreground cursor-default opacity-50" 
                              : "bg-primary/10 text-primary hover:bg-primary/20"
                          }`}
                          disabled={busy || activeLlmConfigId === config.id} 
                          onClick={() => activateLlmConfig(config.id)}
                        >
                          启用
                        </button>
                        <button 
                          type="button" 
                          className={`px-2 py-1 text-[10px] rounded-md transition-all ${
                            activeVisionConfigId === config.id 
                              ? "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20" 
                              : "bg-secondary/50 hover:bg-secondary text-foreground"
                          }`}
                          disabled={busy} 
                          onClick={() => activateVisionConfig(activeVisionConfigId === config.id ? null : config.id)}
                        >
                          {activeVisionConfigId === config.id ? "取消识图" : "设为识图"}
                        </button>
                        <button 
                          type="button" 
                          className="px-2 py-1 text-[10px] rounded-md transition-all bg-secondary/50 hover:bg-secondary text-foreground"
                          disabled={busy} 
                          onClick={() => setLlmConfigForm({
                            id: config.id,
                            name: config.name,
                            provider: config.provider as any,
                            baseUrl: config.baseUrl,
                            model: config.model,
                            apiKey: ""
                          })}
                        >
                          编辑
                        </button>
                        {llmConfigs.length > 1 ? (
                          <button 
                            type="button" 
                            className="px-2 py-1 text-[10px] rounded-md bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 transition-all"
                            disabled={busy} 
                            onClick={() => deleteLlmConfig(config.id)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <input
                value={llmConfigForm.name}
                onChange={(event) => setLlmConfigForm((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                placeholder="配置名称"
              />
              <select
                value={llmConfigForm.provider}
                onChange={(event) => setLlmConfigForm((current) => ({ ...current, provider: event.target.value as typeof current.provider }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              >
                <option value="copilot-proxy">Copilot</option>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
              </select>
              <input
                value={llmConfigForm.baseUrl}
                onChange={(event) => setLlmConfigForm((current) => ({ ...current, baseUrl: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                placeholder="Base URL"
              />
              {llmConfigForm.provider !== "copilot-proxy" ? (
                <input
                  value={llmConfigForm.apiKey ?? ""}
                  onChange={(event) => setLlmConfigForm((current) => ({ ...current, apiKey: event.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                  placeholder={
                    llmConfigs.find((c) => c.id === llmConfigForm.id)?.apiKeyConfigured
                      ? "已配置 API Key (若无需修改请留空)"
                      : "API Key"
                  }
                />
              ) : null}
              <div className="space-y-1.5">
                <select
                  value={llmConfigForm.model}
                  onChange={(event) => setLlmConfigForm((current) => ({ ...current, model: event.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="" disabled>选择或输入模型...</option>
                  {llmConfigForm.model && !configModels.some((m) => m.id === llmConfigForm.model) && (
                    <option value={llmConfigForm.model}>{llmConfigForm.model}</option>
                  )}
                  {configModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.vendor})</option>
                  ))}
                </select>
                {llmConfigForm.provider !== "copilot-proxy" && (
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      className="flex-1 py-1.5 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-secondary disabled:opacity-50 transition-all flex items-center justify-center gap-1 cursor-pointer"
                      disabled={busy || loadingConfigModels}
                      onClick={handleFetchModels}
                    >
                      {loadingConfigModels ? (
                        <span className="material-symbols-outlined text-[12px] animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined text-[12px]">download</span>
                      )}
                      拉取模型列表
                    </button>
                    <button
                      type="button"
                      className="flex-1 py-1.5 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-secondary disabled:opacity-50 transition-all flex items-center justify-center gap-1 cursor-pointer"
                      disabled={busy || testingConnectivity}
                      onClick={handleTestConnectivity}
                    >
                      {testingConnectivity ? (
                        <span className="material-symbols-outlined text-[12px] animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined text-[12px]">wifi</span>
                      )}
                      测试连通性
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="flex-1 h-9 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer" disabled={busy} onClick={saveLlmConfig}>
                  {llmConfigForm.id ? "更新配置" : "保存新配置"}
                </button>
                {llmConfigForm.id && (
                  <button 
                    type="button" 
                    className="px-4 h-9 text-xs font-medium rounded-lg border border-border hover:bg-secondary transition-all cursor-pointer text-muted-foreground" 
                    onClick={() => setLlmConfigForm({ name: "", provider: "openai-compatible", baseUrl: "", model: "", apiKey: "" })}
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </div>
            {/* Model Select */}
            <div className="flex items-center justify-between text-xs py-1 border-b border-dashed border-border/30">
              <span className="text-muted-foreground">模型会话</span>
              {llmSession.connectionStatus === "connected" ? (
                loadingModels ? (
                  <span className="text-muted-foreground text-[10px]">获取中...</span>
                ) : (
                  <select
                    value={llmSession.model}
                    onChange={handleModelChange}
                    className="bg-transparent hover:bg-secondary/40 border-0 focus:ring-0 cursor-pointer font-mono font-medium text-foreground py-0.5 px-2 rounded-lg text-xs max-w-[200px] text-right outline-none"
                  >
                    {!copilotModels.some((m) => m.id === llmSession.model) && (
                      <option value={llmSession.model}>{llmSession.model}</option>
                    )}
                    {copilotModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.vendor})
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <strong className="font-mono text-foreground">{llmSession.model}</strong>
              )}
            </div>

            {/* API host */}
            <div className="flex items-center justify-between text-xs py-1 border-b border-dashed border-border/30">
              <span className="text-muted-foreground">服务地址</span>
              <strong className="font-mono text-foreground text-[11px] truncate max-w-[200px]" title={llmSession.baseUrl}>
                {llmSession.baseUrl}
              </strong>
            </div>

            {/* Sync date */}
            <div className="flex items-center justify-between text-xs py-1 border-b border-dashed border-border/30">
              <span className="text-muted-foreground">最后同步</span>
              <strong className="text-foreground">{formatDateTime(llmSession.lastSyncedAt)}</strong>
            </div>
            
            {/* Error logs */}
            {llmSession.lastError && (
              <p className="text-[10px] text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl leading-relaxed">
                {llmSession.lastError}
              </p>
            )}
          </div>

          {/* Action button */}
          <div className="mt-5 pt-4 border-t border-border/40">
            {activeIsCopilot && llmSession.connectionStatus === "connected" ? (
              <button 
                className="w-full h-8 text-xs font-semibold rounded-lg border border-border hover:bg-secondary hover:text-foreground text-muted-foreground transition-all cursor-pointer"
                type="button" 
                onClick={disconnectCopilot} 
                disabled={busy}
              >
                断开会话连接
              </button>
            ) : activeIsCopilot ? (
              <button 
                className="w-full h-9 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                type="button" 
                onClick={startCopilotDeviceFlow} 
                disabled={busy || copilotPolling}
              >
                <span className="material-symbols-outlined text-sm">login</span>
                {pendingDeviceAuth ? "重新启动授权流" : "启动 Copilot 设备授权"}
              </button>
            ) : null}
          </div>

          {/* Device verification popup info inside panel */}
          {activeIsCopilot && pendingDeviceAuth && (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs animate-spin">sync</span>
                  等待设备授权中
                </span>
                <span className="text-[9px] text-muted-foreground font-mono">
                  {pendingExpiresInSeconds}s 后失效
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground leading-normal">
                请在浏览器中打开授权链接，并输入下方的设备配对码：
              </div>
              <a 
                href={pendingDeviceAuth.verificationUri} 
                target="_blank" 
                rel="noreferrer"
                className="block text-[11px] text-primary hover:underline truncate font-mono bg-secondary/40 p-2 rounded-lg border border-border/40 text-center"
              >
                {pendingDeviceAuth.verificationUri}
              </a>
              <div className="flex items-center justify-center bg-secondary/80 border border-border/60 py-2 rounded-xl font-mono text-base font-bold tracking-widest text-foreground">
                {pendingDeviceAuth.userCode}
              </div>
              <button 
                type="button" 
                onClick={pollCopilotDeviceFlow} 
                disabled={busy || copilotPolling}
                className="w-full h-8 text-[11px] font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1"
              >
                {copilotPolling ? "检查中..." : "立即核对授权"}
              </button>
            </div>
          )}
        </div>

        {/* Right Side: Recent runs */}
        <div className="lg:col-span-2 rounded-2xl border border-border/80 bg-card/50 backdrop-blur-md p-5 flex flex-col shadow-sm">
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
                  projectRuns.slice(0, 6).map((run) => {
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
