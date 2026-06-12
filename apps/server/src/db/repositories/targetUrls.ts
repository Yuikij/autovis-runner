import type { DatabaseSync } from "node:sqlite"
import type { Identifier, TargetUrl } from "@autovis/shared"
import { mapTargetUrl, type TargetUrlRow } from "../mappers.js"

export class TargetUrlRepository {
  constructor(private db: DatabaseSync) {}

  public listByProject(projectId: Identifier): TargetUrl[] {
    const rows = this.db
      .prepare("SELECT * FROM target_urls WHERE project_id = ? ORDER BY is_primary DESC, created_at ASC")
      .all(projectId) as unknown as TargetUrlRow[]
    return rows.map(mapTargetUrl)
  }

  public getById(id: Identifier): TargetUrl | null {
    const row = this.db.prepare("SELECT * FROM target_urls WHERE id = ?").get(id) as TargetUrlRow | undefined
    return row ? mapTargetUrl(row) : null
  }

  public findByUrl(projectId: Identifier, url: string): TargetUrl | null {
    const row = this.db
      .prepare("SELECT * FROM target_urls WHERE project_id = ? AND url = ?")
      .get(projectId, url) as TargetUrlRow | undefined
    return row ? mapTargetUrl(row) : null
  }

  public create(input: { id: Identifier; projectId: Identifier; label: string; url: string; needsStealth?: boolean }): TargetUrl {
    const timestamp = new Date().toISOString()
    this.db
      .prepare("INSERT INTO target_urls (id, project_id, label, url, is_primary, needs_stealth, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)")
      .run(input.id, input.projectId, input.label, input.url, input.needsStealth ? 1 : 0, timestamp, timestamp)
    return this.getById(input.id)!
  }

  public update(id: Identifier, patch: { label?: string; url?: string; needsStealth?: boolean }): TargetUrl {
    const existing = this.getById(id)
    if (!existing) throw new Error(`target_url not found: ${id}`)
    const nextLabel = patch.label ?? existing.label
    const nextUrl = patch.url ?? existing.url
    const nextNeedsStealth = patch.needsStealth ?? existing.needsStealth ?? false
    const timestamp = new Date().toISOString()
    this.db.prepare("UPDATE target_urls SET label = ?, url = ?, needs_stealth = ?, updated_at = ? WHERE id = ?")
      .run(nextLabel, nextUrl, nextNeedsStealth ? 1 : 0, timestamp, id)
    return this.getById(id)!
  }

  public delete(id: Identifier): void {
    const existing = this.getById(id)
    if (!existing) return
    if (existing.isPrimary) {
      throw new Error("主域名行不能直接删除，请在项目设置中修改主域名 URL。")
    }
    this.db.prepare("DELETE FROM target_urls WHERE id = ?").run(id)
  }

  /** 解析 targetUrlId 到 URL 字符串；若 id 不存在返回 null。 */
  public resolveUrl(id: Identifier | undefined | null): string | null {
    if (!id) return null
    const row = this.getById(id)
    return row?.url ?? null
  }
}
