/**
 * 项目级知识库：跟随项目生命周期的多层级 Markdown 内容空间。
 * 落盘在 `DATA_DIR/knowledge/<projectId>/` 下，由系统管理路径；
 * 用户在前端浏览目录树 + 渲染 Markdown，LLM agent 与脚本运行时通过
 * knowledge_* 工具 / `knowledge.*` 命名空间写入内容（采集、沉淀、整理）。
 */

/** 知识库目录树节点（文件或目录）。路径一律为知识库根下的相对路径（`/` 分隔）。 */
export interface KnowledgeEntry {
  path: string
  name: string
  kind: "directory" | "file"
  /** 文件字节数（仅文件）。 */
  size?: number
  /** 扩展名（不含点，仅文件）。 */
  extension?: string
  updatedAt?: string
  /** 子节点（仅目录；tree 接口递归返回）。 */
  children?: KnowledgeEntry[]
}

export interface KnowledgeFileContent {
  path: string
  content: string
  size: number
  updatedAt?: string
}

export interface KnowledgeStats {
  totalFiles: number
  totalDirectories: number
  totalBytes: number
}

/** 写文件请求（PUT /projects/:id/knowledge/file）。 */
export interface WriteKnowledgeFileRequest {
  path: string
  content: string
}

/** 知识库全文搜索的单条命中（GET /projects/:id/knowledge/search）。 */
export interface KnowledgeSearchHit {
  path: string
  name: string
  /** 文件名（或 frontmatter title）是否命中关键字。 */
  titleHit: boolean
  /** 正文命中次数。 */
  matchCount: number
  /** 命中片段（关键字两侧截取的上下文，最多几条）。 */
  snippets: string[]
  size?: number
  updatedAt?: string
}

export interface KnowledgeSearchResult {
  query: string
  hits: KnowledgeSearchHit[]
  /** 扫描的文件总数（用于前端展示搜索范围）。 */
  scannedFiles: number
  truncated: boolean
}

/**
 * 暴露给「LLM agent 生成的脚本」与「脚本运行时」的知识库方法（运行时以 `knowledge` 命名空间注入）。
 * 所有方法都绑定到当前运行所属的项目；目录不存在时 write / saveAsset 会自动逐级创建，
 * 让采集类脚本可以零配置地「按层级沉淀 Markdown 与资产」。
 */
export interface KnowledgeScriptApi {
  /** 写入/覆盖一个文本文件（.md 等）；父目录自动创建。返回规范化后的相对路径。 */
  write: (path: string, content: string) => Promise<string>
  /** 读取文本文件内容；不存在返回 null。 */
  read: (path: string) => Promise<string | null>
  /** 路径（文件或目录）是否存在。 */
  exists: (path: string) => Promise<boolean>
  /** 创建目录（递归）。返回规范化后的相对路径。 */
  mkdir: (path: string) => Promise<string>
  /** 列出某目录下的直接子节点（缺省列根目录）。 */
  list: (path?: string) => Promise<KnowledgeEntry[]>
  /** 下载远程 URL（图片/附件）保存为知识库资产；父目录自动创建。返回规范化后的相对路径。 */
  saveAsset: (path: string, url: string) => Promise<string>
  /** 删除文件或目录（递归）。返回是否真的删除了内容。 */
  remove: (path: string) => Promise<boolean>
}
