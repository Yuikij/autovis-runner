import { createWriteStream, existsSync } from "node:fs"
import { promises as fs } from "node:fs"
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import type { KnowledgeEntry, KnowledgeFileContent, KnowledgeScriptApi, KnowledgeSearchHit, KnowledgeSearchResult, KnowledgeStats } from "@autovis/shared"

import { dataDir } from "./services/common.js"

const MAX_TEXT_READ_BYTES = 2_000_000
const MAX_ASSET_BYTES = 100 * 1024 * 1024
const MAX_TREE_NODES = 3000
// 文件系统单个路径段上限约 255 字节（APFS/ext4）；留余量取 200。
// 脚本/LLM 常拿文章标题甚至整段正文当文件名，超长必炸 ENAMETOOLONG——
// 这是文件系统的物理约束，由服务层统一兜底，不外包给调用方自觉截断。
const MAX_PATH_SEGMENT_BYTES = 200

/** 按 UTF-8 字节数截断字符串，不切断多字节字符。 */
const truncateUtf8Bytes = (text: string, maxBytes: number) => {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  let out = ""
  let used = 0
  for (const ch of text) {
    const bytes = Buffer.byteLength(ch, "utf-8")
    if (used + bytes > maxBytes) break
    out += ch
    used += bytes
  }
  return out
}

/**
 * 剥掉控制字符与不可见格式字符（Cc/Cf：零宽连接符、方向控制符、BOM 等）。
 * 网页标题（尤其飞书文档）常混入这类字符，落到文件名里肉眼不可见但路径难以复现。
 */
const stripInvisibleChars = (segment: string) =>
  segment.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim()

/** 路径段清洗：去不可见字符 + 超长截断（保留扩展名）。确定性变换：读写两侧走同一规则，路径始终一致。 */
const truncatePathSegment = (rawSegment: string) => {
  const segment = rawSegment === "." || rawSegment === ".." ? rawSegment : stripInvisibleChars(rawSegment)
  if (Buffer.byteLength(segment, "utf-8") <= MAX_PATH_SEGMENT_BYTES) return segment
  const dotIndex = segment.lastIndexOf(".")
  const ext = dotIndex > 0 && segment.length - dotIndex <= 10 ? segment.slice(dotIndex) : ""
  const stem = ext ? segment.slice(0, dotIndex) : segment
  const stemBudget = MAX_PATH_SEGMENT_BYTES - Buffer.byteLength(ext, "utf-8")
  return `${truncateUtf8Bytes(stem, stemBudget).trimEnd()}${ext}`
}

/** 可在前端以文本形式读取/编辑的扩展名（其余走 raw 二进制下载）。 */
const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "json", "yaml", "yml", "csv", "html", "htm", "xml", "js", "ts", "css"])

export const isKnowledgeTextPath = (path: string) =>
  TEXT_EXTENSIONS.has(extname(path).replace(/^\./, "").toLowerCase())

/**
 * 项目级知识库服务：管理 `DATA_DIR/knowledge/<projectId>/` 下的多层级 Markdown + 资产。
 * 与 WorkspaceService（导入的只读代码工作区）不同，知识库是**平台自己的可写内容空间**，
 * 跟项目走：前端浏览渲染、LLM agent 工具与脚本运行时 `knowledge.*` 都读写同一棵树。
 */
export class KnowledgeService {
  constructor(private readonly baseDir: string) {}

  getProjectRoot(projectId: string) {
    return join(this.baseDir, "knowledge", projectId)
  }

  /**
   * 把外部传入的相对路径解析为根内绝对路径；越界（.. / 绝对路径逃逸）直接抛错。
   * 超长路径段按 UTF-8 字节截断（文件系统上限约 255 字节/段）——确定性变换且
   * 读写共用本方法，写入后用同一原始路径 read/exists 仍能命中；合法名（超长段
   * 本就无法落盘）不受影响。
   */
  resolveSafePath(projectId: string, relativePath: string) {
    const root = resolve(this.getProjectRoot(projectId))
    const normalized = (relativePath ?? "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .split("/")
      .map(truncatePathSegment)
      .join("/")
    const absolutePath = resolve(root, normalized)
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
      throw new Error(`非法知识库路径: ${relativePath}`)
    }
    return absolutePath
  }

  private toRelative(projectId: string, absolutePath: string) {
    return relative(resolve(this.getProjectRoot(projectId)), absolutePath).replace(/\\/g, "/")
  }

