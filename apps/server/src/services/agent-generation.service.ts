import { runAgentLoop } from "../agent.js"
import { generateScriptWithLlm } from "../llm.js"
import { CopilotSessionError } from "../copilot.js"
import { log } from "../log.js"
import { AutoVisDatabase } from "../db.js"
import {
  type AgentStep,
  type GenerateScriptRequest,
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

    const taskController = this.sessionService.createManagedController(
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

    const onStep = (step: AgentStep) => {
      this.sessionService.appendOrUpdateStep(session, step)
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
        browser: prepared.warmupSession?.browser,
        browserContext: prepared.warmupSession?.context,
        page: prepared.warmupSession?.page,
        preconditionSummary: session.preconditionSummary,
        preconditionReport: prepared.preconditionReport,
        initialPageState: prepared.initialPageState,
        hasWorkspace: prepared.hasWorkspace,
        analyzeImage: (input) => this.runService.analyzeImageWithCurrentLlm(input, ownerKey),
        signal: taskController.signal,
        waitIfPaused: () => taskController.waitIfPaused(),
        lastVerifiedCode: initialVerifiedCode,
        runtimeContext: {
          outputs: prepared.warmupRuntimeOutputs,
          tempValues: new Map<string, unknown>(),
          producer: { testCaseId: testCase.id, caseCode: testCase.caseCode, caseName: testCase.purpose },
        },
        authStorageStateJson: prepared.authStorageStateJson,
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