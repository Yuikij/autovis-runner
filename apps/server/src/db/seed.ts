import { buildDefaultSession } from "./shared.js"
import type { PersistedState } from "./types.js"

export const createSeedState = (_appOrigin: string): PersistedState => ({
  projects: [],
  modules: [],
  releases: [],
  tasks: [],
  testCases: [],
  scripts: [],
  runs: [],
  taskRuns: [],
  recorderSessions: [],
  authProfiles: [],
  llmSession: buildDefaultSession(),
  llmSecrets: {
    copilot: {},
  },
})
