import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { CopilotSecretState } from "../../copilot.js"
import type {
  AgentSession,
  AgentStep,
  ExecutionRun,
  GitAuthProfile,
  LlmSessionConfig,
  Module,
  Project,
  ProjectWorkspace,
  RecorderSession,
  ScriptArtifact,
  TestCase,
  UpsertGitAuthProfileRequest,
  UpsertModuleRequest,
  UpsertProjectRequest,
  UpsertProjectWorkspaceRequest,
  UpsertTestCaseRequest,
} from "@autovis/shared"
import {
  mapAgentSession,
  mapAgentStep,
  mapGitAuthProfile,
  mapPersistedLlmState,
  mapLlmState,
  mapModule,
  mapProject,
  mapProjectWorkspace,
  mapRecorderSession,
  mapRun,
  mapScript,
  mapTestCase,
  type AgentSessionRow,
  type AgentStepRow,
  type GitAuthProfileRow,
  type LlmSessionRow,
  type ModuleRow,
  type ProjectRow,
  type ProjectWorkspaceRow,
  type RecorderSessionRow,
  type RunRow,
  type ScriptRow,
  type TestCaseRow,
} from "../mappers.js"
import { buildDefaultLlmState, normalizePersistedLlmState, now, parseJson, toPublicLlmState, type PersistedLlmState } from "../shared.js"

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]
const typedRow = <TRow>(row: Record<string, SQLOutputValue> | undefined): TRow | undefined => row as TRow | undefined

export const sharedLlmOwnerKey = "shared"

export interface LlmStateRow {
  owner_key: string
  configs_json: string
  llm_secrets_json: string | null
  active_config_id: string | null
  active_vision_config_id: string | null
  updated_at: string
}

const mergeSecrets = (state: PersistedLlmState, secretsJson: string | null): PersistedLlmState => {
  const secrets = JSON.parse(secretsJson || "{}") as Record<string, { apiKey?: string; copilot?: CopilotSecretState }>
  return {
    activeConfigId: state.activeConfigId,
    activeVisionConfigId: state.activeVisionConfigId,
    configs: state.configs.map((item) => ({
      session: item.session,
      secrets: secrets[item.session.id] ?? item.secrets ?? {},
    })),
  }
}

export const getLlmConfigStateForOwner = (db: DatabaseSync, ownerKey = sharedLlmOwnerKey): PersistedLlmState => {
  const row = typedRow<LlmStateRow>(db.prepare("SELECT * FROM llm_states WHERE owner_key = ?").get(ownerKey))
  if (row) {
    return mergeSecrets(
      normalizePersistedLlmState({
        activeConfigId: row.active_config_id ?? undefined,
        activeVisionConfigId: row.active_vision_config_id ?? undefined,
        configs: parseJson(row.configs_json, buildDefaultLlmState()).configs,
      }),
      row.llm_secrets_json,
    )
  }

  if (ownerKey !== sharedLlmOwnerKey) {
    return buildDefaultLlmState()
  }

  return getLlmConfigState(db)
}

export const saveLlmConfigStateForOwner = (db: DatabaseSync, state: PersistedLlmState, ownerKey = sharedLlmOwnerKey) => {
  const publicState = toPublicLlmState(state)
  const configsState: PersistedLlmState = {
    activeConfigId: state.activeConfigId,
    activeVisionConfigId: state.activeVisionConfigId,
    configs: state.configs.map((item) => ({
      session: item.session,
      secrets: {},
    })),
  }
  db.prepare(`
      INSERT OR REPLACE INTO llm_states (
        owner_key, configs_json, llm_secrets_json, active_config_id, active_vision_config_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      ownerKey,
      JSON.stringify(configsState),
      JSON.stringify(
        state.configs.reduce<Record<string, { apiKey?: string; copilot?: CopilotSecretState }>>((acc, item) => {
          acc[item.session.id] = item.secrets
          return acc
        }, {}),
      ),
      publicState.activeConfigId ?? null,
      publicState.activeVisionConfigId ?? null,
      now(),
    )
}



export const getLlmState = (db: DatabaseSync): { session: LlmSessionConfig; secrets: CopilotSecretState } => {
  const row = typedRow<LlmSessionRow>(db.prepare("SELECT * FROM llm_session WHERE singleton_id = 1").get())
  return mapLlmState(row)
}


export const getLlmConfigState = (db: DatabaseSync): PersistedLlmState => {
  const row = typedRow<LlmSessionRow>(db.prepare("SELECT * FROM llm_session WHERE singleton_id = 1").get())
  return mapPersistedLlmState(row)
}


export const saveLlmConfigState = (db: DatabaseSync, state: PersistedLlmState) => {
  const publicState = toPublicLlmState(state)
  const active = state.configs.find((item) => item.session.id === publicState.activeConfigId) ?? state.configs[0]
  const activeSession = publicState.session
  db.prepare(`
      INSERT OR REPLACE INTO llm_session (
        singleton_id, provider, proxy_endpoint, model, signed_in, connection_status, base_url, login_mode,
        last_synced_at, last_error, pending_device_auth, feature_flags, copilot_secrets, configs_json, llm_secrets_json, active_config_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      1,
      activeSession.provider,
      activeSession.proxyEndpoint,
      activeSession.model,
      activeSession.signedIn ? 1 : 0,
      activeSession.connectionStatus,
      activeSession.baseUrl,
      activeSession.loginMode,
      activeSession.lastSyncedAt ?? null,
      activeSession.lastError ?? null,
      activeSession.pendingDeviceAuth ? JSON.stringify(activeSession.pendingDeviceAuth) : null,
      JSON.stringify(activeSession.featureFlags),
      JSON.stringify(active?.secrets.copilot ?? {}),
      JSON.stringify(state),
      JSON.stringify(
        state.configs.reduce<Record<string, { apiKey?: string; copilot?: CopilotSecretState }>>((acc, item) => {
          acc[item.session.id] = item.secrets
          return acc
        }, {}),
      ),
      publicState.activeConfigId ?? null,
    )
}


export const saveLlmState = (db: DatabaseSync, session: LlmSessionConfig, secrets: CopilotSecretState) => {
  const state = getLlmConfigState(db)
  const target = state.configs.find((item) => item.session.id === session.id)
  if (target) {
    target.session = session
    target.secrets = {
      ...target.secrets,
      copilot: secrets,
    }
  }
  saveLlmConfigState(db, state)
}


