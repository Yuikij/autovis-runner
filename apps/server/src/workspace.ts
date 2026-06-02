import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import type { Dirent } from "node:fs"
import { promises as fs } from "node:fs"
import { basename, extname, join, relative, resolve, sep } from "node:path"

import type {
  GitAuthProfile,
  ProjectWorkspace,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceTreeEntry,
} from "@autovis/shared"

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".nuxt", "out", "target", "vendor", "tmp", "coverage"])
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".js", ".jsx", ".ts", ".tsx", ".vue", ".json", ".md", ".css", ".scss", ".sass", ".less", ".yml", ".yaml", ".xml", ".txt", ".mjs", ".cjs"])
const MAX_READ_BYTES = 200_000
const DEFAULT_READ_LINES = 200
const DEFAULT_SEARCH_LIMIT = 20
const MAX_TREE_ENTRIES = 500

export class WorkspaceService {
  constructor(private readonly dataDir: string) {}

  getManagedRoot(projectId: string) {
    return join(this.dataDir, "workspaces", projectId)
  }

  getSourceRoot(projectId: string) {
    return join(this.getManagedRoot(projectId), "source")
  }

  async removeWorkspace(projectId: string) {
    await fs.rm(this.getManagedRoot(projectId), { recursive: true, force: true })
  }

  async importLocalDirectory(projectId: string, localPath: string) {
    const resolvedSource = resolve(localPath)
    const stat = await fs.stat(resolvedSource).catch(() => undefined)
    if (!stat?.isDirectory()) {
      throw new Error(`本地文件夹路径不存在或不是一个目录: ${localPath}`)
    }

    const sourceRoot = this.getSourceRoot(projectId)
    await this.resetSourceRoot(projectId)
    await this.copyDirectory(resolvedSource, sourceRoot)
    return this.summarizeWorkspace(projectId)
  }

  async importUploadedDirectory(projectId: string, uploadedDir: string) {
    const sourceRoot = this.getSourceRoot(projectId)
    await this.resetSourceRoot(projectId)
    await this.copyDirectory(uploadedDir, sourceRoot)
    return this.summarizeWorkspace(projectId)
  }

  async syncGitWorkspace(projectId: string, workspace: ProjectWorkspace, authProfile?: GitAuthProfile) {
    if (!workspace.gitRepoUrl.trim()) {
      throw new Error("Git 仓库地址未配置")
    }

    const sourceRoot = this.getSourceRoot(projectId)
    await fs.mkdir(this.getManagedRoot(projectId), { recursive: true })
    const { repoUrl, env } = await this.buildGitAccess(workspace, authProfile)
    const gitDir = join(sourceRoot, ".git")

    if (existsSync(gitDir)) {
      this.runGit(["-C", sourceRoot, "remote", "set-url", "origin", repoUrl], env)
    } else {
      await fs.rm(sourceRoot, { recursive: true, force: true })
      await fs.mkdir(this.getManagedRoot(projectId), { recursive: true })
      this.runGit(["clone", "--depth", "1", repoUrl, sourceRoot], env)
    }

    const requestedRef = workspace.ref.trim() || workspace.branch.trim()
    if (requestedRef) {
      this.runGit(["-C", sourceRoot, "fetch", "--depth", "1", "origin", requestedRef], env)
      this.runGit(["-C", sourceRoot, "switch", "--detach", "FETCH_HEAD"], env)
    } else if (existsSync(gitDir)) {
      const defaultBranch = this.resolveDefaultRemoteBranch(sourceRoot, env)
      if (defaultBranch) {
        this.runGit(["-C", sourceRoot, "fetch", "--depth", "1", "origin", defaultBranch], env)
        this.runGit(["-C", sourceRoot, "switch", "--detach", "FETCH_HEAD"], env)
      } else {
        this.runGit(["-C", sourceRoot, "fetch", "--depth", "1", "origin"], env)
      }
    }

    const commit = this.runGit(["-C", sourceRoot, "rev-parse", "HEAD"], env).trim()
    const summary = await this.summarizeWorkspace(projectId)
    return { ...summary, commit }
  }

