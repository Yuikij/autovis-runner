import { useEffect, useMemo, useRef, useState } from "react"
import type {
  AuthProfile,
  AuthProfileState,
  ExecutionRun,
  StorageStateSummary,
  TargetUrl,
  TestCase,
  ValidationProgressStep,
  ValidationTask,
} from "@autovis/shared"
import { apiRoutes, streamUrl } from "../apiRoutes"
import { AuthSandboxModal } from "../components/auth-sandbox-modal"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { EmptyState } from "../components/empty-state"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { formatDateTime } from "../utils"

type AuthProfilesSectionProps = {
  controller: ReadyWorkspaceController
}

type DetailTab = "overview" | "script" | "timeline"

type ProfileFormState = {
  id?: string
  name: string
  description: string
  sourceCaseId: string
}

const emptyFormState = (): ProfileFormState => ({ name: "", description: "", sourceCaseId: "" })

interface ActiveRefresh {
  profileId: string
  targetUrlId: string
  runId: string
  testBaseUrl: string
  run: ExecutionRun | null
}

export function AuthProfilesSection({ controller }: AuthProfilesSectionProps) {
  const {
    busy,
    selectedProject,
    allCases,
    authProfiles,
    saveAuthProfile,
    deleteAuthProfile,
    generateValidationScript,
    refreshAuthProfiles,
    checkLoginStatus,
    refreshAuthProfileState,
    setAuthProfilePostLoginUrl,
    setActiveSection,
  } = controller

  const targetUrls: TargetUrl[] = selectedProject.targetUrls ?? []
  const projectCases = useMemo(() => allCases.filter((c) => c.projectId === selectedProject.id), [allCases, selectedProject.id])

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ProfileFormState>(emptyFormState)

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>("overview")

  // 当前正在操作的 targetUrlId（生成 / 检查 / 刷新 都可能指定）
  const [activeTargetUrlId, setActiveTargetUrlId] = useState<string>("")

  const [activeTask, setActiveTask] = useState<ValidationTask | null>(null)
  const [copiedScript, setCopiedScript] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  const [activeRefresh, setActiveRefresh] = useState<ActiveRefresh | null>(null)
  const refreshEsRef = useRef<EventSource | null>(null)

  // 复杂登录沙盒：用户在服务端真浏览器里亲手登录，保存后写回 storageState。
  const [sandbox, setSandbox] = useState<{ authProfileId: string; targetUrlId: string; targetLabel: string } | null>(null)

  useEffect(() => {
    if (!selectedProfileId && authProfiles.length > 0) {
      setSelectedProfileId(authProfiles[0].id)
    } else if (selectedProfileId && !authProfiles.some((p) => p.id === selectedProfileId)) {
      setSelectedProfileId(authProfiles[0]?.id ?? null)
    }
  }, [authProfiles, selectedProfileId])

  useEffect(() => {
    if (targetUrls.length > 0 && !activeTargetUrlId) {
      setActiveTargetUrlId(targetUrls.find((u) => u.isPrimary)?.id ?? targetUrls[0]?.id ?? "")
    }
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
  }, [activeTask?.status])

  useEffect(() => {
    const status = activeRefresh?.run?.status
    if (!status) return
    const terminal = status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"
    if (terminal) {
      refreshEsRef.current?.close()
      refreshAuthProfiles()
    }
  }, [activeRefresh?.run?.status])

  const selectedProfile = useMemo(
    () => authProfiles.find((p) => p.id === selectedProfileId) ?? null,
    [authProfiles, selectedProfileId],
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
    es.onerror = () => es.close()
  }

  const openCreateForm = () => {
    setForm(emptyFormState())
    setShowForm(true)
  }

  const openEditForm = (profile: AuthProfile) => {
    setForm({
      id: profile.id,
      name: profile.name,
      description: profile.description ?? "",
      sourceCaseId: profile.sourceCaseId,
    })
    setShowForm(true)
  }

  const handleSubmitForm = async () => {
    if (!form.name.trim() || !form.sourceCaseId) return
    await saveAuthProfile({
      id: form.id,
      projectId: selectedProject.id,
      name: form.name.trim(),
      description: form.description.trim(),
      sourceCaseId: form.sourceCaseId,
    })
    setForm(emptyFormState())
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
    es.onerror = () => es.close()
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 pb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground select-none">
          <span className="font-medium">{selectedProject.name}</span>
          <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
          <span className="font-medium text-foreground">登录状态管理</span>
          {selectedProfile ? (
            <>
              <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
              <span className="font-mono bg-secondary/80 text-secondary-foreground px-2 py-0.5 rounded border border-border/40 font-semibold text-[10px]">
                {selectedProfile.name}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
            onClick={() => refreshAuthProfiles()}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            刷新
          </Button>
          <Button
            size="sm"
            className="h-8 px-3 rounded-lg cursor-pointer"
            onClick={() => (showForm ? setShowForm(false) : openCreateForm())}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-sm mr-1">{showForm ? "close" : "add"}</span>
            {showForm ? "取消" : "新建登录态"}
          </Button>
        </div>
      </div>

      {showForm ? (
        <ProfileForm
          form={form}
          setForm={setForm}
          isEditing={Boolean(form.id)}
          cases={projectCases}
          onCancel={() => { setShowForm(false); setForm(emptyFormState()) }}
          onSubmit={handleSubmitForm}
          busy={busy}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr] items-start">
        <ProfileSidebar
          profiles={authProfiles}
          selectedId={selectedProfileId}
          onSelect={setSelectedProfileId}
          onEdit={openEditForm}
        />

        <main className="flex min-h-[480px] flex-col border border-border/80 bg-card/20 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm">
          {!selectedProfile ? (
            <EmptyState
              title="选择一个登录状态"
              description="左侧列表里没有可选项？请先新建一个登录态并绑定来源登录用例，再回来继续。"
            />
          ) : (
            <>
              <Toolbar
                detailTab={detailTab}
                onChangeTab={setDetailTab}
                onGenerate={() => handleGenerate(selectedProfile, activeTargetUrlId)}
                onCheck={() => handleCheck(selectedProfile, activeTargetUrlId)}
                profile={selectedProfile}
                targetUrls={targetUrls}
                activeTargetUrlId={activeTargetUrlId}
                setActiveTargetUrlId={setActiveTargetUrlId}
                generationInProgress={generationInProgress}
                checkInProgress={checkInProgress}
                busy={busy}
              />

              <div className="flex-1 bg-card/10 overflow-hidden">
                {detailTab === "overview" ? (
                  <OverviewPanel
                    profile={selectedProfile}
                    caseLabel={caseLabel}
                    targetUrls={targetUrls}
                    onDelete={() => deleteAuthProfile(selectedProfile.id)}
                    onEdit={() => openEditForm(selectedProfile)}
                    onRefreshState={(targetUrlId) => handleRefreshState(selectedProfile, targetUrlId)}
                    onSetPostLoginUrl={(targetUrlId, value) =>
                      setAuthProfilePostLoginUrl(selectedProfile.id, targetUrlId, value)
                    }
                    onOpenSandbox={(targetUrlId, targetLabel) =>
                      setSandbox({ authProfileId: selectedProfile.id, targetUrlId, targetLabel })
                    }
                    onOpenRuns={() => setActiveSection("runs")}
                    activeRefresh={activeRefresh && activeRefresh.profileId === selectedProfile.id ? activeRefresh : null}
                    busy={busy}
                  />
                ) : null}
                {detailTab === "script" ? (
                  <ScriptPanel
                    profile={selectedProfile}
                    onCopy={handleCopyScript}
                    copied={copiedScript}
                    onGenerate={() => handleGenerate(selectedProfile, activeTargetUrlId)}
                    busy={busy || generationInProgress}
                  />
                ) : null}
                {detailTab === "timeline" ? (
                  <TimelinePanel
                    profile={selectedProfile}
                    task={isTaskForCurrent ? activeTask : null}
                  />
                ) : null}
              </div>
            </>
          )}
        </main>
      </div>

      {sandbox ? (
        <AuthSandboxModal
          projectId={selectedProject.id}
          authProfileId={sandbox.authProfileId}
          targetUrlId={sandbox.targetUrlId}
          targetLabel={sandbox.targetLabel}
          onClose={() => setSandbox(null)}
          onSaved={() => {
            setSandbox(null)
            void refreshAuthProfiles()
          }}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub components
// ---------------------------------------------------------------------------

const inputCls = "block w-full rounded-xl border border-border/60 bg-background/40 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</label>
      {children}
      {hint ? <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{hint}</p> : null}
    </div>
  )
}

function ProfileSidebar({
  profiles,
  selectedId,
  onSelect,
  onEdit,
}: {
  profiles: AuthProfile[]
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (profile: AuthProfile) => void
}) {
  return (
    <aside className="space-y-2 lg:sticky lg:top-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">登录态列表</span>
        <span className="text-[10px] font-mono text-muted-foreground">{profiles.length}</span>
      </div>
      <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
        {profiles.map((profile) => {
          const isActive = profile.id === selectedId
          const hasScript = Boolean(profile.validationScript)
          const hasAnyState = profile.states.some((s) => Boolean(s.storageStateJson))
          return (
            <div
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(profile.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect(profile.id)
                }
              }}
              className={
                isActive
                  ? "w-full text-left rounded-2xl border border-primary/50 bg-primary/10 px-3.5 py-3 transition-all shadow-sm cursor-pointer"
                  : "w-full text-left rounded-2xl border border-border/60 bg-card/50 px-3.5 py-3 transition-all hover:border-border hover:bg-card cursor-pointer"
              }
            >
              <div className="flex items-center justify-between gap-2">
                <strong className={`text-sm truncate ${isActive ? "text-foreground" : "text-foreground/90"}`}>
                  {profile.name}
                </strong>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`size-1.5 rounded-full ${hasAnyState ? "bg-emerald-500" : "bg-rose-500"}`} title={hasAnyState ? "已有 storageState" : "无 storageState"} />
                  <span className={`size-1.5 rounded-full ${hasScript ? "bg-blue-500" : "bg-amber-500"}`} title={hasScript ? "已生成失效校验脚本" : "未生成失效校验脚本"} />
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onEdit(profile) }}
                    className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-secondary/60 transition-colors cursor-pointer"
                    title="编辑配置"
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span>
                  </button>
                </div>
              </div>
              {profile.description ? (
                <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{profile.description}</p>
              ) : null}
              <p className="mt-1 text-[10px] text-muted-foreground font-mono">
                {profile.states.length} 个 URL 状态
              </p>
            </div>
          )
        })}
        {profiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/50 bg-card/30 py-10 text-center">
            <span className="material-symbols-outlined text-3xl opacity-50 text-muted-foreground">account_box</span>
            <p className="mt-2 text-xs text-muted-foreground">暂无登录态，点击右上角新建。</p>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function ProfileForm({
  form,
  setForm,
  isEditing,
  cases,
  onCancel,
  onSubmit,
  busy,
}: {
  form: ProfileFormState
  setForm: (next: ProfileFormState) => void
  isEditing: boolean
  cases: TestCase[]
  onCancel: () => void
  onSubmit: () => void
  busy: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{isEditing ? "编辑登录状态" : "新建登录状态"}</CardTitle>
        <CardDescription>
          来源登录用例是用来"跑出"登录态的脚本；创建后可以在概览里为每个项目 URL 独立刷新登录态。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="配置名称">
            <input
              className={inputCls}
              placeholder="例如：标准登录态"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <FormField label="描述">
            <input
              className={inputCls}
              placeholder="例如：用于执行需要登录的用例"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField label="来源登录用例" hint="用来跑登录流程、采集 storageState 的测试用例">
            <select
              className={inputCls}
              value={form.sourceCaseId}
              onChange={(e) => setForm({ ...form, sourceCaseId: e.target.value })}
            >
              <option value="">选择用例...</option>
              {cases.map((testCase) => (
                <option key={testCase.id} value={testCase.id}>{testCase.caseCode}{testCase.purpose ? ` · ${testCase.purpose}` : ""}</option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg cursor-pointer border border-border/60"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={busy || !form.name.trim() || !form.sourceCaseId}
            className="h-8 rounded-lg cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm mr-1">save</span>
            {isEditing ? "保存修改" : "创建"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Toolbar({
  detailTab,
  onChangeTab,
  onGenerate,
  onCheck,
  profile,
  targetUrls,
  activeTargetUrlId,
  setActiveTargetUrlId,
  generationInProgress,
  checkInProgress,
  busy,
}: {
  detailTab: DetailTab
  onChangeTab: (tab: DetailTab) => void
  onGenerate: () => void
  onCheck: () => void
  profile: AuthProfile
  targetUrls: TargetUrl[]
  activeTargetUrlId: string
  setActiveTargetUrlId: (id: string) => void
  generationInProgress: boolean
  checkInProgress: boolean
  busy: boolean
}) {
  const taskBusy = generationInProgress || checkInProgress
  const activeState = profile.states.find((s) => s.targetUrlId === activeTargetUrlId)
  const canCheck = Boolean(profile.validationScript && activeState?.storageStateJson)
  return (
    <div className="flex flex-wrap items-center gap-3 justify-between border-b border-border bg-secondary/10 px-4 py-2">
      <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-xl border border-border/40">
        <DetailTabButton active={detailTab === "overview"} onClick={() => onChangeTab("overview")}>概览</DetailTabButton>
        <DetailTabButton active={detailTab === "script"} onClick={() => onChangeTab("script")}>失效校验脚本</DetailTabButton>
        <DetailTabButton active={detailTab === "timeline"} onClick={() => onChangeTab("timeline")}>
          执行日志
          {taskBusy ? (
            <span className="ml-1 size-1.5 rounded-full bg-rose-500 animate-pulse inline-block align-middle" />
          ) : null}
        </DetailTabButton>
      </div>

      <div className="flex items-center gap-2">
        <select
          className="h-7 rounded-lg border border-border/60 bg-background/40 px-2 text-[11px] text-foreground"
          value={activeTargetUrlId}
          onChange={(e) => setActiveTargetUrlId(e.target.value)}
        >
          <option value="">选择 URL</option>
          {targetUrls.map((u) => (
            <option key={u.id} value={u.id}>{u.label} · {u.url}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
          onClick={onCheck}
          disabled={busy || !canCheck || taskBusy || !activeTargetUrlId}
        >
          <span className="material-symbols-outlined text-base">policy</span>
          {checkInProgress ? "检查中…" : "检查登录状态"}
        </Button>
        <Button
          size="sm"
          className="h-8 px-3 rounded-lg cursor-pointer"
          onClick={onGenerate}
          disabled={busy || taskBusy || !activeTargetUrlId}
        >
          <span className="material-symbols-outlined text-sm mr-1">smart_toy</span>
          {profile.validationScript ? "重新生成失效条件" : "生成失效条件"}
        </Button>
      </div>
    </div>
  )
}

function DetailTabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer bg-background text-foreground shadow-sm"
          : "px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  )
}

function OverviewPanel({
  profile,
  caseLabel,
  targetUrls,
  onDelete,
  onEdit,
  onRefreshState,
  onSetPostLoginUrl,
  onOpenSandbox,
  onOpenRuns,
  activeRefresh,
  busy,
}: {
  profile: AuthProfile
  caseLabel: string | null
  targetUrls: TargetUrl[]
  onDelete: () => void
  onEdit: () => void
  onRefreshState: (targetUrlId: string) => void
  onSetPostLoginUrl: (targetUrlId: string, value: string | null) => Promise<boolean>
  onOpenSandbox: (targetUrlId: string, targetLabel: string) => void
  onOpenRuns: () => void
  activeRefresh: ActiveRefresh | null
  busy: boolean
}) {
  const hasScript = Boolean(profile.validationScript)
  const stateMap = useMemo(
    () => new Map(profile.states.map((s) => [s.targetUrlId, s])),
    [profile.states],
  )

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold tracking-tight">{profile.name}</h3>
          {profile.description ? (
            <p className="text-sm text-muted-foreground max-w-2xl">{profile.description}</p>
          ) : (
            <p className="text-xs text-muted-foreground/70 italic">未填写描述</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
            onClick={onEdit}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-base">edit</span>
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 cursor-pointer"
            onClick={onDelete}
            disabled={busy}
          >
            <span className="material-symbols-outlined text-base">delete</span>
            删除
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile
          label="来源登录用例"
          tone="default"
          value={caseLabel ?? "未绑定"}
          hint={`profileId · ${profile.id}`}
        />
        <StatusTile
          label="失效校验脚本"
          tone={hasScript ? "info" : "warning"}
          value={hasScript ? "已生成" : "未生成"}
          hint={hasScript ? `生成时间 ${formatDateTime(profile.validationScriptGeneratedAt)}` : "用于在执行前检测登录态是否仍然有效"}
        />
        <StatusTile
          label="URL 状态数"
          tone={profile.states.length > 0 ? "success" : "danger"}
          value={`${profile.states.filter((s) => Boolean(s.storageStateJson)).length} / ${targetUrls.length} 已注入`}
          hint="每个 URL 独立采集和维护 storageState"
        />
      </div>

      {/* Per-TargetUrl state matrix */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground">grid_view</span>
            登录态 × URL 矩阵
          </CardTitle>
          <CardDescription className="text-[11px] leading-relaxed">
            每个项目 URL 对应一份独立的 storageState。点击"刷新"可独立跑来源登录用例采集该 URL 的登录数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {targetUrls.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">项目还没有配置任何 URL，请先在项目设置里添加。</p>
          ) : (
            targetUrls.map((tu) => {
              const state = stateMap.get(tu.id)
              const hasState = Boolean(state?.storageStateJson)
              const isRefreshing = activeRefresh?.targetUrlId === tu.id && activeRefresh.profileId === profile.id
              const refreshRun = isRefreshing ? activeRefresh?.run : null
              const refreshRunning = isRefreshing && (!refreshRun || refreshRun.status === "queued" || refreshRun.status === "running")
              const refreshTerminal = refreshRun && (refreshRun.status === "passed" || refreshRun.status === "failed" || refreshRun.status === "cancelled" || refreshRun.status === "interrupted")

              return (
                <div key={tu.id} className={`rounded-xl border px-4 py-3 ${hasState ? "border-emerald-500/20 bg-emerald-500/5" : "border-border/40 bg-background/40"}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`size-2 rounded-full shrink-0 ${hasState ? "bg-emerald-500" : "bg-rose-500"}`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{tu.label}{tu.isPrimary ? " (主)" : ""}</p>
                        <p className="text-[10px] font-mono text-muted-foreground truncate" title={tu.url}>{tu.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasState ? (
                        <span className="text-[10px] text-muted-foreground">
                          {state!.storageStateSummary ? `${state!.storageStateSummary.cookieCount} cookie · ${state!.storageStateSummary.originCount} origin` : "已注入"}
                          {state!.lastRefreshedAt ? ` · ${formatDateTime(state!.lastRefreshedAt)}` : ""}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">未采集</span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 rounded-lg border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                        onClick={() => onOpenSandbox(tu.id, tu.label)}
                        disabled={busy}
                        title="打开真浏览器手动登录，保存登录态"
                      >
                        <span className="material-symbols-outlined text-sm mr-0.5">login</span>
                        {hasState ? "续期" : "手动登录"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 rounded-lg border border-border/60 hover:bg-secondary/60 text-[11px] cursor-pointer"
                        onClick={() => onRefreshState(tu.id)}
                        disabled={busy || refreshRunning}
                        title="跑来源登录用例自动采集登录态"
                      >
                        <span className="material-symbols-outlined text-sm mr-0.5">play_arrow</span>
                        {refreshRunning ? "刷新中…" : "刷新"}
                      </Button>
                    </div>
                  </div>

                  {/* Refresh status inline */}
                  {isRefreshing ? (
                    <div className="mt-2 rounded-lg border border-border/30 bg-background/40 px-3 py-1.5 text-[11px] space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge tone={
                          refreshRun?.status === "passed" ? "success" :
                            refreshRun?.status === "failed" || refreshRun?.status === "cancelled" || refreshRun?.status === "interrupted" ? "danger" :
                              "warning"
                        }>
                          {runStatusLabel(refreshRun?.status)}
                        </Badge>
                      </div>
                      {refreshTerminal && refreshRun?.status === "passed" ? (
                        <p className="text-emerald-600 dark:text-emerald-400">storageState 已写回</p>
                      ) : refreshTerminal ? (
                        <p className="text-rose-600 dark:text-rose-400">来源登录用例未通过，storageState 未更新</p>
                      ) : null}
                      <button type="button" className="text-primary hover:underline cursor-pointer" onClick={onOpenRuns}>
                        查看详情 →
                      </button>
                    </div>
                  ) : null}

                  {/* Post-login URL editor: 跟 storageState 1:1，回放时优先用它 */}
                  <PostLoginUrlEditor
                    targetUrl={tu.url}
                    state={state}
                    onSubmit={(value) => onSetPostLoginUrl(tu.id, value)}
                    disabled={busy}
                  />

                  {/* Inline storage state summary expandable */}
                  {hasState && state!.storageStateSummary ? (
                    <StorageStateCompact summary={state!.storageStateSummary} />
                  ) : null}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Injection behavior */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-muted-foreground">info</span>
            注入行为约定
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed list-disc list-inside">
            <li>用例执行时，Playwright 用 <span className="font-mono text-foreground">newContext(&#123;storageState&#125;)</span> 整体注入：<strong className="text-foreground">全部 cookie 和 origin 的 localStorage 会被替换覆盖</strong>。</li>
            <li>注入完成后浏览器首跳到<strong className="text-foreground">"登录后 URL"</strong>（若未配置则回退到 targetUrl 根域名），脚本看到的是用户登录完成后的真实落地页。</li>
            <li>"登录后 URL"在刷新登录态时自动采集（取来源测试集跑完后浏览器停留的页面）；也可以在下方手动覆盖，刷新不会冲掉手改。</li>
            <li>每个 URL 的 storageState 和登录后 URL 都独立维护，刷新一个不会影响其他 URL 的数据。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function PostLoginUrlEditor({
  targetUrl,
  state,
  onSubmit,
  disabled,
}: {
  targetUrl: string
  state: AuthProfileState | undefined
  onSubmit: (value: string | null) => Promise<boolean>
  disabled: boolean
}) {
  const effective = state?.postLoginUrl
  const autoValue = state?.postLoginUrlAuto
  const overrideValue = state?.postLoginUrlOverride
  const isOverridden = Boolean(overrideValue && overrideValue.trim())

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(effective ?? "")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(effective ?? "")
  }, [effective, editing])

  const handleSave = async () => {
    const trimmed = draft.trim()
    setSaving(true)
    const ok = await onSubmit(trimmed === "" ? null : trimmed)
    setSaving(false)
    if (ok) setEditing(false)
  }

  const handleResetAuto = async () => {
    setSaving(true)
    const ok = await onSubmit(null)
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <div className="mt-2 rounded-lg border border-border/30 bg-background/40 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="material-symbols-outlined text-[14px] text-muted-foreground shrink-0">my_location</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">登录后 URL</span>
          {effective ? (
            isOverridden ? (
              <Badge tone="info">手动</Badge>
            ) : (
              <Badge tone="default">自动</Badge>
            )
          ) : (
            <Badge tone="warning">未设置</Badge>
          )}
        </div>
        {!editing ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="text-[10px] text-primary hover:underline cursor-pointer disabled:opacity-50"
              onClick={() => setEditing(true)}
              disabled={disabled || saving}
            >
              {effective ? "改写" : "设置"}
            </button>
            {isOverridden ? (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer ml-1 disabled:opacity-50"
                onClick={handleResetAuto}
                disabled={disabled || saving}
                title={autoValue ? `回退到自动采集值：${autoValue}` : "清除手动覆盖（当前没有自动采集值）"}
              >
                {saving ? "重置中…" : "重置为自动"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!editing ? (
        <p className="mt-0.5 text-[11px] font-mono text-foreground/90 break-all leading-relaxed" title={effective ?? `未设置时回退到 ${targetUrl}`}>
          {effective ?? <span className="text-muted-foreground italic">未设置 · 回放将回退到 {targetUrl}</span>}
        </p>
      ) : (
        <div className="mt-1 space-y-1.5">
          <input
            className="block w-full rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-[11px] font-mono text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"
            placeholder={autoValue ?? targetUrl}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            autoFocus
          />
          {autoValue && draft !== autoValue ? (
            <p className="text-[10px] text-muted-foreground leading-tight">
              自动采集值：<span className="font-mono">{autoValue}</span>
              <button
                type="button"
                className="ml-1 text-primary hover:underline cursor-pointer"
                onClick={() => setDraft(autoValue)}
                disabled={saving}
              >
                填回
              </button>
            </p>
          ) : null}
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded border border-border/60 hover:bg-secondary/60 cursor-pointer disabled:opacity-50"
              onClick={() => { setEditing(false); setDraft(effective ?? "") }}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90 cursor-pointer disabled:opacity-50"
              onClick={handleSave}
              disabled={saving || draft.trim() === (effective ?? "")}
            >
              {saving ? "保存中…" : (draft.trim() === "" ? "清除覆盖" : "保存为手动覆盖")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StorageStateCompact({ summary }: { summary: StorageStateSummary }) {
  const [expanded, setExpanded] = useState(false)
  if (summary.cookieCount === 0 && summary.originCount === 0) return null
  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="material-symbols-outlined text-[12px]">{expanded ? "expand_less" : "expand_more"}</span>
        {expanded ? "收起" : "展开"} StorageState 详情
      </button>
      {expanded ? (
        <div className="mt-1.5 space-y-2 pl-2 border-l-2 border-border/40">
          {summary.cookies.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Cookies ({summary.cookieCount})</p>
              <div className="max-h-36 overflow-auto rounded-lg border border-border/40 bg-background/40">
                <table className="w-full text-[10px]">
                  <thead className="bg-secondary/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-0.5 text-left font-medium">名称</th>
                      <th className="px-2 py-0.5 text-left font-medium">域</th>
                      <th className="px-2 py-0.5 text-left font-medium">过期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.cookies.map((cookie) => (
                      <tr key={`${cookie.domain}-${cookie.name}`} className="border-t border-border/30">
                        <td className="px-2 py-0.5 font-mono text-foreground truncate max-w-[140px]" title={cookie.name}>{cookie.name}</td>
                        <td className="px-2 py-0.5 font-mono text-muted-foreground truncate max-w-[140px]" title={cookie.domain}>{cookie.domain}</td>
                        <td className="px-2 py-0.5 text-muted-foreground">{formatCookieExpires(cookie.expires)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {summary.origins.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">localStorage ({summary.originCount})</p>
              {summary.origins.map((origin) => (
                <div key={origin.origin} className="rounded-lg border border-border/40 bg-background/40 px-2 py-1 text-[10px] mb-1">
                  <p className="font-mono text-foreground">{origin.origin}</p>
                  <p className="text-muted-foreground">{origin.localStorageKeys.length} keys{origin.localStorageKeys.length > 0 ? `: ${origin.localStorageKeys.slice(0, 5).join(", ")}${origin.localStorageKeys.length > 5 ? "…" : ""}` : ""}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function runStatusLabel(status?: string) {
  switch (status) {
    case "queued": return "排队中"
    case "running": return "执行中"
    case "paused": return "已暂停"
    case "cancelling": return "取消中"
    case "cancelled": return "已取消"
    case "interrupted": return "已中断"
    case "passed": return "已完成"
    case "failed": return "失败"
    default: return "启动中"
  }
}

function formatCookieExpires(expires?: number) {
  if (expires === undefined || expires < 0) return "Session"
  try {
    return new Date(expires * 1000).toLocaleString()
  } catch {
    return "-"
  }
}

function StatusTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone: "success" | "danger" | "warning" | "info" | "default"
}) {
  const toneClass: Record<typeof tone, string> = {
    success: "border-emerald-500/30 bg-emerald-500/5",
    danger: "border-rose-500/30 bg-rose-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    info: "border-blue-500/30 bg-blue-500/5",
    default: "border-border bg-card/40",
  }
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground truncate" title={value}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{hint}</p> : null}
    </div>
  )
}

function ScriptPanel({
  profile,
  onCopy,
  copied,
  onGenerate,
  busy,
}: {
  profile: AuthProfile
  onCopy: () => void
  copied: boolean
  onGenerate: () => void
  busy: boolean
}) {
  if (!profile.validationScript) {
    return (
      <div className="p-6">
        <EmptyState
          title="尚未生成失效条件脚本"
          description="点击右上角『生成失效条件』，AI 会基于「登录态浏览器」和「匿名浏览器」对同一 URL 的实际差异自动产出 Playwright 校验脚本，并通过双向回归后才落库。"
          actionLabel={busy ? "生成中…" : "立即生成"}
          onAction={busy ? undefined : onGenerate}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2 bg-secondary/20">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="material-symbols-outlined text-base">javascript</span>
          <span>Playwright 校验脚本</span>
          {profile.validationScriptGeneratedAt ? (
            <Badge tone="default">{formatDateTime(profile.validationScriptGeneratedAt)}</Badge>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 rounded-lg border border-border/60 hover:bg-secondary/60 text-xs flex items-center gap-1 cursor-pointer"
          onClick={onCopy}
        >
          <span className="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
          {copied ? "已复制" : "复制脚本"}
        </Button>
      </div>
      <pre className="flex-1 m-0 p-4 text-[12px] leading-relaxed font-mono text-foreground/90 bg-background/40 overflow-auto whitespace-pre-wrap break-all">
        {profile.validationScript}
      </pre>
    </div>
  )
}

function TimelinePanel({ profile, task }: { profile: AuthProfile; task: ValidationTask | null }) {
  if (!task) {
    return (
      <div className="p-6">
        <EmptyState
          title="暂无执行日志"
          description={
            profile.validationScript
              ? "上一次生成结果已落库到『失效校验脚本』标签页。再次点击『生成』或『检查登录状态』时，这里会实时展示每一步过程。"
              : "点击右上角『生成失效条件』开始，AI 会在这里逐步展示双对照采集 → LLM → 验证回归 → 落库的执行过程。"
          }
        />
      </div>
    )
  }

  const titleByKind = task.kind === "check" ? "登录状态重放" : "失效校验脚本生成"

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-foreground">{titleByKind}</h4>
          <Badge tone={task.status === "completed" ? "success" : task.status === "error" ? "danger" : "warning"}>
            {task.status === "running" ? "执行中" : task.status === "completed" ? "已完成" : "失败"}
          </Badge>
          {task.kind === "check" && task.checkResult ? (
            <Badge tone={task.checkResult.valid ? "success" : "danger"}>
              {task.checkResult.valid ? "登录有效" : "登录无效"}
            </Badge>
          ) : null}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px]" title={task.id}>{task.id}</span>
      </div>

      <ol className="space-y-3">
        {task.steps.map((step, idx) => (
          <TimelineStep key={`${idx}-${step.label}`} step={step} isLast={idx === task.steps.length - 1} />
        ))}
        {task.steps.length === 0 ? (
          <li className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="size-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            正在启动…
          </li>
        ) : null}
      </ol>

      {task.status === "error" && task.error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-3 py-2">
          <p className="text-xs font-medium text-rose-700 dark:text-rose-300">任务终止</p>
          <p className="mt-1 text-[11px] font-mono text-rose-600 dark:text-rose-400 break-all">{task.error}</p>
        </div>
      ) : null}
    </div>
  )
}

const STEP_ICON: Record<NonNullable<ValidationProgressStep["kind"]>, string> = {
  init: "settings",
  browser: "open_in_browser",
  navigate: "explore",
  snapshot: "filter_center_focus",
  llm: "smart_toy",
  verify: "rule",
  save: "save",
  result: "flag",
}

function TimelineStep({ step, isLast }: { step: ValidationProgressStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(step.status === "error" || step.status === "running")
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const dotClass = step.status === "done"
    ? "bg-emerald-500"
    : step.status === "error"
      ? "bg-rose-500"
      : step.status === "skipped"
        ? "bg-muted-foreground"
        : "bg-indigo-500 animate-pulse"
  const textClass = step.status === "error" ? "text-rose-600 dark:text-rose-400" : "text-foreground"
  const icon = step.kind ? STEP_ICON[step.kind] : "circle"
  const hasExpandable = Boolean(step.detail || step.codePreview || step.screenshotUrl || step.metaJson)

  return (
    <li className="relative flex gap-3">
      {!isLast ? <div className="absolute left-[11px] top-6 bottom-[-12px] w-[2px] rounded-full bg-border/70" /> : null}
      <div className="relative z-10 flex flex-col items-center mt-0.5">
        <div className={`flex items-center justify-center size-6 rounded-full bg-background border-2 ${step.status === "running" ? "border-indigo-500" : "border-border"}`}>
          <div className={`size-2.5 rounded-full ${dotClass}`} />
        </div>
      </div>
      <div className="flex-1 rounded-xl border border-border/60 bg-card/60 px-3 py-2">
        <div
          className={`flex items-center justify-between gap-2 ${hasExpandable ? "cursor-pointer" : ""}`}
          onClick={() => hasExpandable && setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-base text-muted-foreground shrink-0">{icon}</span>
            <span className={`text-xs font-medium truncate ${textClass}`}>{step.label}</span>
            {step.iteration ? (
              <span className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded shrink-0">#{step.iteration}</span>
            ) : null}
          </div>
          {hasExpandable ? (
            <span className="material-symbols-outlined text-sm text-muted-foreground shrink-0">{expanded ? "expand_less" : "expand_more"}</span>
          ) : null}
        </div>

        {expanded && hasExpandable ? (
          <div className="mt-2 space-y-2">
            {step.detail ? (
              <p className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all ${step.status === "error" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
                {step.detail}
              </p>
            ) : null}
            {step.screenshotUrl ? (
              <div
                className="rounded-xl overflow-hidden border border-border/40 bg-black/40 max-w-md cursor-zoom-in group"
                onClick={(e) => {
                  e.stopPropagation()
                  setLightboxUrl(step.screenshotUrl!)
                }}
              >
                <img src={step.screenshotUrl} alt={step.label} className="w-full h-auto max-h-64 object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
              </div>
            ) : null}
            {step.codePreview ? (
              <pre className="text-[11px] font-mono leading-relaxed text-foreground/90 bg-background/60 border border-border/40 rounded-lg p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {step.codePreview}
              </pre>
            ) : null}
            {step.metaJson ? (
              <details className="text-[11px] font-mono text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground select-none">meta</summary>
                <pre className="mt-1 p-2 bg-background/40 border border-border/30 rounded leading-relaxed whitespace-pre-wrap break-all">{step.metaJson}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur p-6 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="screenshot" className="max-w-full max-h-full rounded-2xl shadow-2xl" />
        </div>
      ) : null}
    </li>
  )
}
