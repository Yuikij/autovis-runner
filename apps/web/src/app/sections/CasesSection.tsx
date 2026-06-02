import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "../components/page-header"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import type { CasesSectionProps } from "./cases/types"
import { CaseEditForm } from "./cases/CaseEditForm"
import { CaseDetails } from "./cases/CaseDetails"
import { emptyCaseForm } from "../workspaceForms"
import { Drawer } from "../components/ui/drawer"
import { Badge } from "../components/ui/badge"
import { inputClassName } from "../components/ui/field"
import { translateStatus, translateTestType, formatDateTime } from "../utils"

export function CasesSection({ controller }: CasesSectionProps) {
  const {
    testCases,
    modules,
    selectedProject,
    projectRuns,
    selectedCase,
    busy,
    setCaseForm,
    setSelectedCaseId,
    lastTargetUrlId,
    activeRun,
    setActiveRun,
    setWorkbenchVerificationRunId,
  } = controller

  // Redesign state hooks
  const [isEditing, setIsEditing] = useState(false)
  const [lastSelectedCaseId, setLastSelectedCaseId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"info" | "script" | "history">("info")
  const [copied, setCopied] = useState(false)
  const [quickRunHumanInput, setQuickRunHumanInput] = useState("")
  const [quickRunTargetUrlId, setQuickRunTargetUrlId] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const isDrawerOpen = isEditing || !!selectedCase
  const handleCloseDrawer = () => {
    setIsEditing(false)
    setSelectedCaseId(null)
  }

  // Auto-reset state when active test case changes
  useEffect(() => {
    const currentCaseId = selectedCase?.id ?? null
    if (currentCaseId !== lastSelectedCaseId) {
      if (currentCaseId) {
        setIsEditing(false)
        setActiveTab("info")
      }
      setLastSelectedCaseId(currentCaseId)
    }
  }, [selectedCase?.id, lastSelectedCaseId])

  useEffect(() => {
    if (!selectedProject) return
    const targetUrls = selectedProject.targetUrls ?? []
    if (lastTargetUrlId && targetUrls.some((u) => u.id === lastTargetUrlId)) {
      setQuickRunTargetUrlId(lastTargetUrlId)
      return
    }
    const primary = targetUrls.find((u) => u.isPrimary) ?? targetUrls[0]
    setQuickRunTargetUrlId(primary?.id ?? "")
  }, [lastTargetUrlId, selectedProject, selectedCase?.id])

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

  // Get current case's runs for history tab
  const caseRuns = useMemo(() => {
    if (!selectedCase) return []
    return projectRuns.filter((run) => run.testCaseId === selectedCase.id && run.kind !== "temporary")
  }, [projectRuns, selectedCase?.id])

  const temporaryRun = useMemo(() => {
    if (!selectedCase || activeRun?.kind !== "temporary" || activeRun.testCaseId !== selectedCase.id) {
      return null
    }
    return activeRun
  }, [activeRun, selectedCase?.id])

  const temporaryReplayVideo = useMemo(
    () => temporaryRun?.artifacts.find((artifact) => artifact.kind === "video")?.url,
    [temporaryRun?.artifacts],
  )

  const openNewCase = () => {
    setActiveRun(null)
    setWorkbenchVerificationRunId(null)
    setSelectedCaseId(null)
    setCaseForm({
      ...emptyCaseForm(),
      caseCode: `CASE_${String(testCases.length + 1).padStart(3, "0")}`,
      moduleName: modules[0]?.name ?? "",
      moduleId: modules[0]?.id ?? "",
    })
    setIsEditing(true)
  }

  const handleDeleteCase = async (caseId: string) => {
    const success = await controller.deleteTestCase(caseId)
    if (success) {
      handleCloseDrawer()
    }
  }

  if (!selectedProject) {
    return null
  }

  const caseDetailsProps = {
    controller,
    isEditing,
    setIsEditing,
    activeTab,
    setActiveTab,
    copied,
    setCopied,
    quickRunTargetUrlId,
    setQuickRunTargetUrlId,
    quickRunHumanInput,
    setQuickRunHumanInput,
    temporaryRun,
    temporaryReplayVideo,
    caseRuns,
    handleDeleteCase,
  }

  if (isEditing || selectedCase) {
    return (
      <div className="flex h-[calc(100vh-32px)] -mx-6 -my-6 bg-background overflow-hidden border border-border/40 rounded-xl shadow-sm">
        {/* Left Sidebar List */}
        <div className="w-[280px] shrink-0 border-r border-border/60 overflow-y-auto bg-secondary/10 hidden md:flex flex-col">
           <div className="p-3 border-b border-border/60 font-medium text-xs sticky top-0 bg-secondary/10 backdrop-blur-md z-10 text-muted-foreground flex items-center justify-between uppercase tracking-wider">
              <div className="flex items-center gap-2">
                <button onClick={handleCloseDrawer} className="hover:bg-secondary/40 p-1.5 rounded-lg transition-colors text-foreground flex items-center">
                   <span className="material-symbols-outlined text-base">arrow_back</span>
                </button>
                返回列表
              </div>
              <span className="text-[10px] bg-background border border-border/60 rounded-full px-2 py-0.5">{filteredCases.length}</span>
           </div>
           <div className="p-3 space-y-2">
             {filteredCases.map(item => (
               <button
                 key={item.id}
                 onClick={() => setSelectedCaseId(item.id)}
                 className={`w-full text-left p-3 rounded-xl text-sm transition-all border ${selectedCase?.id === item.id ? "bg-background border-border/80 shadow-sm" : "border-transparent hover:bg-secondary/40 text-muted-foreground hover:text-foreground"}`}
               >
                 <div className="flex items-center justify-between gap-2">
                   <span className={`font-mono text-xs ${selectedCase?.id === item.id ? "text-primary font-bold" : "font-medium"}`}>{item.caseCode}</span>
                   {item.moduleName && (
                     <span className="text-[9px] bg-secondary px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[80px]">
                       {item.moduleName}
                     </span>
                   )}
                 </div>
                 <div className="text-xs line-clamp-2 mt-1.5 opacity-80 leading-relaxed">{item.purpose}</div>
               </button>
             ))}
           </div>
        </div>
        
        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-background relative">
          <div className="md:hidden mb-4">
             <Button variant="ghost" size="sm" onClick={handleCloseDrawer} className="-ml-3">
               <span className="material-symbols-outlined text-base mr-1">arrow_back</span> 返回列表
             </Button>
          </div>
          <div className="max-w-5xl mx-auto">
            {isEditing ? (
              <CaseEditForm {...caseDetailsProps} />
            ) : selectedCase ? (
              <CaseDetails {...caseDetailsProps} />
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Test Cases"
        title="用例管理"
        description="管理项目下的测试用例与有序前置用例，并串联到 AI 工作台。"
        actions={
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={openNewCase}>
              <span className="material-symbols-outlined text-base">add</span>
              新建用例
            </Button>
          </div>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4 bg-card p-4 rounded-2xl border border-border/80 shadow-sm">
        <div className="flex-1 max-w-sm flex items-center gap-2">
           <span className="material-symbols-outlined text-muted-foreground text-sm">search</span>
           <input 
             className={`${inputClassName} bg-transparent border-0 shadow-none focus-visible:ring-0 px-0 h-auto w-full`}
             placeholder="搜索编号、模块或测试目的..."
             value={searchQuery}
             onChange={e => setSearchQuery(e.target.value)}
           />
        </div>
        <div className="hidden sm:block h-6 w-[1px] bg-border/60 mx-2"></div>
        <div className="flex flex-1 sm:flex-none items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium shrink-0">当前项目:</span>
          <select 
            className={`${inputClassName} h-9 py-1 text-sm bg-secondary/30 w-full sm:w-auto`}
            value={controller.selectedProjectId ?? ""}
            onChange={e => {
              controller.setSelectedProjectId(e.target.value)
              handleCloseDrawer() // close drawer if switching project
            }}
          >
            {controller.projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-secondary/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-4 font-medium">编号</th>
                <th className="px-6 py-4 font-medium">模块</th>
                <th className="px-6 py-4 font-medium">测试类型</th>
                <th className="px-6 py-4 font-medium min-w-[200px] w-full">测试目的</th>
                <th className="px-6 py-4 font-medium">状态</th>
                <th className="px-6 py-4 font-medium text-right">更新时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    暂无匹配的测试用例
                  </td>
                </tr>
              ) : (
                filteredCases.map(item => {
                  const lastRun = projectRuns.find((run) => run.kind !== "verification" && run.testCaseId === item.id)
                  return (
                    <tr 
                      key={item.id} 
                      onClick={() => setSelectedCaseId(item.id)}
                      className="group transition-colors hover:bg-secondary/40 cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <strong className="font-mono text-primary font-medium">{item.caseCode}</strong>
                      </td>
                      <td className="px-6 py-4">
                        {item.moduleName ? (
                          <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
                            {item.moduleName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge tone={item.testType === "smoke" ? "warning" : item.testType === "regression" ? "info" : "default"}>
                          {translateTestType(item.testType)}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="max-w-[400px] truncate whitespace-nowrap" title={item.purpose}>
                          {item.purpose}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge tone={lastRun?.status === "passed" ? "success" : lastRun?.status === "failed" ? "danger" : "default"}>
                          {translateStatus(lastRun?.status ?? "idle")}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right text-muted-foreground text-xs font-mono">
                        {formatDateTime(item.updatedAt)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
