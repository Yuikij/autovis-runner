import { t } from "../../i18n/index.js"
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
            <p className="panel-eyebrow">{t("settings.eyebrow")}</p>
            <h3>{t("settings.connectionTitle")}</h3>
          </div>
          {llmSession.connectionStatus === "connected" ? (
            <button className="ghost-button" type="button" onClick={disconnectCopilot} disabled={busy}>
              {t("settings.disconnectCopilot")}
            </button>
          ) : (
            <button className="primary-button small" type="button" onClick={startCopilotDeviceFlow} disabled={busy || copilotPolling}>
              {t("settings.connectCopilot")}
            </button>
          )}
        </div>

        <div className="settings-grid-inner">
          <label className="setting-field" htmlFor="setting-model">
            <span>{t("settings.copilotModel")}</span>
            <input id="setting-model" value={copilotModel} onChange={(event) => setCopilotModel(event.target.value)} />
          </label>
          <div className="setting-field readonly">
            <span>{t("settings.proxyEndpoint")}</span>
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
            <p className="panel-eyebrow">{t("settings.eyebrow")}</p>
            <h3>{t("settings.capabilitiesTitle")}</h3>
          </div>
        </div>

        <div className="stack-list">
          <div className="stack-card">
            <strong>{t("settings.capAiGenTitle")}</strong>
            <span>{t("settings.capAiGenDesc")}</span>
          </div>
          <div className="stack-card">
            <strong>{t("settings.capSuiteTitle")}</strong>
            <span>{t("settings.capSuiteDesc")}</span>
          </div>
          <div className="stack-card">
            <strong>{t("settings.capRecordTitle")}</strong>
            <span>{t("settings.capRecordDesc")}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
