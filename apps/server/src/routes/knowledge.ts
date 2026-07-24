import { createReadStream } from "node:fs"
import { extname } from "node:path"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { ApiEnvelope, KnowledgeEntry, KnowledgeFileContent, KnowledgeSearchResult, KnowledgeStats } from "@autovis/shared"
import { knowledgeService } from "../knowledge.js"

const projectParams = z.object({ projectId: z.string() })

const rawContentTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
}

export async function knowledgeRoutes(app: FastifyInstance) {
  // 目录树（递归，供前端左侧树渲染）
  app.get("/projects/:projectId/knowledge/tree", async (request): Promise<ApiEnvelope<{ entries: KnowledgeEntry[]; stats: KnowledgeStats; truncated: boolean }>> => {
    const params = projectParams.parse(request.params)
    return { data: await knowledgeService.listTree(params.projectId) }
  })

  // 全文关键字搜索（大小写不敏感，空格分词 AND 语义）
  app.get("/projects/:projectId/knowledge/search", async (request): Promise<ApiEnvelope<KnowledgeSearchResult>> => {
    const params = projectParams.parse(request.params)
    const query = z.object({ q: z.string().min(1) }).parse(request.query)
    return { data: await knowledgeService.search(params.projectId, query.q) }
  })

  // 读取文本文件
  app.get("/projects/:projectId/knowledge/file", async (request): Promise<ApiEnvelope<KnowledgeFileContent>> => {
    const params = projectParams.parse(request.params)
    const query = z.object({ path: z.string().min(1) }).parse(request.query)
    return { data: await knowledgeService.readFile(params.projectId, query.path) }
  })

  // 写入/覆盖文本文件（父目录自动创建）
  app.put("/projects/:projectId/knowledge/file", async (request): Promise<ApiEnvelope<{ path: string }>> => {
    const params = projectParams.parse(request.params)
    const body = z.object({ path: z.string().min(1), content: z.string() }).parse(request.body)
    const path = await knowledgeService.writeFile(params.projectId, body.path, body.content)
    return { data: { path } }
  })

  // 创建目录
  app.post("/projects/:projectId/knowledge/dir", async (request): Promise<ApiEnvelope<{ path: string }>> => {
    const params = projectParams.parse(request.params)
    const body = z.object({ path: z.string().min(1) }).parse(request.body)
    const path = await knowledgeService.createDirectory(params.projectId, body.path)
    return { data: { path } }
  })

  // 删除文件或目录（递归）
  app.delete("/projects/:projectId/knowledge/entry", async (request): Promise<ApiEnvelope<boolean>> => {
    const params = projectParams.parse(request.params)
    const query = z.object({ path: z.string().min(1) }).parse(request.query)
    return { data: await knowledgeService.removeEntry(params.projectId, query.path) }
  })

  // 移动文件或目录到目标目录（拖拽重组目录树）
  app.post("/projects/:projectId/knowledge/move", async (request): Promise<ApiEnvelope<{ path: string }>> => {
    const params = projectParams.parse(request.params)
    const body = z.object({ sourcePath: z.string().min(1), targetDirPath: z.string().optional().default("") }).parse(request.body)
    const path = await knowledgeService.moveEntry(params.projectId, body.sourcePath, body.targetDirPath)
    return { data: { path } }
  })

  // raw 访问：Markdown 内嵌图片、附件下载
  app.get("/projects/:projectId/knowledge/raw/*", async (request, reply) => {
    const params = projectParams.parse(request.params)
    const relativePath = String((request.params as Record<string, string>)["*"] ?? "")
    const resolved = await knowledgeService.resolveRawFile(params.projectId, relativePath).catch(() => null)
    if (!resolved) {
      reply.code(404).send({ message: "Not Found" })
      return
    }
    const contentType = rawContentTypes[extname(resolved.filePath).toLowerCase()] ?? "application/octet-stream"
    reply.header("cache-control", "private, max-age=30")
    reply.header("content-length", String(resolved.size))
    reply.type(contentType)
    return reply.send(createReadStream(resolved.filePath))
  })
}
