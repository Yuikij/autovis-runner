import { runAgentLoop } from "../agent.js"
import { generateScriptWithLlm, generateTextWithLlm, callLlmWithTools, type ChatMessage } from "../llm.js"
import { buildRewriteChatSystemPrompt, buildRewritePlanInstruction } from "../agent/prompts.js"
import { CopilotSessionError } from "../copilot.js"
import { log } from "../log.js"
import { AutoVisDatabase } from "../db.js"
import { knowledgeService } from "../knowledge.js"
import {
  type AgentStep,
  type CaseContract,
  type ContractField,
  type GenerateScriptRequest,
  type RewriteChatMessage,
  type RuntimeOutput,
  type ScriptArtifact,
} from "@autovis/shared"

import { appOrigin, artifactsDir, createId, escapeSingleQuotedString, escapeTemplateComment, now } from "./common.js"
import type { AgentWarmupService } from "./agent-warmup.service.js"
import type { LlmConfigService } from "./llm-config.service.js"
import type { ProjectService } from "./project.service.js"
import type { RunService } from "./run.service.js"
import { AgentSessionService } from "./agent-session.service.js"
import {
  type LlmOwned,
  closeWarmupSession,
  createAgentConflictError,
  ensureProjectAndTestCase,
  getOwnerKey,
  handleUnauthorizedCopilotError,
  prepareAgentExecutionContext,
} from "./agent-runtime-context.js"

const CONTRACT_FIELD_TYPES = ["string", "number", "integer", "boolean", "array", "object"]

/** 从 LLM 文本里抽出 JSON 对象：优先扒 ```json``` 代码块，否则截取第一个 { 到最后一个 }。 */
const extractJsonObject = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const body = (fenced ?? text).trim()
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  return start >= 0 && end > start ? body.slice(start, end + 1) : body
}

/** 清洗 LLM 产出的契约字段，丢弃非法项、归一化结构（与 define_contract 工具一致的语义）。 */
const sanitizeContractFields = (fields: unknown): ContractField[] => {
  if (!Array.isArray(fields)) return []
  return fields
    .filter((f): f is ContractField => Boolean(f) && typeof (f as ContractField).name === "string" && (f as ContractField).name.trim() !== "" && CONTRACT_FIELD_TYPES.includes((f as ContractField).type))
    .map((f) => ({
      name: f.name.trim(),
      type: f.type,
      description: typeof f.description === "string" ? f.description : undefined,
      required: f.required === true,
      default: f.default,
      format: typeof f.format === "string" ? f.format : undefined,
      items: f.items && CONTRACT_FIELD_TYPES.includes(f.items.type) ? { type: f.items.type } : undefined,
      enum: Array.isArray(f.enum) ? f.enum : undefined,
    }))
}

export class AgentGenerationService {
  constructor(
    private readonly db: AutoVisDatabase,
    private readonly projectService: ProjectService,
    private readonly llmService: LlmConfigService,
    private readonly runService: RunService,
    private readonly agentWarmupService: AgentWarmupService,
    private readonly sessionService: AgentSessionService,
  ) {}

  public createScriptArtifact(
    testCaseId: string,
    provider: ScriptArtifact["provider"],
    prompt: string,
    code: string,
    source: ScriptArtifact["source"] = "generated",
  ): ScriptArtifact {
    const nextVersion = this.db.listScriptsForTestCase(testCaseId).length + 1
    return {
      id: createId("script"),
      testCaseId,
      version: nextVersion,
      source,
      provider,
      prompt,
      code,
      createdAt: now(),
    }
  }

  public async saveScriptVersion(testCaseId: string, input: { code: string; baseScriptId?: string; prompt?: string }) {
    const testCase = this.db.getTestCase(testCaseId)
    if (!testCase) {
      throw new Error("Test case not found")
    }

    if (input.baseScriptId) {
      const baseScript = this.db.getScript(input.baseScriptId)
      if (!baseScript || baseScript.testCaseId !== testCaseId) {
        throw new Error("Base script not found")
      }
    }

    const script = this.createScriptArtifact(
      testCaseId,
      "manual-editor",
      input.prompt?.trim() || (input.baseScriptId ? `Manual editor save from ${input.baseScriptId}` : "Manual editor save"),
      input.code,
      "manual",
    )
    this.db.insertScript(script)
    return script
  }

