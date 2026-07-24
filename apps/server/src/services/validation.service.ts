import { AutoVisDatabase } from "../db.js"
import { now } from "./common.js"
import { type LlmConfigService } from "./llm-config.service.js"
import { CopilotSessionError } from "../copilot.js"
import { generateValidationScriptWithLlmV2 } from "../llm.js"
import {
  executeLoginStatusCheck,
  executeValidationScriptGeneration,
  type ValidationLlmCallInput,
  type ValidationStepEmitter,
} from "../agent/validation.js"
import { decorateAuthProfile } from "./authProfile.utils.js"
import { type ValidationTask, type ValidationTaskKind } from "@autovis/shared"

export class ValidationService {
  private readonly validationSubscribers = new Map<string, Set<(task: ValidationTask) => void>>()

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly llmService: LlmConfigService,
  ) {}

  public getValidationTask(taskId: string): ValidationTask | undefined {
    return this.db.getValidationTask(taskId)
  }

  public subscribeValidationTask(taskId: string, listener: (task: ValidationTask) => void): () => void {
    if (!this.validationSubscribers.has(taskId)) {
      this.validationSubscribers.set(taskId, new Set())
    }
    this.validationSubscribers.get(taskId)!.add(listener)
    return () => { this.validationSubscribers.get(taskId)?.delete(listener) }
  }

  private notifyValidationTask(task: ValidationTask) {
    this.db.upsertValidationTask(task)
    const subs = this.validationSubscribers.get(task.id)
    if (subs) {
      const snapshot = { ...task, steps: [...task.steps] }
      for (const listener of subs) listener(snapshot)
    }
  }

  private createValidationTask(profileId: string, kind: ValidationTaskKind, targetUrlId?: string): ValidationTask {
    const prefix = kind === "check" ? "vcheck" : "vtask"
    const taskId = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const task: ValidationTask = { id: taskId, profileId, kind, targetUrlId, status: "running", steps: [] }
    this.db.upsertValidationTask(task)
    return task
  }

  private makeStepEmitter(taskId: string): ValidationStepEmitter {
    const getTask = () => this.db.getValidationTask(taskId)
    return {
      emit: (step) => {
        const task = getTask()
        if (!task) return
        task.steps = [...task.steps, { ...step }]
        this.notifyValidationTask(task)
      },
      updateLast: (patch) => {
        const task = getTask()
        if (!task || task.steps.length === 0) return
        const lastIndex = task.steps.length - 1
        task.steps = [...task.steps.slice(0, lastIndex), { ...task.steps[lastIndex], ...patch }]
        this.notifyValidationTask(task)
      },
    }
  }

  public startGenerateValidationScript(projectId: string, profileId: string, targetUrlId?: string, llmOwnerKey = "shared"): string {
    const task = this.createValidationTask(profileId, "generate", targetUrlId)
    void this.runGenerateValidationScript(task.id, projectId, profileId, targetUrlId, llmOwnerKey).catch((err) => {
      const current = this.db.getValidationTask(task.id)
      if (!current) return
      current.status = "error"
      current.error = err instanceof Error ? err.message : String(err)
      current.steps = [
        ...current.steps,
        {
          kind: "result",
          label: "任务终止",
          status: "error",
          detail: current.error,
        },
      ]
      this.notifyValidationTask(current)
    })
    return task.id
  }

  public startCheckLoginStatus(projectId: string, profileId: string, targetUrlId: string): string {
    const task = this.createValidationTask(profileId, "check", targetUrlId)
    void this.runCheckLoginStatus(task.id, projectId, profileId, targetUrlId).catch((err) => {
      const current = this.db.getValidationTask(task.id)
      if (!current) return
      current.status = "error"
      current.error = err instanceof Error ? err.message : String(err)
      current.steps = [
        ...current.steps,
        {
          kind: "result",
          label: "重放终止",
          status: "error",
          detail: current.error,
        },
      ]
      this.notifyValidationTask(current)
    })
    return task.id
  }

  private resolveTargetUrlForProfile(projectId: string, targetUrlId?: string) {
    const resolved = this.db.resolveTargetUrl(projectId, targetUrlId)
    if (!resolved || !resolved.id) {
      throw new Error("无法解析目标 URL：请确认登录态对应的 URL 已加入项目网址管理。")
    }
    const targetUrl = this.db.getTargetUrl(resolved.id)
    if (!targetUrl) throw new Error("无法找到目标 URL 记录")
    return targetUrl
  }

  private async runGenerateValidationScript(taskId: string, projectId: string, profileId: string, targetUrlId?: string, llmOwnerKey = "shared") {
    const project = this.db.getProject(projectId)
    if (!project) throw new Error("Project not found")
    const authProfile = this.db.getAuthProfile(profileId)
    if (!authProfile) throw new Error("Auth profile not found")

    const targetUrl = this.resolveTargetUrlForProfile(projectId, targetUrlId)
    const state = this.db.getAuthProfileState(profileId, targetUrl.id)
    if (!state?.storageStateJson) {
      throw new Error(`目标 URL「${targetUrl.label}」尚未捕获 storageState。请先在概览页对该 URL 执行『刷新登录态』。`)
    }

    const { state: llmState, current } = this.llmService.getActiveLlmConfigBundle(undefined, llmOwnerKey)
    if (current.session.connectionStatus !== "connected") {
      throw new Error("当前 AI 配置未连接。失效校验脚本依赖 LLM 基于实际页面差异生成，无法在断连状态下安全生成。")
    }

    const emitter = this.makeStepEmitter(taskId)

    const callLlm = async (input: ValidationLlmCallInput) => {
      try {
        const code = await generateValidationScriptWithLlmV2({
          ...input,
          authProfileName: input.profile.name,
          authProfileDescription: input.profile.description,
          session: current.session,
          secrets: current.secrets,
        })
        current.session.lastError = undefined
        this.llmService.saveLlmConfigState(llmState, llmOwnerKey)
        return code
      } catch (error) {
        const message = error instanceof Error
          ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
          : "LLM generation failed"
        if (error instanceof CopilotSessionError && error.statusCode === 401 && current.session.provider === "copilot-proxy") {
          const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
          this.llmService.applyCopilotSessionError(bundle, message, { disconnect: true, clearSecrets: true })
          current.session = bundle.session
          current.secrets = { ...current.secrets, copilot: bundle.secrets }
        } else {
          current.session.lastError = message
          current.session.lastSyncedAt = now()
        }
        this.llmService.saveLlmConfigState(llmState, llmOwnerKey)
        throw error
      }
    }

    const { code } = await executeValidationScriptGeneration({
      taskId,
      project,
      authProfile,
      targetUrl,
      storageStateJson: state.storageStateJson,
      emitter,
      callLlm,
      maxAttempts: 3,
    })

    emitter.emit({ kind: "save", label: "校验脚本通过双向回归，正在落库", status: "running" })
    this.db.updateAuthProfileValidationScript(profileId, code)
    const updated = this.db.getAuthProfile(profileId)
    emitter.updateLast({ status: "done", detail: "已写入 auth_profile.validationScript" })
    emitter.emit({
      kind: "result",
      label: "校验脚本生成完成",
      status: "done",
      detail: "校验脚本对所有目标 URL 通用；可在概览页对其他 URL 单独执行『检查登录状态』。",
      codePreview: code,
    })

    const task = this.db.getValidationTask(taskId)
    if (task) {
      task.status = "completed"
      task.resultProfile = decorateAuthProfile(updated) ?? undefined
      this.notifyValidationTask(task)
    }
  }

  private async runCheckLoginStatus(taskId: string, projectId: string, profileId: string, targetUrlId: string) {
    const project = this.db.getProject(projectId)
    if (!project) throw new Error("Project not found")
    const authProfile = this.db.getAuthProfile(profileId)
    if (!authProfile) throw new Error("Auth profile not found")

    const targetUrl = this.resolveTargetUrlForProfile(projectId, targetUrlId)
    const state = this.db.getAuthProfileState(profileId, targetUrl.id)
    if (!state?.storageStateJson) {
      throw new Error(`目标 URL「${targetUrl.label}」尚未捕获 storageState。请先在概览页执行『刷新登录态』。`)
    }

    const emitter = this.makeStepEmitter(taskId)
    const result = await executeLoginStatusCheck({
      taskId,
      project,
      authProfile,
      targetUrl,
      storageStateJson: state.storageStateJson,
      emitter,
    })

    const task = this.db.getValidationTask(taskId)
    if (task) {
      task.status = "completed"
      task.checkResult = result
      task.error = result.valid ? undefined : result.error
      this.notifyValidationTask(task)
    }
  }
}
