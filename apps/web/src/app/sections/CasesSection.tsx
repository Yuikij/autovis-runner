import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "../components/page-header"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import type { CasesSectionProps } from "./cases/types"
import { CasesSidebar } from "./cases/CasesSidebar"
import { CaseEditForm } from "./cases/CaseEditForm"
import { CaseDetails } from "./cases/CaseDetails"
import { emptyCaseForm } from "../workspaceForms"

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
  } = controller

  // Redesign state hooks
  const [isEditing, setIsEditing] = useState(false)
  const [lastSelectedCaseId, setLastSelectedCaseId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"info" | "script" | "history">("info")
  const [copied, setCopied] = useState(false)
  const [quickRunHumanInput, setQuickRunHumanInput] = useState("")
  const [quickRunTargetUrlId, setQuickRunTargetUrlId] = useState("")

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
      // Find the next available case to select
      const remaining = testCases.filter((item) => item.id !== caseId)
      if (remaining.length > 0) {
        setSelectedCaseId(remaining[0].id)
      } else {
        setSelectedCaseId(null)
      }
      setIsEditing(false)
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Test Cases"
        title={`${selectedProject.name} · 测试用例`}
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

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <CasesSidebar controller={controller} />

        <div className="space-y-6">
          {isEditing ? (
            <CaseEditForm {...caseDetailsProps} />
          ) : selectedCase ? (
            <CaseDetails {...caseDetailsProps} />
          ) : (
            <Card>
              <CardContent className="py-20 text-center flex flex-col items-center justify-center gap-3">
                <span className="material-symbols-outlined text-muted-foreground/60 text-5xl">fact_check</span>
                <h3 className="text-lg font-bold text-foreground">未选择测试用例</h3>
                <p className="text-sm text-muted-foreground max-w-sm">请从左侧列表中选择一个测试用例，或者点击右上角“新建用例”开始进行设计。</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
