import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { marked } from "marked"
import type { KnowledgeEntry, KnowledgeFileContent, KnowledgeSearchHit, KnowledgeSearchResult, KnowledgeStats } from "@autovis/shared"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { EmptyState } from "../components/empty-state"
import { PageHeader } from "../components/page-header"
import { request } from "../api"
import { apiRoutes } from "../apiRoutes"
import { apiBase } from "../constants"
import { t } from "../../i18n/index.js"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { formatDateTime } from "../utils"

type Props = { controller: ReadyWorkspaceController }

const inputCls =
  "block w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"])
const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "json", "yaml", "yml", "csv", "html", "htm", "xml", "js", "ts", "css"])

const isMarkdownFile = (entry: KnowledgeEntry) => entry.extension === "md" || entry.extension === "markdown"
const isImageFile = (entry: KnowledgeEntry) => IMAGE_EXTENSIONS.has(entry.extension ?? "")
const isTextFile = (entry: KnowledgeEntry) => TEXT_EXTENSIONS.has(entry.extension ?? "")

const formatBytes = (size?: number) => {
  if (size == null) return ""
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

const fileIcon = (entry: KnowledgeEntry) => {
  if (entry.kind === "directory") return "folder"
  if (isMarkdownFile(entry)) return "article"
  if (isImageFile(entry)) return "image"
  if (entry.extension === "json" || entry.extension === "yaml" || entry.extension === "yml") return "data_object"
  return "draft"
}

const parentPathOf = (path: string) => path.split("/").slice(0, -1).join("/")
const joinKnowledgePath = (base: string, leaf: string) => [base.replace(/\/+$/, ""), leaf.replace(/^\/+/, "")].filter(Boolean).join("/")

const expandParents = (path: string) => {
  const parts = path.split("/").filter(Boolean)
  const parents: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join("/"))
  }
  return parents
}

const findEntryByPath = (entries: KnowledgeEntry[], path: string): KnowledgeEntry | null => {
  for (const entry of entries) {
    if (entry.path === path) return entry
    const child = entry.children ? findEntryByPath(entry.children, path) : null
    if (child) return child
  }
  return null
}

const countChildren = (entry: KnowledgeEntry): { files: number; directories: number } => {
  let files = 0
  let directories = 0
  for (const child of entry.children ?? []) {
    if (child.kind === "directory") {
      directories += 1
      const nested = countChildren(child)
      files += nested.files
      directories += nested.directories
    } else {
      files += 1
    }
  }
  return { files, directories }
}

/** 解析 Markdown 顶部的 YAML frontmatter（仅支持 `key: value` 简单结构，够展示来源元数据用）。 */
const parseFrontmatter = (raw: string): { meta: Array<[string, string]>; body: string } => {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return { meta: [], body: raw }
  const end = raw.indexOf("\n---", 3)
  if (end === -1) return { meta: [], body: raw }
  const block = raw.slice(raw.indexOf("\n") + 1, end)
  const body = raw.slice(end + 4).replace(/^\r?\n/, "")
  const meta: Array<[string, string]> = []
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) meta.push([key, value])
  }
  return { meta, body }
}

/** 把文件内相对引用（../assets/x.webp）解析成知识库内的规范路径。 */
const resolveRelativePath = (baseFilePath: string, relative: string) => {
  const baseSegments = baseFilePath.split("/").slice(0, -1)
  const segments = [...baseSegments]
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      segments.pop()
      continue
    }
    segments.push(part)
  }
  return segments.join("/")
}

/** 轻量净化：去掉脚本类节点与内联事件，采集回来的页面内容不至于在平台里执行。 */
const sanitizeHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll("script, iframe, object, embed, form").forEach((el) => el.remove())
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith("on")) el.removeAttribute(attr.name)
      if ((name === "href" || name === "src") && attr.value.trim().toLowerCase().startsWith("javascript:")) {
        el.removeAttribute(attr.name)
      }
    }
  })
  return doc.body.innerHTML
}

