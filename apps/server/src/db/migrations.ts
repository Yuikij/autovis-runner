import { basename, dirname, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"

import { log } from "../log.js"
import { createBaseSchema } from "./schema.js"

type DatabaseMigration = {
  version: number
  name: string
  run: (db: DatabaseSync) => void
}

const migrations: DatabaseMigration[] = [
  {
    version: 1,
    name: "base_schema",
    run: (db) => {
      createBaseSchema(db)
    },
  },
  {
    version: 2,
    name: "auth_profiles_validation_columns",
    run: (db) => {
      ensureColumn(db, "auth_profiles", "validation_script", "TEXT")
      ensureColumn(db, "auth_profiles", "validation_script_generated_at", "TEXT")
    },
  },
  {
    version: 3,
    name: "auth_profile_state_post_login_columns",
    run: (db) => {
      ensureColumn(db, "auth_profile_states", "post_login_url_auto", "TEXT")
      ensureColumn(db, "auth_profile_states", "post_login_url_override", "TEXT")
    },
  },
  {
    version: 4,
    name: "task_run_agent_tracking_columns",
    run: (db) => {
      ensureColumn(db, "task_runs", "current_agent_id", "TEXT")
      ensureColumn(db, "task_runs", "last_agent_id", "TEXT")
      ensureColumn(db, "agent_sessions", "task_run_id", "TEXT")
      ensureColumn(db, "agent_sessions", "direct_result", "TEXT")
    },
  },
  {
    version: 5,
    name: "test_case_target_url_id",
    run: (db) => {
      ensureColumn(db, "test_cases", "target_url_id", "TEXT")
    },
  },
  {
    version: 6,
    name: "target_url_needs_stealth",
    run: (db) => {
      ensureColumn(db, "target_urls", "needs_stealth", "INTEGER DEFAULT 0")
    },
  },
]

const ensureColumn = (db: DatabaseSync, tableName: string, columnName: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  if (columns.some((column) => column.name === columnName)) {
    return
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
}

const ensureMigrationTable = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

const listAppliedMigrationVersions = (db: DatabaseSync) => {
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all() as Array<{ version: number }>
  return new Set(rows.map((row) => row.version))
}

const getHighestAppliedMigrationVersion = (db: DatabaseSync) => {
  const row = db.prepare("SELECT MAX(version) as version FROM schema_migrations").get() as { version: number | null }
  return row.version ?? 0
}

const hasUserSchemaObjects = (db: DatabaseSync) => {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'view', 'trigger')
      AND name NOT LIKE 'sqlite_%'
      AND name != 'schema_migrations'
    LIMIT 1
  `).get() as { name?: string } | undefined

  return Boolean(row?.name)
}

const escapeSqlString = (value: string) => value.replaceAll("'", "''")

const createPreMigrationBackup = (db: DatabaseSync, databaseFile: string) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const fileBaseName = basename(databaseFile).replace(/\.db$/i, "") || basename(databaseFile)
  const backupFile = join(dirname(databaseFile), `${fileBaseName}.backup.${timestamp}.sqlite`)
  db.exec(`VACUUM INTO '${escapeSqlString(backupFile)}'`)
  return backupFile
}

const recordAppliedMigration = (db: DatabaseSync, migration: DatabaseMigration) => {
  db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
    migration.version,
    migration.name,
    new Date().toISOString(),
  )
  db.exec(`PRAGMA user_version = ${migration.version}`)
}

export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1]?.version ?? 0

export const runMigrations = (
  db: DatabaseSync,
  options: {
    databaseFile: string
    databaseExisted: boolean
  },
) => {
  ensureMigrationTable(db)

  const appliedVersions = listAppliedMigrationVersions(db)
  const pendingMigrations = migrations.filter((migration) => !appliedVersions.has(migration.version))

  if (pendingMigrations.length === 0) {
    const currentVersion = getHighestAppliedMigrationVersion(db)
    if (currentVersion > 0) {
      db.exec(`PRAGMA user_version = ${currentVersion}`)
    }
    return
  }

  if (options.databaseExisted && hasUserSchemaObjects(db)) {
    const backupFile = createPreMigrationBackup(db, options.databaseFile)
    log.info("db.migration.backup_created", { backupFile })
  }

  for (const migration of pendingMigrations) {
    db.exec("BEGIN IMMEDIATE")
    try {
      migration.run(db)
      recordAppliedMigration(db, migration)
      db.exec("COMMIT")
      log.info("db.migration.applied", {
        version: migration.version,
        name: migration.name,
      })
    } catch (error) {
      db.exec("ROLLBACK")
      throw new Error(
        `Failed to apply database migration v${migration.version} (${migration.name}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}