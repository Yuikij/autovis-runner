import type { CaseDetailsProps } from "./types"
import type { TestCase } from "@autovis/shared"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { Field, inputClassName, textareaClassName } from "../../components/ui/field"

function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

export function CaseEditForm(props: CaseDetailsProps) {
  const { controller, isEditing, setIsEditing, handleDeleteCase } = props
  const {
    selectedCase,
    testCases,
    setSelectedCaseId,
    caseForm,
    setCaseForm,
    modules,
    dependencyCaseCandidates,
    projects,
    busy,
    saveTestCase,
    authProfiles,
  } = controller

  if (!isEditing) return null

  const dependencyCaseIds = caseForm.dependencyCaseIds
  const dependencyItems = dependencyCaseIds.map((id) => dependencyCaseCandidates.find((item) => item.id === id) ?? null)
  const availableToAdd = dependencyCaseCandidates.filter((item) => !dependencyCaseIds.includes(item.id))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{selectedCase ? `编辑用例 ${selectedCase.caseCode}` : "创建测试用例"}</CardTitle>
        <CardDescription>设计测试用例与有序前置用例，并为后续脚本生成与验证提供上下文。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="用例编号">
            <input className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, caseCode: event.target.value }))} value={caseForm.caseCode} />
          </Field>
          <Field label="模块（选填）">
            {modules.length > 0 ? (
              <select
                className={inputClassName}
                onChange={(event) => {
                  const nextModule = modules.find((item) => item.id === event.target.value)
                  setCaseForm((current) => ({
                    ...current,
                    moduleId: event.target.value,
                    moduleName: nextModule?.name ?? current.moduleName,
                  }))
                }}
                value={caseForm.moduleId ?? ""}
              >
                <option value="">选择模块...</option>
                {modules.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            ) : (
              <input className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, moduleName: event.target.value }))} placeholder="请先在项目中创建模块" value={caseForm.moduleName ?? ""} />
            )}
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="测试类型">
            <select className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, testType: event.target.value as TestCase["testType"] }))} value={caseForm.testType}>
              <option value="functional">功能测试</option>
              <option value="regression">回归测试</option>
              <option value="smoke">冒烟测试</option>
            </select>
          </Field>
          <Field label="Bug ID">
            <input className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, bugId: event.target.value }))} placeholder="例: #BUG-101" value={caseForm.bugId ?? ""} />
          </Field>
        </div>

        <Field label="执行鉴权态 (可选)">
          <select
            className={inputClassName}
            onChange={(event) => setCaseForm((current) => ({ ...current, authProfileId: event.target.value || undefined }))}
            value={caseForm.authProfileId ?? ""}
          >
            <option value="">不指派鉴权配置（或不需登录）</option>
            {authProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} {profile.states?.some((s) => Boolean(s.storageStateJson)) ? "✅(已有状态)" : "❌(需登录)"}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            如执行此用例需要登录态，请指派相关鉴权配置。若所选配置无状态，系统会尝试自动调用它的来源登录用例。
          </p>
        </Field>

        <Field label="测试目的">
          <textarea className={textareaClassName} onChange={(event) => setCaseForm((current) => ({ ...current, purpose: event.target.value }))} value={caseForm.purpose ?? ""} />
        </Field>

        <Field label="前置用例（按顺序执行）">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">执行本用例前会按下面的顺序依次先跑这些用例（用于登录 / 造数据等可复用前置）。</p>
            {dependencyCaseIds.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-secondary/20 px-4 py-3 text-xs text-muted-foreground">
                暂未选择前置用例。
              </div>
            ) : (
              <div className="space-y-2">
                {dependencyCaseIds.map((id, index) => {
                  const item = dependencyItems[index]
                  const project = item ? projects.find((entry) => entry.id === item.projectId) : undefined
                  return (
                    <div key={id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/20 p-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-background text-xs font-semibold text-muted-foreground">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{item ? item.caseCode : id} {project ? `[${project.name}]` : ""}</p>
                        <p className="truncate text-xs text-muted-foreground">{item ? (item.purpose || item.expectedResult || "未填写说明") : "用例不存在或不可用"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          aria-label="上移前置用例"
                          className="h-8 w-8 px-0"
                          disabled={index === 0}
                          onClick={() => setCaseForm((current) => ({ ...current, dependencyCaseIds: moveItem(current.dependencyCaseIds, index, -1) }))}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <span className="material-symbols-outlined text-base">keyboard_arrow_up</span>
                        </Button>
                        <Button
                          aria-label="下移前置用例"
                          className="h-8 w-8 px-0"
                          disabled={index === dependencyCaseIds.length - 1}
                          onClick={() => setCaseForm((current) => ({ ...current, dependencyCaseIds: moveItem(current.dependencyCaseIds, index, 1) }))}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <span className="material-symbols-outlined text-base">keyboard_arrow_down</span>
                        </Button>
                        <Button
                          aria-label="移除前置用例"
                          className="h-8 w-8 px-0 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                          onClick={() => setCaseForm((current) => ({ ...current, dependencyCaseIds: current.dependencyCaseIds.filter((depId) => depId !== id) }))}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <span className="material-symbols-outlined text-base">close</span>
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <select
              className={inputClassName}
              value=""
              onChange={(event) => {
                const id = event.target.value
                if (!id) return
                setCaseForm((current) => ({
                  ...current,
                  dependencyCaseIds: current.dependencyCaseIds.includes(id)
                    ? current.dependencyCaseIds
                    : [...current.dependencyCaseIds, id],
                }))
              }}
              disabled={availableToAdd.length === 0}
            >
              <option value="">{availableToAdd.length === 0 ? "没有更多可添加的用例" : "添加前置用例..."}</option>
              {availableToAdd.map((item) => {
                const project = projects.find((entry) => entry.id === item.projectId)
                return (
                  <option key={item.id} value={item.id}>
                    {item.caseCode} {project ? `[${project.name}]` : ""} - {item.purpose || item.expectedResult || "未填写说明"}
                  </option>
                )
              })}
            </select>
          </div>
        </Field>

        <Field label="操作步骤（每行一条）">
          <textarea className={textareaClassName} onChange={(event) => setCaseForm((current) => ({ ...current, steps: event.target.value.split("\n") }))} value={caseForm.steps.join("\n")} />
        </Field>

        <Field label="预期结果">
          <textarea className={textareaClassName} onChange={(event) => setCaseForm((current) => ({ ...current, expectedResult: event.target.value }))} value={caseForm.expectedResult} />
        </Field>

        <Field label="备注">
          <textarea className={textareaClassName} onChange={(event) => setCaseForm((current) => ({ ...current, note: event.target.value }))} value={caseForm.note ?? ""} />
        </Field>

        <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-border/40">
          <Button
            onClick={() => {
              if (selectedCase) {
                setIsEditing(false)
              } else if (testCases.length > 0) {
                setSelectedCaseId(testCases[0].id)
                setIsEditing(false)
              } else {
                setSelectedCaseId(null)
                setIsEditing(false)
              }
            }}
            variant="ghost"
            disabled={busy}
          >
            取消
          </Button>
          {selectedCase && (
            <Button
              disabled={busy}
              onClick={() => handleDeleteCase(selectedCase.id)}
              variant="ghost"
              className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-500/10"
            >
              <span className="material-symbols-outlined text-base">delete</span>
              删除用例
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={async () => {
              const ok = await saveTestCase()
              if (ok) {
                setIsEditing(false)
              }
            }}
          >
            <span className="material-symbols-outlined text-base">save</span>
            保存用例
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
