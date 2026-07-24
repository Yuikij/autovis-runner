import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

const SECRET_PREFIX = "enc:v1:"
const CIPHER_ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

let cachedKeyMaterial: { source: string; key: Buffer } | null = null
const warnedMessages = new Set<string>()

const warnOnce = (message: string) => {
  if (warnedMessages.has(message)) {
    return
  }
  warnedMessages.add(message)
  console.warn(`[AutoVis] ${message}`)
}

const resolveKeyMaterial = (): Buffer | null => {
  const source = process.env.AUTOVIS_SECRET_KEY?.trim()
  if (!source) {
    cachedKeyMaterial = null
    return null
  }

  if (cachedKeyMaterial?.source === source) {
    return cachedKeyMaterial.key
  }

  const key = createHash("sha256").update(source, "utf8").digest()
  cachedKeyMaterial = { source, key }
  return key
}

export const encryptStoredText = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null
  }

  const key = resolveKeyMaterial()
  if (!key) {
    return value
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${SECRET_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`
}

export const decryptStoredText = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null
  }

  if (!value.startsWith(SECRET_PREFIX)) {
    return value
  }

  const key = resolveKeyMaterial()
  if (!key) {
    warnOnce("Encrypted persisted secrets were found but AUTOVIS_SECRET_KEY is not configured; sensitive values will stay unavailable until the key is provided.")
    return null
  }

  const parts = value.slice(SECRET_PREFIX.length).split(".")
  if (parts.length !== 3) {
    warnOnce("Malformed encrypted persisted secret payload was ignored.")
    return null
  }

  const [ivRaw, authTagRaw, encryptedRaw] = parts

  try {
    const iv = Buffer.from(ivRaw, "base64url")
    const authTag = Buffer.from(authTagRaw, "base64url")
    const encrypted = Buffer.from(encryptedRaw, "base64url")
    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
  } catch {
    warnOnce("Failed to decrypt persisted secret; check AUTOVIS_SECRET_KEY. Sensitive values backed by that payload are temporarily unavailable.")
    return null
  }
}
