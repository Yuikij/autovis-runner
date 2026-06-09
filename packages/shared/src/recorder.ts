import type { Identifier } from "./core"
import type { RunArtifact } from "./run"

export type RecorderSessionStatus =
  | "starting"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "stopping"
  | "completed"
  | "error"
export type RecorderActionType =
  | "navigate"
  | "click"
  | "dblclick"
  | "input"
  | "keydown"
  | "scroll"
  | "pointerdown"
  | "pointermove"
  | "pointerup"
export type RecorderInteractionType = RecorderActionType

export interface RecorderAction {
  id: Identifier
  type: RecorderActionType
  timestamp: string
  url: string
  title?: string
  selector?: string
  role?: string
  label?: string
  text?: string
  placeholder?: string
  value?: string
  key?: string
  deltaY?: number
  x?: number
  y?: number
  screenshotUrl?: string
  detail?: string
}

export interface RecorderSession {
  id: Identifier
  projectId: Identifier
  testCaseId: Identifier
  status: RecorderSessionStatus
  targetUrlId?: Identifier
  testBaseUrl: string
  currentViewport: string
  currentUrl?: string
  pageTitle?: string
  actions: RecorderAction[]
  artifacts: RunArtifact[]
  generatedScriptId?: Identifier
  startedAt: string
  finishedAt?: string
  error?: string
}
