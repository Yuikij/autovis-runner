import { useMemo, useState } from "react"
import type { CasesSectionProps } from "./types"
import type { TestCase } from "@autovis/shared"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { inputClassName } from "../../components/ui/field"
import { EmptyState } from "../../components/empty-state"
import { Badge } from "../../components/ui/badge"
import { translateStatus } from "../../utils"

export function CasesSidebar({ controller }: CasesSectionProps) {
  const { testCases, projectRuns, selectedCase, setSelectedCaseId } = controller
  const [searchQuery, setSearchQuery] = useState("")

  const filteredCases = useMemo(() => {
    if (!searchQuery) return testCases
    const query = searchQuery.toLowerCase()
    return testCases.filter(
      (item) =>
        item.caseCode.toLowerCase().includes(query) ||
        (item.moduleName ?? "").toLowerCase().includes(query) ||
        item.purpose.toLowerCase().includes(query),
    )
  }, [testCases, searchQuery])

  const groupedCases = useMemo(() => {
    const groups = new Map<string, TestCase[]>()
    for (const item of filteredCases) {
      const key = item.moduleName?.trim() || "未分组"
      const list = groups.get(key) ?? []
      list.push(item)
      groups.set(key, list)
    }
    return Array.from(groups.entries())
  }, [filteredCases])

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>测试用例</CardTitle>
        <CardDescription>{filteredCases.length} 条结果</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input className={inputClassName} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索编号、模块或测试目的" value={searchQuery} />
        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
          {filteredCases.length === 0 ? (
            <EmptyState description="当前项目下还没有测试用例，先创建一条开始设计。" title="暂无测试用例" />
          ) : (
            groupedCases.map(([moduleName, items]) => (
              <div key={moduleName} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{moduleName}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-3">
                  {items.map((item) => {
                    const lastRun = projectRuns.find((run) => run.kind !== "verification" && run.testCaseId === item.id)
                    const isActive = item.id === selectedCase?.id
                    return (
                      <button
                        className={isActive ? "w-full rounded-2xl border border-primary/40 bg-primary/10 p-4 text-left block" : "w-full rounded-2xl border border-border/80 bg-secondary/30 p-4 text-left transition hover:bg-secondary/60 block"}
                        key={item.id}
                        onClick={() => setSelectedCaseId(item.id)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <strong className="font-mono text-sm text-primary">{item.caseCode}</strong>
                          <Badge tone={lastRun?.status === "passed" ? "success" : lastRun?.status === "failed" ? "danger" : "default"}>{translateStatus(lastRun?.status ?? "idle")}</Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{item.purpose}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
