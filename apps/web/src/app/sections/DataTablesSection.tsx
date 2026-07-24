import { useCallback, useEffect, useState } from "react"
import type { DataColumnType, DataTable, DataTableColumn, DataTableRow } from "@autovis/shared"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { EmptyState } from "../components/empty-state"
import { PageHeader } from "../components/page-header"
import { request } from "../api"
import { apiRoutes } from "../apiRoutes"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { formatDateTime } from "../utils"

type Props = { controller: ReadyWorkspaceController }

const inputCls =
  "block w-full rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/80 focus:ring-2 focus:ring-primary/20"

const COLUMN_TYPE_LABELS: Record<DataColumnType, string> = {
  string: "文本",
  number: "数字",
  boolean: "布尔",
  datetime: "日期时间",
}

const COLUMN_TYPES: DataColumnType[] = ["string", "number", "boolean", "datetime"]

type CellInput = string | boolean

const emptyCellValue = (type: DataColumnType): CellInput => (type === "boolean" ? false : "")

const toCellInput = (value: unknown, type: DataColumnType): CellInput => {
  if (type === "boolean") return value === true || value === "true"
  if (value === null || value === undefined) return ""
  return String(value)
}

const fromCellInput = (value: CellInput, type: DataColumnType): unknown => {
  if (type === "boolean") return Boolean(value)
  const str = typeof value === "string" ? value.trim() : value
  if (str === "") return null
  if (type === "number") {
    const n = Number(str)
    return Number.isFinite(n) ? n : str
  }
  return str
}

