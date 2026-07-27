import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { ApiEnvelope, DataTable, DataTableRow, DataTableRowPage } from "@browsewright/shared"
import { store } from "../store.js"
import { wrapDeleteOperation } from "./errorHandlers.js"

const columnTypeSchema = z.enum(["string", "number", "boolean", "datetime"])
const rowDataSchema = z.record(z.string(), z.unknown())

export async function dataTablesRoutes(app: FastifyInstance) {
  // ----- 表 -----
  app.get("/projects/:projectId/data-tables", async (request): Promise<ApiEnvelope<DataTable[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listDataTables(params.projectId) }
  })

  app.post("/projects/:projectId/data-tables", async (request): Promise<ApiEnvelope<DataTable>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z.object({ name: z.string().min(1), description: z.string().optional() }).parse(request.body)
    return { data: await store.createDataTable({ projectId: params.projectId, name: body.name, description: body.description }) }
  })

  app.patch("/data-tables/:tableId", async (request): Promise<ApiEnvelope<DataTable>> => {
    const params = z.object({ tableId: z.string() }).parse(request.params)
    const body = z.object({ name: z.string().min(1).optional(), description: z.string().optional() }).parse(request.body)
    return { data: await store.updateDataTable(params.tableId, body) }
  })

  app.delete("/data-tables/:tableId", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ tableId: z.string() }).parse(request.params)
    await store.deleteDataTable(params.tableId)
    return { data: true }
  })

  // ----- 列（字段）-----
  app.post("/data-tables/:tableId/columns", async (request): Promise<ApiEnvelope<DataTable>> => {
    const params = z.object({ tableId: z.string() }).parse(request.params)
    const body = z.object({ name: z.string().min(1), type: columnTypeSchema }).parse(request.body)
    return { data: await store.addDataTableColumn(params.tableId, body) }
  })

  app.patch("/data-tables/:tableId/columns/:columnId", async (request): Promise<ApiEnvelope<DataTable>> => {
    const params = z.object({ tableId: z.string(), columnId: z.string() }).parse(request.params)
    const body = z.object({ name: z.string().min(1).optional(), type: columnTypeSchema.optional() }).parse(request.body)
    return { data: await store.updateDataTableColumn(params.columnId, body) }
  })

  app.delete("/data-tables/:tableId/columns/:columnId", async (request): Promise<ApiEnvelope<DataTable>> => {
    const params = z.object({ tableId: z.string(), columnId: z.string() }).parse(request.params)
    return { data: await store.deleteDataTableColumn(params.columnId) }
  })

  // ----- 行 -----
  app.get("/data-tables/:tableId/rows", async (request): Promise<ApiEnvelope<DataTableRowPage>> => {
    const params = z.object({ tableId: z.string() }).parse(request.params)
    const query = z.object({ limit: z.coerce.number().optional(), offset: z.coerce.number().optional() }).parse(request.query)
    return { data: await store.listDataTableRows(params.tableId, query) }
  })

  app.post("/data-tables/:tableId/rows", async (request): Promise<ApiEnvelope<DataTableRow>> => {
    const params = z.object({ tableId: z.string() }).parse(request.params)
    const body = z.object({ data: rowDataSchema }).parse(request.body)
    return { data: await store.insertDataTableRow(params.tableId, body.data) }
  })

  app.patch("/data-tables/:tableId/rows/:rowId", async (request): Promise<ApiEnvelope<DataTableRow>> => {
    const params = z.object({ tableId: z.string(), rowId: z.string() }).parse(request.params)
    const body = z.object({ data: rowDataSchema }).parse(request.body)
    return { data: await store.updateDataTableRow(params.rowId, body.data) }
  })

  app.delete("/data-tables/:tableId/rows/:rowId", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ tableId: z.string(), rowId: z.string() }).parse(request.params)
    await wrapDeleteOperation(() => store.deleteDataTableRow(params.rowId), "无法删除该数据行。")
    return { data: true }
  })
}
