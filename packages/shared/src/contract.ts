import type { Identifier } from "./core.js"

/**
 * 用例 API 契约（Case Contract）。
 *
 * 设计要点（见 API 需求讨论总结）：
 * - 契约是用例的「一等公民」、被冻结的接口定义，不能每次调用临时生成；否则入参非确定，
 *   调用方无法对接。人确认后冻结成契约。
 * - 采用 JSON Schema 子集，为进阶 MCP 铺路：一个用例 = 一个 MCP tool，
 *   `paramsSchema` 直接当 `inputSchema`，零转换。
 */

export type ContractFieldType = "string" | "number" | "integer" | "boolean" | "array" | "object"

export interface ContractField {
  /** 参数名，作为 `params.get(name)` / 响应体的 key。 */
  name: string
  type: ContractFieldType
  description?: string
  /** 是否必填（入参缺失即拒绝；响应缺失即出参校验失败）。 */
  required?: boolean
  /** 缺省值：入参未提供时注入。 */
  default?: unknown
  /**
   * JSON Schema `format` 提示。文件类参数用 `"uri"`：调用方传图片/视频 URL，
   * 脚本用 `files.download(url)` 落盘再 `setInputFiles`（B 方案）。
   * 将来上 A 方案（用户上传素材）时，参数契约这层不用改，只是多一种 format。
   */
  format?: string
  /** type=array 时声明元素类型。 */
  items?: { type: ContractFieldType }
  /** 枚举取值（string / number）。 */
  enum?: Array<string | number>
}

export interface CaseContract {
  /** 入参契约：外部调用方传入、经网关校验后通过 `params.get()` 读取。 */
  params: ContractField[]
  /** 响应契约：脚本通过 `result.set()` 产出，按此校验后返回给调用方。 */
  response: ContractField[]
  /**
   * 运行所需登录态（AuthProfile id）。冗余声明，便于调用方「无脑调」。
   * 实际注入仍由用例自身的 `authProfileId` 驱动；此处主要用于文档与 MCP 描述。
   */
  requiresAuthProfileId?: Identifier
  /** 是否需要素材（A 方案预留）。当前 B 方案（脚本从 URL 下载）用不到。 */
  requiresAssets?: boolean
  /**
   * 同一用例允许的最大并发 API 调用数（默认 1）。超过即返回 busy。
   * 小红书等强风控站点建议保持 1；幂等的读类用例可调高。
   */
  maxConcurrency?: number
  /** 契约版本：人 review 冻结后递增，便于调用方感知不兼容变更。 */
  version?: number
  updatedAt?: string
}

/** JSON Schema 子集对象（用于文档渲染、测试表单、MCP inputSchema）。 */
export interface JsonSchemaObject {
  type: "object"
  properties: Record<string, JsonSchemaProperty>
  required: string[]
  additionalProperties: boolean
}

export interface JsonSchemaProperty {
  type: ContractFieldType
  description?: string
  default?: unknown
  format?: string
  items?: { type: ContractFieldType }
  enum?: Array<string | number>
}

const fieldToJsonSchemaProperty = (field: ContractField): JsonSchemaProperty => {
  const property: JsonSchemaProperty = { type: field.type }
  if (field.description) property.description = field.description
  if (field.default !== undefined) property.default = field.default
  if (field.format) property.format = field.format
  if (field.items) property.items = field.items
  if (field.enum) property.enum = field.enum
  return property
}

/** 把契约字段数组转换为 JSON Schema 对象（文档 / 测试表单 / MCP inputSchema 通用）。 */
export const fieldsToJsonSchema = (fields: ContractField[]): JsonSchemaObject => {
  const properties: Record<string, JsonSchemaProperty> = {}
  const required: string[] = []
  for (const field of fields) {
    properties[field.name] = fieldToJsonSchemaProperty(field)
    if (field.required) required.push(field.name)
  }
  return { type: "object", properties, required, additionalProperties: false }
}

export interface ValidationResult {
  ok: boolean
  /** 校验并按类型「轻度强转」后的值（应用了 default）。 */
  value: Record<string, unknown>
  errors: string[]
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** 把单个值按声明类型做轻度强转；返回 { value } 或 { error }。 */
const coerceValue = (field: ContractField, raw: unknown): { value?: unknown; error?: string } => {
  switch (field.type) {
    case "string": {
      if (typeof raw === "string") return { value: raw }
      if (typeof raw === "number" || typeof raw === "boolean") return { value: String(raw) }
      return { error: `参数 ${field.name} 应为 string` }
    }
    case "number":
    case "integer": {
      let num: number
      if (typeof raw === "number") num = raw
      else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) num = Number(raw)
      else return { error: `参数 ${field.name} 应为 ${field.type}` }
      if (field.type === "integer" && !Number.isInteger(num)) return { error: `参数 ${field.name} 应为整数` }
      return { value: num }
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw }
      if (raw === "true") return { value: true }
      if (raw === "false") return { value: false }
      return { error: `参数 ${field.name} 应为 boolean` }
    }
    case "array": {
      if (!Array.isArray(raw)) return { error: `参数 ${field.name} 应为 array` }
      if (field.items) {
        for (const item of raw) {
          const itemField: ContractField = { name: `${field.name}[]`, type: field.items.type }
          const result = coerceValue(itemField, item)
          if (result.error) return { error: result.error }
        }
      }
      return { value: raw }
    }
    case "object": {
      if (!isPlainObject(raw)) return { error: `参数 ${field.name} 应为 object` }
      return { value: raw }
    }
    default:
      return { error: `参数 ${field.name} 类型未知: ${String(field.type)}` }
  }
}

/**
 * 按契约字段校验一组键值。入参网关与出参校验共用。
 * - 缺失且 required → 报错；缺失且有 default → 注入 default。
 * - 类型不符 → 报错；可轻度强转的（数字字符串、"true"/"false"）会被强转。
 * - enum 不在取值范围 → 报错。
 */
export const validateAgainstFields = (
  fields: ContractField[],
  input: Record<string, unknown> | undefined,
): ValidationResult => {
  const source = input ?? {}
  const value: Record<string, unknown> = {}
  const errors: string[] = []

  for (const field of fields) {
    const provided = Object.prototype.hasOwnProperty.call(source, field.name) ? source[field.name] : undefined
    if (provided === undefined || provided === null || provided === "") {
      if (field.default !== undefined) {
        value[field.name] = field.default
        continue
      }
      if (field.required) {
        errors.push(`缺少必填参数 ${field.name}`)
      }
      continue
    }
    const coerced = coerceValue(field, provided)
    if (coerced.error) {
      errors.push(coerced.error)
      continue
    }
    if (field.enum && !field.enum.includes(coerced.value as string | number)) {
      errors.push(`参数 ${field.name} 取值必须是 [${field.enum.join(", ")}] 之一`)
      continue
    }
    value[field.name] = coerced.value
  }

  return { ok: errors.length === 0, value, errors }
}
