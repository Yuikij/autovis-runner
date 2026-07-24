import type { ExecutionRun, OutboxItem } from "@autovis/shared"

/**
 * 把若干 run 的 runtimeOutputs 摊平成「产出收件箱」卡片，按时间倒序取前 limit 条。
 * 纯函数，不依赖 DB/IO，便于单测。分类/需关注/标题/摘要由脚本经 outputs.add 的 meta 提供。
 */
export const buildOutboxItems = (runs: ExecutionRun[], limit = 60): OutboxItem[] => {
  const items: OutboxItem[] = []
  for (const run of runs) {
    const reportUrl = run.artifacts?.find((a) => a.kind === "report")?.url
    const screenshotUrl = run.artifacts?.find((a) => a.kind === "screenshot")?.url
    for (const o of run.runtimeOutputs ?? []) {
      items.push({
        id: o.id,
        runId: o.runId,
        createdAt: o.createdAt,
        category: o.category?.trim() || "其他",
        attention: o.attention === true,
        title: o.title?.trim() || o.description,
        summary: o.summary?.trim() || undefined,
        source: o.caseName || o.caseCode || undefined,
        reportUrl,
        screenshotUrl,
      })
    }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return items.slice(0, Math.max(1, limit))
}
