import type { WorkspaceActionParams } from "./hooks/types"
import { useProjectActions } from "./hooks/actions/useProjectActions"
import { useTestActions } from "./hooks/actions/useTestActions"
import { useTaskActions } from "./hooks/actions/useTaskActions"
import { useLlmActions } from "./hooks/actions/useLlmActions"
import { useWorkspaceSyncActions } from "./hooks/actions/useWorkspaceSyncActions"
import { useRecorderActions } from "./hooks/actions/useRecorderActions"

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
