import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  fieldsToJsonSchema,
  type ApiEnvelope,
  type CaseContract,
  type InvokeCaseResponse,
  type TestCase,
} from "@autovis/shared"
import { store } from "../store.js"
import { getRequestLlmOwnerKey } from "../auth.js"

const contractFieldTypes = ["string", "number", "integer", "boolean", "array", "object"] as const

const contractFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(contractFieldTypes),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  format: z.string().optional(),
  items: z.object({ type: z.enum(contractFieldTypes) }).optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
})

const contractSchema = z.object({
  params: z.array(contractFieldSchema).default([]),
  response: z.array(contractFieldSchema).default([]),
  requiresAuthProfileId: z.string().optional(),
  requiresAssets: z.boolean().optional(),
  maxConcurrency: z.number().int().min(1).optional(),
  version: z.number().optional(),
})

interface ContractDoc {
  testCaseId: string
  caseCode: string
  purpose: string
  apiIntended: boolean
  apiEnabled: boolean
  hasScript: boolean
  contract?: CaseContract
  paramsSchema?: ReturnType<typeof fieldsToJsonSchema>
  responseSchema?: ReturnType<typeof fieldsToJsonSchema>
  invokeUrl: string
}

const buildContractDoc = (testCase: TestCase): ContractDoc => ({
  testCaseId: testCase.id,
  caseCode: testCase.caseCode,
  purpose: testCase.purpose,
  apiIntended: Boolean(testCase.apiIntended),
  apiEnabled: Boolean(testCase.apiEnabled),
  hasScript: Boolean(testCase.latestScriptId),
  contract: testCase.contract,
  paramsSchema: testCase.contract ? fieldsToJsonSchema(testCase.contract.params) : undefined,
  responseSchema: testCase.contract ? fieldsToJsonSchema(testCase.contract.response) : undefined,
  invokeUrl: `/api/test-cases/${testCase.id}/invoke`,
})

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** 自包含的接口文档 + 测试表单页面（满足「llm 生成完脚本后有文档展示，可输出参数测试」）。 */
const renderApiDocHtml = (doc: ContractDoc): string => {
  const fieldRows = (fields: CaseContract["params"]) =>
    fields.length === 0
      ? `<tr><td colspan="4" class="muted">（无）</td></tr>`
      : fields
          .map(
            (f) => `<tr>
        <td><code>${escapeHtml(f.name)}</code></td>
        <td>${escapeHtml(f.type)}${f.format ? ` <span class="muted">(${escapeHtml(f.format)})</span>` : ""}</td>
        <td>${f.required ? "✔" : ""}</td>
        <td>${escapeHtml(f.description ?? "")}${f.default !== undefined ? ` <span class="muted">默认: ${escapeHtml(JSON.stringify(f.default))}</span>` : ""}</td>
      </tr>`,
          )
          .join("")

  const formInputs = (doc.contract?.params ?? [])
    .map((f) => {
      const id = `p_${f.name}`
      const label = `${escapeHtml(f.name)}${f.required ? " *" : ""} <span class="muted">${escapeHtml(f.type)}</span>`
      if (f.type === "boolean") {
        return `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-name="${escapeHtml(f.name)}" data-type="${f.type}"><option value="">(未设置)</option><option value="true">true</option><option value="false">false</option></select></div>`
      }
      const placeholder = f.type === "array" || f.type === "object" ? "JSON" : f.format === "uri" ? "https://..." : ""
      return `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-name="${escapeHtml(f.name)}" data-type="${f.type}" placeholder="${placeholder}" value="${f.default !== undefined && typeof f.default !== "object" ? escapeHtml(String(f.default)) : ""}"/></div>`
    })
    .join("")

  const enabledBadge = doc.apiEnabled
    ? `<span class="badge ok">API 已开启</span>`
    : `<span class="badge warn">API 未开启</span>`

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.caseCode)} · API 文档</title>
<style>
  body{max-width:880px;margin:2rem auto;padding:0 1rem;font:15px/1.6 -apple-system,Segoe UI,Roboto,"Helvetica Neue",sans-serif;color:#1a1a1a}
  h1{font-size:1.4rem;margin-bottom:.2rem}
  h2{font-size:1.05rem;margin-top:1.8rem;border-bottom:1px solid #eee;padding-bottom:.3rem}
  code{background:#f5f5f5;padding:.1rem .3rem;border-radius:4px}
  table{width:100%;border-collapse:collapse;margin:.6rem 0}
  th,td{text-align:left;border-bottom:1px solid #eee;padding:.4rem .5rem;vertical-align:top}
  th{color:#666;font-weight:600;font-size:.85rem}
  .muted{color:#999;font-size:.85rem}
  .badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.78rem;vertical-align:middle}
  .badge.ok{background:#e6f7ed;color:#1a7f4b}
  .badge.warn{background:#fdf0e3;color:#b96a00}
  .field{margin:.5rem 0;display:flex;flex-direction:column;gap:.2rem}
  .field input,.field select{padding:.45rem;border:1px solid #ddd;border-radius:6px;font:inherit}
  button{margin-top:.8rem;padding:.5rem 1.1rem;border:0;border-radius:6px;background:#2563eb;color:#fff;font:inherit;cursor:pointer}
  button:disabled{background:#9bb6ee;cursor:not-allowed}
  pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:8px;overflow:auto;font-size:.85rem}
  .endpoint{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:.6rem .8rem;font-family:ui-monospace,Menlo,monospace;font-size:.9rem}
</style></head><body>
<h1>${escapeHtml(doc.caseCode)} ${enabledBadge}</h1>
<p class="muted">${escapeHtml(doc.purpose || "")}</p>
<div class="endpoint"><b>POST</b> <span id="endpoint"></span></div>
${doc.contract ? "" : `<p class="badge warn">该用例尚未定义契约（contract）。</p>`}

<h2>入参（params）</h2>
<table><thead><tr><th>名称</th><th>类型</th><th>必填</th><th>说明</th></tr></thead>
<tbody>${fieldRows(doc.contract?.params ?? [])}</tbody></table>

<h2>响应（response）</h2>
<table><thead><tr><th>名称</th><th>类型</th><th>必填</th><th>说明</th></tr></thead>
<tbody>${fieldRows(doc.contract?.response ?? [])}</tbody></table>

<h2>在线测试</h2>
${doc.apiEnabled && doc.contract ? `<form id="invoke-form">${formInputs || `<p class="muted">无入参</p>`}<button type="submit">发送请求</button></form>` : `<p class="muted">用例未开启 API 或未定义契约，无法测试。</p>`}
<pre id="result" style="display:none"></pre>

<h2>参数 Schema (JSON Schema)</h2>
<pre>${escapeHtml(JSON.stringify(doc.paramsSchema ?? {}, null, 2))}</pre>

<script>
  const invokeUrl = ${JSON.stringify(doc.invokeUrl)};
  document.getElementById("endpoint").textContent = location.origin + invokeUrl;
  const form = document.getElementById("invoke-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button");
      btn.disabled = true; btn.textContent = "请求中…";
      const params = {};
      for (const el of form.querySelectorAll("[data-name]")) {
        const raw = el.value;
        if (raw === "") continue;
        const type = el.getAttribute("data-type");
        if (type === "number" || type === "integer") params[el.getAttribute("data-name")] = Number(raw);
        else if (type === "boolean") params[el.getAttribute("data-name")] = raw === "true";
        else if (type === "array" || type === "object") { try { params[el.getAttribute("data-name")] = JSON.parse(raw); } catch { params[el.getAttribute("data-name")] = raw; } }
        else params[el.getAttribute("data-name")] = raw;
      }
      const out = document.getElementById("result");
      out.style.display = "block"; out.textContent = "…";
      try {
        const res = await fetch(invokeUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params }) });
        const json = await res.json();
        out.textContent = "HTTP " + res.status + "\\n" + JSON.stringify(json, null, 2);
      } catch (err) {
        out.textContent = "请求失败: " + err;
      } finally {
        btn.disabled = false; btn.textContent = "发送请求";
      }
    });
  }
</script>
</body></html>`
}

interface McpToolDescriptor {
  testCaseId: string
  projectId: string
  name: string
  description: string
  inputSchema: ReturnType<typeof fieldsToJsonSchema>
}

const sanitizeToolName = (raw: string) => {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
  return cleaned || "tool"
}

export async function caseApiRoutes(app: FastifyInstance) {
  // 列出所有「已开启 API + 有契约」的用例，映射为 MCP tool 描述（MCP server 据此暴露 tools）。
  app.get("/mcp/tools", async (): Promise<ApiEnvelope<McpToolDescriptor[]>> => {
    const cases = await store.listAllTestCases()
    const used = new Set<string>()
    const tools: McpToolDescriptor[] = []
    for (const testCase of cases) {
      if (!testCase.apiEnabled || !testCase.contract || !testCase.latestScriptId) continue
      let name = sanitizeToolName(testCase.caseCode)
      if (used.has(name)) name = `${name}_${testCase.id.slice(-6)}`
      used.add(name)
      tools.push({
        testCaseId: testCase.id,
        projectId: testCase.projectId,
        name,
        description: testCase.purpose || testCase.caseCode,
        inputSchema: fieldsToJsonSchema(testCase.contract.params),
      })
    }
    return { data: tools }
  })

  // 读取契约 + 渲染所需的 schema（前端文档 / 测试表单 / MCP inputSchema 通用）。
  app.get("/test-cases/:testCaseId/contract", async (request, reply): Promise<ApiEnvelope<ContractDoc> | undefined> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    const testCase = await store.getTestCase(params.testCaseId)
    if (!testCase) {
      reply.code(404).send({ message: "用例不存在" })
      return
    }
    return { data: buildContractDoc(testCase) }
  })

  // 写入/冻结契约（define_contract 工具或用户 review 后调用）。
  app.put("/test-cases/:testCaseId/contract", async (request): Promise<ApiEnvelope<TestCase | undefined>> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    const body = contractSchema.parse(request.body)
    const contract: CaseContract = { ...body, updatedAt: new Date().toISOString() }
    return { data: await store.updateTestCaseContract(params.testCaseId, contract) }
  })

  // AI 生成契约草稿：基于已有脚本 + 用例目的，让 LLM 反推入参/响应。只返回草稿，由前端 review 后再 PUT 冻结。
  app.post("/test-cases/:testCaseId/contract/generate", async (request, reply): Promise<ApiEnvelope<CaseContract> | undefined> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    const testCase = await store.getTestCase(params.testCaseId)
    if (!testCase) {
      reply.code(404).send({ message: "用例不存在" })
      return
    }
    const contract = await store.generateCaseContract({
      projectId: testCase.projectId,
      testCaseId: testCase.id,
      llmOwnerKey: getRequestLlmOwnerKey(request),
    })
    return { data: contract }
  })

  // 开关：开启/关闭对外 API 暴露。
  app.post("/test-cases/:testCaseId/api-enabled", async (request): Promise<ApiEnvelope<TestCase | undefined>> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    const body = z.object({ enabled: z.boolean() }).parse(request.body)
    return { data: await store.setTestCaseApiEnabled(params.testCaseId, body.enabled) }
  })

  // 开关：标记用例「计划 API 化」意图（轻量，不依赖 contract/脚本；用于在脚本生成时注入 API 意识）。
  app.post("/test-cases/:testCaseId/api-intended", async (request): Promise<ApiEnvelope<TestCase | undefined>> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    const body = z.object({ intended: z.boolean() }).parse(request.body)
    return { data: await store.setTestCaseApiIntended(params.testCaseId, body.intended) }
  })

  // 调用：外部服务把用例当 API 调。入参/出参均按 contract 校验。
  app.post("/test-cases/:testCaseId/invoke", async (request, reply): Promise<InvokeCaseResponse> => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    // 入参信封兼容两种写法，调用方可「无脑调」：
    //   1) 包裹式：{ "params": { ... }, "targetUrlId"?: "..." }（前端测试表单 / MCP 走这条）
    //   2) 扁平式：{ "<paramName>": ... }（Postman / curl 直接把入参铺在顶层最自然）
    // 历史只认包裹式，导致扁平 body 里的入参被静默丢弃、回落到 contract 的 default，用户传的值不生效。
    const body = z
      .object({
        params: z.record(z.string(), z.unknown()).optional(),
        targetUrlId: z.string().optional(),
      })
      .passthrough()
      .parse(request.body ?? {})
    let invokeParams = body.params
    if (invokeParams === undefined) {
      const flat: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(body)) {
        if (key === "params" || key === "targetUrlId") continue
        flat[key] = value
      }
      if (Object.keys(flat).length > 0) invokeParams = flat
    }
    let result: InvokeCaseResponse
    try {
      result = await store.invokeCase({ testCaseId: params.testCaseId, params: invokeParams, targetUrlId: body.targetUrlId })
    } catch (error) {
      reply.code(400)
      return { ok: false, status: "rejected", errors: [error instanceof Error ? error.message : String(error)] }
    }
    if (!result.ok) {
      if (result.status === "invalid_params") reply.code(400)
      else if (result.status === "busy") reply.code(429)
      else reply.code(502)
    }
    return result
  })

  // 自包含 HTML 文档 + 在线测试表单。
  app.get("/test-cases/:testCaseId/api-doc", async (request, reply) => {
    const params = z.object({ testCaseId: z.string() }).parse(request.params)
    const testCase = await store.getTestCase(params.testCaseId)
    if (!testCase) {
      reply.code(404).type("text/html").send("<h1>用例不存在</h1>")
      return
    }
    reply.type("text/html; charset=utf-8").send(renderApiDocHtml(buildContractDoc(testCase)))
  })
}
