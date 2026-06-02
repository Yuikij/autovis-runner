import type { ReadyWorkspaceController } from "../useWorkspaceController"

type SettingsSectionProps = {
  controller: ReadyWorkspaceController
}

export function SettingsSection({ controller }: SettingsSectionProps) {
  const { busy, copilotPolling, llmSession, copilotModel, setCopilotModel, selectedProject, disconnectCopilot, startCopilotDeviceFlow } = controller

  return (
    <section className="stage-grid settings-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">系统设置</p>
            <h3>连接与默认行为</h3>
          </div>
          {llmSession.connectionStatus === "connected" ? (
            <button className="ghost-button" type="button" onClick={disconnectCopilot} disabled={busy}>
              断开 Copilot
            </button>
          ) : (
            <button className="primary-button small" type="button" onClick={startCopilotDeviceFlow} disabled={busy || copilotPolling}>
              连接 Copilot
            </button>
          )}
        </div>

        <div className="settings-grid-inner">
          <label className="setting-field" htmlFor="setting-model">
            <span>Copilot 模型</span>
            <input id="setting-model" value={copilotModel} onChange={(event) => setCopilotModel(event.target.value)} />
          </label>
          <div className="setting-field readonly">
            <span>代理接口</span>
            <strong>{llmSession.proxyEndpoint}</strong>
          </div>
          <div className="setting-field readonly">
            <span>Base URL</span>
            <strong>{llmSession.baseUrl}</strong>
          </div>

        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">系统设置</p>
            <h3>平台能力概览</h3>
          </div>
        </div>

        <div className="stack-list">
          <div className="stack-card">
            <strong>AI 自动化脚本生成</strong>
            <span>支持连接 GitHub Copilot，在 AI 工作台中结合项目代码与测试页面生成 Playwright 脚本。</span>
          </div>
          <div className="stack-card">
            <strong>测试集任务执行</strong>
            <span>支持按测试集串行执行已有脚本，并保留浏览器回放、日志、trace、video 与截图。</span>
          </div>
          <div className="stack-card">
            <strong>手动录制模式</strong>
            <span>支持在 Web 端远程操作浏览器，生成 manual script 后继续验证与回放。</span>
          </div>
        </div>
      </div>
    </section>
  )
}
