import { t } from "../i18n/index.js"

export type WorkspaceSection = "dashboard" | "projects" | "cases" | "tasks" | "targetUrls" | "dataTables" | "knowledge" | "authProfiles" | "workbench" | "runs" | "outbox" | "llmConnections"

const runtimeApiBase = typeof window === "undefined"
  ? undefined
  : (window as Window & { __AUTOVIS_API_BASE__?: string }).__AUTOVIS_API_BASE__

export const apiBase = runtimeApiBase ?? import.meta.env.VITE_API_BASE_URL ?? ""
export const appName = "AutoVis"
export const appVersion = "v1.0.0-alpha"
export const defaultCopilotModel = "gpt-4o"
export const defaultScriptPrompt = ""
export const defaultRecorderUrl = ""

export const navItems: Array<{ id: WorkspaceSection; label: string; icon: string }> = [
  { id: "dashboard", label: t("nav.dashboard"), icon: "dashboard" },
  { id: "llmConnections", label: t("nav.llmConnections"), icon: "smart_toy" },
  { id: "projects", label: t("nav.projects"), icon: "folder" },
  { id: "cases", label: t("nav.cases"), icon: "assignment" },
  { id: "tasks", label: t("nav.tasks"), icon: "checklist" },
  { id: "targetUrls", label: t("nav.targetUrls"), icon: "language" },
  { id: "dataTables", label: t("nav.dataTables"), icon: "table" },
  { id: "knowledge", label: t("nav.knowledge"), icon: "auto_stories" },
  { id: "authProfiles", label: t("nav.authProfiles"), icon: "key" },
  { id: "workbench", label: t("nav.workbench"), icon: "terminal" },
  { id: "runs", label: t("nav.runs"), icon: "play_circle" },
  { id: "outbox", label: t("nav.outbox"), icon: "inbox" },
]
