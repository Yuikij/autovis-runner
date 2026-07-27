import type { DatabaseSync } from "node:sqlite"
import type {
  DataColumnType,
  DataTable,
  DataTableColumn,
  DataTableMatch,
  DataTableRow,
  DataTableRowPage,
  DataTableScriptApi,
  Identifier,
} from "@browsewright/shared"

interface DataTableTableRow {
  id: string
  project_id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

interface DataTableColumnRow {
  id: string
  table_id: string
  name: string
  type: string
  position: number
  created_at: string
}

interface DataTableDataRow {
  id: string
  table_id: string
  data_json: string
  created_at: string
  updated_at: string
}

const COLUMN_TYPES: DataColumnType[] = ["string", "number", "boolean", "datetime"]

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const now = () => new Date().toISOString()

const normalizeColumnType = (raw: string): DataColumnType =>
  (COLUMN_TYPES as string[]).includes(raw) ? (raw as DataColumnType) : "string"

const inferColumnType = (value: unknown): DataColumnType => {
  if (typeof value === "number" && Number.isFinite(value)) return "number"
  if (typeof value === "boolean") return "boolean"
  return "string"
}

export class DataTableRepository {
  constructor(private readonly db: DatabaseSync) {}

  // -- 读 --

  private mapColumn(row: DataTableColumnRow): DataTableColumn {
    return {
      id: row.id,
      tableId: row.table_id,
      name: row.name,
      type: normalizeColumnType(row.type),
      position: row.position,
      createdAt: row.created_at,
    }
  }

  private mapRow(row: DataTableDataRow): DataTableRow {
    let data: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(row.data_json)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>
    } catch {
      data = {}
    }
    return { id: row.id, tableId: row.table_id, data, createdAt: row.created_at, updatedAt: row.updated_at }
  }

  private listColumns(tableId: Identifier): DataTableColumn[] {
    const rows = this.db
      .prepare("SELECT * FROM data_table_columns WHERE table_id = ? ORDER BY position ASC, created_at ASC")
      .all(tableId) as unknown as DataTableColumnRow[]
    return rows.map((row) => this.mapColumn(row))
  }

