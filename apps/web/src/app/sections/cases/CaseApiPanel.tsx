import { useCallback, useEffect, useState } from "react"
import type { CaseContract, ContractField, TestCase, TargetUrl } from "@autovis/shared"
import { apiBase } from "../../constants"
import { apiRoutes } from "../../apiRoutes"
import { request } from "../../api"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { inputClassName } from "../../components/ui/field"

interface ContractDoc {
  testCaseId: string
  caseCode: string
  purpose: string
  apiIntended: boolean
  apiEnabled: boolean
  hasScript: boolean
  contract?: CaseContract
  paramsSchema?: Record<string, unknown>
  responseSchema?: Record<string, unknown>
  invokeUrl: string
}

interface InvokeResult {
  ok: boolean
  runId?: string
  status: string
  result?: Record<string, unknown>
  errors?: string[]
}

const FIELD_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const

const emptyField = (): ContractField => ({ name: "", type: "string" })

const parseDefault = (raw: string): unknown => {
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

const stringifyDefault = (value: unknown): string => {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function FieldEditor({
  title,
  fields,
  onChange,
}: {
  title: string
  fields: ContractField[]
  onChange: (next: ContractField[]) => void
}) {
  const update = (index: number, patch: Partial<ContractField>) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{title}</h4>
        <Button size="sm" variant="ghost" onClick={() => onChange([...fields, emptyField()])}>
          <span className="material-symbols-outlined text-sm">add</span>
          添加字段
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1 py-3 border border-dashed border-border/50 rounded-lg text-center">
          暂无字段
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={index} className="rounded-xl border border-border/60 bg-secondary/10 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputClassName} h-8 text-xs font-mono flex-1 min-w-[120px]`}
                  placeholder="字段名"
                  value={field.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
                <select
                  className={`${inputClassName} h-8 text-xs w-[90px]`}
                  value={field.type}
                  onChange={(e) => update(index, { type: e.target.value as ContractField["type"] })}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {field.type === "array" && (
                  <select
                    className={`${inputClassName} h-8 text-xs w-[90px]`}
                    value={field.items?.type ?? "string"}
                    onChange={(e) => update(index, { items: { type: e.target.value as ContractField["type"] } })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        元素:{t}
                      </option>
                    ))}
                  </select>
                )}
                <label className="flex items-center gap-1 text-xs text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    className="size-3.5"
                    checked={Boolean(field.required)}
                    onChange={(e) => update(index, { required: e.target.checked })}
                  />
                  必填
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-rose-500 hover:text-rose-600 ml-auto"
                  onClick={() => onChange(fields.filter((_, i) => i !== index))}
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputClassName} h-8 text-xs flex-1 min-w-[160px]`}
                  placeholder="说明（描述这个字段的用途）"
                  value={field.description ?? ""}
                  onChange={(e) => update(index, { description: e.target.value || undefined })}
                />
                <input
                  className={`${inputClassName} h-8 text-xs w-[120px]`}
                  placeholder="format（如 uri）"
                  value={field.format ?? ""}
                  onChange={(e) => update(index, { format: e.target.value || undefined })}
                />
                <input
                  className={`${inputClassName} h-8 text-xs w-[140px]`}
                  placeholder="默认值"
                  value={stringifyDefault(field.default)}
                  onChange={(e) => update(index, { default: parseDefault(e.target.value) })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CaseApiPanel({ selectedCase, targetUrls }: { selectedCase: TestCase; targetUrls: TargetUrl[] }) {
  const testCaseId = selectedCase.id
  const [doc, setDoc] = useState<ContractDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [generating, setGenerating] = useState(false)

  const [params, setParams] = useState<ContractField[]>([])
  const [response, setResponse] = useState<ContractField[]>([])
  const [maxConcurrency, setMaxConcurrency] = useState(1)
  const [apiEnabled, setApiEnabled] = useState(false)
  const [apiIntended, setApiIntended] = useState(false)
  const [hasScript, setHasScript] = useState(false)

  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [invokeTargetUrlId, setInvokeTargetUrlId] = useState("")
  const [invoking, setInvoking] = useState(false)
  const [invokeResult, setInvokeResult] = useState<{ httpStatus: number; body: InvokeResult } | null>(null)
  const [copied, setCopied] = useState(false)

  const applyDoc = useCallback((next: ContractDoc) => {
    setDoc(next)
    setParams(next.contract?.params ?? [])
    setResponse(next.contract?.response ?? [])
    setMaxConcurrency(next.contract?.maxConcurrency ?? 1)
    setApiEnabled(next.apiEnabled)
    setApiIntended(next.apiIntended)
    setHasScript(next.hasScript)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await request<ContractDoc>(apiRoutes.testCases.contract(testCaseId))
      applyDoc(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载契约失败")
    } finally {
      setLoading(false)
    }
  }, [testCaseId, applyDoc])

  useEffect(() => {
    void load()
    setInvokeResult(null)
    setParamValues({})
  }, [load])

  const saveContract = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: CaseContract = {
        params: params.filter((f) => f.name.trim()),
        response: response.filter((f) => f.name.trim()),
        maxConcurrency,
        version: (doc?.contract?.version ?? 0) + 1,
      }
      await request<TestCase>(apiRoutes.testCases.contract(testCaseId), {
        method: "PUT",
        body: JSON.stringify(payload),
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存契约失败")
    } finally {
      setSaving(false)
    }
  }

  const generateContract = async () => {
    setGenerating(true)
    setError(null)
    try {
      const { data } = await request<CaseContract>(apiRoutes.testCases.contractGenerate(testCaseId), { method: "POST" })
      // 只填进可编辑表单，不自动落库——遵循「AI 生成 → 人 review → 保存并冻结」。
      setParams(data.params ?? [])
      setResponse(data.response ?? [])
      if (data.maxConcurrency) setMaxConcurrency(data.maxConcurrency)
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 生成契约失败")
    } finally {
      setGenerating(false)
    }
  }

  const toggleApi = async () => {
    setToggling(true)
    setError(null)
    try {
      await request<TestCase>(apiRoutes.testCases.apiEnabled(testCaseId), {
        method: "POST",
        body: JSON.stringify({ enabled: !apiEnabled }),
      })
      setApiEnabled((prev) => !prev)
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换 API 开关失败")
    } finally {
      setToggling(false)
    }
  }

  const toggleApiIntended = async () => {
    setToggling(true)
    setError(null)
    try {
      await request<TestCase>(apiRoutes.testCases.apiIntended(testCaseId), {
        method: "POST",
        body: JSON.stringify({ intended: !apiIntended }),
      })
      setApiIntended((prev) => !prev)
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换「计划 API 化」失败")
    } finally {
      setToggling(false)
    }
  }

  const invoke = async () => {
    setInvoking(true)
    setInvokeResult(null)
    try {
      const body: Record<string, unknown> = {}
      for (const field of params) {
        const raw = paramValues[field.name]
        if (raw === undefined || raw === "") continue
        if (field.type === "number" || field.type === "integer") body[field.name] = Number(raw)
        else if (field.type === "boolean") body[field.name] = raw === "true"
        else if (field.type === "array" || field.type === "object") {
          try {
            body[field.name] = JSON.parse(raw)
          } catch {
            body[field.name] = raw
          }
        } else body[field.name] = raw
      }
      const res = await fetch(`${apiBase}${apiRoutes.testCases.invoke(testCaseId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: body, targetUrlId: invokeTargetUrlId || undefined }),
      })
      const json = (await res.json()) as InvokeResult
      setInvokeResult({ httpStatus: res.status, body: json })
    } catch (err) {
      setInvokeResult({ httpStatus: 0, body: { ok: false, status: "network_error", errors: [String(err)] } })
    } finally {
      setInvoking(false)
    }
  }

  const invokeUrl = `${apiBase || location.origin}${apiRoutes.testCases.invoke(testCaseId)}`

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">加载契约中…</div>
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* 计划 API 化意图（轻量开关，驱动 LLM 生成时具备 API 意识） */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-amber-600 dark:text-amber-400">target</span>
            <span className="text-sm font-semibold text-foreground">计划 API 化</span>
            <Badge tone={apiIntended ? "success" : "default"}>{apiIntended ? "已开启" : "未开启"}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            开启后，LLM 生成脚本时即具备「API 意识」：先声明接口契约，再用 params.get() 写参数化脚本。这是轻量意图开关，不要求已有契约或脚本。
          </p>
        </div>
        <Button size="sm" variant={apiIntended ? "secondary" : "primary"} disabled={toggling} onClick={toggleApiIntended}>
          <span className="material-symbols-outlined text-sm">{apiIntended ? "toggle_on" : "toggle_off"}</span>
          {apiIntended ? "关闭意图" : "开启意图"}
        </Button>
      </div>

      {/* 状态 + 开关 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-primary">api</span>
            <span className="text-sm font-semibold text-foreground">对外 API</span>
            <Badge tone={apiEnabled ? "success" : "default"}>{apiEnabled ? "已开启" : "未开启"}</Badge>
            {!hasScript && <Badge tone="warning">尚未生成脚本</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            开启后，其他服务可通过 HTTP / MCP 把该用例当作稳定接口调用，入参与出参均按下方契约校验。
          </p>
        </div>
        <Button size="sm" variant={apiEnabled ? "secondary" : "primary"} disabled={toggling || !hasScript} onClick={toggleApi}>
          <span className="material-symbols-outlined text-sm">{apiEnabled ? "toggle_on" : "toggle_off"}</span>
          {apiEnabled ? "关闭 API" : "开启 API"}
        </Button>
      </div>

      {/* Endpoint */}
      <div className="space-y-2">
        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">调用地址</h4>
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/10 px-3 py-2">
          <code className="flex-1 text-xs font-mono text-foreground break-all">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">POST</span> {invokeUrl}
          </code>
          <button
            className="shrink-0 p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground"
            onClick={() => {
              navigator.clipboard.writeText(invokeUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <span className="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
          </button>
          <a
            className="shrink-0 p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground"
            href={`${apiBase}${apiRoutes.testCases.apiDoc(testCaseId)}`}
            target="_blank"
            rel="noreferrer"
            title="打开独立文档页"
          >
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </a>
        </div>
      </div>

      {/* 契约编辑 */}
      <div className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-foreground">接口契约</h4>
            <p className="text-[11px] text-muted-foreground">
              推荐让 AI 根据脚本目标自动设计入参 / 响应，再在下方 review 微调后保存冻结。
            </p>
          </div>
          <Button size="sm" variant="primary" disabled={generating || !hasScript} onClick={generateContract}>
            <span className="material-symbols-outlined text-sm">auto_awesome</span>
            {generating ? "AI 生成中…" : "AI 生成契约"}
          </Button>
        </div>
        {!hasScript && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">需要先生成脚本，AI 才能反推契约。</p>
        )}
        <FieldEditor title="入参契约 (params)" fields={params} onChange={setParams} />
        <FieldEditor title="响应契约 (response)" fields={response} onChange={setResponse} />
        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border/40">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            最大并发
            <input
              type="number"
              min={1}
              className={`${inputClassName} h-8 text-xs w-20`}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className="text-[10px] text-muted-foreground/70">同一用例同时在跑的 API 调用上限，超过返回 busy</span>
          </label>
          <Button size="sm" disabled={saving} onClick={saveContract} className="ml-auto">
            <span className="material-symbols-outlined text-sm">save</span>
            {saving ? "保存中…" : "保存并冻结契约"}
          </Button>
        </div>
      </div>

      {/* 在线测试 */}
      <div className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-4">
        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">在线测试</h4>
        {!apiEnabled ? (
          <p className="text-xs text-muted-foreground italic">请先开启 API 后再测试。</p>
        ) : params.length === 0 && doc?.contract ? (
          <p className="text-xs text-muted-foreground">该用例无入参，可直接发送。</p>
        ) : !doc?.contract ? (
          <p className="text-xs text-muted-foreground italic">请先保存契约。</p>
        ) : null}

        {apiEnabled && (
          <div className="space-y-3">
            {params.map((field) => (
              <div key={field.name} className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{field.name}</span>
                  {field.required && <span className="text-rose-500"> *</span>}
                  <span className="ml-1 text-[10px]">{field.type}</span>
                  {field.description && <span className="ml-1 text-[10px] text-muted-foreground/70">· {field.description}</span>}
                </label>
                {field.type === "boolean" ? (
                  <select
                    className={`${inputClassName} h-8 text-xs`}
                    value={paramValues[field.name] ?? ""}
                    onChange={(e) => setParamValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  >
                    <option value="">(未设置)</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className={`${inputClassName} h-8 text-xs`}
                    placeholder={field.type === "array" || field.type === "object" ? "JSON" : field.format === "uri" ? "https://..." : ""}
                    value={paramValues[field.name] ?? ""}
                    onChange={(e) => setParamValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${inputClassName} h-8 text-xs flex-1 min-w-[200px]`}
                value={invokeTargetUrlId}
                onChange={(e) => setInvokeTargetUrlId(e.target.value)}
              >
                <option value="">默认目标 URL</option>
                {targetUrls.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label} · {u.url}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={invoking} onClick={invoke}>
                <span className="material-symbols-outlined text-sm">send</span>
                {invoking ? "请求中…" : "发送请求"}
              </Button>
            </div>
          </div>
        )}

        {invokeResult && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <Badge tone={invokeResult.body.ok ? "success" : "danger"}>
                {invokeResult.body.ok ? "成功" : "失败"}
              </Badge>
              <span className="text-muted-foreground font-mono">HTTP {invokeResult.httpStatus} · {invokeResult.body.status}</span>
            </div>
            <pre className="overflow-auto max-h-[320px] rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-200">
              {JSON.stringify(invokeResult.body, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
