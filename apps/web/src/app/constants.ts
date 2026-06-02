export type WorkspaceSection = "dashboard" | "projects" | "cases" | "tasks" | "targetUrls" | "authProfiles" | "workbench" | "runs"

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
  { id: "dashboard", label: "仪表盘", icon: "dashboard" },
  { id: "projects", label: "项目", icon: "folder" },
  { id: "cases", label: "测试用例", icon: "assignment" },
  { id: "tasks", label: "任务", icon: "checklist" },
  { id: "targetUrls", label: "目标网址", icon: "language" },
  { id: "authProfiles", label: "登录状态", icon: "key" },
  { id: "workbench", label: "AI 工作台", icon: "smart_toy" },
  { id: "runs", label: "执行记录", icon: "play_circle" },
]
