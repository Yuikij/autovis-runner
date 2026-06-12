import { rm } from "node:fs/promises"
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

/**
 * 删除 data/artifacts 下与 run / agent session 对应的产物目录。
 * 删除执行记录时调用，保证截图、回放视频、trace 等磁盘产物随记录一起回收。
 */
export const removeArtifactDirs = async (ids: string[]) => {
  await Promise.all(
    ids
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id))
      .map((id) =>
        rm(join(artifactsDir, id), { recursive: true, force: true }).catch(() => undefined),
      ),
  )
}
