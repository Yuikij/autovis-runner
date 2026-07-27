import { type CaseContract, type ContractField, fieldsToJsonSchema } from "@browsewright/shared"
import { type ToolDefinition } from "../../llm.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

const fieldTypeEnum = ["string", "number", "integer", "boolean", "array", "object"]

const fieldSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "参数名（脚本里用 params.get(name) 读取 / 响应体的 key）" },
    type: { type: "string", enum: fieldTypeEnum, description: "JSON Schema 类型" },
    description: { type: "string", description: "用途说明（会渲染进 API 文档）" },
    required: { type: "boolean", description: "是否必填" },
    default: { description: "缺省值（入参未提供时注入）" },
    format: { type: "string", description: "格式提示，文件/URL 类参数用 \"uri\"" },
    enum: { type: "array", description: "枚举取值（可选）" },
  },
  required: ["name", "type"],
} as const

export const defineContractTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "define_contract",
      description:
        "声明本用例对外暴露为 API / MCP tool 时的「接口契约」：入参 schema（params）+ 响应 schema（response）。" +
        "这是把用例 API 化的地基，直接驱动文档、测试表单与 MCP inputSchema。" +
        "**当用例已开启「计划 API 化」意图时，应在固化阶段尽早调用——先声明契约，再按契约用 params.get(name) 写参数化脚本**，而非写完硬编码脚本再回头补。" +
        "声明后 execute_step 校验会按契约的 default 注入占位入参，让参数化脚本能即时验证。" +
        "入参对应脚本里的 params.get(name)；响应对应脚本里的 result.set(key, value)。" +
        "文件类入参（发图文/视频要上传的素材）声明 type=string、format=uri，脚本用 files.download(url) 落盘后 setInputFiles。",
      parameters: {
        type: "object",
        properties: {
          params: { type: "array", description: "入参字段列表", items: fieldSchema },
          response: { type: "array", description: "响应字段列表", items: fieldSchema },
          requiresAuthProfileId: { type: "string", description: "运行所需登录态 AuthProfile id（可选，便于调用方无脑调）" },
          requiresAssets: { type: "boolean", description: "是否需要素材（可选）" },
          maxConcurrency: { type: "integer", description: "同一用例允许的最大并发 API 调用数（默认 1；强风控站点保持 1）" },
        },
        required: ["params", "response"],
      },
    },
  },
]

interface DefineContractArgs {
  params?: ContractField[]
  response?: ContractField[]
  requiresAuthProfileId?: string
  requiresAssets?: boolean
  maxConcurrency?: number
}

const sanitizeFields = (fields: ContractField[] | undefined): ContractField[] => {
  if (!Array.isArray(fields)) return []
  return fields
    .filter((f) => f && typeof f.name === "string" && f.name.trim() && fieldTypeEnum.includes(f.type))
    .map((f) => ({
      name: f.name.trim(),
      type: f.type,
      description: typeof f.description === "string" ? f.description : undefined,
      required: f.required === true,
      default: f.default,
      format: typeof f.format === "string" ? f.format : undefined,
      items: f.items && fieldTypeEnum.includes(f.items.type) ? { type: f.items.type } : undefined,
      enum: Array.isArray(f.enum) ? f.enum : undefined,
    }))
}

export async function executeDefineContract(
  ctx: ToolRuntimeContext,
  args: DefineContractArgs,
): Promise<ToolExecutionResult> {
  const params = sanitizeFields(args.params)
  const response = sanitizeFields(args.response)
  const contract: CaseContract = {
    params,
    response,
    requiresAuthProfileId: typeof args.requiresAuthProfileId === "string" ? args.requiresAuthProfileId : undefined,
    requiresAssets: args.requiresAssets === true,
    maxConcurrency:
      typeof args.maxConcurrency === "number" && args.maxConcurrency >= 1 ? Math.floor(args.maxConcurrency) : undefined,
    updatedAt: new Date().toISOString(),
  }

  if (!ctx.defineContract) {
    return {
      stage: "generation",
      content: "当前执行环境不支持冻结契约（define_contract 不可用）。",
      payloadJson: JSON.stringify({ contract }),
    }
  }

  await ctx.defineContract(contract)

  return {
    stage: "generation",
    content:
      `已冻结接口契约：入参 ${params.length} 个（${params.map((p) => p.name).join(", ") || "无"}）、` +
      `响应 ${response.length} 个（${response.map((p) => p.name).join(", ") || "无"}）。` +
      "脚本里请用 params.get(name) 读取入参、result.set(key, value) 写响应。",
    payloadJson: JSON.stringify({ contract, paramsSchema: fieldsToJsonSchema(params), responseSchema: fieldsToJsonSchema(response) }),
  }
}
