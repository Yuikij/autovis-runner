import { DatabaseSync } from "node:sqlite"
import { type Identifier, type AuthProfile, type AuthProfileState } from "@autovis/shared"
import { mapAuthProfile, mapAuthProfileState, type AuthProfileRow, type AuthProfileStateRow } from "../mappers.js"
import { encryptStoredText } from "../secrets.js"

export class AuthProfileRepository {
  constructor(private db: DatabaseSync) {}

  public getById(id: Identifier): AuthProfile | null {
    const row = this.db
      .prepare(`SELECT * FROM auth_profiles WHERE id = ?`)
      .get(id) as AuthProfileRow | undefined
    if (!row) return null
    const states = this.listStates(id)
    return mapAuthProfile(row, states)
  }

  public listByProjectId(projectId: Identifier): AuthProfile[] {
    const rows = this.db
      .prepare(`SELECT * FROM auth_profiles WHERE project_id = ? ORDER BY updated_at DESC`)
      .all(projectId) as unknown as AuthProfileRow[]
    return rows.map((row) => mapAuthProfile(row, this.listStates(row.id)))
  }

  public upsert(profile: AuthProfile): AuthProfile {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(`
      INSERT INTO auth_profiles (
        id, project_id, name, description, source_case_id, validation_script_id, validation_script, validation_script_generated_at, created_at, updated_at
      )
      VALUES (
        @id, @projectId, @name, @description, @sourceCaseId, @validationScriptId, @validationScript, @validationScriptGeneratedAt, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        source_case_id = excluded.source_case_id,
        validation_script_id = excluded.validation_script_id,
        validation_script = excluded.validation_script,
        validation_script_generated_at = excluded.validation_script_generated_at,
        updated_at = excluded.updated_at
    `)

    stmt.run({
      id: profile.id,
      projectId: profile.projectId,
      name: profile.name,
      description: profile.description ?? null,
      sourceCaseId: profile.sourceCaseId,
      validationScriptId: profile.validationScriptId ?? null,
      validationScript: profile.validationScript ?? null,
      validationScriptGeneratedAt: profile.validationScriptGeneratedAt ?? null,
      createdAt: profile.createdAt || now,
      updatedAt: now,
    })

    return this.getById(profile.id)!
  }

  public updateValidationScript(id: Identifier, code: string): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      UPDATE auth_profiles
      SET validation_script = ?, validation_script_generated_at = ?, updated_at = ?
      WHERE id = ?
    `).run(code, now, now, id)
  }

  public delete(id: Identifier): void {
    this.db.prepare(`DELETE FROM auth_profile_states WHERE auth_profile_id = ?`).run(id)
    this.db.prepare(`DELETE FROM auth_profiles WHERE id = ?`).run(id)
  }

  // ---- AuthProfileState (per-targetUrl storage state) ----

  public listStates(authProfileId: Identifier): AuthProfileState[] {
    const rows = this.db
      .prepare(`SELECT * FROM auth_profile_states WHERE auth_profile_id = ? ORDER BY updated_at DESC`)
      .all(authProfileId) as unknown as AuthProfileStateRow[]
    return rows.map(mapAuthProfileState)
  }

  public getState(authProfileId: Identifier, targetUrlId: Identifier): AuthProfileState | null {
    const row = this.db
      .prepare(`SELECT * FROM auth_profile_states WHERE auth_profile_id = ? AND target_url_id = ?`)
      .get(authProfileId, targetUrlId) as AuthProfileStateRow | undefined
    return row ? mapAuthProfileState(row) : null
  }

  /**
   * 用于 "刷新登录态" 流程：同时写 storageState 和自动采集的 post_login_url_auto。
   * 不会触碰用户手动覆盖的 post_login_url_override，确保下次刷新不会冲掉用户手改。
   */
  public upsertState(
    authProfileId: Identifier,
    targetUrlId: Identifier,
    storageStateJson: string | null,
    postLoginUrlAuto: string | null = null,
  ): AuthProfileState {
    const now = new Date().toISOString()
    const encryptedStorageStateJson = encryptStoredText(storageStateJson)
    this.db.prepare(`
      INSERT INTO auth_profile_states (
        auth_profile_id, target_url_id, storage_state_json, last_refreshed_at, updated_at, post_login_url_auto
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(auth_profile_id, target_url_id) DO UPDATE SET
        storage_state_json = excluded.storage_state_json,
        last_refreshed_at = excluded.last_refreshed_at,
        updated_at = excluded.updated_at,
        post_login_url_auto = excluded.post_login_url_auto
    `).run(
      authProfileId,
      targetUrlId,
      encryptedStorageStateJson,
      storageStateJson ? now : null,
      now,
      postLoginUrlAuto,
    )
    return this.getState(authProfileId, targetUrlId)!
  }

  /**
   * 用户在 UI 手动改写"登录后 URL"。传 null 表示清除覆盖，回到自动采集值。
   * 行不存在时新建一条空白记录承载这个 override（罕见，但保证幂等）。
   */
  public setStatePostLoginUrlOverride(
    authProfileId: Identifier,
    targetUrlId: Identifier,
    overrideUrl: string | null,
  ): AuthProfileState {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO auth_profile_states (
        auth_profile_id, target_url_id, storage_state_json, last_refreshed_at, updated_at, post_login_url_override
      ) VALUES (?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(auth_profile_id, target_url_id) DO UPDATE SET
        post_login_url_override = excluded.post_login_url_override,
        updated_at = excluded.updated_at
    `).run(authProfileId, targetUrlId, now, overrideUrl)
    return this.getState(authProfileId, targetUrlId)!
  }

  public deleteState(authProfileId: Identifier, targetUrlId: Identifier): void {
    this.db.prepare(`DELETE FROM auth_profile_states WHERE auth_profile_id = ? AND target_url_id = ?`)
      .run(authProfileId, targetUrlId)
  }
}