  async ensureRoot(projectId: string) {
    await fs.mkdir(this.getProjectRoot(projectId), { recursive: true })
  }

  async removeProject(projectId: string) {
    await fs.rm(this.getProjectRoot(projectId), { recursive: true, force: true })
  }

  /** 递归目录树（含节点总量上限，防止超大知识库拖垮接口）。 */
  async listTree(projectId: string): Promise<{ entries: KnowledgeEntry[]; stats: KnowledgeStats; truncated: boolean }> {
    const root = this.getProjectRoot(projectId)
    const stats: KnowledgeStats = { totalFiles: 0, totalDirectories: 0, totalBytes: 0 }
    let nodeCount = 0
    let truncated = false

    const walk = async (dir: string): Promise<KnowledgeEntry[]> => {
      const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      const entries: KnowledgeEntry[] = []
      for (const dirent of dirents) {
        if (dirent.name.startsWith(".")) continue
        if (dirent.isSymbolicLink()) continue
        if (nodeCount >= MAX_TREE_NODES) {
          truncated = true
          break
        }
        nodeCount += 1
        const absPath = join(dir, dirent.name)
        const stat = await fs.stat(absPath).catch(() => undefined)
        if (!stat) continue
        if (dirent.isDirectory()) {
          stats.totalDirectories += 1
          entries.push({
            path: this.toRelative(projectId, absPath),
            name: dirent.name,
            kind: "directory",
            updatedAt: stat.mtime.toISOString(),
            children: await walk(absPath),
          })
        } else if (dirent.isFile()) {
          stats.totalFiles += 1
          stats.totalBytes += stat.size
          entries.push({
            path: this.toRelative(projectId, absPath),
            name: dirent.name,
            kind: "file",
            size: stat.size,
            extension: extname(dirent.name).replace(/^\./, "").toLowerCase() || undefined,
            updatedAt: stat.mtime.toISOString(),
          })
        }
      }
      return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "zh-CN") : a.kind === "directory" ? -1 : 1))
    }

    const entries = existsSync(root) ? await walk(root) : []
    return { entries, stats, truncated }
  }

  /** 列出某目录的直接子节点（脚本运行时 knowledge.list 用；不递归）。 */
  async listDirectory(projectId: string, relativePath = ""): Promise<KnowledgeEntry[]> {
    const dir = this.resolveSafePath(projectId, relativePath)
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const entries: KnowledgeEntry[] = []
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".") || dirent.isSymbolicLink()) continue
      const absPath = join(dir, dirent.name)
      const stat = await fs.stat(absPath).catch(() => undefined)
      if (!stat) continue
      entries.push({
        path: this.toRelative(projectId, absPath),
        name: dirent.name,
        kind: dirent.isDirectory() ? "directory" : "file",
        size: dirent.isFile() ? stat.size : undefined,
        extension: dirent.isFile() ? extname(dirent.name).replace(/^\./, "").toLowerCase() || undefined : undefined,
        updatedAt: stat.mtime.toISOString(),
      })
    }
    return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "zh-CN") : a.kind === "directory" ? -1 : 1))
  }

  /**
   * 全文关键字搜索：递归扫描项目知识库里的文本文件，大小写不敏感。
   * 多个空格分隔的词按 AND 语义（都出现才算命中）；片段取第一个词的上下文。
   * 同步读全部文件对本地单机知识库（几百个 md）足够快，无需建索引。
   */
  async search(projectId: string, rawQuery: string): Promise<KnowledgeSearchResult> {
    const MAX_HITS = 30
    const MAX_SNIPPETS_PER_FILE = 3
    const SNIPPET_RADIUS = 40

    const query = rawQuery.trim()
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return { query, hits: [], scannedFiles: 0, truncated: false }

    const root = this.getProjectRoot(projectId)
    const files: string[] = []
    const walk = async (dir: string) => {
      const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const dirent of dirents) {
        if (dirent.name.startsWith(".") || dirent.isSymbolicLink()) continue
        const absPath = join(dir, dirent.name)
        if (dirent.isDirectory()) await walk(absPath)
        else if (dirent.isFile() && isKnowledgeTextPath(absPath)) files.push(absPath)
      }
    }
    if (existsSync(root)) await walk(root)

    const hits: KnowledgeSearchHit[] = []
    let scannedFiles = 0
    for (const absPath of files) {
      const stat = await fs.stat(absPath).catch(() => undefined)
      if (!stat || stat.size > MAX_TEXT_READ_BYTES) continue
      scannedFiles += 1
      const content = await fs.readFile(absPath, "utf-8").catch(() => "")
      const name = basename(absPath)
      const contentLower = content.toLowerCase()
      const nameLower = name.toLowerCase()

      // AND 语义：每个词都要出现在文件名或正文中
      if (!terms.every((t) => nameLower.includes(t) || contentLower.includes(t))) continue

      const primary = terms[0]
      const titleHit = terms.some((t) => nameLower.includes(t))
      let matchCount = 0
      const snippets: string[] = []
      let from = 0
      while (true) {
        const idx = contentLower.indexOf(primary, from)
        if (idx === -1) break
        matchCount += 1
        if (snippets.length < MAX_SNIPPETS_PER_FILE) {
          const start = Math.max(0, idx - SNIPPET_RADIUS)
          const end = Math.min(content.length, idx + primary.length + SNIPPET_RADIUS)
          const snippet = content
            .slice(start, end)
            .replace(/\s+/g, " ")
            .trim()
          snippets.push(`${start > 0 ? "…" : ""}${snippet}${end < content.length ? "…" : ""}`)
        }
        from = idx + primary.length
      }

      hits.push({
        path: this.toRelative(projectId, absPath),
        name,
        titleHit,
        matchCount,
        snippets,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      })
    }

    // 标题命中优先，其次正文命中次数
    hits.sort((a, b) => (a.titleHit === b.titleHit ? b.matchCount - a.matchCount : a.titleHit ? -1 : 1))
    const truncated = hits.length > MAX_HITS
    return { query, hits: hits.slice(0, MAX_HITS), scannedFiles, truncated }
  }

  async readFile(projectId: string, relativePath: string): Promise<KnowledgeFileContent> {
    const absPath = this.resolveSafePath(projectId, relativePath)
    const stat = await fs.stat(absPath).catch(() => undefined)
    if (!stat?.isFile()) {
      throw new Error(`文件不存在: ${relativePath}`)
    }
    if (!isKnowledgeTextPath(absPath)) {
      throw new Error(`该文件不是文本类型，请通过 raw 接口访问: ${basename(absPath)}`)
    }
    if (stat.size > MAX_TEXT_READ_BYTES) {
      throw new Error(`文件过大（${Math.round(stat.size / 1024)}KB），暂不支持在线读取`)
    }
    const content = await fs.readFile(absPath, "utf-8")
    return {
      path: this.toRelative(projectId, absPath),
      content,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    }
  }

  async writeFile(projectId: string, relativePath: string, content: string) {
    const absPath = this.resolveSafePath(projectId, relativePath)
    if (!relativePath?.trim() || absPath === resolve(this.getProjectRoot(projectId))) {
      throw new Error("写入路径不能为空")
    }
    await fs.mkdir(dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, content, "utf-8")
    return this.toRelative(projectId, absPath)
  }

  async createDirectory(projectId: string, relativePath: string) {
    const absPath = this.resolveSafePath(projectId, relativePath)
    await fs.mkdir(absPath, { recursive: true })
    return this.toRelative(projectId, absPath)
  }

  /** 移动文件或目录到目标目录；保留原文件名/目录名，不覆盖已有内容。 */
  async moveEntry(projectId: string, sourcePath: string, targetDirPath = "") {
    const root = resolve(this.getProjectRoot(projectId))
    const sourceAbs = this.resolveSafePath(projectId, sourcePath)
    const targetDirAbs = this.resolveSafePath(projectId, targetDirPath)

    if (!sourcePath?.trim() || sourceAbs === root) {
      throw new Error("不允许移动知识库根目录")
    }

    const sourceStat = await fs.stat(sourceAbs).catch(() => undefined)
    if (!sourceStat) throw new Error(`源条目不存在: ${sourcePath}`)

    const targetDirStat = await fs.stat(targetDirAbs).catch(() => undefined)
    if (!targetDirStat?.isDirectory()) {
      throw new Error(`目标目录不存在: ${targetDirPath || "/"}`)
    }

    if (sourceStat.isDirectory() && (targetDirAbs === sourceAbs || targetDirAbs.startsWith(`${sourceAbs}${sep}`))) {
      throw new Error("不能把目录移动到它自己或它的子目录下面")
    }

    const targetAbs = resolve(targetDirAbs, basename(sourceAbs))
    if (targetAbs === sourceAbs) {
      return this.toRelative(projectId, sourceAbs)
    }
    const existing = await fs.stat(targetAbs).catch(() => undefined)
    if (existing) {
      throw new Error(`目标位置已存在同名条目: ${this.toRelative(projectId, targetAbs)}`)
    }

    await fs.rename(sourceAbs, targetAbs)
    return this.toRelative(projectId, targetAbs)
  }

  /** 删除文件或目录（递归）。返回是否存在并被删除。 */
  async removeEntry(projectId: string, relativePath: string) {
    const absPath = this.resolveSafePath(projectId, relativePath)
    if (!relativePath?.trim() || absPath === resolve(this.getProjectRoot(projectId))) {
      throw new Error("不允许删除知识库根目录")
    }
    const stat = await fs.stat(absPath).catch(() => undefined)
    if (!stat) return false
    await fs.rm(absPath, { recursive: true, force: true })
    return true
  }

  async exists(projectId: string, relativePath: string) {
    const absPath = this.resolveSafePath(projectId, relativePath)
    return fs.stat(absPath).then(() => true).catch(() => false)
  }

  /** 下载远程 URL 存为知识库资产（图片/附件）；流式写盘并限制大小。 */
  async saveAssetFromUrl(projectId: string, relativePath: string, url: string) {
    const absPath = this.resolveSafePath(projectId, relativePath)
    if (!relativePath?.trim() || absPath === resolve(this.getProjectRoot(projectId))) {
      throw new Error("资产路径不能为空")
    }
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`仅支持 http/https URL: ${url}`)
    }
    const res = await fetch(url)
    if (!res.ok || !res.body) {
      throw new Error(`下载资产失败：HTTP ${res.status} - ${url}`)
    }
    const declaredLength = Number(res.headers.get("content-length") ?? 0)
    if (declaredLength > MAX_ASSET_BYTES) {
      throw new Error(`资产超过大小上限（${Math.round(MAX_ASSET_BYTES / 1024 / 1024)}MB）: ${url}`)
    }
    await fs.mkdir(dirname(absPath), { recursive: true })
    let written = 0
    const guard = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        written += chunk.byteLength
        if (written > MAX_ASSET_BYTES) {
          controller.error(new Error(`资产超过大小上限（${Math.round(MAX_ASSET_BYTES / 1024 / 1024)}MB）: ${url}`))
          return
        }
        controller.enqueue(chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body.pipeThrough(guard) as import("node:stream/web").ReadableStream), createWriteStream(absPath))
    return this.toRelative(projectId, absPath)
  }

  /** raw 访问（图片内嵌 / 附件下载）用的绝对路径解析；不存在返回 null。 */
  async resolveRawFile(projectId: string, relativePath: string) {
    const absPath = this.resolveSafePath(projectId, relativePath)
    const stat = await fs.stat(absPath).catch(() => undefined)
    if (!stat?.isFile()) return null
    return { filePath: absPath, size: stat.size }
  }

  /**
   * 脚本运行时 / agent 工具用的 `knowledge` 命名空间实现（绑定项目）。
   * onLog 可选：把写入动作回显到运行日志。
   */
  createScriptApi(projectId: string, onLog?: (line: string) => void): KnowledgeScriptApi {
    return {
      write: async (path, content) => {
        const saved = await this.writeFile(projectId, path, content)
        onLog?.(`知识库 · 写入 ${saved}（${Buffer.byteLength(content, "utf-8")} 字节）`)
        return saved
      },
      read: async (path) => {
        try {
          return (await this.readFile(projectId, path)).content
        } catch {
          return null
        }
      },
      exists: (path) => this.exists(projectId, path),
      mkdir: async (path) => {
        const created = await this.createDirectory(projectId, path)
        onLog?.(`知识库 · 创建目录 ${created}`)
        return created
      },
      list: (path) => this.listDirectory(projectId, path ?? ""),
      saveAsset: async (path, url) => {
        const saved = await this.saveAssetFromUrl(projectId, path, url)
        onLog?.(`知识库 · 保存资产 ${saved} ← ${url}`)
        return saved
      },
      remove: async (path) => {
        const removed = await this.removeEntry(projectId, path)
        if (removed) onLog?.(`知识库 · 删除 ${path}`)
        return removed
      },
    }
  }
}

/** 全局单例：路由、agent 工具注入、脚本运行时注入共用同一实例。 */
export const knowledgeService = new KnowledgeService(dataDir)
