import { useEffect, useState } from "react"
import { request } from "../api"
import { apiRoutes } from "../apiRoutes"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { formatDateTime } from "../utils"

type LlmConnectionsSectionProps = {
  controller: ReadyWorkspaceController
}

export function LlmConnectionsSection({ controller }: LlmConnectionsSectionProps) {
  const {
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
    disconnectCopilot,
    saveLlmConfig,
    activateLlmConfig,
    activateVisionConfig,
    deleteLlmConfig,
    startCopilotDeviceFlow,
    pollCopilotDeviceFlow,
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
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="rounded-2xl border border-border/80 bg-card/50 backdrop-blur-md p-6 flex flex-col shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-border/40 mb-5">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-xl">smart_toy</span>
            <h3 className="text-base font-semibold text-foreground">大模型连接中心</h3>
          </div>
          
           {llmSession.connectionStatus === "connected" ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg select-none">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              在线已连接
            </span>
          ) : llmSession.connectionStatus === "authorizing" ? (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg select-none">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              授权核对中
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-lg select-none">
              <span className="size-2 rounded-full bg-rose-500" />
              未连接
            </span>
          )}
        </div>

        <div className="space-y-6 flex-1">
          <div className="rounded-xl border border-border/40 bg-secondary/10 p-5 space-y-4">
            <div className="text-sm font-semibold text-foreground">AI 配置管理</div>
            <div className="space-y-2.5">
              {llmConfigs.map((config) => (
                <div key={config.id} className="rounded-xl border border-border/40 bg-background/80 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate flex items-center gap-2 flex-wrap">
                        {config.name}
                        {activeLlmConfigId === config.id && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                            通用配置
                          </span>
                        )}
                        {activeVisionConfigId === config.id && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 whitespace-nowrap">
                            识图模型
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{config.provider}</div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        type="button" 
                        className={`px-3 py-1.5 text-xs rounded-md transition-all ${
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
                        className={`px-3 py-1.5 text-xs rounded-md transition-all ${
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
                        className="px-3 py-1.5 text-xs rounded-md transition-all bg-secondary/50 hover:bg-secondary text-foreground"
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
                          className="px-3 py-1.5 text-xs rounded-md bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 transition-all"
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
            
            <div className="pt-2 border-t border-border/30 space-y-3">
              <div className="text-xs font-medium text-muted-foreground">新增/修改配置</div>
              <input
                value={llmConfigForm.name}
                onChange={(event) => setLlmConfigForm((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                placeholder="配置名称"
              />
              <select
                value={llmConfigForm.provider}
                onChange={(event) => setLlmConfigForm((current) => ({ ...current, provider: event.target.value as typeof current.provider }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              >
                <option value="copilot-proxy">Copilot</option>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
              </select>
              <input
                value={llmConfigForm.baseUrl}
                onChange={(event) => setLlmConfigForm((current) => ({ ...current, baseUrl: event.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                placeholder="Base URL"
              />
              {llmConfigForm.provider !== "copilot-proxy" ? (
                <input
                  value={llmConfigForm.apiKey ?? ""}
                  onChange={(event) => setLlmConfigForm((current) => ({ ...current, apiKey: event.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                  placeholder={
                    llmConfigs.find((c) => c.id === llmConfigForm.id)?.apiKeyConfigured
                      ? "已配置 API Key (若无需修改请留空)"
                      : "API Key"
                  }
                />
              ) : null}
              <div className="space-y-2">
                <select
                  value={llmConfigForm.model}
                  onChange={(event) => setLlmConfigForm((current) => ({ ...current, model: event.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
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
                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      className="flex-1 py-2 text-xs font-medium rounded-lg border border-border bg-background hover:bg-secondary disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      disabled={busy || loadingConfigModels}
                      onClick={handleFetchModels}
                    >
                      {loadingConfigModels ? (
                        <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined text-[14px]">download</span>
                      )}
                      拉取模型列表
                    </button>
                    <button
                      type="button"
                      className="flex-1 py-2 text-xs font-medium rounded-lg border border-border bg-background hover:bg-secondary disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      disabled={busy || testingConnectivity}
                      onClick={handleTestConnectivity}
                    >
                      {testingConnectivity ? (
                        <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined text-[14px]">wifi</span>
                      )}
                      测试连通性
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" className="flex-1 h-10 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer" disabled={busy} onClick={saveLlmConfig}>
                  {llmConfigForm.id ? "更新配置" : "保存新配置"}
                </button>
                {llmConfigForm.id && (
                  <button 
                    type="button" 
                    className="px-6 h-10 text-sm font-medium rounded-lg border border-border hover:bg-secondary transition-all cursor-pointer text-muted-foreground" 
                    onClick={() => setLlmConfigForm({ name: "", provider: "openai-compatible", baseUrl: "", model: "", apiKey: "" })}
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </div>
          </div>
          
          <div className="bg-secondary/20 p-5 rounded-xl border border-border/30 space-y-4">
            <div className="text-sm font-semibold text-foreground border-b border-border/30 pb-2">当前连接状态</div>
            
            {/* Model Select */}
            <div className="flex items-center justify-between text-sm py-1">
              <span className="text-muted-foreground">模型会话</span>
              {llmSession.connectionStatus === "connected" ? (
                loadingModels ? (
                  <span className="text-muted-foreground text-xs">获取中...</span>
                ) : (
                  <select
                    value={llmSession.model}
                    onChange={handleModelChange}
                    className="bg-transparent hover:bg-secondary/60 border border-transparent hover:border-border/60 focus:border-border focus:ring-0 cursor-pointer font-mono font-medium text-foreground py-1 px-2 rounded-lg text-sm max-w-[250px] text-right outline-none transition-all"
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
            <div className="flex items-center justify-between text-sm py-1">
              <span className="text-muted-foreground">服务地址</span>
              <strong className="font-mono text-foreground text-xs truncate max-w-[250px]" title={llmSession.baseUrl}>
                {llmSession.baseUrl}
              </strong>
            </div>

            {/* Sync date */}
            <div className="flex items-center justify-between text-sm py-1">
              <span className="text-muted-foreground">最后同步</span>
              <strong className="text-foreground text-sm">{formatDateTime(llmSession.lastSyncedAt)}</strong>
            </div>
            
            {/* Error logs */}
            {llmSession.lastError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl leading-relaxed mt-2">
                {llmSession.lastError}
              </p>
            )}
          </div>
        </div>

        {/* Action button */}
        <div className="mt-6 pt-5 border-t border-border/40">
          {activeIsCopilot && llmSession.connectionStatus === "connected" ? (
            <button 
              className="w-full h-10 text-sm font-semibold rounded-lg border border-border hover:bg-secondary hover:text-foreground text-muted-foreground transition-all cursor-pointer"
              type="button" 
              onClick={disconnectCopilot} 
              disabled={busy}
            >
              断开会话连接
            </button>
          ) : activeIsCopilot ? (
            <button 
              className="w-full h-11 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm"
              type="button" 
              onClick={startCopilotDeviceFlow} 
              disabled={busy || copilotPolling}
            >
              <span className="material-symbols-outlined text-base">login</span>
              {pendingDeviceAuth ? "重新启动授权流" : "启动 Copilot 设备授权"}
            </button>
          ) : null}
        </div>

        {/* Device verification popup info inside panel */}
        {activeIsCopilot && pendingDeviceAuth && (
          <div className="mt-5 rounded-xl border border-warning/30 bg-warning/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                等待设备授权中
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {pendingExpiresInSeconds}s 后失效
              </span>
            </div>
            <div className="text-sm text-muted-foreground leading-normal">
              请在浏览器中打开授权链接，并输入下方的设备配对码：
            </div>
            <a 
              href={pendingDeviceAuth.verificationUri} 
              target="_blank" 
              rel="noreferrer"
              className="block text-sm text-primary hover:underline truncate font-mono bg-secondary/40 p-3 rounded-lg border border-border/40 text-center"
            >
              {pendingDeviceAuth.verificationUri}
            </a>
            <div className="flex items-center justify-center bg-secondary/80 border border-border/60 py-3 rounded-xl font-mono text-xl font-bold tracking-widest text-foreground">
              {pendingDeviceAuth.userCode}
            </div>
            <button 
              type="button" 
              onClick={pollCopilotDeviceFlow} 
              disabled={busy || copilotPolling}
              className="w-full h-10 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              {copilotPolling ? "检查中..." : "立即核对授权"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
