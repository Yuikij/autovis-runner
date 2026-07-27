import type { ReadyWorkspaceController } from "../../useWorkspaceController.js"
import type { ExecutionRun } from "@browsewright/shared"

export type CasesSectionProps = {
  controller: ReadyWorkspaceController
}

export type CaseDetailsProps = CasesSectionProps & {
  isEditing: boolean
  setIsEditing: (v: boolean) => void
  activeTab: "info" | "script" | "history" | "api"
  setActiveTab: (v: "info" | "script" | "history" | "api") => void
  copied: boolean
  setCopied: (v: boolean) => void
  quickRunTargetUrlId: string
  setQuickRunTargetUrlId: (v: string) => void
  quickRunHumanInput: string
  setQuickRunHumanInput: (v: string) => void
  temporaryRun: ExecutionRun | null
  temporaryReplayVideo: string | undefined
  caseRuns: ExecutionRun[]
  handleDeleteCase: (id: string) => void
}
