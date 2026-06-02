import { navItems, type WorkspaceSection } from "./constants"

export type HashKey =
  | "projectId"
  | "taskId"
  | "caseId"
  | "agentSessionId"
  | "runId"
  | "taskRunId"
  | "recorderSessionId"

export interface ParsedHash {
  section: WorkspaceSection
  projectId: string | null
  taskId: string | null
  caseId: string | null
  agentSessionId: string | null
  runId: string | null
  taskRunId: string | null
  recorderSessionId: string | null
}

export interface HashState {
  section: WorkspaceSection
  projectId?: string | null
  taskId?: string | null
  caseId?: string | null
  agentSessionId?: string | null
  runId?: string | null
  taskRunId?: string | null
  recorderSessionId?: string | null
}

/**
 * 每个 section 在 URL hash 中"持有"的查询参数白名单。
 * 不在列表里的 key 既不会被写入 URL，也不会在 hashchange 时回写到 React state，
 * 以避免诸如 "在首页 (dashboard) 仍然挂着 projectId=..." 这种语义错位。
 */
export const sectionUrlPolicy: Record<WorkspaceSection, ReadonlyArray<HashKey>> = {
  dashboard: [],
  projects: [],
  cases: ["projectId", "caseId"],
  tasks: ["projectId", "taskId"],
  targetUrls: ["projectId"],
  authProfiles: ["projectId"],
  workbench: ["projectId", "caseId", "agentSessionId", "runId"],
  runs: ["projectId", "runId", "taskRunId", "recorderSessionId"],
}

export const sectionAllows = (section: WorkspaceSection, key: HashKey) =>
  sectionUrlPolicy[section].includes(key)

const DEFAULT_SECTION: WorkspaceSection = "dashboard"
const VALID_SECTIONS = new Set<WorkspaceSection>(navItems.map((item) => item.id))

const emptyHash = (): ParsedHash => ({
  section: DEFAULT_SECTION,
  projectId: null,
  taskId: null,
  caseId: null,
  agentSessionId: null,
  runId: null,
  taskRunId: null,
  recorderSessionId: null,
})

const isSection = (value: string): value is WorkspaceSection =>
  VALID_SECTIONS.has(value as WorkspaceSection)

export function parseHash(rawHash?: string): ParsedHash {
  if (typeof window === "undefined" && rawHash === undefined) {
    return emptyHash()
  }

  const source = rawHash ?? (typeof window !== "undefined" ? window.location.hash : "")
  const hash = source.startsWith("#/")
    ? source.slice(2)
    : source.startsWith("#")
    ? source.slice(1)
    : ""

  const [path, queryStr] = hash.split("?")
  const params = new URLSearchParams(queryStr ?? "")
  const section = isSection(path) ? path : DEFAULT_SECTION

  return {
    section,
    projectId: params.get("projectId") || null,
    taskId: params.get("taskId") || null,
    caseId: params.get("caseId") || null,
    agentSessionId: params.get("agentSessionId") || null,
    runId: params.get("runId") || null,
    taskRunId: params.get("taskRunId") || null,
    recorderSessionId: params.get("recorderSessionId") || null,
  }
}

export function buildHash(state: HashState): string {
  const params = new URLSearchParams()
  const allowed = sectionUrlPolicy[state.section]
  const entries: ReadonlyArray<[key: HashKey, value: string | null | undefined]> = [
    ["projectId", state.projectId],
    ["taskId", state.taskId],
    ["caseId", state.caseId],
    ["agentSessionId", state.agentSessionId],
    ["runId", state.runId],
    ["taskRunId", state.taskRunId],
    ["recorderSessionId", state.recorderSessionId],
  ]

  for (const [key, value] of entries) {
    if (!allowed.includes(key)) continue
    if (value) params.set(key, value)
  }

  const queryStr = params.toString()
  return `#/${state.section}${queryStr ? `?${queryStr}` : ""}`
}

export function writeHash(state: HashState): void {
  if (typeof window === "undefined") return
  const next = buildHash(state)
  if (window.location.hash !== next) {
    window.location.hash = next
  }
}
