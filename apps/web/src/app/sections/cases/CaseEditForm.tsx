import type { CaseDetailsProps } from "./types"
import type { TestCase } from "@autovis/shared"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { Field, inputClassName, textareaClassName } from "../../components/ui/field"
import { t } from "../../../i18n/index.js"

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
    <div className="space-y-6">
      <div className="pb-4 border-b border-border/40">
        <h3 className="text-xl font-bold tracking-tight text-foreground">{selectedCase ? t("cases.editCaseTitle", { code: selectedCase.caseCode }) : t("cases.createCaseTitle")}</h3>
        <p className="text-sm text-muted-foreground mt-2">{t("cases.editFormDesc")}</p>
      </div>
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("cases.caseCodeLabel")}>
            <input className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, caseCode: event.target.value }))} value={caseForm.caseCode} />
          </Field>
          <Field label={t("cases.moduleOptionalLabel")}>
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
                <option value="">{t("cases.selectModule")}</option>
                {modules.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            ) : (
              <input className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, moduleName: event.target.value }))} placeholder={t("cases.createModuleFirst")} value={caseForm.moduleName ?? ""} />
            )}
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("cases.testType")}>
            <select className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, testType: event.target.value as TestCase["testType"] }))} value={caseForm.testType}>
              <option value="functional">{t("cases.testTypeFunctional")}</option>
              <option value="regression">{t("cases.testTypeRegression")}</option>
              <option value="smoke">{t("cases.testTypeSmoke")}</option>
            </select>
          </Field>
          <Field label="Bug ID">
            <input className={inputClassName} onChange={(event) => setCaseForm((current) => ({ ...current, bugId: event.target.value }))} placeholder={t("cases.bugIdPlaceholder")} value={caseForm.bugId ?? ""} />
          </Field>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 cursor-pointer"
            checked={Boolean(caseForm.apiIntended)}
            onChange={(event) => setCaseForm((current) => ({ ...current, apiIntended: event.target.checked }))}
          />
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">{t("cases.apiIntended")}</div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("cases.apiIntendedFormDesc")}
            </p>
          </div>
        </label>

        <Field label={t("cases.authProfileLabel")}>
          <select
            className={inputClassName}
            onChange={(event) => setCaseForm((current) => ({ ...current, authProfileId: event.target.value || undefined }))}
            value={caseForm.authProfileId ?? ""}
          >
            <option value="">{t("cases.noAuthProfile")}</option>
            {authProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} {profile.states?.some((s) => Boolean(s.storageStateJson)) ? t("cases.authProfileReady") : t("cases.authProfileNeedsLogin")}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {t("cases.authProfileHint")}
          </p>
        </Field>

        <Field label={t("cases.targetUrlLabel")}>
          <select
            className={inputClassName}
            onChange={(event) => setCaseForm((current) => ({ ...current, defaultTargetUrlId: event.target.value || undefined }))}
            value={caseForm.defaultTargetUrlId ?? ""}
          >
            <option value="">{t("cases.followProjectDefault")}</option>
            {controller.selectedProject?.targetUrls?.map((targetUrl) => (
              <option key={targetUrl.id} value={targetUrl.id}>
                {targetUrl.label} ({targetUrl.url})
              </option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {t("cases.targetUrlHint")}
          </p>
        </Field>

        <Field label={t("cases.purpose")}>
          <textarea className={textareaClassName} onChange={(event) => setCaseForm((current) => ({ ...current, purpose: event.target.value }))} value={caseForm.purpose ?? ""} />
        </Field>

        <Field label={t("cases.dependencyLabel")}>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("cases.dependencyHint")}</p>
            {dependencyCaseIds.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-secondary/20 px-4 py-3 text-xs text-muted-foreground">
                {t("cases.noDependencySelected")}
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
                        <p className="truncate text-xs text-muted-foreground">{item ? (item.purpose || item.expectedResult || t("cases.noDescription")) : t("cases.caseUnavailable")}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          aria-label={t("cases.moveDependencyUp")}
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
                          aria-label={t("cases.moveDependencyDown")}
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
                          aria-label={t("cases.removeDependency")}
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
              <option value="">{availableToAdd.length === 0 ? t("cases.noMoreCasesToAdd") : t("cases.addDependency")}</option>
              {availableToAdd.map((item) => {
                const project = projects.find((entry) => entry.id === item.projectId)
                return (
                  <option key={item.id} value={item.id}>
                    {item.caseCode} {project ? `[${project.name}]` : ""} - {item.purpose || item.expectedResult || t("cases.noDescription")}
                  </option>
                )
              })}
            </select>
          </div>
        </Field>

        <Field label={t("cases.stepsLabel")}>
          <textarea className={textareaClassName} onChange={(event) => setCaseForm((current) => ({ ...current, steps: event.target.value.split("\n") }))} value={caseForm.steps.join("\n")} />
        </Field>

        <Field label={t("cases.expectedResult")}>
          <textarea className={textareaClassName} onChange={(event) => setCaseForm((current) => ({ ...current, expectedResult: event.target.value }))} value={caseForm.expectedResult} />
        </Field>

        <Field label={t("cases.noteLabel")}>
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
            {t("cases.cancel")}
          </Button>
          {selectedCase && (
            <Button
              disabled={busy}
              onClick={() => handleDeleteCase(selectedCase.id)}
              variant="ghost"
              className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-500/10"
            >
              <span className="material-symbols-outlined text-base">delete</span>
              {t("cases.deleteCase")}
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
            {t("cases.saveCase")}
          </Button>
        </div>
      </div>
    </div>
  )
}