const displayCell = (value: unknown, type: DataColumnType): string => {
  if (value === null || value === undefined || value === "") return "—"
  if (type === "boolean") return value === true || value === "true" ? "✓ true" : "✗ false"
  if (type === "datetime") return formatDateTime(String(value))
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function DataTablesSection({ controller }: Props) {
  const projectId = controller.selectedProject.id

  const [tables, setTables] = useState<DataTable[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)

  const [showCreateTable, setShowCreateTable] = useState(false)
  const [newTableName, setNewTableName] = useState("")
  const [newTableDesc, setNewTableDesc] = useState("")

  const [rows, setRows] = useState<DataTableRow[]>([])
  const [rowsTotal, setRowsTotal] = useState(0)
  const [rowsLoading, setRowsLoading] = useState(false)

  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (reason) {
      setError((reason as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const loadTables = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await request<DataTable[]>(apiRoutes.projects.dataTables(projectId))
      setTables(result.data)
      setSelectedTableId((prev) => {
        if (prev && result.data.some((t) => t.id === prev)) return prev
        return result.data[0]?.id ?? null
      })
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadRows = useCallback(async (tableId: string) => {
    setRowsLoading(true)
    try {
      const result = await request<{ rows: DataTableRow[]; total: number }>(apiRoutes.dataTables.rows(tableId, { limit: 200 }))
      setRows(result.data.rows)
      setRowsTotal(result.data.total)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setRowsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTables()
  }, [loadTables])

  useEffect(() => {
    if (selectedTableId) void loadRows(selectedTableId)
    else {
      setRows([])
      setRowsTotal(0)
    }
  }, [selectedTableId, loadRows])

  const refreshTables = async () => {
    await loadTables()
    if (selectedTableId) await loadRows(selectedTableId)
  }

  const handleCreateTable = async () => {
    if (!newTableName.trim()) return
    const created = await run(() =>
      request<DataTable>(apiRoutes.projects.dataTables(projectId), {
        method: "POST",
        body: JSON.stringify({ name: newTableName.trim(), description: newTableDesc.trim() }),
      }),
    )
    if (created) {
      setNewTableName("")
      setNewTableDesc("")
      setShowCreateTable(false)
      await loadTables()
      setSelectedTableId(created.data.id)
    }
  }

  const handleDeleteTable = async (table: DataTable) => {
    if (!window.confirm(`确定删除数据表「${table.name}」吗？表内所有字段与数据行都会被清除。`)) return
    const ok = await run(() => request(apiRoutes.dataTables.remove(table.id), { method: "DELETE" }))
    if (ok) {
      if (selectedTableId === table.id) setSelectedTableId(null)
      await loadTables()
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Data Tables"
        title="数据表"
        description="为当前项目维护可增删改查的持久化数据表（行 + 字段）。脚本运行时可通过 tables.* 读写它，用于跨运行记录与去重——例如标记某篇论文是否已被分析过，让后续运行和其他人都能查到。"
        actions={
          <Button size="sm" onClick={() => setShowCreateTable((v) => !v)} disabled={busy} className="cursor-pointer">
            <span className="material-symbols-outlined text-sm mr-1">{showCreateTable ? "close" : "add"}</span>
            {showCreateTable ? "取消" : "新建数据表"}
          </Button>
        }
      />

      {showCreateTable ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">新建数据表</CardTitle>
            <CardDescription className="text-[11px]">表名在项目内唯一。脚本写入未知字段时会自动补列。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[220px_1fr_auto] items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">表名</label>
                <input className={inputCls} placeholder="例如：analyzed_papers" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">描述（可选）</label>
                <input className={inputCls} placeholder="用途说明" value={newTableDesc} onChange={(e) => setNewTableDesc(e.target.value)} />
              </div>
              <Button size="sm" onClick={handleCreateTable} disabled={busy || !newTableName.trim()} className="h-9 rounded-lg cursor-pointer">
                <span className="material-symbols-outlined text-sm mr-1">add</span>
                创建
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</div> : null}

      {loading ? (
        <div className="text-xs text-muted-foreground">加载中…</div>
      ) : tables.length === 0 ? (
        <EmptyState
          title="暂无数据表"
          description="点击上方『新建数据表』创建第一张表。也可以直接在脚本里 tables.insert('表名', { ... })，运行时会自动创建表与字段。"
          actionLabel="新建数据表"
          onAction={() => setShowCreateTable(true)}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr] items-start">
          {/* 左侧：表列表 */}
          <div className="space-y-2">
            {tables.map((table) => {
              const active = table.id === selectedTableId
              return (
                <button
                  key={table.id}
                  onClick={() => setSelectedTableId(table.id)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all cursor-pointer ${active ? "border-primary/50 bg-primary/10" : "border-border/60 bg-card/50 hover:bg-secondary/40"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground truncate">{table.name}</span>
                    <Badge tone="info" className="text-[9px] shrink-0">{table.rowCount} 行</Badge>
                  </div>
                  {table.description ? <p className="text-[11px] text-muted-foreground truncate mt-0.5">{table.description}</p> : null}
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">{table.columns.length} 个字段</p>
                </button>
              )
            })}
          </div>

          {/* 右侧：选中表的字段 + 行 */}
          {selectedTable ? (
            <TableDetail
              key={selectedTable.id}
              table={selectedTable}
              rows={rows}
              rowsTotal={rowsTotal}
              rowsLoading={rowsLoading}
              busy={busy}
              run={run}
              onChanged={refreshTables}
              onDeleteTable={() => handleDeleteTable(selectedTable)}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

type DetailProps = {
  table: DataTable
  rows: DataTableRow[]
  rowsTotal: number
  rowsLoading: boolean
  busy: boolean
  run: <T,>(fn: () => Promise<T>) => Promise<T | null>
  onChanged: () => Promise<void>
  onDeleteTable: () => void
}

function TableDetail({ table, rows, rowsTotal, rowsLoading, busy, run, onChanged, onDeleteTable }: DetailProps) {
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [colName, setColName] = useState("")
  const [colType, setColType] = useState<DataColumnType>("string")

  const [showAddRow, setShowAddRow] = useState(false)
  const [newRow, setNewRow] = useState<Record<string, CellInput>>({})

  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editRow, setEditRow] = useState<Record<string, CellInput>>({})

  const columns = table.columns

  const buildRowData = (values: Record<string, CellInput>): Record<string, unknown> => {
    const data: Record<string, unknown> = {}
    for (const col of columns) {
      data[col.name] = fromCellInput(values[col.name] ?? emptyCellValue(col.type), col.type)
    }
    return data
  }

  const handleAddColumn = async () => {
    if (!colName.trim()) return
    const ok = await run(() =>
      request(apiRoutes.dataTables.columns(table.id), { method: "POST", body: JSON.stringify({ name: colName.trim(), type: colType }) }),
    )
    if (ok) {
      setColName("")
      setColType("string")
      setShowAddColumn(false)
      await onChanged()
    }
  }

  const handleUpdateColumnType = async (col: DataTableColumn, type: DataColumnType) => {
    const ok = await run(() => request(apiRoutes.dataTables.column(table.id, col.id), { method: "PATCH", body: JSON.stringify({ type }) }))
    if (ok) await onChanged()
  }

  const handleDeleteColumn = async (col: DataTableColumn) => {
    if (!window.confirm(`删除字段「${col.name}」？所有行里该字段的数据会被移除。`)) return
    const ok = await run(() => request(apiRoutes.dataTables.column(table.id, col.id), { method: "DELETE" }))
    if (ok) await onChanged()
  }

  const handleAddRow = async () => {
    const ok = await run(() => request(apiRoutes.dataTables.rows(table.id), { method: "POST", body: JSON.stringify({ data: buildRowData(newRow) }) }))
    if (ok) {
      setNewRow({})
      setShowAddRow(false)
      await onChanged()
    }
  }

  const startEditRow = (row: DataTableRow) => {
    const values: Record<string, CellInput> = {}
    for (const col of columns) values[col.name] = toCellInput(row.data[col.name], col.type)
    setEditRow(values)
    setEditingRowId(row.id)
  }

  const handleSaveRow = async () => {
    if (!editingRowId) return
    const ok = await run(() =>
      request(apiRoutes.dataTables.row(table.id, editingRowId), { method: "PATCH", body: JSON.stringify({ data: buildRowData(editRow) }) }),
    )
    if (ok) {
      setEditingRowId(null)
      await onChanged()
    }
  }

  const handleDeleteRow = async (row: DataTableRow) => {
    if (!window.confirm("确定删除该数据行吗？")) return
    const ok = await run(() => request(apiRoutes.dataTables.row(table.id, row.id), { method: "DELETE" }))
    if (ok) await onChanged()
  }

  const renderCellInput = (col: DataTableColumn, values: Record<string, CellInput>, setValues: (v: Record<string, CellInput>) => void) => {
    const value = values[col.name] ?? emptyCellValue(col.type)
    if (col.type === "boolean") {
      return (
        <input
          type="checkbox"
          className="size-4 cursor-pointer accent-primary"
          checked={Boolean(value)}
          onChange={(e) => setValues({ ...values, [col.name]: e.target.checked })}
        />
      )
    }
    return (
      <input
        className={inputCls}
        type={col.type === "number" ? "number" : col.type === "datetime" ? "datetime-local" : "text"}
        value={typeof value === "boolean" ? "" : value}
        onChange={(e) => setValues({ ...values, [col.name]: e.target.value })}
      />
    )
  }

  return (
    <Card className="border-border/60 bg-card/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-muted-foreground">table</span>
              {table.name}
            </CardTitle>
            <CardDescription className="text-[11px] mt-1">
              {table.description || "（无描述）"} · 共 {rowsTotal} 行 · {columns.length} 个字段
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowAddColumn((v) => !v)} disabled={busy} className="h-8 rounded-lg border border-border/60 text-[11px] cursor-pointer">
              <span className="material-symbols-outlined text-sm mr-1">view_column</span>
              添加字段
            </Button>
            <Button size="sm" variant="ghost" onClick={onDeleteTable} disabled={busy} className="h-8 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] cursor-pointer">
              <span className="material-symbols-outlined text-sm">delete</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAddColumn ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] items-end rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">字段名</label>
              <input className={inputCls} placeholder="例如：doi" value={colName} onChange={(e) => setColName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">类型</label>
              <select className={inputCls} value={colType} onChange={(e) => setColType(e.target.value as DataColumnType)}>
                {COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>{COLUMN_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={handleAddColumn} disabled={busy || !colName.trim()} className="h-9 rounded-lg cursor-pointer">添加</Button>
          </div>
        ) : null}

        {/* 字段管理 */}
        {columns.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {columns.map((col) => (
              <div key={col.id} className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2 py-1">
                <span className="text-xs font-mono text-foreground">{col.name}</span>
                <select
                  className="text-[10px] bg-transparent text-muted-foreground border-none focus:outline-none cursor-pointer"
                  value={col.type}
                  onChange={(e) => handleUpdateColumnType(col, e.target.value as DataColumnType)}
                  disabled={busy}
                >
                  {COLUMN_TYPES.map((t) => (
                    <option key={t} value={t}>{COLUMN_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <button onClick={() => handleDeleteColumn(col)} disabled={busy} className="text-muted-foreground/60 hover:text-rose-500 cursor-pointer" title="删除字段">
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">还没有字段。先添加字段，或直接添加数据行（脚本写入时也会自动补列）。</p>
        )}

        {/* 行操作 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{rowsLoading ? "加载行…" : `${rows.length} / ${rowsTotal} 行`}</span>
          <Button size="sm" onClick={() => setShowAddRow((v) => !v)} disabled={busy || columns.length === 0} className="h-8 rounded-lg cursor-pointer">
            <span className="material-symbols-outlined text-sm mr-1">{showAddRow ? "close" : "add"}</span>
            {showAddRow ? "取消" : "添加行"}
          </Button>
        </div>

        {columns.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40">
                <tr>
                  {columns.map((col) => (
                    <th key={col.id} className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">
                      {col.name}
                      <span className="ml-1 text-[9px] text-muted-foreground font-normal">{COLUMN_TYPE_LABELS[col.type]}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-foreground w-px">操作</th>
                </tr>
              </thead>
              <tbody>
                {showAddRow ? (
                  <tr className="border-t border-border/60 bg-primary/5">
                    {columns.map((col) => (
                      <td key={col.id} className="px-3 py-2">{renderCellInput(col, newRow, setNewRow)}</td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" onClick={handleAddRow} disabled={busy} className="h-7 rounded-lg cursor-pointer text-[11px]">保存</Button>
                    </td>
                  </tr>
                ) : null}
                {rows.map((row) => {
                  const editing = editingRowId === row.id
                  return (
                    <tr key={row.id} className="border-t border-border/60 hover:bg-secondary/20">
                      {columns.map((col) => (
                        <td key={col.id} className="px-3 py-2 align-top">
                          {editing ? renderCellInput(col, editRow, setEditRow) : <span className="text-foreground break-words">{displayCell(row.data[col.name], col.type)}</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {editing ? (
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="sm" onClick={handleSaveRow} disabled={busy} className="h-7 rounded-lg cursor-pointer text-[11px]">保存</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingRowId(null)} className="h-7 rounded-lg border border-border/60 cursor-pointer text-[11px]">取消</Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => startEditRow(row)} disabled={busy} className="text-muted-foreground hover:text-primary cursor-pointer" title="编辑">
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                            <button onClick={() => handleDeleteRow(row)} disabled={busy} className="text-muted-foreground hover:text-rose-500 cursor-pointer" title="删除">
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && !showAddRow ? (
                  <tr className="border-t border-border/60">
                    <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted-foreground">暂无数据行</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
