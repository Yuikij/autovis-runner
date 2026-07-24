import type { Identifier } from "./core.js"

/** data-table 字段（列）的数据类型，决定 UI 输入控件与展示方式；存储层按 JSON 原值落库。 */
export type DataColumnType = "string" | "number" | "boolean" | "datetime"

export interface DataTableColumn {
  id: Identifier
  tableId: Identifier
  name: string
  type: DataColumnType
  position: number
  createdAt: string
}

/**
 * 项目级数据表。给「执行分析论文」这类场景提供跨运行的持久状态：
 * 例如记录某篇论文是否已经被分析过，让后续运行 / 其他人都能查到。
 * 列由用户在可视化界面增删改；脚本写入未知字段时会自动补列。
 */
export interface DataTable {
  id: Identifier
  projectId: Identifier
  name: string
  description: string
  columns: DataTableColumn[]
  /** 当前行数（列表展示用，不含完整行数据）。 */
  rowCount: number
  createdAt: string
  updatedAt: string
}

export interface DataTableRow {
  id: Identifier
  tableId: Identifier
  /** 行数据，按列名键控；值为列类型对应的 JSON 原值。 */
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface DataTableRowPage {
  rows: DataTableRow[]
  total: number
}

export interface CreateDataTableRequest {
  projectId: Identifier
  name: string
  description?: string
}

export interface UpdateDataTableRequest {
  name?: string
  description?: string
}

export interface UpsertDataTableColumnRequest {
  name: string
  type: DataColumnType
}

export interface UpsertDataTableRowRequest {
  data: Record<string, unknown>
}

/** 行匹配条件：按列名做相等匹配；特殊键 `id` 匹配行 id。 */
export type DataTableMatch = Record<string, unknown>

/**
 * 暴露给「生成脚本」与「脚本运行时」的 data-tables 方法（运行时以 `tables` 命名空间注入）。
 * 所有方法都绑定到当前运行所属的项目。表 / 列不存在时，insert / upsert 会自动创建（并打日志），
 * 让脚本可以零配置地「记录一次、下次跳过」。
 */
export interface DataTableScriptApi {
  /** 插入一行；表或列不存在时自动创建。返回新行。 */
  insert: (tableName: string, row: Record<string, unknown>) => Promise<DataTableRow>
  /** 查询匹配的行（match 为列名相等匹配，缺省返回全部）。 */
  find: (tableName: string, match?: DataTableMatch) => Promise<DataTableRow[]>
  /** 查询第一条匹配的行，无则返回 null。 */
  findOne: (tableName: string, match?: DataTableMatch) => Promise<DataTableRow | null>
  /** 是否存在匹配的行。常用于去重判断（如这篇论文是否已分析过）。 */
  exists: (tableName: string, match: DataTableMatch) => Promise<boolean>
  /** 更新匹配的行（合并 patch 到 data），返回受影响行数。 */
  update: (tableName: string, match: DataTableMatch, patch: Record<string, unknown>) => Promise<number>
  /** 存在匹配行则更新、否则插入；返回最终行。 */
  upsert: (tableName: string, match: DataTableMatch, row: Record<string, unknown>) => Promise<DataTableRow>
  /** 删除匹配的行，返回删除行数。 */
  delete: (tableName: string, match: DataTableMatch) => Promise<number>
}
