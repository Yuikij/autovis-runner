/**
 * AutoVis MCP server（stdio）。
 *
 * 把每个「已开启 API + 有契约 + 有脚本」的用例映射成一个 MCP tool：
 *   - tools/list  ← GET  /api/mcp/tools           （契约的 params JSON Schema 即 inputSchema）
 *   - tools/call  ← POST /api/test-cases/:id/invoke（入参/出参均按契约校验）
 *
 * 这是一个独立进程，由 MCP 客户端（Cursor / Claude Desktop 等）以 stdio 方式拉起，
 * 通过 HTTP 调用正在运行的 AutoVis server，因此不直接依赖 DB / 浏览器。
 *
 * 环境变量：
 *   AUTOVIS_BASE_URL  AutoVis server 基址（默认 http://127.0.0.1:8787）
 *   AUTOVIS_TOKEN     可选；当 server 开启鉴权时，作为 autovis_session cookie 传入
 *   AUTOVIS_MCP_NAME  可选；MCP server 名称（默认 autovis）
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

interface McpToolDescriptor {
  testCaseId: string
  projectId: string
  name: string
  description: string
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] }
}

interface InvokeResult {
  ok: boolean
  runId?: string
  status: string
  result?: Record<string, unknown>
  errors?: string[]
}

const baseUrl = (process.env.AUTOVIS_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "")
const token = process.env.AUTOVIS_TOKEN
const serverName = process.env.AUTOVIS_MCP_NAME ?? "autovis"

const authHeaders = (): Record<string, string> => (token ? { cookie: `autovis_session=${encodeURIComponent(token)}` } : {})

async function fetchTools(): Promise<McpToolDescriptor[]> {
  const response = await fetch(`${baseUrl}/api/mcp/tools`, { headers: { ...authHeaders() } })
  if (!response.ok) {
    throw new Error(`拉取工具列表失败：HTTP ${response.status}`)
  }
  const payload = (await response.json()) as { data?: McpToolDescriptor[] }
  return payload.data ?? []
}

async function invokeTool(testCaseId: string, params: Record<string, unknown>): Promise<InvokeResult> {
  const response = await fetch(`${baseUrl}/api/test-cases/${encodeURIComponent(testCaseId)}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ params }),
  })
  const payload = (await response.json()) as { data?: InvokeResult } & Partial<InvokeResult>
  // invoke 路由成功时走 ApiEnvelope（{ data }），失败时直接返回 InvokeCaseResponse。
  return payload.data ?? (payload as InvokeResult)
}

async function main() {
  const server = new Server({ name: serverName, version: "0.1.0" }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await fetchTools()
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const tools = await fetchTools()
    const tool = tools.find((item) => item.name === toolName)
    if (!tool) {
      return { content: [{ type: "text" as const, text: `未找到工具：${toolName}` }], isError: true }
    }
    let result: InvokeResult
    try {
      result = await invokeTool(tool.testCaseId, args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: "text" as const, text: `调用失败：${message}` }], isError: true }
    }
    if (!result.ok) {
      const detail = result.errors?.join("; ") || result.status
      return { content: [{ type: "text" as const, text: `执行未通过（${result.status}）：${detail}` }], isError: true }
    }
    const payload = result.result ?? {}
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdio 模式下不要往 stdout 打印任何非协议内容；日志走 stderr。
  process.stderr.write(`[autovis-mcp] connected, base=${baseUrl}\n`)
}

main().catch((error) => {
  process.stderr.write(`[autovis-mcp] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
