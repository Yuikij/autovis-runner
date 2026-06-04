import type { Identifier } from "./core"

export type WorkspaceSourceKind = "git" | "local_path" | "upload"
export type WorkspaceStatus = "missing" | "importing" | "ready" | "syncing" | "error"
export type GitAuthKind = "none" | "http_token" | "http_basic" | "ssh_key"

export interface ProjectWorkspace {
  projectId: Identifier
  sourceKind: WorkspaceSourceKind
  managedRoot: string
  gitRepoUrl: string
  localSourcePath: string
  branch: string
  ref: string
  lastCommitSha?: string
  gitAuthProfileId?: Identifier
  status: WorkspaceStatus
  lastSyncedAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceTreeEntry {
  path: string
  name: string
  kind: "file" | "directory"
  size?: number
  extension?: string
}

export interface WorkspaceSearchMatch {
  path: string
  lineNumber: number
  line: string
  preview: string
}

export interface WorkspaceFileContent {
  path: string
  content: string
  truncated: boolean
  offset: number
  totalLines: number
}

export interface GitAuthProfile {
  id: Identifier
  name: string
  kind: GitAuthKind
  hostPattern: string
  username?: string
  secret?: string
  createdAt: string
  updatedAt: string
}