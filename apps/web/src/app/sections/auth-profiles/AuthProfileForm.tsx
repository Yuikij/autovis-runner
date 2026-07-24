import { useState, useEffect } from "react"
import type { TestCase, AuthProfile } from "@autovis/shared"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { t } from "../../../i18n/index.js"
import type { ProfileFormState } from "./useAuthProfilesState"

const inputCls = "block w-full rounded-xl border border-border/60 bg-background/40 px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"

export function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</label>
      {children}
      {hint ? <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{hint}</p> : null}
    </div>
  )
}

export function AuthProfileForm({
  editingProfile,
  cases,
  profiles,
  onCancel,
  onSubmit,
}: {
  editingProfile: AuthProfile | null
  cases: TestCase[]
  /** 项目内全部登录态，用于"前置登录态"多选（会自动排除正在编辑的这个）。 */
  profiles: AuthProfile[]
  onCancel: () => void
  onSubmit: (form: ProfileFormState) => Promise<void>
}) {
  const isEditing = Boolean(editingProfile)
  const [form, setForm] = useState<ProfileFormState>({ name: "", description: "", sourceCaseId: "", usePersistentProfile: true, prerequisiteAuthProfileIds: [] })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Initialize form state when editingProfile changes
  useEffect(() => {
    if (editingProfile) {
      setForm({
        id: editingProfile.id,
        name: editingProfile.name,
        description: editingProfile.description ?? "",
        sourceCaseId: editingProfile.sourceCaseId,
        usePersistentProfile: editingProfile.usePersistentProfile ?? true,
        prerequisiteAuthProfileIds: editingProfile.prerequisiteAuthProfileIds ?? [],
      })
    } else {
      setForm({ name: "", description: "", sourceCaseId: "", usePersistentProfile: true, prerequisiteAuthProfileIds: [] })
    }
  }, [editingProfile])

  const prerequisiteCandidates = profiles.filter((profile) => profile.id !== editingProfile?.id)

  const togglePrerequisite = (profileId: string) => {
    setForm((current) => ({
      ...current,
      prerequisiteAuthProfileIds: current.prerequisiteAuthProfileIds.includes(profileId)
        ? current.prerequisiteAuthProfileIds.filter((id) => id !== profileId)
        : [...current.prerequisiteAuthProfileIds, profileId],
    }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.sourceCaseId) return
    setIsSubmitting(true)
    try {
      await onSubmit(form)
    } finally {
      setIsSubmitting(false)
    }
  }

  const busy = isSubmitting

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{isEditing ? t("auth.formTitleEdit") : t("auth.formTitleCreate")}</CardTitle>
        <CardDescription>
          {t("auth.formDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("auth.fieldName")}>
            <input
              className={inputCls}
              placeholder={t("auth.fieldNamePlaceholder")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={busy}
            />
          </FormField>
          <FormField label={t("auth.fieldDescription")}>
            <input
              className={inputCls}
              placeholder={t("auth.fieldDescriptionPlaceholder")}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              disabled={busy}
            />
          </FormField>
          <FormField label={t("auth.sourceCase")} hint={t("auth.fieldSourceCaseHint")}>
            <select
              className={inputCls}
              value={form.sourceCaseId}
              onChange={(e) => setForm({ ...form, sourceCaseId: e.target.value })}
              disabled={busy}
            >
              <option value="">{t("auth.selectCasePlaceholder")}</option>
              {cases.map((testCase) => (
                <option key={testCase.id} value={testCase.id}>{testCase.caseCode}{testCase.purpose ? ` · ${testCase.purpose}` : ""}</option>
              ))}
            </select>
          </FormField>
          {prerequisiteCandidates.length > 0 ? (
            <div className="sm:col-span-2">
              <FormField
                label={t("auth.fieldPrerequisites")}
                hint={t("auth.fieldPrerequisitesHint")}
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                  {prerequisiteCandidates.map((profile) => (
                    <label key={profile.id} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded border-border/60 accent-primary cursor-pointer"
                        checked={form.prerequisiteAuthProfileIds.includes(profile.id)}
                        onChange={() => togglePrerequisite(profile.id)}
                        disabled={busy}
                      />
                      <span className="text-xs text-foreground">{profile.name}</span>
                    </label>
                  ))}
                </div>
              </FormField>
            </div>
          ) : null}
          <div className="space-y-1.5 sm:col-span-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border/60 accent-primary cursor-pointer"
                checked={form.usePersistentProfile}
                onChange={(e) => setForm({ ...form, usePersistentProfile: e.target.checked })}
                disabled={busy}
              />
              <span className="text-xs text-foreground">{t("auth.persistentProfileLabel")}</span>
            </label>
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
              {t("auth.persistentProfileHint")}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg cursor-pointer border border-border/60"
            onClick={onCancel}
            disabled={busy}
          >
            {t("auth.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={busy || !form.name.trim() || !form.sourceCaseId}
            className="h-8 rounded-lg cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm mr-1">save</span>
            {busy ? t("auth.formSaving") : (isEditing ? t("auth.saveChanges") : t("auth.create"))}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