  async listTree(projectId: string, relativePath = "") {
    const targetDir = await this.resolveWorkspacePath(projectId, relativePath)
    const stat = await fs.stat(targetDir).catch(() => undefined)
    if (!stat?.isDirectory()) {
      if (!relativePath.trim()) {
        return []
      }
      throw new Error(`目录不存在: ${relativePath || "/"}`)
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true })
    const items: WorkspaceTreeEntry[] = []

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (entry.name === ".git") continue
      }
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      if (entry.isSymbolicLink()) continue
      const absPath = join(targetDir, entry.name)
      const stat = await fs.stat(absPath).catch(() => undefined)
      const relPath = this.normalizeRelative(projectId, absPath)
      items.push({
        path: relPath,
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
        size: stat?.isFile() ? stat.size : undefined,
        extension: entry.isFile() ? extname(entry.name).replace(/^\./, "") || undefined : undefined,
      })
    }

    return items
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1))
      .slice(0, MAX_TREE_ENTRIES)
  }

  async globPaths(projectId: string, pattern: string) {
    const normalizedPattern = pattern.trim().replace(/\\/g, "/")
    if (!normalizedPattern) return []
    if (!await this.hasWorkspace(projectId)) return []
    const matcher = globToRegExp(normalizedPattern)
    const files = await this.collectPaths(projectId)
    return files.filter((path) => matcher.test(path))
  }

  async searchCode(projectId: string, query: string, path = "", limit = DEFAULT_SEARCH_LIMIT) {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    if (!await this.hasWorkspace(projectId)) return []

    const sourceRoot = this.getSourceRoot(projectId)
    const baseDir = path ? await this.resolveWorkspacePath(projectId, path) : sourceRoot
    const matches: WorkspaceSearchMatch[] = []
    await this.walk(baseDir, async (absolutePath) => {
      if (matches.length >= limit) return false
      const content = await this.readTextFile(absolutePath).catch(() => undefined)
      if (content == null) return
      const lines = content.split(/\r?\n/)
      lines.forEach((line, index) => {
        if (matches.length >= limit) return
        if (!line.toLowerCase().includes(needle)) return
        matches.push({
          path: this.normalizeRelative(projectId, absolutePath),
          lineNumber: index + 1,
          line,
          preview: line.trim().slice(0, 200),
        })
      })
    })
    return matches
  }

  async readWorkspaceFile(projectId: string, relativePath: string, offset = 0, limit = DEFAULT_READ_LINES): Promise<WorkspaceFileContent> {
    const absolutePath = await this.resolveWorkspacePath(projectId, relativePath)
    const content = await this.readTextFile(absolutePath)
    const lines = content.split(/\r?\n/)
    const safeOffset = Math.max(0, offset)
    const safeLimit = Math.max(1, limit)
    const slice = lines.slice(safeOffset, safeOffset + safeLimit)
    return {
      path: this.normalizeRelative(projectId, absolutePath),
      content: slice.join("\n"),
      truncated: safeOffset + safeLimit < lines.length,
      offset: safeOffset,
      totalLines: lines.length,
    }
  }

  async summarizeWorkspace(projectId: string) {
    let totalFiles = 0
    await this.walk(this.getSourceRoot(projectId), async () => {
      totalFiles += 1
    })
    return {
      managedRoot: this.getManagedRoot(projectId),
      totalFiles,
    }
  }

  async hasWorkspace(projectId: string) {
    const stat = await fs.stat(this.getSourceRoot(projectId)).catch(() => undefined)
    return Boolean(stat?.isDirectory())
  }

  private async resetSourceRoot(projectId: string) {
    const managedRoot = this.getManagedRoot(projectId)
    await fs.mkdir(managedRoot, { recursive: true })
    await fs.rm(this.getSourceRoot(projectId), { recursive: true, force: true })
    await fs.mkdir(this.getSourceRoot(projectId), { recursive: true })
  }

  private async copyDirectory(sourceDir: string, targetDir: string) {
    await fs.mkdir(targetDir, { recursive: true })
    const entries = await fs.readdir(sourceDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      if (entry.isSymbolicLink()) continue
      const sourcePath = join(sourceDir, entry.name)
      const targetPath = join(targetDir, entry.name)
      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath)
      } else if (entry.isFile()) {
        await fs.mkdir(resolve(targetPath, ".."), { recursive: true })
        await fs.copyFile(sourcePath, targetPath)
      }
    }
  }

  private async resolveWorkspacePath(projectId: string, relativePath: string) {
    const sourceRoot = this.getSourceRoot(projectId)
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
    const absolutePath = resolve(sourceRoot, normalized)
    const relativeToRoot = relative(sourceRoot, absolutePath)
    if (relativeToRoot.startsWith("..") || relativeToRoot.includes(`..${sep}`)) {
      throw new Error(`非法路径: ${relativePath}`)
    }
    return absolutePath
  }

  private normalizeRelative(projectId: string, absolutePath: string) {
    const sourceRoot = this.getSourceRoot(projectId)
    return relative(sourceRoot, absolutePath).replace(/\\/g, "/")
  }

  private async collectPaths(projectId: string) {
    const paths: string[] = []
    await this.walk(this.getSourceRoot(projectId), async (absolutePath) => {
      paths.push(this.normalizeRelative(projectId, absolutePath))
    })
    return paths
  }

  private async walk(startDir: string, onFile: (absolutePath: string) => Promise<void | boolean>) {
    const stat = await fs.stat(startDir).catch(() => undefined)
    if (!stat?.isDirectory()) return
    const stack = [startDir]
    while (stack.length > 0) {
      const current = stack.pop()!
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue
          stack.push(join(current, entry.name))
          continue
        }
        if (!entry.isFile() || entry.isSymbolicLink()) continue
        if (!isTextPath(entry.name)) continue
        const shouldStop = await onFile(join(current, entry.name))
        if (shouldStop === false) return
      }
    }
  }

  private async readTextFile(absolutePath: string) {
    if (!isTextPath(absolutePath)) {
      throw new Error(`暂不支持读取该文件类型: ${basename(absolutePath)}`)
    }
    const stat = await fs.stat(absolutePath)
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`文件过大，无法读取: ${this.formatSize(stat.size)}`)
    }
    return fs.readFile(absolutePath, "utf-8")
  }

  private formatSize(size: number) {
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)}MB`
    if (size >= 1024) return `${Math.round(size / 1024)}KB`
    return `${size}B`
  }

  private resolveDefaultRemoteBranch(sourceRoot: string, env: NodeJS.ProcessEnv = process.env) {
    try {
      const headRef = this.runGit(["-C", sourceRoot, "symbolic-ref", "refs/remotes/origin/HEAD"], env).trim()
      return headRef.replace("refs/remotes/origin/", "")
    } catch {
      try {
        const branch = this.runGit(["-C", sourceRoot, "remote", "show", "origin"], env)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.startsWith("HEAD branch:"))
        return branch?.replace("HEAD branch:", "").trim() || undefined
      } catch {
        return undefined
      }
    }
  }

  private async buildGitAccess(workspace: ProjectWorkspace, authProfile?: GitAuthProfile) {
    if (!authProfile || authProfile.kind === "none") {
      return { repoUrl: workspace.gitRepoUrl, env: process.env }
    }

    if (authProfile.kind === "ssh_key") {
      const keyPath = join(this.getManagedRoot(workspace.projectId), ".auth", "id_key")
      await fs.mkdir(join(this.getManagedRoot(workspace.projectId), ".auth"), { recursive: true })
      await fs.writeFile(keyPath, authProfile.secret ?? "", "utf-8")
      return {
        repoUrl: workspace.gitRepoUrl,
        env: {
          ...process.env,
          GIT_SSH_COMMAND: `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new`,
        },
      }
    }

    const url = new URL(workspace.gitRepoUrl)
    if (authProfile.kind === "http_token") {
      url.username = authProfile.username || "oauth2"
      url.password = authProfile.secret || ""
    }
    if (authProfile.kind === "http_basic") {
      url.username = authProfile.username || ""
      url.password = authProfile.secret || ""
    }
    return { repoUrl: url.toString(), env: process.env }
  }

  private runGit(args: string[], env: NodeJS.ProcessEnv = process.env) {
    try {
      return execFileSync("git", args, {
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: string }).stderr || "") : ""
      throw new Error(stderr.trim() || (error as Error).message)
    }
  }
}

const isTextPath = (filePath: string) => TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())

const escapeRegex = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")

const globToRegExp = (pattern: string) => {
  const normalized = pattern.replace(/\\/g, "/")
  let regex = "^"
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]
    if (char === "*" && next === "*") {
      regex += ".*"
      index += 1
      continue
    }
    if (char === "*") {
      regex += "[^/]*"
      continue
    }
    if (char === "?") {
      regex += "."
      continue
    }
    regex += escapeRegex(char)
  }
  regex += "$"
  return new RegExp(regex, "i")
}
