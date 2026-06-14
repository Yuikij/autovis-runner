import { useEffect, useMemo, useState } from "react"
import type { OutboxItem } from "@autovis/shared"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { apiRoutes } from "../apiRoutes"
import { request } from "../api"

type OutboxSectionProps = {
  controller: ReadyWorkspaceController
}

const CATEGORY_STYLES: Record<string, string> = {
  签到: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  账单: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  资讯: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  告警: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
}
const categoryStyle = (c: string) => CATEGORY_STYLES[c] ?? "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300"
const timeLabel = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
}

export function OutboxSection({ controller }: OutboxSectionProps) {
  const [items, setItems] = useState<OutboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string>("全部")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await request<OutboxItem[]>(apiRoutes.outbox())
      setItems(res.data)
    } catch (err) {
      controller.setError?.(err instanceof Error ? err.message : "加载产出收件箱失败")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of items) counts.set(it.category, (counts.get(it.category) ?? 0) + 1)
    return [...counts.entries()]
  }, [items])
  const attentionCount = useMemo(() => items.filter((i) => i.attention).length, [items])
  const filtered = activeCategory === "全部" ? items : items.filter((i) => i.category === activeCategory)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-2xl text-slate-500">inbox</span>
          <h2 className="text-xl font-semibold">产出收件箱</h2>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>共 {items.length} 条{attentionCount > 0 ? ` · ${attentionCount} 条需关注` : ""}</span>
          <button onClick={() => void load()} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800" title="刷新">
            <span className="material-symbols-outlined text-base">refresh</span>
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {[["全部", items.length] as const, ...categories].map(([cat, count]) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              activeCategory === cat ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {cat} {count}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-400">暂无产出。定时脚本里用 <code>outputs.add(desc, value, {"{ category, attention, title, summary }"})</code> 即可在此聚合。</div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((it) => (
            <article
              key={it.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-slate-900 ${
                it.attention ? "border-l-4 border-l-amber-400 border-slate-200 dark:border-slate-700" : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${categoryStyle(it.category)}`}>{it.category}</span>
                  {it.attention ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
                      <span className="material-symbols-outlined text-sm">warning</span>需关注
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-slate-400">{it.source ? `${it.source} · ` : ""}{timeLabel(it.createdAt)}</span>
              </div>
              <h3 className="mt-2 font-semibold text-slate-900 dark:text-slate-100">{it.title}</h3>
              {it.summary ? <p className="mt-1 text-sm text-slate-500">{it.summary}</p> : null}
              <div className="mt-3 flex items-center gap-4 text-sm">
                {it.reportUrl ? (
                  <button onClick={() => setPreviewUrl(it.reportUrl!)} className="flex items-center gap-1 text-sky-600 hover:underline">
                    <span className="material-symbols-outlined text-base">description</span>查看报告
                  </button>
                ) : null}
                {it.screenshotUrl ? (
                  <a href={it.screenshotUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-slate-500 hover:underline">
                    <span className="material-symbols-outlined text-base">image</span>看截图
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {previewUrl ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setPreviewUrl(null)}>
          <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <span className="flex items-center gap-2 font-medium"><span className="material-symbols-outlined text-base">description</span>报告预览</span>
              <div className="flex items-center gap-2">
                <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">新标签打开</a>
                <button onClick={() => setPreviewUrl(null)} className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><span className="material-symbols-outlined text-base">close</span></button>
              </div>
            </div>
            <iframe title="报告预览" src={previewUrl} className="h-full w-full flex-1 border-0" />
          </div>
        </div>
      ) : null}
    </div>
  )
}