// ---------------- 目录树 ----------------

type TreeNodeProps = {
  entry: KnowledgeEntry
  depth: number
  selectedPath: string | null
  expanded: Set<string>
  draggingPath: string | null
  dropTargetPath: string | null
  onToggle: (path: string) => void
  onSelect: (entry: KnowledgeEntry) => void
  onDelete: (entry: KnowledgeEntry) => void
  onDragStart: (entry: KnowledgeEntry) => void
  onDragEnd: () => void
  onDropToDirectory: (entry: KnowledgeEntry, targetDirPath: string) => void
  onDragOverDirectory: (targetDirPath: string | null) => void
}

function TreeNode({
  entry,
  depth,
  selectedPath,
  expanded,
  draggingPath,
  dropTargetPath,
  onToggle,
  onSelect,
  onDelete,
  onDragStart,
  onDragEnd,
  onDropToDirectory,
  onDragOverDirectory,
}: TreeNodeProps) {
  const isDir = entry.kind === "directory"
  const isOpen = expanded.has(entry.path)
  const active = entry.path === selectedPath
  const dragging = draggingPath === entry.path
  const canDrop = isDir && draggingPath && draggingPath !== entry.path && !entry.path.startsWith(`${draggingPath}/`)
  const isDropTarget = canDrop && dropTargetPath === entry.path

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canDrop) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    onDragOverDirectory(entry.path)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!canDrop) return
    event.preventDefault()
    onDropToDirectory(entry, entry.path)
  }

  return (
    <div>
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          event.dataTransfer.setData("text/plain", entry.path)
          onDragStart(entry)
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={() => onDragOverDirectory(null)}
        onDrop={handleDrop}
        className={`group flex items-center rounded-lg pr-1 transition ${
          active ? "bg-primary/15 text-primary" : "text-foreground/90 hover:bg-secondary/50"
        } ${isDropTarget ? "ring-2 ring-primary/50 bg-primary/10" : ""} ${dragging ? "opacity-45" : ""}`}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        title={entry.path}
      >
        <button
          type="button"
          onClick={() => {
            onSelect(entry)
            if (isDir) onToggle(entry.path)
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-xs cursor-pointer"
        >
          {isDir ? (
            <span className="material-symbols-outlined text-sm text-muted-foreground shrink-0">
              {isOpen ? "expand_more" : "chevron_right"}
            </span>
          ) : (
            <span className="w-[14px] shrink-0" />
          )}
          <span className={`material-symbols-outlined text-base shrink-0 ${isDir ? "text-amber-500/90" : "text-muted-foreground"}`}>
            {isDir ? (isOpen ? "folder_open" : "folder") : fileIcon(entry)}
          </span>
          <span className="truncate">{entry.name}</span>
          {!isDir && entry.size != null ? (
            <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/60">{formatBytes(entry.size)}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(entry)
          }}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground/60 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-600 group-hover:opacity-100 cursor-pointer"
          title={entry.kind === "directory" ? t("kb.deleteDirTooltip") : t("kb.deleteFileTooltip")}
        >
          <span className="material-symbols-outlined text-sm">delete</span>
        </button>
      </div>
      {isDir && isOpen
        ? (entry.children ?? []).map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              draggingPath={draggingPath}
              dropTargetPath={dropTargetPath}
              onToggle={onToggle}
              onSelect={onSelect}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropToDirectory={onDropToDirectory}
              onDragOverDirectory={onDragOverDirectory}
            />
          ))
        : null}
    </div>
  )
}

// ---------------- Markdown 渲染 ----------------

type TocItem = { id: string; text: string; level: number }

