import { promises as fs } from "node:fs"
import { join } from "node:path"
import { AutoVisDatabase } from "../db.js"
import { artifactsDir, createId, now } from "./common.js"
import {
  type RecorderAction,
  type RecorderInteractionRequest,
  type RecorderSession,
  type ScriptArtifact,
  type StartRecorderSessionRequest,
  type StopRecorderSessionRequest,
  type TestCase,
} from "@autovis/shared"
import { type ExecutionRun } from "@autovis/shared"
import { log } from "../log.js"
import { recordBrowserStartFailure } from "../observability.js"
import { TaskControlRegistry } from "./task-control.js"

/** 录制会话空闲自动回收时长（ms），杜绝用户开了录制走开后残留的浏览器进程。0 关闭。 */
const recorderIdleTimeoutMs = (): number => {
  const raw = Number.parseInt(process.env.RECORDER_IDLE_MS ?? "", 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : 15 * 60_000
}

export class RecorderService {
  private readonly recorderSubscribers = new Map<string, Set<(session: RecorderSession) => void>>()
  private readonly activeRecorderPages = new Map<string, import("@playwright/test").Page>()
  private readonly activeRecorderContexts = new Map<string, import("@playwright/test").BrowserContext>()
  private readonly activeRecorderBrowsers = new Map<string, import("@playwright/test").Browser>()
  private readonly lastActivityAt = new Map<string, number>()

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly startVerificationCb: (req: any) => Promise<ExecutionRun>,
    private readonly createScriptArtifactCb: (testCaseId: string, provider: ScriptArtifact["provider"], prompt: string, code: string, source: ScriptArtifact["source"]) => ScriptArtifact,
    private readonly tasks: TaskControlRegistry,
  ) {
    const ttl = recorderIdleTimeoutMs()
    if (ttl > 0) {
      const timer = setInterval(() => this.reapIdleSessions(ttl), Math.min(ttl, 60_000))
      ;(timer as { unref?: () => void }).unref?.()
    }
  }

  private reapIdleSessions(ttl: number) {
    const now = Date.now()
    for (const [sessionId, last] of this.lastActivityAt) {
      if (now - last < ttl) continue
      if (!this.activeRecorderBrowsers.has(sessionId)) {
        this.lastActivityAt.delete(sessionId)
        continue
      }
      log.warn("recorder.idle_reaped", { sessionId, idleMs: now - last })
      void this.cancelRecorder(sessionId)
    }
  }

  public listActiveRecorderSessions(projectId?: string): RecorderSession[] {
    return this.tasks
      .listByKind("recorder")
      .map((ctrl) => this.db.getRecorderSession(ctrl.id))
      .filter((session): session is RecorderSession => Boolean(session) && (!projectId || session!.projectId === projectId))
  }

  public pauseRecorder(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "recorder") return false
    if (!ctrl.pause()) return false
    const session = this.db.getRecorderSession(sessionId)
    if (session) {
      session.status = "paused"
      this.persistAndNotifyRecorder(session)
    }
    return true
  }

  public resumeRecorder(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "recorder") return false
    if (!ctrl.resume()) return false
    const session = this.db.getRecorderSession(sessionId)
    if (session) {
      session.status = "running"
      this.persistAndNotifyRecorder(session)
    }
    return true
  }

  public async cancelRecorder(sessionId: string): Promise<boolean> {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "recorder") return false
    const session = this.db.getRecorderSession(sessionId)
    if (session) {
      session.status = "cancelling"
      this.persistAndNotifyRecorder(session)
    }
    ctrl.cancel("Recorder cancelled by user.")
    const page = this.activeRecorderPages.get(sessionId)
    const context = this.activeRecorderContexts.get(sessionId)
    const browser = this.activeRecorderBrowsers.get(sessionId)
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    this.activeRecorderPages.delete(sessionId)
    this.activeRecorderContexts.delete(sessionId)
    this.activeRecorderBrowsers.delete(sessionId)
    this.lastActivityAt.delete(sessionId)
    this.tasks.unregister(sessionId)
    if (session) {
      session.status = "cancelled"
      session.finishedAt = now()
      this.persistAndNotifyRecorder(session)
    }
    return true
  }

  public subscribeRecorder(sessionId: string, listener: (session: RecorderSession) => void) {
    const set = this.recorderSubscribers.get(sessionId) ?? new Set<(session: RecorderSession) => void>()
    set.add(listener)
    this.recorderSubscribers.set(sessionId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.recorderSubscribers.delete(sessionId)
      }
    }
  }

  private persistAndNotifyRecorder(session: RecorderSession) {
    this.db.upsertRecorderSession(session)
    this.recorderSubscribers.get(session.id)?.forEach((listener) => listener(session))
  }

  private createRecorderSession(request: StartRecorderSessionRequest, testBaseUrl: string): RecorderSession {
    return {
      id: createId("recorder"),
      projectId: request.projectId,
      testCaseId: request.testCaseId,
      status: "starting",
      targetUrlId: request.targetUrlId,
      testBaseUrl,
      currentViewport: "",
      actions: [],
      artifacts: [],
      startedAt: now(),
    }
  }

  private getLastRecorderTarget(actions: RecorderAction[]) {
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      const action = actions[index]
      if (action.selector || action.label || action.placeholder || action.text) {
        return action
      }
    }
    return undefined
  }

  private buildRecorderCode(testCase: TestCase, actions: RecorderAction[], testBaseUrl: string): string {
    const body = actions
      .map((action) => {
        switch (action.type) {
          case "navigate":
            return action.url ? `  await page.goto(${JSON.stringify(action.url)});` : null
          case "click":
            if (action.selector) {
              return `  await page.locator(${JSON.stringify(action.selector)}).click();`
            }
            return action.x != null && action.y != null ? `  await page.mouse.click(${Math.round(action.x)}, ${Math.round(action.y)});` : null
          case "dblclick":
            if (action.selector) {
              return `  await page.locator(${JSON.stringify(action.selector)}).dblclick();`
            }
            return action.x != null && action.y != null
              ? `  await page.mouse.click(${Math.round(action.x)}, ${Math.round(action.y)}, { clickCount: 2 });`
              : null
          case "input":
            if (action.selector) {
              return `  await page.locator(${JSON.stringify(action.selector)}).fill(${JSON.stringify(action.value ?? "")});`
            }
            return action.value != null ? `  await page.keyboard.type(${JSON.stringify(action.value)});` : null
          case "keydown":
            return action.key ? `  await page.keyboard.press(${JSON.stringify(action.key)});` : null
          case "scroll":
            return `  await page.mouse.wheel(0, ${Math.round(action.deltaY ?? 0)});`
          case "pointerdown":
            return action.x != null && action.y != null
              ? `  await page.mouse.move(${Math.round(action.x)}, ${Math.round(action.y)});\n  await page.mouse.down();`
              : `  await page.mouse.down();`
          case "pointermove":
            return action.x != null && action.y != null ? `  await page.mouse.move(${Math.round(action.x)}, ${Math.round(action.y)});` : null
          case "pointerup":
            return action.x != null && action.y != null
              ? `  await page.mouse.move(${Math.round(action.x)}, ${Math.round(action.y)});\n  await page.mouse.up();`
              : `  await page.mouse.up();`
          default:
            return null
        }
      })
      .filter(Boolean)
      .join("\n")

    return [
      "import { test, expect } from '@playwright/test';",
      "",
      `test(${JSON.stringify(`${testCase.caseCode} ${testCase.purpose || testCase.moduleName}`)}, async ({ page }) => {`,
      body || `  await page.goto(${JSON.stringify(testBaseUrl)});`,
      `  await expect(page.getByText(${JSON.stringify(testCase.expectedResult)})).toBeVisible();`,
      "});",
    ].join("\n")
  }

  private summarizeRecorderAction(action: RecorderAction) {
    const target = action.selector ?? action.label ?? action.placeholder ?? action.text ?? "元素"
    if (action.type === "input") {
      const value = action.value ? ` = ${action.value}` : ""
      return `${action.type}: ${target}${value}`
    }
    if (action.type === "keydown") {
      return `${action.type}: ${action.key ?? ""}`
    }
    return `${action.type}: ${target}`
  }

  public async startRecorderSession(request: StartRecorderSessionRequest) {
    const project = this.db.getProject(request.projectId)
    const testCase = this.db.getTestCase(request.testCaseId)
    if (!project || !testCase) {
      throw new Error("Project or test case not found")
    }

    const resolved = this.db.resolveTargetUrl(request.projectId, request.targetUrlId)
    if (!resolved) {
      throw new Error("无法解析目标 URL：请先在项目设置中配置主域名或选择有效的 TargetUrl。")
    }

    const session = this.createRecorderSession({ ...request, targetUrlId: resolved.id }, resolved.url)
    this.persistAndNotifyRecorder(session)

    const { chromium, localNetworkAccessArgs, performanceArgs } = await import("../browser.js")
    let browser
    try {
      browser = await chromium.launch({ headless: process.env.HEADLESS !== "false", args: [...localNetworkAccessArgs(), ...performanceArgs()] })
    } catch (error) {
      recordBrowserStartFailure("recorder_browser_launch", error, {
        projectId: request.projectId,
        testCaseId: request.testCaseId,
      })
      log.error("recorder.browser_launch_failed", {
        sessionId: session.id,
        projectId: request.projectId,
        testCaseId: request.testCaseId,
        error,
      })
      throw error
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: join(artifactsDir, session.id), size: { width: 1440, height: 960 } } })
    const page = await context.newPage()
    this.activeRecorderBrowsers.set(session.id, browser)
    this.activeRecorderContexts.set(session.id, context)
    this.activeRecorderPages.set(session.id, page)
    this.lastActivityAt.set(session.id, Date.now())

    await fs.mkdir(join(artifactsDir, session.id), { recursive: true })
    await page.goto(resolved.url, { waitUntil: "domcontentloaded" })
    session.status = "running"
    session.currentUrl = page.url()
    session.pageTitle = await page.title()
    session.currentViewport = `/artifacts/${session.id}/current.png`
    await page.screenshot({ path: join(artifactsDir, session.id, "current.png"), fullPage: true })
    session.actions.push({
      id: createId("rec_action"),
      type: "navigate",
      timestamp: now(),
      url: page.url(),
      title: session.pageTitle,
      screenshotUrl: session.currentViewport,
      detail: "录制会话已启动。",
    })
    this.tasks.create({
      kind: "recorder",
      id: session.id,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
      recoveryPolicy: "terminate",
      request: {
        ...request,
        targetUrlId: resolved.id,
      },
      buildCheckpoint: () => ({
        status: session.status,
        actionCount: session.actions.length,
        currentUrl: session.currentUrl ?? null,
        generatedScriptId: session.generatedScriptId ?? null,
      }),
      applyAction: (action) => {
        switch (action) {
          case "pause":
            return this.pauseRecorder(session.id)
          case "resume":
            return this.resumeRecorder(session.id)
          case "cancel":
            return this.cancelRecorder(session.id)
          default:
            return false
        }
      },
    })
    this.persistAndNotifyRecorder(session)
    return session
  }

  public async applyRecorderInteraction(sessionId: string, interaction: RecorderInteractionRequest) {
    const session = this.db.getRecorderSession(sessionId)
    const page = this.activeRecorderPages.get(sessionId)
    if (!session || !page) {
      throw new Error("Recorder session not found")
    }
    const ctrl = this.tasks.get(sessionId)
    if (ctrl?.signal.aborted) {
      throw new Error("Recorder session has been cancelled")
    }
    if (ctrl) {
      await ctrl.waitIfPaused()
    }
    this.lastActivityAt.set(sessionId, Date.now())

    const pointerTarget = null
    const lastTarget = this.getLastRecorderTarget(session.actions)
    const interactionTarget = interaction.type === "input"
      ? {
        selector: lastTarget?.selector,
        role: lastTarget?.role,
        label: lastTarget?.label,
        text: lastTarget?.text,
        placeholder: lastTarget?.placeholder,
        x: lastTarget?.x,
        y: lastTarget?.y,
      }
      : pointerTarget

    if (interaction.url && interaction.type === "navigate") {
      await page.goto(interaction.url, { waitUntil: "domcontentloaded" })
    } else if (interaction.type === "click" || interaction.type === "dblclick") {
      await page.mouse.click(interaction.x ?? 0, interaction.y ?? 0, { clickCount: interaction.type === "dblclick" ? 2 : 1 })
    } else if (interaction.type === "pointerdown") {
      await page.mouse.move(interaction.x ?? 0, interaction.y ?? 0)
      await page.mouse.down()
    } else if (interaction.type === "pointermove") {
      await page.mouse.move(interaction.x ?? 0, interaction.y ?? 0)
    } else if (interaction.type === "pointerup") {
      if (interaction.x != null && interaction.y != null) {
        await page.mouse.move(interaction.x, interaction.y)
      }
      await page.mouse.up()
    } else if (interaction.type === "scroll") {
      await page.mouse.wheel(0, interaction.deltaY ?? 0)
    } else if (interaction.type === "keydown") {
      if (!interaction.key) {
        throw new Error("Missing key for recorder keydown event")
      }
      await page.keyboard.press(interaction.key)
    } else if (interaction.type === "input") {
      if (interaction.value == null) {
        throw new Error("Missing value for recorder input event")
      }
      if (interactionTarget?.selector) {
        await page.locator(interactionTarget.selector).fill(interaction.value)
      } else {
        if (interactionTarget?.x != null && interactionTarget?.y != null) {
          await page.mouse.click(interactionTarget.x, interactionTarget.y)
        }
        await page.keyboard.type(interaction.value)
      }
    }

    await page.waitForTimeout(200)
    const screenshotFile = `${Date.now()}-${interaction.type}.png`
    await page.screenshot({ path: join(artifactsDir, session.id, screenshotFile), fullPage: true })
    const action: RecorderAction = {
      id: createId("rec_action"),
      type: interaction.type,
      timestamp: now(),
      url: page.url(),
      selector: interactionTarget?.selector,
      role: interactionTarget?.role,
      label: interactionTarget?.label,
      text: interactionTarget?.text,
      placeholder: interactionTarget?.placeholder,
      x: interaction.x,
      y: interaction.y,
      key: interaction.key,
      value: interaction.value,
      deltaY: interaction.deltaY,
      screenshotUrl: `/artifacts/${session.id}/${screenshotFile}`,
      detail: this.summarizeRecorderAction({
        id: "tmp",
        type: interaction.type,
        timestamp: now(),
        url: page.url(),
        selector: interactionTarget?.selector,
        role: interactionTarget?.role,
        label: interactionTarget?.label,
        text: interactionTarget?.text,
        placeholder: interactionTarget?.placeholder,
        key: interaction.key,
        value: interaction.value,
        deltaY: interaction.deltaY,
        x: interaction.x,
        y: interaction.y,
      }),
    }
    session.actions.push(action)
    session.currentUrl = page.url()
    session.pageTitle = await page.title()
    session.currentViewport = action.screenshotUrl ?? session.currentViewport
    this.persistAndNotifyRecorder(session)
    return session
  }

  public async stopRecorderSession(sessionId: string, options: StopRecorderSessionRequest) {
    const session = this.db.getRecorderSession(sessionId)
    const page = this.activeRecorderPages.get(sessionId)
    const context = this.activeRecorderContexts.get(sessionId)
    const browser = this.activeRecorderBrowsers.get(sessionId)
    if (!session) {
      throw new Error("Recorder session not found")
    }

    session.status = "stopping"
    this.persistAndNotifyRecorder(session)

    let savedScript: ScriptArtifact | undefined
    let verificationRun: ExecutionRun | undefined
    const testCase = this.db.getTestCase(session.testCaseId)
    if (options.saveAsScript !== false && testCase) {
      const code = this.buildRecorderCode(testCase, session.actions, session.testBaseUrl)
      savedScript = this.createScriptArtifactCb(testCase.id, "manual-recorder", "Manual recorder session", code, "manual")
      this.db.insertScript(savedScript)
      session.generatedScriptId = savedScript.id
      if (options.runAfterSave) {
        verificationRun = await this.startVerificationCb({
          projectId: session.projectId,
          testCaseId: session.testCaseId,
          scriptId: savedScript.id,
          targetUrlId: session.targetUrlId,
        })
      }
    }

    if (page) {
      await page.screenshot({ path: join(artifactsDir, session.id, "final.png"), fullPage: true }).catch(() => undefined)
    }
    const artifactFiles = await fs.readdir(join(artifactsDir, session.id)).catch(() => [])
    session.artifacts = artifactFiles
      .filter((fileName) => fileName.endsWith(".png") || fileName.endsWith(".webm") || fileName.endsWith(".zip"))
      .map((fileName) => ({
        kind: fileName.endsWith(".webm") ? "video" : fileName.endsWith(".zip") ? "trace" : "screenshot",
        name: fileName,
        url: `/artifacts/${session.id}/${fileName}`,
      }))
    session.status = "completed"
    session.finishedAt = now()
    this.persistAndNotifyRecorder(session)

    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    this.activeRecorderPages.delete(sessionId)
    this.activeRecorderContexts.delete(sessionId)
    this.activeRecorderBrowsers.delete(sessionId)
    this.lastActivityAt.delete(sessionId)
    this.tasks.unregister(sessionId)

    return { session, script: savedScript, run: verificationRun }
  }
}
