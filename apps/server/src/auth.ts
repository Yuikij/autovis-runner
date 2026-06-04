import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

export type LlmScope = "shared" | "per_user"

export interface AuthUser {
  id: string
  username: string
  role: "admin" | "user"
}

export interface AuthSession {
  user: AuthUser | null
  authEnabled: boolean
  llmScope: LlmScope
}

export const authEnabled = ["1", "true", "yes", "on"].includes((process.env.AUTOVIS_AUTH_ENABLED ?? "").toLowerCase())
export const llmScope: LlmScope = process.env.AUTOVIS_LLM_SCOPE === "per_user" ? "per_user" : "shared"

export const sharedLlmOwnerKey = "shared"
export const llmOwnerForUser = (user?: AuthUser | null) =>
  authEnabled && llmScope === "per_user" && user ? `user:${user.id}` : sharedLlmOwnerKey

const cookieName = "autovis_session"
const sessionTtlMs = 1000 * 60 * 60 * 24 * 14

export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `scrypt:${salt}:${hash}`
}

export const verifyPassword = (password: string, passwordHash: string) => {
  const [kind, salt, expected] = passwordHash.split(":")
  if (kind !== "scrypt" || !salt || !expected) return false
  const actual = scryptSync(password, salt, 64)
  const expectedBuffer = Buffer.from(expected, "hex")
  return expectedBuffer.length === actual.length && timingSafeEqual(actual, expectedBuffer)
}

const parseCookies = (header: string | undefined) => {
  const cookies = new Map<string, string>()
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=")
    if (index <= 0) continue
    cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()))
  }
  return cookies
}

export const getSessionToken = (request: FastifyRequest) => parseCookies(request.headers.cookie).get(cookieName)

export const setSessionCookie = (reply: FastifyReply, token: string) => {
  reply.header(
    "Set-Cookie",
    `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
  )
}

export const clearSessionCookie = (reply: FastifyReply) => {
  reply.header("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export const sessionExpiresAt = () => new Date(Date.now() + sessionTtlMs).toISOString()

export const getRequestUser = (request: FastifyRequest): AuthUser | null =>
  (request as FastifyRequest & { authUser?: AuthUser | null }).authUser ?? null

export const getRequestLlmOwnerKey = (request: FastifyRequest) => llmOwnerForUser(getRequestUser(request))

const isPublicApi = (url: string) =>
  url === "/api/auth/session" ||
  url === "/api/auth/login" ||
  url === "/api/auth/logout" ||
  url === "/api/health" ||
  url === "/api/ready" ||
  url === "/api/metrics"

export const registerAuthHook = (
  app: FastifyInstance,
  resolveUser: (token: string | undefined) => AuthUser | null,
) => {
  app.addHook("preHandler", async (request, reply) => {
    const user = resolveUser(getSessionToken(request))
    ;(request as FastifyRequest & { authUser?: AuthUser | null }).authUser = user

    if (!authEnabled) return
    const url = request.raw.url ?? ""
    if (!url.startsWith("/api/") || isPublicApi(url.split("?")[0] ?? url)) return
    if (user) return

    return reply.code(401).send({ message: "Authentication required" })
  })
}
