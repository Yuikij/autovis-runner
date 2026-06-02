import type { DatabaseSync, SQLOutputValue } from "node:sqlite"
import type { AuthUser } from "../../auth.js"

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]
const typedRow = <TRow>(row: Record<string, SQLOutputValue> | undefined): TRow | undefined => row as TRow | undefined

interface UserRow {
  id: string
  username: string
  password_hash: string
  role: AuthUser["role"]
  created_at: string
  updated_at: string
}

interface SessionRow {
  token: string
  user_id: string
  expires_at: string
  created_at: string
}

export const mapUser = (row: UserRow): AuthUser => ({
  id: row.id,
  username: row.username,
  role: row.role === "admin" ? "admin" : "user",
})

export const countUsers = (db: DatabaseSync) => {
  const row = typedRow<{ count: number }>(db.prepare("SELECT COUNT(*) AS count FROM users").get())
  return Number(row?.count ?? 0)
}

export const upsertUser = (db: DatabaseSync, input: { id: string; username: string; passwordHash: string; role: AuthUser["role"]; now: string }) => {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = excluded.role,
      updated_at = excluded.updated_at
  `).run(input.id, input.username, input.passwordHash, input.role, input.now, input.now)
}

export const findUserByUsername = (db: DatabaseSync, username: string) =>
  typedRow<UserRow>(db.prepare("SELECT * FROM users WHERE username = ?").get(username))

export const findUserById = (db: DatabaseSync, id: string) =>
  typedRow<UserRow>(db.prepare("SELECT * FROM users WHERE id = ?").get(id))

export const createUserSession = (db: DatabaseSync, input: { token: string; userId: string; expiresAt: string; now: string }) => {
  db.prepare("INSERT INTO user_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(input.token, input.userId, input.expiresAt, input.now)
}

export const deleteUserSession = (db: DatabaseSync, token: string) => {
  db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token)
}

export const deleteExpiredUserSessions = (db: DatabaseSync, now: string) => {
  db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(now)
}

export const findUserBySessionToken = (db: DatabaseSync, token: string, now: string): AuthUser | undefined => {
  const row = typedRow<UserRow & SessionRow>(db.prepare(`
    SELECT users.*, user_sessions.token, user_sessions.expires_at, user_sessions.created_at
    FROM user_sessions
    JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token = ? AND user_sessions.expires_at > ?
  `).get(token, now))
  return row ? mapUser(row) : undefined
}
