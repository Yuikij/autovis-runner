import type { CopilotSecretState } from "../copilot.js"

export interface LlmSecretState {
  apiKey?: string
  copilot?: CopilotSecretState
}
