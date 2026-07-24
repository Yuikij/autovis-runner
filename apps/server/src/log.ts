type LogLevel = "debug" | "info" | "warn" | "error"

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const configuredLevel = ((process.env.AUTOVIS_LOG_LEVEL ?? "info").toLowerCase() as LogLevel)
const activeLevel = configuredLevel in levelOrder ? configuredLevel : "info"

const shouldLog = (level: LogLevel) => levelOrder[level] >= levelOrder[activeLevel]

const serializeError = (error: Error) => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
})

const serializeValue = (value: unknown): unknown => {
  if (value instanceof Error) {
    return serializeError(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeValue(item)]),
    )
  }
  return value
}

const emitLog = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
  if (!shouldLog(level)) {
    return
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields ? (serializeValue(fields) as Record<string, unknown>) : {}),
  }

  const line = JSON.stringify(payload)
  if (level === "error") {
    console.error(line)
    return
  }
  if (level === "warn") {
    console.warn(line)
    return
  }
  console.log(line)
}

export const log = {
  debug(event: string, fields?: Record<string, unknown>) {
    emitLog("debug", event, fields)
  },
  info(event: string, fields?: Record<string, unknown>) {
    emitLog("info", event, fields)
  },
  warn(event: string, fields?: Record<string, unknown>) {
    emitLog("warn", event, fields)
  },
  error(event: string, fields?: Record<string, unknown>) {
    emitLog("error", event, fields)
  },
}