  public async generateScript(request: GenerateScriptRequest & LlmOwned) {
    const ownerKey = getOwnerKey(request)
    const { state, current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const { project, testCase } = ensureProjectAndTestCase(this.db, request.projectId, request.testCaseId)

    const codeContextFiles = await this.projectService.getWorkspaceCodeContext(request.projectId)
    const codeContext = codeContextFiles.length > 0
      ? codeContextFiles.map((file) => `// --- ${escapeTemplateComment(file.path)} ---\n// ${escapeTemplateComment(file.content).split("\n").join("\n// ")}`).join("\n\n")
      : ""

    const promptSummary = request.prompt
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => `// ${escapeTemplateComment(line)}`)
      .join("\n")
    const scriptedSteps = testCase.steps.map((step, index) => `  // Step ${index + 1}: ${escapeTemplateComment(step)}`).join("\n")

    if (!request.runTargetUrlId) {
      throw new Error("生成脚本需要先在工作台选择一个目标 URL。")
    }
    const resolvedMockTarget = this.db.resolveTargetUrl(request.projectId, request.runTargetUrlId)
    if (!resolvedMockTarget?.url) {
      throw new Error(`所选的目标 URL 不存在或已被删除（targetUrlId=${request.runTargetUrlId}）。请刷新页面后重新选择。`)
    }
    const baseUrl = resolvedMockTarget.url

    let generatedCode = `import { test, expect } from '@playwright/test';
${codeContext ? `\n// === Code context (DOM reference) ===\n${codeContext}\n` : ""}
test('${escapeSingleQuotedString(`${testCase.caseCode} ${testCase.purpose}`)}', async ({ page }) => {
  await page.goto('${escapeSingleQuotedString(baseUrl)}');

${scriptedSteps}

  await expect(page.getByText('${escapeSingleQuotedString(testCase.expectedResult)}')).toBeVisible();
});

${promptSummary || "// Prompt summary: (empty)"}`

    if (current.session.connectionStatus === "connected") {
      try {
        generatedCode = await generateScriptWithLlm({
          request,
          project,
          testCase,
          session: current.session,
          secrets: current.secrets,
        })
        current.session.lastError = undefined
      } catch (error) {
        const message = error instanceof Error
          ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
          : "LLM generation failed"
        if (!handleUnauthorizedCopilotError({ error, message, llmService: this.llmService, state, current, ownerKey })) {
          current.session.lastError = message
          current.session.lastSyncedAt = now()
          this.llmService.saveLlmConfigState(state, ownerKey)
        }
        log.warn("agent.generation_fallback", {
          projectId: request.projectId,
          testCaseId: request.testCaseId,
          provider: current.session.provider,
          reason: message,
        })
      }
    }

    const nextScript = this.createScriptArtifact(testCase.id, current.session.provider, request.prompt, generatedCode)
    current.session.lastSyncedAt = now()
    current.session.lastError = undefined
    this.db.insertScript(nextScript)
    this.llmService.saveLlmConfigState(state, ownerKey)
    return nextScript
  }

  /**
   * 基于已有脚本 + 用例目的，让 LLM 反推一份 API 契约草稿（入参/响应）。
   * 用于：用户点「AI 生成契约」时一键填好表单。只返回草稿、不落库——遵循「LLM 生成 → 人 review → 冻结」。
   */
  public async generateContractDraft(request: { projectId: string; testCaseId: string } & LlmOwned): Promise<CaseContract> {
    const ownerKey = getOwnerKey(request)
    const { current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const { testCase } = ensureProjectAndTestCase(this.db, request.projectId, request.testCaseId)

    if (current.session.connectionStatus !== "connected") {
      throw new Error("LLM 未连接，无法生成契约。请先在设置里连接模型。")
    }
    const script = testCase.latestScriptId ? this.db.getScript(testCase.latestScriptId) : undefined
    if (!script?.code) {
      throw new Error("该用例还没有脚本，无法反推契约。请先生成脚本。")
    }

    const systemPrompt =
      "你是接口设计助手。给定一个 Playwright 自动化脚本和它的测试目的，推断把这个用例暴露成 HTTP/MCP API 时的接口契约。\n" +
      "- params（入参）：调用方需要传入、当前在脚本里被写死或应当被参数化的值（如搜索关键词、目标链接、要发布的文案、数量上限等）；已通过 params.get(name) 读取的也算。\n" +
      "- response（响应）：调用方会想拿回的结构化结果（脚本抓取/断言的数据、已通过 result.set 产出的字段）。读类用例（搜索/详情）尤其要有。\n" +
      "字段类型只能是 string|number|integer|boolean|array|object；文件/链接类入参用 type:'string' 且 format:'uri'。\n" +
      "只输出 JSON，不要任何解释，格式：{\"params\":[{\"name\",\"type\",\"description\",\"required\",\"format?\",\"default?\"}],\"response\":[...]}。"
    const userPrompt =
      `# 用例目的\n${testCase.purpose || testCase.caseCode}\n\n` +
      `# 步骤\n${testCase.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") || "（无）"}\n\n` +
      `# 脚本\n\`\`\`ts\n${script.code}\n\`\`\``

    const raw = await generateTextWithLlm({ prompt: userPrompt, systemPrompt, session: current.session, secrets: current.secrets })
    const jsonText = extractJsonObject(raw)
    let parsed: { params?: unknown; response?: unknown }
    try {
      parsed = JSON.parse(jsonText) as { params?: unknown; response?: unknown }
    } catch {
      throw new Error("LLM 未返回有效的契约 JSON，请重试。")
    }
    return {
      params: sanitizeContractFields(parsed.params),
      response: sanitizeContractFields(parsed.response),
      updatedAt: new Date().toISOString(),
    }
  }

