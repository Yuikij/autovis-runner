import type { ReadyWorkspaceController } from "../../useWorkspaceController"

export type ProjectsSectionProps = {
  controller: ReadyWorkspaceController
}

export type EditTab = "basic" | "modules"

export type ProjectEditModalProps = ProjectsSectionProps & {
  isEditing: boolean
  setIsEditing: (v: boolean) => void
  editTab: EditTab
  setEditTab: (v: EditTab) => void
  newModuleName: string
  setNewModuleName: (v: string) => void
  newModuleDesc: string
  setNewModuleDesc: (v: string) => void
  authForm: { name: string; kind: string; hostPattern: string; username: string; secret: string }
  setAuthForm: (v: any) => void
}

export type ProjectsGridProps = ProjectsSectionProps & {
  setIsEditing: (v: boolean) => void
  setEditTab: (v: EditTab) => void
  confirmDeleteId: string | null
  setConfirmDeleteId: (v: string | null) => void
}
