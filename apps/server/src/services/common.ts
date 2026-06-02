import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const now = () => new Date().toISOString()
export const createId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`
export const escapeSingleQuotedString = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
export const escapeTemplateComment = (value: string) => value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")

const currentDir = dirname(fileURLToPath(import.meta.url))
export const rootDir = join(currentDir, "../../../../")
export const dataDir = process.env.DATA_DIR ?? join(rootDir, "data")
export const artifactsDir = join(dataDir, "artifacts")
export const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:8787"