  /** 解析改写对话/计划的共享上下文：LLM bundle + 用例 + 基准脚本代码。 */
  private resolveRewriteContext(request: { projectId: string; testCaseId: string; baseScriptId?: string } & LlmOwned) {
    const ownerKey = getOwnerKey(request)
    const { current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const { project, testCase } = ensureProjectAndTestCase(this.db, request.projectId, request.testCaseId)

    if (current.session.connectionStatus !== "connected") {
      throw new Error("LLM 未连接，无法进行 AI 改写对话。请先在大模型中心连接模型。")
    }

    const baseScriptId = request.baseScriptId ?? testCase.latestScriptId
    const baseScript = baseScriptId ? this.db.getScript(baseScriptId) : undefined
    if (request.baseScriptId && (!baseScript || baseScript.testCaseId !== testCase.id)) {
      throw new Error("Base script not found")
    }

    return { current, project, testCase, scriptCode: baseScript?.code ?? "" }
  }

  /**
   * AI 脚本改写「对话」阶段：纯文本多轮对话，不启动浏览器、不产出脚本。
   * 前端持有完整 messages 历史并逐轮回传，这里拼上 system prompt 后调用 LLM 返回助手回复。
   */
  public async rewriteChat(
    request: { projectId: string; testCaseId: string; baseScriptId?: string; messages: RewriteChatMessage[] } & LlmOwned,
  ): Promise<string> {
    const { current, project, testCase, scriptCode } = this.resolveRewriteContext(request)

    const messages: ChatMessage[] = [
      { role: "system", content: buildRewriteChatSystemPrompt(project, testCase, scriptCode) },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ]
    const result = await callLlmWithTools(current.session, current.secrets, messages, [])
    return result.content?.trim() || "（模型未返回内容，请重试。）"
  }

  /**
   * AI 脚本改写「计划」阶段：把对话整理成一份可执行的改写方案，供用户确认后交给脚本生成流程。
   */
  public async rewritePlan(
    request: { projectId: string; testCaseId: string; baseScriptId?: string; messages: RewriteChatMessage[] } & LlmOwned,
  ): Promise<string> {
    const { current, project, testCase, scriptCode } = this.resolveRewriteContext(request)

    const messages: ChatMessage[] = [
      { role: "system", content: buildRewriteChatSystemPrompt(project, testCase, scriptCode) },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: buildRewritePlanInstruction() },
    ]
    const result = await callLlmWithTools(current.session, current.secrets, messages, [])
    const plan = result.content?.trim()
    if (!plan) {
      throw new Error("模型未返回有效的改写方案，请重试。")
    }
    return plan
  }