function MarkdownView({ projectId, filePath, content }: { projectId: string; filePath: string; content: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { meta, body } = useMemo(() => parseFrontmatter(content), [content])
  const html = useMemo(() => sanitizeHtml(marked.parse(body, { async: false }) as string), [body])
  const [toc, setToc] = useState<TocItem[]>([])
  const [activeHeading, setActiveHeading] = useState<string | null>(null)

  // 渲染后把相对图片/链接指到知识库 raw 接口；外链新窗口打开。同时给标题编 id、提取 TOC。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? ""
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return
      img.src = `${apiBase}${apiRoutes.projects.knowledgeRaw(projectId, resolveRelativePath(filePath, src))}`
    })
    container.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") ?? ""
      if (/^https?:/i.test(href)) {
        a.target = "_blank"
        a.rel = "noreferrer noopener"
      } else if (href && !href.startsWith("#")) {
        a.href = `${apiBase}${apiRoutes.projects.knowledgeRaw(projectId, resolveRelativePath(filePath, href))}`
        a.target = "_blank"
      }
    })

    const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4"))
    const items: TocItem[] = headings.map((el, index) => {
      const id = `kb-heading-${index}`
      el.id = id
      return { id, text: (el.textContent ?? "").trim(), level: Number(el.tagName.slice(1)) }
    }).filter((item) => item.text)
    setToc(items)
    setActiveHeading(items[0]?.id ?? null)

    // 滚动时高亮当前所在小节
    if (headings.length) {
      const observer = new IntersectionObserver(
        (observed) => {
          const visible = observed.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
          if (visible[0]?.target.id) setActiveHeading(visible[0].target.id)
        },
        { rootMargin: "0px 0px -70% 0px" },
      )
      headings.forEach((el) => observer.observe(el))
      return () => observer.disconnect()
    }
  }, [html, projectId, filePath])

  const showToc = toc.length >= 3

  return (
    <div className="flex items-start gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        {meta.length > 0 ? (
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{t("kb.sourceInfo")}</p>
            <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr] text-xs">
              {meta.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="font-mono text-muted-foreground">{key}</dt>
                  <dd className="break-all text-foreground">
                    {/^https?:\/\//.test(value) ? (
                      <a className="text-primary hover:underline" href={value} target="_blank" rel="noreferrer noopener">{value}</a>
                    ) : (
                      value || "-"
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        <div ref={containerRef} className="knowledge-markdown" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {showToc ? (
        <nav className="sticky top-0 hidden w-52 shrink-0 xl:block">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("kb.tocTitle")}</p>
          <div className="max-h-[70vh] space-y-0.5 overflow-y-auto border-l border-border/60 pr-1">
            {toc.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={`block w-full truncate border-l-2 py-1 text-left text-[11px] leading-4 transition cursor-pointer ${
                  activeHeading === item.id
                    ? "-ml-px border-primary font-medium text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                style={{ paddingLeft: `${8 + (item.level - 1) * 10}px` }}
                title={item.text}
              >
                {item.text}
              </button>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  )
}

// ---------------- 搜索结果 ----------------

/** 把片段里命中的关键词高亮出来（大小写不敏感，只按第一个词）。 */
function HighlightedSnippet({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const lower = text.toLowerCase()
  const t = term.toLowerCase()
  const parts: Array<{ str: string; hit: boolean }> = []
  let from = 0
  while (true) {
    const idx = lower.indexOf(t, from)
    if (idx === -1) {
      parts.push({ str: text.slice(from), hit: false })
      break
    }
    if (idx > from) parts.push({ str: text.slice(from, idx), hit: false })
    parts.push({ str: text.slice(idx, idx + t.length), hit: true })
    from = idx + t.length
  }
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-400/30 px-0.5 text-foreground">{p.str}</mark>
        ) : (
          <span key={i}>{p.str}</span>
        ),
      )}
    </>
  )
}

// ---------------- 主视图 ----------------

export function KnowledgeSection({ controller }: Props) {
  const projectId = controller.selectedProject.id

  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [stats, setStats] = useState<KnowledgeStats | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<KnowledgeEntry | null>(null)
  const [file, setFile] = useState<KnowledgeFileContent | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  const [creating, setCreating] = useState<"file" | "dir" | null>(null)
  const [createPath, setCreatePath] = useState("")

  const [draggingEntry, setDraggingEntry] = useState<KnowledgeEntry | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [searchResult, setSearchResult] = useState<KnowledgeSearchResult | null>(null)
  const [searching, setSearching] = useState(false)

  const selectedDirectoryPath = selected?.kind === "directory" ? selected.path : selected ? parentPathOf(selected.path) : ""
  const rawUrl = selected?.kind === "file" ? `${apiBase}${apiRoutes.projects.knowledgeRaw(projectId, selected.path)}` : null
  const folderCounts = selected?.kind === "directory" ? countChildren(selected) : null

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (reason) {
      setError((reason as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const loadTree = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await request<{ entries: KnowledgeEntry[]; stats: KnowledgeStats; truncated: boolean }>(
        apiRoutes.projects.knowledgeTree(projectId),
      )
      setEntries(result.data.entries)
      setStats(result.data.stats)
      setTruncated(result.data.truncated)
      return result.data
    } catch (reason) {
      setError((reason as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setSelected(null)
    setFile(null)
    setExpanded(new Set())
    void loadTree()
  }, [loadTree])

  const openFile = useCallback(async (entry: KnowledgeEntry) => {
    setSelected(entry)
    setEditing(false)
    setFile(null)
    if (entry.kind !== "file" || !isTextFile(entry)) return
    setFileLoading(true)
    try {
      const result = await request<KnowledgeFileContent>(apiRoutes.projects.knowledgeFile(projectId, entry.path))
      setFile(result.data)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setFileLoading(false)
    }
  }, [projectId])

  // 关键字搜索：300ms 防抖调服务端全文检索
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResult(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      request<KnowledgeSearchResult>(apiRoutes.projects.knowledgeSearch(projectId, q))
        .then((result) => setSearchResult(result.data))
        .catch((reason) => setError((reason as Error).message))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, projectId])

  const openSearchHit = useCallback((hit: KnowledgeSearchHit) => {
    const entry = findEntryByPath(entries, hit.path) ?? {
      path: hit.path,
      name: hit.name,
      kind: "file" as const,
      size: hit.size,
      extension: hit.name.split(".").pop()?.toLowerCase(),
      updatedAt: hit.updatedAt,
    }
    setExpanded((prev) => new Set([...prev, ...expandParents(hit.path)]))
    void openFile(entry)
  }, [entries, openFile])

  const selectEntry = useCallback((entry: KnowledgeEntry) => {
    if (entry.kind === "directory") {
      setSelected(entry)
      setEditing(false)
      setFile(null)
      return
    }
    void openFile(entry)
  }, [openFile])

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const refresh = async () => {
    const loaded = await loadTree()
    if (!loaded || !selected) return
    const freshSelected = findEntryByPath(loaded.entries, selected.path)
    if (!freshSelected) {
      setSelected(null)
      setFile(null)
      return
    }
    if (freshSelected.kind === "file" && isTextFile(freshSelected)) {
      await openFile(freshSelected)
    } else {
      setSelected(freshSelected)
      setFile(null)
    }
  }

  const startCreate = (kind: "file" | "dir") => {
    setCreating((current) => (current === kind ? null : kind))
    setCreatePath(selectedDirectoryPath ? `${selectedDirectoryPath}/` : "")
    setTimeout(() => document.getElementById("knowledge-create-path")?.focus(), 0)
  }

  const handleSaveEdit = async () => {
    if (!selected || selected.kind !== "file") return
    const ok = await run(() =>
      request(apiRoutes.projects.knowledgeFile(projectId), {
        method: "PUT",
        body: JSON.stringify({ path: selected.path, content: draft }),
      }),
    )
    if (ok) {
      setEditing(false)
      await refresh()
    }
  }

  const handleDelete = async (entry: KnowledgeEntry) => {
    const message = entry.kind === "directory" ? t("kb.confirmDeleteDir", { path: entry.path }) : t("kb.confirmDeleteFile", { path: entry.path })
    if (!window.confirm(message)) return
    const ok = await run(() => request(apiRoutes.projects.knowledgeEntry(projectId, entry.path), { method: "DELETE" }))
    if (ok) {
      if (selected?.path === entry.path || selected?.path.startsWith(`${entry.path}/`)) {
        setSelected(null)
        setFile(null)
      }
      await loadTree()
    }
  }

  const handleCreate = async () => {
    const path = createPath.trim().replace(/^\/+/, "")
    if (!path) return
    if (creating === "dir") {
      const ok = await run(() => request(apiRoutes.projects.knowledgeDir(projectId), { method: "POST", body: JSON.stringify({ path }) }))
      if (ok) {
        setCreating(null)
        setCreatePath("")
        setExpanded((prev) => new Set([...prev, ...expandParents(path), path]))
        const loaded = await loadTree()
        const created = loaded ? findEntryByPath(loaded.entries, path) : null
        if (created) setSelected(created)
      }
      return
    }
    const finalPath = /\.[a-z0-9]+$/i.test(path) ? path : `${path}.md`
    const ok = await run(() =>
      request(apiRoutes.projects.knowledgeFile(projectId), {
        method: "PUT",
        body: JSON.stringify({ path: finalPath, content: `# ${finalPath.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? ""}\n` }),
      }),
    )
    if (ok) {
      setCreating(null)
      setCreatePath("")
      setExpanded((prev) => new Set([...prev, ...expandParents(finalPath)]))
      const loaded = await loadTree()
      const created = loaded ? findEntryByPath(loaded.entries, finalPath) : null
      if (created) await openFile(created)
    }
  }

  const handleMove = async (entry: KnowledgeEntry, targetDirPath: string) => {
    if (entry.path === targetDirPath || targetDirPath.startsWith(`${entry.path}/`)) return
    const currentParent = parentPathOf(entry.path)
    if (currentParent === targetDirPath) return

    const result = await run(() =>
      request<{ path: string }>(apiRoutes.projects.knowledgeMove(projectId), {
        method: "POST",
        body: JSON.stringify({ sourcePath: entry.path, targetDirPath }),
      }),
    )
    setDraggingEntry(null)
    setDropTargetPath(null)
    if (!result) return

    const nextSelectedPath =
      selected?.path === entry.path || selected?.path.startsWith(`${entry.path}/`)
        ? joinKnowledgePath(result.data.path, selected.path.slice(entry.path.length).replace(/^\/+/, ""))
        : selected?.path

    setExpanded((prev) => new Set([...prev, ...expandParents(result.data.path), targetDirPath].filter(Boolean)))
    const loaded = await loadTree()
    if (loaded && nextSelectedPath) {
      const nextSelected = findEntryByPath(loaded.entries, nextSelectedPath)
      if (nextSelected) {
        if (nextSelected.kind === "file" && isTextFile(nextSelected)) await openFile(nextSelected)
        else setSelected(nextSelected)
      }
    }
  }

  const handleRootDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingEntry) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDropTargetPath("")
  }

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingEntry) return
    event.preventDefault()
    void handleMove(draggingEntry, "")
  }

  const toolbar = (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => startCreate("dir")} disabled={busy} className="h-8 rounded-lg border border-border/60 text-[11px] whitespace-nowrap cursor-pointer">
        <span className="material-symbols-outlined text-sm mr-1">create_new_folder</span>
        {t("kb.newDir")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => startCreate("file")} disabled={busy} className="h-8 rounded-lg border border-border/60 text-[11px] whitespace-nowrap cursor-pointer">
        <span className="material-symbols-outlined text-sm mr-1">note_add</span>
        {t("kb.newDoc")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setFullscreen((value) => !value)} className="h-8 rounded-lg border border-border/60 text-[11px] whitespace-nowrap cursor-pointer">
        <span className="material-symbols-outlined text-sm mr-1">{fullscreen ? "close_fullscreen" : "open_in_full"}</span>
        {fullscreen ? t("kb.exitFullscreen") : t("kb.fullscreenRead")}
      </Button>
      <Button size="sm" onClick={() => void refresh()} disabled={loading || busy} className="h-8 rounded-lg text-[11px] whitespace-nowrap cursor-pointer">
        <span className="material-symbols-outlined text-sm mr-1">refresh</span>
        {t("kb.refresh")}
      </Button>
    </div>
  )

  const content = (
    <>
      {fullscreen ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Knowledge Base</p>
            <h2 className="text-xl font-semibold text-foreground">{t("kb.title")}</h2>
          </div>
          {toolbar}
        </div>
      ) : (
        <PageHeader
          eyebrow="Knowledge Base"
          title={t("kb.title")}
          description={t("kb.description")}
          actions={toolbar}
        />
      )}

      {creating ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                  {creating === "dir" ? t("kb.dirPathLabel") : t("kb.docPathLabel")}
                </label>
                <input
                  id="knowledge-create-path"
                  className={inputCls}
                  placeholder={creating === "dir" ? t("kb.dirPathPlaceholder") : t("kb.docPathPlaceholder")}
                  value={createPath}
                  onChange={(e) => setCreatePath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreate() }}
                />
              </div>
              <Button size="sm" onClick={() => void handleCreate()} disabled={busy || !createPath.trim()} className="h-9 rounded-lg cursor-pointer">
                {t("kb.create")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</div> : null}

      {loading ? (
        <div className="text-xs text-muted-foreground">{t("kb.loading")}</div>
      ) : entries.length === 0 ? (
        <EmptyState
          title={t("kb.emptyTitle")}
          description={t("kb.emptyDescription")}
          actionLabel={t("kb.emptyAction")}
          onAction={() => startCreate("file")}
        />
      ) : (
        <div className={`grid min-h-0 gap-3 ${fullscreen ? "h-[calc(100vh-128px)] lg:grid-cols-[300px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]"}`}>
          {/* 左侧：目录树 */}
          <Card className="overflow-hidden rounded-xl border-border/60 bg-card/60">
            <CardContent className="flex h-full flex-col p-2">
              <div className="relative mb-2">
                <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">search</span>
                <input
                  className={`${inputCls} pl-8 pr-7`}
                  placeholder={t("kb.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery("") }}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground cursor-pointer"
                    title={t("kb.clearSearch")}
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                ) : null}
              </div>
              {searchQuery.trim() ? (
                <div className={`${fullscreen ? "h-full" : "max-h-[72vh]"} min-h-0 space-y-1 overflow-y-auto pr-1`}>
                  {searching ? (
                    <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("kb.searching")}</p>
                  ) : !searchResult || searchResult.hits.length === 0 ? (
                    <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("kb.noSearchMatch", { query: searchQuery.trim() })}</p>
                  ) : (
                    <>
                      <p className="px-2 pb-1 text-[10px] text-muted-foreground">
                        {t("kb.searchStats", {
                          hits: searchResult.hits.length,
                          truncated: searchResult.truncated ? t("kb.searchTruncated") : "",
                          scanned: searchResult.scannedFiles,
                        })}
                      </p>
                      {searchResult.hits.map((hit) => (
                        <button
                          key={hit.path}
                          type="button"
                          onClick={() => openSearchHit(hit)}
                          className={`block w-full rounded-lg px-2 py-1.5 text-left transition cursor-pointer ${
                            selected?.path === hit.path ? "bg-primary/15" : "hover:bg-secondary/50"
                          }`}
                          title={hit.path}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined shrink-0 text-sm text-muted-foreground">article</span>
                            <span className="truncate text-xs text-foreground">
                              <HighlightedSnippet text={hit.name.replace(/\.md$/, "")} term={searchQuery.trim().split(/\s+/)[0] ?? ""} />
                            </span>
                            {hit.matchCount > 0 ? (
                              <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/70">{t("kb.matchCount", { count: hit.matchCount })}</span>
                            ) : null}
                          </span>
                          {hit.snippets[0] ? (
                            <span className="mt-0.5 block truncate pl-5 text-[10px] leading-4 text-muted-foreground">
                              <HighlightedSnippet text={hit.snippets[0]} term={searchQuery.trim().split(/\s+/)[0] ?? ""} />
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div
                    className={`mb-2 rounded-lg border border-dashed px-2 py-2 text-[10px] transition ${
                      dropTargetPath === "" ? "border-primary/70 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"
                    }`}
                    onDragOver={handleRootDragOver}
                    onDragLeave={() => setDropTargetPath(null)}
                    onDrop={handleRootDrop}
                  >
                    {t("kb.dropToRoot")}
                  </div>
                  <div className={`${fullscreen ? "h-full" : "max-h-[72vh]"} min-h-0 overflow-y-auto pr-1`}>
                    {entries.map((entry) => (
                      <TreeNode
                        key={entry.path}
                        entry={entry}
                        depth={0}
                        selectedPath={selected?.path ?? null}
                        expanded={expanded}
                        draggingPath={draggingEntry?.path ?? null}
                        dropTargetPath={dropTargetPath}
                        onToggle={toggleDir}
                        onSelect={selectEntry}
                        onDelete={(item) => void handleDelete(item)}
                        onDragStart={setDraggingEntry}
                        onDragEnd={() => {
                          setDraggingEntry(null)
                          setDropTargetPath(null)
                        }}
                        onDropToDirectory={(item) => draggingEntry && void handleMove(draggingEntry, item.path)}
                        onDragOverDirectory={setDropTargetPath}
                      />
                    ))}
                  </div>
                </>
              )}
              <div className="mt-2 border-t border-border/60 px-2 pt-2 pb-1 text-[10px] text-muted-foreground">
                {stats ? t("kb.statsSummary", { files: stats.totalFiles, dirs: stats.totalDirectories, size: formatBytes(stats.totalBytes) }) : null}
                {truncated ? t("kb.treeTruncated") : null}
              </div>
            </CardContent>
          </Card>

          {/* 右侧：内容 */}
          <Card className="min-h-[72vh] overflow-hidden rounded-xl border-border/60 bg-card/60">
            <CardContent className="flex h-full min-h-0 flex-col p-0">
              {!selected ? (
                <div className="flex min-h-[62vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <span className="material-symbols-outlined text-5xl opacity-40">auto_stories</span>
                  <p className="text-sm">{t("kb.selectDocHint")}</p>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  {/* 文件头部 */}
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                        <span className={`material-symbols-outlined text-lg ${selected.kind === "directory" ? "text-amber-500/90" : "text-muted-foreground"}`}>{selected.kind === "directory" ? "folder_open" : fileIcon(selected)}</span>
                        <span className="truncate">{selected.name}</span>
                      </h3>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{selected.path}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {selected.kind === "directory" ? <Badge tone="default" className="text-[9px]">{t("kb.dirBadge")}</Badge> : null}
                        {selected.extension ? <Badge tone="info" className="text-[9px] uppercase">{selected.extension}</Badge> : null}
                        {selected.size != null ? <span className="text-[10px] text-muted-foreground">{formatBytes(selected.size)}</span> : null}
                        {selected.updatedAt ? <span className="text-[10px] text-muted-foreground">{t("kb.updatedAt", { time: formatDateTime(selected.updatedAt) })}</span> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {selected.kind === "directory" ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startCreate("dir")} disabled={busy} className="h-8 rounded-lg border border-border/60 text-[11px] whitespace-nowrap cursor-pointer">
                            <span className="material-symbols-outlined text-sm mr-1">create_new_folder</span>
                            {t("kb.subDir")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => startCreate("file")} disabled={busy} className="h-8 rounded-lg border border-border/60 text-[11px] whitespace-nowrap cursor-pointer">
                            <span className="material-symbols-outlined text-sm mr-1">note_add</span>
                            {t("kb.doc")}
                          </Button>
                        </>
                      ) : null}
                      {selected.kind === "file" && isTextFile(selected) && file && !editing ? (
                        <Button size="sm" variant="ghost" onClick={() => { setDraft(file.content); setEditing(true) }} disabled={busy} className="h-8 rounded-lg border border-border/60 text-[11px] whitespace-nowrap cursor-pointer">
                          <span className="material-symbols-outlined text-sm mr-1">edit</span>
                          {t("kb.edit")}
                        </Button>
                      ) : null}
                      {rawUrl ? (
                        <a href={rawUrl} target="_blank" rel="noreferrer noopener" className="flex h-8 items-center rounded-lg border border-border/60 px-2.5 text-[11px] text-muted-foreground transition hover:bg-secondary/50 hover:text-foreground">
                          <span className="material-symbols-outlined text-sm mr-1">download</span>
                          {t("kb.rawFile")}
                        </a>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => void handleDelete(selected)} disabled={busy} className="h-8 rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-[11px] cursor-pointer">
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </Button>
                    </div>
                  </div>

                  {/* 文件内容 */}
                  <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                    {selected.kind === "directory" ? (
                      <div className="flex min-h-[46vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                        <span className="material-symbols-outlined text-5xl text-amber-500/60">folder_open</span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{t("kb.dirSelected")}</p>
                          <p className="mt-1 text-xs">
                            {folderCounts ? t("kb.folderCounts", { files: folderCounts.files, dirs: folderCounts.directories }) : t("kb.emptyDir")}
                          </p>
                        </div>
                        <p className="max-w-md text-xs leading-5">{t("kb.dirHint")}</p>
                      </div>
                    ) : editing && file ? (
                      <div className="space-y-3">
                        <textarea
                          className={`${fullscreen ? "h-[calc(100vh-276px)]" : "h-[58vh]"} w-full resize-y rounded-lg border border-border/60 bg-background/40 p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20`}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          spellCheck={false}
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => void handleSaveEdit()} disabled={busy} className="h-8 rounded-lg cursor-pointer text-[11px]">
                            <span className="material-symbols-outlined text-sm mr-1">save</span>
                            {t("kb.save")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy} className="h-8 rounded-lg border border-border/60 cursor-pointer text-[11px]">
                            {t("kb.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : fileLoading ? (
                      <div className="py-10 text-center text-xs text-muted-foreground">{t("kb.loadingDoc")}</div>
                    ) : isImageFile(selected) && rawUrl ? (
                      <div className="flex justify-center py-4">
                        <img src={rawUrl} alt={selected.name} className={`${fullscreen ? "max-h-[calc(100vh-230px)]" : "max-h-[65vh]"} max-w-full rounded-lg border border-border/60`} />
                      </div>
                    ) : file && isMarkdownFile(selected) ? (
                      <MarkdownView projectId={projectId} filePath={selected.path} content={file.content} />
                    ) : file ? (
                      <pre className={`${fullscreen ? "max-h-[calc(100vh-230px)]" : "max-h-[65vh]"} overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/40 p-4 font-mono text-xs leading-relaxed text-foreground`}>{file.content}</pre>
                    ) : (
                      <div className="py-10 text-center text-xs text-muted-foreground">
                        {t("kb.previewUnsupported")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )

  return (
    <div className={fullscreen ? "fixed inset-0 z-[80] flex flex-col gap-3 overflow-hidden bg-background p-4" : "space-y-5 animate-fade-in"}>
      {content}
    </div>
  )
}
