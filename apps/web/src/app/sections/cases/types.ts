import type { ReadyWorkspaceController } from "../../useWorkspaceController"
import type { ExecutionRun } from "@autovis/shared"

export type CasesSectionProps = {
  controller: ReadyWorkspaceController
}

export type CaseDetailsProps = CasesSectionProps & {
  isEditing: boolean
  setIsEditing: (v: boolean) => void
  activeTab: "info" | "script" | "history"
  setActiveTab: (v: "info" | "script" | "history") => void
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