  private countRows(tableId: Identifier): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM data_table_rows WHERE table_id = ?").get(tableId) as
      | { c: number }
      | undefined
    return row?.c ?? 0
  }

  private toTable(row: DataTableTableRow): DataTable {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      columns: this.listColumns(row.id),
      rowCount: this.countRows(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  public listByProject(projectId: Identifier): DataTable[] {
    const rows = this.db
      .prepare("SELECT * FROM data_tables WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as unknown as DataTableTableRow[]
    return rows.map((row) => this.toTable(row))
  }

  private rawTable(tableId: Identifier): DataTableTableRow | undefined {
    return this.db.prepare("SELECT * FROM data_tables WHERE id = ?").get(tableId) as DataTableTableRow | undefined
  }

  public getTable(tableId: Identifier): DataTable | null {
    const row = this.rawTable(tableId)
    return row ? this.toTable(row) : null
  }

  private rawTableByName(projectId: Identifier, name: string): DataTableTableRow | undefined {
    return this.db.prepare("SELECT * FROM data_tables WHERE project_id = ? AND name = ?").get(projectId, name) as
      | DataTableTableRow
      | undefined
  }

  // -- 表 CRUD --

  public createTable(input: { projectId: Identifier; name: string; description?: string }): DataTable {
    const name = input.name.trim()
    if (!name) throw new Error("数据表名称不能为空")
    if (this.rawTableByName(input.projectId, name)) throw new Error(`该项目下已存在数据表「${name}」`)
    const id = newId("dt")
    const ts = now()
    this.db
      .prepare("INSERT INTO data_tables (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.projectId, name, input.description?.trim() ?? "", ts, ts)
    return this.getTable(id)!
  }

  public updateTable(tableId: Identifier, patch: { name?: string; description?: string }): DataTable {
    const existing = this.rawTable(tableId)
    if (!existing) throw new Error(`数据表不存在：${tableId}`)
    const nextName = patch.name?.trim() ?? existing.name
    if (!nextName) throw new Error("数据表名称不能为空")
    if (nextName !== existing.name) {
      const dup = this.rawTableByName(existing.project_id, nextName)
      if (dup && dup.id !== tableId) throw new Error(`该项目下已存在数据表「${nextName}」`)
    }
    const nextDescription = patch.description !== undefined ? patch.description.trim() : existing.description
    this.db
      .prepare("UPDATE data_tables SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(nextName, nextDescription, now(), tableId)
    return this.getTable(tableId)!
  }

  public deleteTable(tableId: Identifier): void {
    this.db.prepare("DELETE FROM data_tables WHERE id = ?").run(tableId)
  }

  // -- 列 CRUD --

  private rawColumn(columnId: Identifier): DataTableColumnRow | undefined {
    return this.db.prepare("SELECT * FROM data_table_columns WHERE id = ?").get(columnId) as
      | DataTableColumnRow
      | undefined
  }

  private nextColumnPosition(tableId: Identifier): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) AS p FROM data_table_columns WHERE table_id = ?")
      .get(tableId) as { p: number } | undefined
    return (row?.p ?? -1) + 1
  }

  /** 内部：确保某列存在（脚本自动补列用）。返回是否新建。 */
  private ensureColumn(tableId: Identifier, name: string, type: DataColumnType): boolean {
    const trimmed = name.trim()
    if (!trimmed) return false
    const existing = this.db
      .prepare("SELECT id FROM data_table_columns WHERE table_id = ? AND name = ?")
      .get(tableId, trimmed)
    if (existing) return false
    this.db
      .prepare("INSERT INTO data_table_columns (id, table_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("dtc"), tableId, trimmed, type, this.nextColumnPosition(tableId), now())
    return true
  }

  public addColumn(tableId: Identifier, input: { name: string; type: DataColumnType }): DataTable {
    if (!this.rawTable(tableId)) throw new Error(`数据表不存在：${tableId}`)
    const name = input.name.trim()
    if (!name) throw new Error("字段名称不能为空")
    const existing = this.db
      .prepare("SELECT id FROM data_table_columns WHERE table_id = ? AND name = ?")
      .get(tableId, name)
    if (existing) throw new Error(`字段「${name}」已存在`)
    this.db
      .prepare("INSERT INTO data_table_columns (id, table_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId("dtc"), tableId, name, normalizeColumnType(input.type), this.nextColumnPosition(tableId), now())
    this.touchTable(tableId)
    return this.getTable(tableId)!
  }

  public updateColumn(columnId: Identifier, patch: { name?: string; type?: DataColumnType }): DataTable {
    const existing = this.rawColumn(columnId)
    if (!existing) throw new Error(`字段不存在：${columnId}`)
    const nextName = patch.name?.trim() ?? existing.name
    if (!nextName) throw new Error("字段名称不能为空")
    if (nextName !== existing.name) {
      const dup = this.db
        .prepare("SELECT id FROM data_table_columns WHERE table_id = ? AND name = ?")
        .get(existing.table_id, nextName)
      if (dup) throw new Error(`字段「${nextName}」已存在`)
    }
    const nextType = patch.type ? normalizeColumnType(patch.type) : normalizeColumnType(existing.type)
    this.db.prepare("UPDATE data_table_columns SET name = ?, type = ? WHERE id = ?").run(nextName, nextType, columnId)
    // 列改名时同步迁移已有行数据的键，避免历史行丢字段。
    if (nextName !== existing.name) this.renameRowKey(existing.table_id, existing.name, nextName)
    this.touchTable(existing.table_id)
    return this.getTable(existing.table_id)!
  }

  public deleteColumn(columnId: Identifier): DataTable {
    const existing = this.rawColumn(columnId)
    if (!existing) throw new Error(`字段不存在：${columnId}`)
    this.db.prepare("DELETE FROM data_table_columns WHERE id = ?").run(columnId)
    this.dropRowKey(existing.table_id, existing.name)
    this.touchTable(existing.table_id)
    return this.getTable(existing.table_id)!
  }

  private renameRowKey(tableId: Identifier, fromKey: string, toKey: string): void {
    const rows = this.db.prepare("SELECT * FROM data_table_rows WHERE table_id = ?").all(tableId) as unknown as DataTableDataRow[]
    for (const raw of rows) {
      const mapped = this.mapRow(raw)
      if (!(fromKey in mapped.data)) continue
      const data = { ...mapped.data }
      data[toKey] = data[fromKey]
      delete data[fromKey]
      this.db.prepare("UPDATE data_table_rows SET data_json = ? WHERE id = ?").run(JSON.stringify(data), raw.id)
    }
  }

  private dropRowKey(tableId: Identifier, key: string): void {
    const rows = this.db.prepare("SELECT * FROM data_table_rows WHERE table_id = ?").all(tableId) as unknown as DataTableDataRow[]
    for (const raw of rows) {
      const mapped = this.mapRow(raw)
      if (!(key in mapped.data)) continue
      const data = { ...mapped.data }
      delete data[key]
      this.db.prepare("UPDATE data_table_rows SET data_json = ? WHERE id = ?").run(JSON.stringify(data), raw.id)
    }
  }

  private touchTable(tableId: Identifier): void {
    this.db.prepare("UPDATE data_tables SET updated_at = ? WHERE id = ?").run(now(), tableId)
  }

  // -- 行 CRUD --

  public listRows(tableId: Identifier, options?: { limit?: number; offset?: number }): DataTableRowPage {
    const total = this.countRows(tableId)
    const limit = options?.limit && options.limit > 0 ? Math.min(options.limit, 500) : 100
    const offset = options?.offset && options.offset > 0 ? options.offset : 0
    const rows = this.db
      .prepare("SELECT * FROM data_table_rows WHERE table_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(tableId, limit, offset) as unknown as DataTableDataRow[]
    return { rows: rows.map((row) => this.mapRow(row)), total }
  }

  /** 在表上写入一行（自动为未知键补列）。 */
  private insertRowInternal(tableId: Identifier, data: Record<string, unknown>): DataTableRow {
    for (const [key, value] of Object.entries(data)) {
      this.ensureColumn(tableId, key, inferColumnType(value))
    }
    const id = newId("dtr")
    const ts = now()
    this.db
      .prepare("INSERT INTO data_table_rows (id, table_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, tableId, JSON.stringify(data ?? {}), ts, ts)
    this.touchTable(tableId)
    const raw = this.db.prepare("SELECT * FROM data_table_rows WHERE id = ?").get(id) as unknown as DataTableDataRow
    return this.mapRow(raw)
  }

  public insertRow(tableId: Identifier, data: Record<string, unknown>): DataTableRow {
    if (!this.rawTable(tableId)) throw new Error(`数据表不存在：${tableId}`)
    return this.insertRowInternal(tableId, data ?? {})
  }

  public updateRow(rowId: Identifier, data: Record<string, unknown>): DataTableRow {
    const raw = this.db.prepare("SELECT * FROM data_table_rows WHERE id = ?").get(rowId) as DataTableDataRow | undefined
    if (!raw) throw new Error(`数据行不存在：${rowId}`)
    for (const [key, value] of Object.entries(data ?? {})) {
      this.ensureColumn(raw.table_id, key, inferColumnType(value))
    }
    this.db
      .prepare("UPDATE data_table_rows SET data_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(data ?? {}), now(), rowId)
    this.touchTable(raw.table_id)
    const updated = this.db.prepare("SELECT * FROM data_table_rows WHERE id = ?").get(rowId) as unknown as DataTableDataRow
    return this.mapRow(updated)
  }

  public deleteRow(rowId: Identifier): void {
    const raw = this.db.prepare("SELECT * FROM data_table_rows WHERE id = ?").get(rowId) as DataTableDataRow | undefined
    if (!raw) return
    this.db.prepare("DELETE FROM data_table_rows WHERE id = ?").run(rowId)
    this.touchTable(raw.table_id)
  }

  // -- 脚本运行时 API（按表名解析，绑定项目；表/列缺失时自动创建）--

  public createScriptApi(projectId: Identifier, onLog?: (line: string) => void): DataTableScriptApi {
    const log = (line: string) => onLog?.(line)

    const resolveOrCreateTable = (tableName: string): DataTableTableRow => {
      const name = tableName.trim()
      if (!name) throw new Error("tables: 表名不能为空")
      const existing = this.rawTableByName(projectId, name)
      if (existing) return existing
      const created = this.createTable({ projectId, name, description: "（脚本运行时自动创建）" })
      log(`数据表 · 自动创建表「${name}」`)
      return this.rawTable(created.id)!
    }

    const resolveTable = (tableName: string): DataTableTableRow | null => {
      const name = tableName.trim()
      if (!name) return null
      return this.rawTableByName(projectId, name) ?? null
    }

    const matchRow = (mapped: DataTableRow, match: DataTableMatch): boolean => {
      for (const [key, value] of Object.entries(match)) {
        if (key === "id") {
          if (mapped.id !== value) return false
          continue
        }
        // 用宽松相等比较，兼容数值/字符串混写（如 doi 用数字还是字符串）。
        if (mapped.data[key] !== value && String(mapped.data[key] ?? "") !== String(value ?? "")) return false
      }
      return true
    }

    const findRaw = (tableName: string, match?: DataTableMatch): DataTableRow[] => {
      const table = resolveTable(tableName)
      if (!table) return []
      const rows = this.db
        .prepare("SELECT * FROM data_table_rows WHERE table_id = ? ORDER BY created_at ASC")
        .all(table.id) as unknown as DataTableDataRow[]
      const mapped = rows.map((row) => this.mapRow(row))
      if (!match || Object.keys(match).length === 0) return mapped
      return mapped.filter((row) => matchRow(row, match))
    }

    return {
      insert: async (tableName, row) => {
        const table = resolveOrCreateTable(tableName)
        const created = this.insertRowInternal(table.id, row ?? {})
        log(`数据表 · insert(${tableName})`)
        return created
      },
      find: async (tableName, match) => findRaw(tableName, match),
      findOne: async (tableName, match) => findRaw(tableName, match)[0] ?? null,
      exists: async (tableName, match) => findRaw(tableName, match).length > 0,
      update: async (tableName, match, patch) => {
        const targets = findRaw(tableName, match)
        for (const target of targets) {
          this.updateRow(target.id, { ...target.data, ...(patch ?? {}) })
        }
        log(`数据表 · update(${tableName}) 影响 ${targets.length} 行`)
        return targets.length
      },
      upsert: async (tableName, match, row) => {
        const existing = findRaw(tableName, match)[0]
        if (existing) {
          const updated = this.updateRow(existing.id, { ...existing.data, ...(row ?? {}) })
          log(`数据表 · upsert(${tableName}) → 更新`)
          return updated
        }
        const table = resolveOrCreateTable(tableName)
        const created = this.insertRowInternal(table.id, { ...(match ?? {}), ...(row ?? {}) })
        log(`数据表 · upsert(${tableName}) → 新增`)
        return created
      },
      delete: async (tableName, match) => {
        const targets = findRaw(tableName, match)
        for (const target of targets) this.deleteRow(target.id)
        log(`数据表 · delete(${tableName}) 删除 ${targets.length} 行`)
        return targets.length
      },
    }
  }
}