  public async runScriptAgent(request: GenerateScriptRequest & { sessionId: string } & LlmOwned) {
    const ownerKey = getOwnerKey(request)
    const { state, current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const { project, testCase } = ensureProjectAndTestCase(this.db, request.projectId, request.testCaseId)

    const existing = this.sessionService.findActiveAgentConflict(request.testCaseId)
    if (existing) {
      throw createAgentConflictError("当前用例已有进行中的脚本生成任务。", existing.id, existing.status)
    }

    const session = this.sessionService.createAgentSession(request)
    this.sessionService.persistAndNotifyAgent(session)

    const preparingStepId = `prep_${session.id}`
    let preparingResolved = false
    const resolvePreparingStep = () => {
      if (preparingResolved) return
      preparingResolved = true
      this.sessionService.appendOrUpdateStep(session, {
        id: preparingStepId,
        type: "thinking",
        stage: "page",
        title: "执行环境准备完成",
        content: "浏览器与前置依赖已就绪，开始生成脚本。",
        status: "completed",
        timestamp: now(),
      })
    }
    const onStep = (step: AgentStep) => {
      // 第一个真实步骤到达时，把"准备中"步骤收尾，避免两个 running 步骤并存。
      if (step.id !== preparingStepId) {
        resolvePreparingStep()
      }
      this.sessionService.appendOrUpdateStep(session, step)
    }

    onStep({
      id: preparingStepId,
      type: "thinking",
      stage: "page",
      title: "正在准备执行环境",
      content: "已接收生成请求，正在初始化浏览器与前置依赖……首次启动浏览器可能较慢，请稍候。",
      status: "running",
      timestamp: now(),
    })

    let taskController: ReturnType<AgentSessionService["createManagedController"]>
    try {
      taskController = this.sessionService.createManagedController(
        session,
        { ...request, mode: "generate", sessionId: session.id },
        () => ({
          mode: session.mode,
          status: session.status,
          verificationStatus: session.verificationStatus,
          stepCount: session.steps.length,
          latestRunId: session.latestRunId ?? null,
          warmupRunId: session.warmupRunId ?? null,
          resultScriptId: session.resultScriptId ?? null,
          pausedAt: session.pausedAt ?? null,
        }),
      )
    } catch (controllerError) {
      // 控制器/租约创建发生在主 try 之前，若不在此收敛，会话会永远停留在
      // running + 空步骤，SSE 永不终止，前端表现为"卡在等待生成开始"。
      const message = controllerError instanceof Error ? controllerError.message : String(controllerError)
      session.status = "error"
      session.error = message
      session.finishedAt = now()
      onStep({
        id: preparingStepId,
        type: "error",
        stage: "page",
        title: "无法启动生成任务",
        content: message,
        status: "error",
        timestamp: now(),
      })
      this.sessionService.persistAndNotifyAgent(session)
      throw controllerError
    }

    let warmupSession: Awaited<ReturnType<typeof prepareAgentExecutionContext>>["warmupSession"] = null
    let warmupRunId: string | undefined

    try {
      const prepared = await prepareAgentExecutionContext({
        mode: "generate",
        request,
        ownerKey,
        current,
        db: this.db,
        projectService: this.projectService,
        runService: this.runService,
        agentWarmupService: this.agentWarmupService,
        session,
        project,
        testCase,
        onStep,
        updateSession: (patch) => {
          if (patch.preconditionSummary !== undefined) {
            session.preconditionSummary = patch.preconditionSummary
          }
          if (patch.warmupRunId !== undefined) {
            session.warmupRunId = patch.warmupRunId
            warmupRunId = patch.warmupRunId ?? warmupRunId
          }
          this.sessionService.persistAndNotifyAgent(session)
        },
        logMissingAuthState: true,
        signal: taskController.signal,
        waitIfPaused: () => taskController.waitIfPaused(),
      })

      warmupSession = prepared.warmupSession

      let agentPrompt = request.prompt
      let initialVerifiedCode = ""
      if (request.baseScriptId) {
        const baseScript = this.db.getScript(request.baseScriptId)
        if (!baseScript || baseScript.testCaseId !== testCase.id) {
          throw new Error("Base script not found")
        }
        agentPrompt = [
          `当前脚本版本: v${baseScript.version}`,
          "请基于下面这份现有脚本做修改，使用 execute_step 逐步验证修改后的代码。",
          "",
          "现有脚本:",
          baseScript.code,
          "",
          "修改要求:",
          request.prompt,
        ].join("\n")
        initialVerifiedCode = baseScript.code
      }

      const finalCode = await runAgentLoop({
        request: { ...request, prompt: agentPrompt },
        project,
        effectiveBaseUrl: prepared.resolvedRunUrl,
        testCase,
        session: current.session,
        secrets: current.secrets,
        agentSessionId: session.id,
        artifactsDir,
        onStep,
        listWorkspaceTree: (path) => this.projectService.listWorkspaceTree(request.projectId, path),
        globWorkspacePaths: (pattern) => this.projectService.globWorkspacePaths(request.projectId, pattern),
        searchWorkspaceCode: (query, path, limit) => this.projectService.searchWorkspaceCode(request.projectId, query, path, limit),
        readWorkspaceFile: (path, offset, limit) => this.projectService.readWorkspaceFile(request.projectId, path, offset, limit),
        browser: prepared.warmupSession?.browser ?? undefined,
        browserContext: prepared.warmupSession?.context ?? undefined,
        page: prepared.warmupSession?.page ?? undefined,
        persistent: prepared.warmupSession?.persistent ?? undefined,
        preconditionSummary: session.preconditionSummary,
        preconditionReport: prepared.preconditionReport,
        initialPageState: prepared.initialPageState,
        hasWorkspace: prepared.hasWorkspace,
        analyzeImage: (input) => this.runService.analyzeImageWithCurrentLlm(input, ownerKey),
        dataTables: this.db.createDataTableScriptApi(request.projectId),
        knowledge: knowledgeService.createScriptApi(request.projectId),
        defineContract: (contract) => {
          // LLM 通过 define_contract 声明接口契约 → 冻结进当前用例（驱动文档 / 测试表单 / MCP）。
          this.db.updateTestCaseContract(testCase.id, contract)
          onStep({
            id: createId("agent_contract"),
            type: "generation",
            stage: "generation",
            title: "已冻结 API 契约",
            content: `入参 ${contract.params.length} 个、响应 ${contract.response.length} 个。用例已可作为 API / MCP tool 暴露（需在用例上开启 API 开关）。`,
            status: "completed",
            timestamp: now(),
          })
        },
        signal: taskController.signal,
        waitIfPaused: () => taskController.waitIfPaused(),
        lastVerifiedCode: initialVerifiedCode,
        runtimeContext: {
          outputs: prepared.warmupRuntimeOutputs,
          tempValues: new Map<string, unknown>(),
          producer: { testCaseId: testCase.id, caseCode: testCase.caseCode, caseName: testCase.purpose },
        },
        authStorageStateJson: prepared.authStorageStateJson,
        stealth: prepared.stealth,
      })

      const script = this.createScriptArtifact(testCase.id, current.session.provider, request.prompt, finalCode)
      this.db.insertScript(script)
      session.resultScriptId = script.id
      session.latestScriptId = script.id

      const generationDone: AgentStep = {
        id: createId("agent_generation"),
        type: "generation",
        stage: "generation",
        title: "脚本已落库",
        content: `脚本 v${script.version} 已保存（增量生成过程中已逐步验证）。`,
        status: "completed",
        timestamp: now(),
        scriptId: script.id,
      }
      onStep(generationDone)

      current.session.lastSyncedAt = now()
      current.session.lastError = undefined
      this.llmService.saveLlmConfigState(state, ownerKey)

      session.status = "completed"
      session.verificationStatus = "passed"
      session.warmupRunId = undefined
      session.finishedAt = now()
      session.finalSummary = "脚本已通过增量生成并逐步验证完成。"
      this.sessionService.persistAndNotifyAgent(session)
    } catch (error) {
      const message = error instanceof Error
        ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
        : "Agent 执行失败"
      const wasCancelled = taskController.signal.aborted
      session.status = wasCancelled ? "cancelled" : "error"
      session.warmupRunId = undefined
      session.error = message
      session.finishedAt = now()
      session.pausedAt = undefined
      this.sessionService.appendOrUpdateStep(session, {
        id: `step_err_${Math.random().toString(36).slice(2, 8)}`,
        type: "error",
        stage: "verification",
        title: wasCancelled ? "Agent 已取消" : "Agent 执行失败",
        content: message,
        status: "error",
        timestamp: now(),
      })
      this.sessionService.persistAndNotifyAgent(session)

      handleUnauthorizedCopilotError({ error, message, llmService: this.llmService, state, current, ownerKey })
    } finally {
      this.sessionService.unregister(session.id)
      if (warmupRunId) {
        this.runService.getRunStateService().unregisterLiveViewportController(warmupRunId)
      }
      await closeWarmupSession(warmupSession)
    }
  }
}