import type { DashboardData, Project } from "@autovis/shared"
import type { CopilotSecretState } from "../copilot.js"
import type { PersistedLlmState } from "./shared.js"

export interface PersistedState extends DashboardData {
  llmSecrets?: {
    copilot?: CopilotSecretState
  }
  llmState?: PersistedLlmState
  releases?: unknown[]
}

export type LegacyProjectState = Project & {
  summary: Project["summary"] & {
    releaseCount?: number
  }
  gitRepoUrl?: string
  localRepoPath?: string
}
