import { useState, useEffect } from "react"
import type { TestCase, AuthProfile } from "@autovis/shared"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
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
  onCancel,
  onSubmit,
}: {
  editingProfile: AuthProfile | null
  cases: TestCase[]
  onCancel: () => void
  onSubmit: (form: ProfileFormState) => Promise<void>
}) {
  const isEditing = Boolean(editingProfile)
  const [form, setForm] = useState<ProfileFormState>({ name: "", description: "", sourceCaseId: "" })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Initialize form state when editingProfile changes
  useEffect(() => {
    if (editingProfile) {
      setForm({
        id: editingProfile.id,
        name: editingProfile.name,
        description: editingProfile.description ?? "",
        sourceCaseId: editingProfile.sourceCaseId,
      })
    } else {
      setForm({ name: "", description: "", sourceCaseId: "" })
    }
  }, [editingProfile])

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
              disabled={busy}
            />
          </FormField>
          <FormField label="描述">
            <input
              className={inputCls}
              placeholder="例如：用于执行需要登录的用例"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              disabled={busy}
            />
          </FormField>
          <FormField label="来源登录用例" hint="用来跑登录流程、采集 storageState 的测试用例">
            <select
              className={inputCls}
              value={form.sourceCaseId}
              onChange={(e) => setForm({ ...form, sourceCaseId: e.target.value })}
              disabled={busy}
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
            onClick={handleSubmit}
            disabled={busy || !form.name.trim() || !form.sourceCaseId}
            className="h-8 rounded-lg cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm mr-1">save</span>
            {busy ? "保存中..." : (isEditing ? "保存修改" : "创建")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
