import { join } from "node:path"
import type { ExecutionRun, ExecutionStep, ExecutionStepKind, RuntimeOutput } from "@autovis/shared"

export const now = () => new Date().toISOString()

export const createStepId = (prefix: string, index: number) => `${prefix}_${index}_${Math.random().toString(36).slice(2, 8)}`

export const createRuntimeOutputId = (runId: string) => `${runId}_output_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export const normalizeRuntimeMatch = (value?: string) => value?.trim() ?? ""

export const matchesProducer = (output: RuntimeOutput, from: string) => {
  const target = normalizeRuntimeMatch(from)
  return [output.testCaseId, output.caseCode, output.caseName]
    .map((item) => normalizeRuntimeMatch(item))
    .some((item) => item === target)
}

export const formatRuntimeValue = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const isRuntimeOwnedData = (record: unknown, outputs: RuntimeOutput[], tempValues: Map<string, unknown>) => {
  const needle = formatRuntimeValue(record)
  const haystacks = [
    ...outputs.map((item) => formatRuntimeValue(item.value)),
    ...[...tempValues.values()].map((item) => formatRuntimeValue(item)),
  ]
  return haystacks.some((item) => item === needle || item.includes(needle))
}

export const toPublicArtifactUrl = (runId: string, fileName: string) => `/artifacts/${runId}/${fileName}`

export const artifactUrlToFilePath = (runDir: string, artifactUrl: string) => join(runDir, artifactUrl.split("/").at(-1) ?? "")

export const inferMimeTypeFromPath = (filePath: string) => {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  return "application/octet-stream"
}

export const createExecutionStep = (runId: string, index: number, title: string, log: string, kind?: ExecutionStepKind): ExecutionStep => ({
  id: createStepId(runId, index),
  title,
  kind,
  status: "queued",
  startedAt: now(),
  log,
})

export const markRunStep = async (
  run: ExecutionRun,
  stepIndex: number,
  status: "running" | "passed" | "failed",
  onUpdate: () => Promise<void> | void,
  log?: string,
  screenshotUrl?: string,
) => {
  const step = run.steps[stepIndex]
  if (!step) {
    return
  }
  step.status = status
  if (log) {
    step.log = log
    run.logs.push(`[${new Date().toLocaleTimeString()}] ${log}`)
  }
  if (screenshotUrl) {
    step.screenshotUrl = screenshotUrl
    run.currentViewport = screenshotUrl
  }
  if (status !== "running") {
    step.finishedAt = now()
  }
  await onUpdate()
}
