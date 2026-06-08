import type { Browser, BrowserContext, Page } from "@playwright/test"
import type {
  ExecutionRun,
  HumanHandoffReason,
  HumanHandoffRequest,
  Project,
  ScriptArtifact,
  TestCase,
} from "@autovis/shared"
import type { LiveStreamController } from "./live-streamer.js"

export interface CreateExecutionTemplateInput {
  runId: string
  project: Project
  testCase: TestCase
  script: ScriptArtifact
  testBaseUrl: string
}

export interface LiveViewportEvent {
  type: "started" | "chunk" | "ended" | "unavailable"
  mimeType?: "image/jpeg"
  chunk?: Uint8Array
  width?: number
  height?: number
}

export interface ExecutePlaywrightRunInput {
  run: ExecutionRun
  project: Project
  testCase: TestCase
  script: ScriptArtifact
  artifactsDir: string
  appOrigin: string
  headless?: boolean
  onUpdate: () => Promise<void> | void
  onLiveViewportEvent?: (event: LiveViewportEvent) => Promise<void> | void
  requestHumanInput: (request: {
    reason: HumanHandoffReason
    instruction: string
    inputLabel?: string
    placeholder?: string
    confirmText?: string
    imageUrl?: string
    scope?: HumanHandoffRequest["scope"]
    suiteId?: string
    testCaseId?: string
  }) => Promise<string>
  analyzeImage: (request: {
    dataUrl: string
    mimeType: string
    prompt: string
  }) => Promise<string>
}

export interface RunnerSession {
  runDir: string
  browser: Browser
  context: BrowserContext
  page: Page
  video: Awaited<ReturnType<Page["video"]>>
  /** 实时预览推流控制器：stop 释放、setDemand 按观众开关抓帧。 */
  liveStream?: LiveStreamController
  /** 是否开启了 tracing（决定 finalize 时是否调用 tracing.stop，避免未 start 即 stop 抛错）。 */
  traceEnabled?: boolean
}

export interface CreateRunnerSessionInput {
  run: ExecutionRun
  artifactsDir: string
  headless?: boolean
  onUpdate: () => Promise<void> | void
  onLiveViewportEvent?: (event: LiveViewportEvent) => Promise<void> | void
  initStepIndex?: number
  storageStateJson?: string
  /**
   * 初始打开的 URL。注入 storageState 后，光访问 testBaseUrl 可能仍停在登录页/首页，
   * 调用方（如注入了登录态的用例回放）可传入"登录后 URL"，让浏览器直接落在真实的工作页。
   * 留空则回退到 run.testBaseUrl，保持原有行为。
   */
  landingUrl?: string
  /** 是否录制 webm 视频。缺省按 run.kind 决定（temporary 不录），可被环境变量覆盖。 */
  recordVideo?: boolean
  /** 是否开启 Playwright trace（screenshots+snapshots，较重）。缺省同 recordVideo。 */
  trace?: boolean
}

export interface ExecuteScriptInSessionInput {
  run: ExecutionRun
  session: RunnerSession
  script: ScriptArtifact
  onUpdate: () => Promise<void> | void
  requestHumanInput: ExecutePlaywrightRunInput["requestHumanInput"]
  analyzeImage: ExecutePlaywrightRunInput["analyzeImage"]
  stepIndex: number
  startedLog: string
  completedLog: string
  handoffContext?: {
    scope?: HumanHandoffRequest["scope"]
    suiteId?: string
    testCaseId?: string
  }
  screenshotFilePrefix?: string
  timeoutMs?: number
  signal?: AbortSignal
  waitIfPaused?: () => Promise<void>
  runtimeProducer?: {
    testCaseId?: string
    caseCode?: string
    caseName?: string
  }
}

export interface FinalizeRunnerSessionInput {
  run: ExecutionRun
  session: RunnerSession
  onUpdate: () => Promise<void> | void
  archiveStepIndex: number
}

export interface ValidateAuthStateInput {
  storageStateJson: string
  validationScriptCode: string
  testBaseUrl: string
  headless?: boolean
  timeoutMs?: number
}
