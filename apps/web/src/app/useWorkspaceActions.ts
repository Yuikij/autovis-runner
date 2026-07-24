import type { WorkspaceActionParams } from "./hooks/types.js"
import { useProjectActions } from "./hooks/actions/useProjectActions.js"
import { useTestActions } from "./hooks/actions/useTestActions.js"
import { useTaskActions } from "./hooks/actions/useTaskActions.js"
import { useLlmActions } from "./hooks/actions/useLlmActions.js"
import { useWorkspaceSyncActions } from "./hooks/actions/useWorkspaceSyncActions.js"
import { useRecorderActions } from "./hooks/actions/useRecorderActions.js"

export function useWorkspaceActions(params: WorkspaceActionParams) {
  const projectActions = useProjectActions(params)
  const testActions = useTestActions(params, projectActions.refreshWorkspace)
  const taskActions = useTaskActions(params)
  const llmActions = useLlmActions(params)
  const syncActions = useWorkspaceSyncActions(params)
  const recorderActions = useRecorderActions(params)

  return {
    ...projectActions,
    ...testActions,
    ...taskActions,
    ...llmActions,
    ...syncActions,
    ...recorderActions,
  }
}
