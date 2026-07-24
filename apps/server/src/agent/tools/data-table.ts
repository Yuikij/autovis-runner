import { type ToolDefinition } from "../../llm.js"
import { type ToolExecutionResult, type ToolRuntimeContext } from "../types.js"

/**
 * 通用「项目数据表」工具：把平台早已有的、跨运行持久的项目数据表（data-tables，此前只在生成脚本的
 * `tables` 运行时里可用）通用地暴露给 direct agent。任何需要"跨运行记住做过什么 / 去重 / 累积台账"的任务
 * 都能用（论文、资讯、账单、抢购记录……），表名与字段由模型按任务自定，不针对任何具体业务写死。
 */
export const dataTableTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "query_data_table",
      description:
        "查询某个项目数据表里的行。**需要判断某条记录是否处理过（去重）时用它**：传 match 按字段等值过滤，返回匹配行；不传 match 返回全部。表不存在时返回空。",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "数据表名称（自定，如 collected_papers / seen_news）" },
          match: { type: "object", description: "按列名等值匹配的过滤条件；缺省返回全部行", additionalProperties: true },
          limit: { type: "number", description: "最多返回多少行，缺省 200" },
        },
        required: ["table"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_data_table_row",
      description:
        "向项目数据表写入/更新一行（表或列不存在会自动创建）。**完成一条记录后调用它登记，后续运行才知道这条做过了**。" +
        "传 match（唯一键，如 { arxivId: '2401.01234' }）做去重：已存在则更新、否则新增；row 为要写入的完整字段。",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "数据表名称（自定）" },
          match: { type: "object", description: "唯一键匹配条件，用于去重（存在则更新、否则插入）", additionalProperties: true },
          row: { type: "object", description: "要写入的行数据（列名→值），可含 match 里的键", additionalProperties: true },
        },
        required: ["table", "row"],
      },
    },
  },
]

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v)

export async function executeQueryDataTable(
  ctx: ToolRuntimeContext,
  args: { table: string; match?: Record<string, unknown>; limit?: number },
): Promise<ToolExecutionResult> {
  if (!ctx.dataTables) return { stage: "page", content: "query_data_table 不可用：当前执行环境未接入项目数据表。" }
  if (!args.table?.trim()) return { stage: "page", content: "query_data_table 失败：table 不能为空。" }
  const match = isPlainObject(args.match) ? args.match : undefined
  const rows = await ctx.dataTables.find(args.table.trim(), match)
  const limit = args.limit && args.limit > 0 ? args.limit : 200
  const data = rows.slice(0, limit).map((r) => r.data)
  const payloadJson = JSON.stringify({ table: args.table.trim(), total: rows.length, rows: data })
  if (!rows.length) {
    return { stage: "page", content: `数据表「${args.table.trim()}」${match ? "没有匹配的行" : "为空或不存在"}。`, payloadJson }
  }
  const preview = data.map((d, i) => `${i + 1}. ${JSON.stringify(d)}`).join("\n")
  return { stage: "page", content: `数据表「${args.table.trim()}」匹配 ${rows.length} 行：\n${preview.slice(0, 4000)}`, payloadJson }
}

export async function executeSaveDataTableRow(
  ctx: ToolRuntimeContext,
  args: { table: string; match?: Record<string, unknown>; row: Record<string, unknown> },
): Promise<ToolExecutionResult> {
  if (!ctx.dataTables) return { stage: "page", content: "save_data_table_row 不可用：当前执行环境未接入项目数据表。" }
  if (!args.table?.trim()) return { stage: "page", content: "save_data_table_row 失败：table 不能为空。" }
  if (!isPlainObject(args.row) || Object.keys(args.row).length === 0) {
    return { stage: "page", content: "save_data_table_row 失败：row 不能为空。" }
  }
  const table = args.table.trim()
  const match = isPlainObject(args.match) ? args.match : undefined

  if (match && Object.keys(match).length > 0) {
    const existed = await ctx.dataTables.exists(table, match)
    const saved = await ctx.dataTables.upsert(table, match, args.row)
    return {
      stage: "page",
      content: existed ? `数据表「${table}」已存在匹配行，已更新。` : `已写入数据表「${table}」一行（新增）。`,
      payloadJson: JSON.stringify({ table, isNew: !existed, row: saved.data }),
    }
  }
  const saved = await ctx.dataTables.insert(table, args.row)
  return { stage: "page", content: `已写入数据表「${table}」一行（新增）。`, payloadJson: JSON.stringify({ table, isNew: true, row: saved.data }) }
}
