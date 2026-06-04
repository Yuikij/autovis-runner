import { useEffect, useMemo, useRef, useState } from "react"
import type { ExecutionRun, TargetUrl, TestCase, ValidationTask, AuthProfile } from "@autovis/shared"
import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { ReadyWorkspaceController } from "../../useWorkspaceController"

export type DetailTab = "overview" | "script" | "timeline"

export type ProfileFormState = {
  id?: string
  name: string
  description: string
  sourceCaseId: string
}

export const emptyFormState = (): ProfileFormState => ({ name: "", description: "", sourceCaseId: "" })

export interface ActiveRefresh {
  profileId: string
  targetUrlId: string
  runId: string
  testBaseUrl: string
  run: ExecutionRun | null
}

export function useAuthProfilesState(controller: ReadyWorkspaceController) {
  const {
    selectedProject,
    allCases,
    authProfiles,
    saveAuthProfile,
    generateValidationScript,
    refreshAuthProfiles,
    checkLoginStatus,
    refreshAuthProfileState,
  } = controller

  const targetUrls: TargetUrl[] = selectedProject.targetUrls ?? []
  const projectCases = useMemo(() => allCases.filter((c) => c.projectId === selectedProject.id), [allCases, selectedProject.id])

  const [showForm, setShowForm] = useState(false)
  const [editingProfile, setEditingProfile] = useState<AuthProfile | null>(null)

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>("overview")

  const [activeTargetUrlId, setActiveTargetUrlId] = useState<string>("")
  const [activeTask, setActiveTask] = useState<ValidationTask | null>(null)
  const [copiedScript, setCopiedScript] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  const [activeRefresh, setActiveRefresh] = useState<ActiveRefresh | null>(null)
  const refreshEsRef = useRef<EventSource | null>(null)

  const [sandbox, setSandbox] = useState<{ authProfileId: string; targetUrlId: string; targetLabel: string } | null>(null)

  // Computed state instead of useEffect fallback
  const effectiveProfileId = useMemo(() => {
    if (selectedProfileId && authProfiles.some((p) => p.id === selectedProfileId)) {
      return selectedProfileId
    }
    return authProfiles.length > 0 ? authProfiles[0].id : null
  }, [authProfiles, selectedProfileId])

  const effectiveTargetUrlId = useMemo(() => {
    if (activeTargetUrlId && targetUrls.some((u) => u.id === activeTargetUrlId)) {
      return activeTargetUrlId
    }
    return targetUrls.find((u) => u.isPrimary)?.id ?? targetUrls[0]?.id ?? ""
  }, [targetUrls, activeTargetUrlId])

  useEffect(() => () => {
    eventSourceRef.current?.close()
    refreshEsRef.current?.close()
  }, [])

  useEffect(() => {
    if (!activeTask || activeTask.status === "running") return
    refreshAuthProfiles()
    if (activeTask.kind === "generate" && activeTask.status === "completed") {
      setDetailTab("script")
    }
  }, [activeTask?.status, activeTask?.kind, refreshAuthProfiles])

  useEffect(() => {
    const status = activeRefresh?.run?.status
    if (!status) return
    const terminal = status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"
    if (terminal) {
      refreshEsRef.current?.close()
      refreshAuthProfiles()
    }
  }, [activeRefresh?.run?.status, refreshAuthProfiles])

  const selectedProfile = useMemo(
    () => authProfiles.find((p) => p.id === effectiveProfileId) ?? null,
    [authProfiles, effectiveProfileId],
  )

  const caseLabel = useMemo(() => {
    if (!selectedProfile) return null
    const testCase = allCases.find((c) => c.id === selectedProfile.sourceCaseId)
    return testCase ? `${testCase.caseCode}${testCase.purpose ? ` · ${testCase.purpose}` : ""}` : selectedProfile.sourceCaseId
  }, [selectedProfile, allCases])

  const subscribeTask = (taskId: string, profileId: string, kind: "generate" | "check") => {
    const initial: ValidationTask = { id: taskId, profileId, kind, status: "running", steps: [] }
    setActiveTask(initial)

    eventSourceRef.current?.close()
    const es = new EventSource(streamUrl(apiRoutes.validationTasks.stream(taskId)))
    eventSourceRef.current = es
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ValidationTask
        setActiveTask(data)
        if (data.status !== "running") es.close()
      } catch {
        // ignore
      }
    }
    es.onerror = () => {
      es.close()
      setActiveTask((prev) => {
        if (prev && prev.status === "running") {
          return { ...prev, status: "error", error: "Connection to server lost." }
        }
        return prev
      })
    }
  }

  const openCreateForm = () => {
    setEditingProfile(null)
    setShowForm(true)
  }

  const openEditForm = (profile: AuthProfile) => {
    setEditingProfile(profile)
    setShowForm(true)
  }

  const handleSubmitForm = async (form: ProfileFormState) => {
    if (!form.name.trim() || !form.sourceCaseId) return
    await saveAuthProfile({
      id: form.id,
      projectId: selectedProject.id,
      name: form.name.trim(),
      description: form.description.trim(),
      sourceCaseId: form.sourceCaseId,
    })
    setShowForm(false)
  }

  const handleRefreshState = async (profile: AuthProfile, targetUrlId: string) => {
    const result = await refreshAuthProfileState(profile.id, targetUrlId)
    if (!result) return
    const initial: ActiveRefresh = {
      profileId: profile.id,
      targetUrlId,
      runId: result.runId,
      testBaseUrl: result.testBaseUrl,
      run: null,
    }
    setActiveRefresh(initial)
    refreshEsRef.current?.close()
    const es = new EventSource(streamUrl(apiRoutes.runs.stream(result.runId)))
    refreshEsRef.current = es
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ExecutionRun
        setActiveRefresh((current) =>
          current && current.runId === data.id ? { ...current, run: data } : current,
        )
      } catch {
        // ignore
      }
    }
    es.onerror = () => {
      es.close()
      setActiveRefresh((current) => {
        if (current && (!current.run || current.run.status === "queued" || current.run.status === "running")) {
          // Fake a failed run to unblock UI
          return { ...current, run: { ...(current.run as any), status: "failed" } }
        }
        return current
      })
    }
  }

  const handleGenerate = async (profile: AuthProfile, targetUrlId: string) => {
    setDetailTab("timeline")
    const taskId = await generateValidationScript(profile.id, targetUrlId)
    if (!taskId) return
    subscribeTask(taskId, profile.id, "generate")
  }

  const handleCheck = async (profile: AuthProfile, targetUrlId: string) => {
    setDetailTab("timeline")
    const taskId = await checkLoginStatus(profile.id, targetUrlId)
    if (!taskId) return
    subscribeTask(taskId, profile.id, "check")
  }

  const handleCopyScript = () => {
    if (!selectedProfile?.validationScript) return
    navigator.clipboard.writeText(selectedProfile.validationScript)
    setCopiedScript(true)
    setTimeout(() => setCopiedScript(false), 2000)
  }

  const isTaskForCurrent = Boolean(activeTask && selectedProfile && activeTask.profileId === selectedProfile.id)
  const taskIsRunning = activeTask?.status === "running"
  const generationInProgress = isTaskForCurrent && activeTask?.kind === "generate" && taskIsRunning
  const checkInProgress = isTaskForCurrent && activeTask?.kind === "check" && taskIsRunning

  return {
    controller,
    targetUrls,
    projectCases,
    showForm,
    setShowForm,
    editingProfile,
    effectiveProfileId,
    setSelectedProfileId,
    detailTab,
    setDetailTab,
    effectiveTargetUrlId,
    setActiveTargetUrlId,
    activeTask,
    setActiveTask,
    copiedScript,
    setCopiedScript,
    activeRefresh,
    setActiveRefresh,
    sandbox,
    setSandbox,
    selectedProfile,
    caseLabel,
    openCreateForm,
    openEditForm,
    handleSubmitForm,
    handleRefreshState,
    handleGenerate,
    handleCheck,
    handleCopyScript,
    isTaskForCurrent,
    taskIsRunning,
    generationInProgress,
    checkInProgress,
  }
}
