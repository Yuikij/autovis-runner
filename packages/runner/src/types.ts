import type { Browser, BrowserContext, Page } from "@playwright/test"
import type {
  DataTableScriptApi,
  ExecutionRun,
  KnowledgeScriptApi,
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
  /** 运行时文本生成：暴露给生成脚本的 ai.generate。缺省时脚本调用会抛出明确错误。 */
  generateText?: (prompt: string, systemPrompt?: string) => Promise<string>
}

export interface RunnerSession {
  runDir: string
  browser: Browser | null
  context: BrowserContext
  page: Page
  video: Awaited<ReturnType<Page["video"]>>
  /** 实时预览推流控制器：stop 释放、setDemand 按观众开关抓帧。 */
  liveStream?: LiveStreamController
  /** 是否开启了 tracing（决定 finalize 时是否调用 tracing.stop，避免未 start 即 stop 抛错）。 */
  traceEnabled?: boolean
  /** 持久 profile 模式：关闭时只 close context（其拥有的浏览器随之关闭），不再单独 close browser。 */
  persistent?: boolean
  /** 持久 profile 串行锁的释放函数（同一 userDataDir 同时只能一个 Chrome 用）；close 时调用。 */
  releaseLock?: () => void
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
  /**
   * 是否使用反检测有头模式（真实 Chrome）。由调用方依据站点 / 任务用例级配置解析后显式传入；
   * 留空则回退到"有登录态即有头"的旧推断。最终仍受 STEALTH_REPLAY / STEALTH_ALWAYS 环境变量钳制。
   */
  stealth?: boolean
  /** 是否录制 webm 视频。缺省按 run.kind 决定（temporary 不录），可被环境变量覆盖。 */
  recordVideo?: boolean
  /** 是否开启 Playwright trace（screenshots+snapshots，较重）。缺省同 recordVideo。 */
  trace?: boolean
  /**
   * 持久 profile 目录。传入则用 launchPersistentContext 起浏览器，cookie/缓存/指纹落在该目录、跨运行保留，
   * 且**不再注入 storageState**（登录态来自目录本身）。专治 Cloudflare 人机质询等"风险分"拦截。
   * 调用方需保证同一目录的运行串行（Chrome 会锁 profile 目录）。
   */
  userDataDir?: string
  /**
   * 任务取消信号。传入后，浏览器启动 / profile 锁等待 / 打开页面等阻塞环节都会响应 abort
   * 立即抛 "Run cancelled" 中止——否则 warmup 阶段（启动浏览器期间）无法被「停止」打断。
   */
  signal?: AbortSignal
  /** 暂停闸门：在各阶段开始前 await，支持任务被暂停后挂起。 */
  waitIfPaused?: () => Promise<void>
  /**
   * 浏览器启动超时（毫秒）。超过仍未拿到浏览器/上下文则以可读错误失败，避免无限期卡在
   * launch / launchPersistentContext（如 profile 被占、Chrome 弹首启对话框等）。
   * 缺省读取 BROWSER_LAUNCH_TIMEOUT_MS，再缺省 60s。
   */
  launchTimeoutMs?: number
}

export interface ExecuteScriptInSessionInput {
  run: ExecutionRun
  session: RunnerSession
  script: ScriptArtifact
  onUpdate: () => Promise<void> | void
  requestHumanInput: ExecutePlaywrightRunInput["requestHumanInput"]
  analyzeImage: ExecutePlaywrightRunInput["analyzeImage"]
  generateText?: ExecutePlaywrightRunInput["generateText"]
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
  overrideBaseUrl?: string
  /**
   * deadline 模式的目标精确时刻（ISO 字符串）。设置后，在脚本正文执行前自动
   * `await schedule.waitUntil(at)`：浏览器实例化、登录态与初始页面已在 at 之前完成预热，
   * 卡到 at 才执行脚本正文（抢占动作），脚本无需自己写等待逻辑。已过 at 时为无操作。
   */
  deadlineWaitUntil?: string
  /**
   * 外部 API 调用方传入、已按用例 contract 校验的入参。
   * 通过沙箱 `params.get(name)` 读取。仅在以 API 方式调用用例时传入；
   * 与 `inputs`（上游用例 output）是不同命名空间，语义上必须分开。
   */
  apiParams?: Record<string, unknown>
  /**
   * 项目级 data-tables 运行时 API（绑定当前 run 所属项目）。注入后脚本可用 `tables` 命名空间
   * 做跨运行的持久记录 / 去重（如标记某篇论文已分析）。缺省时脚本调用 `tables.*` 抛出明确错误。
   */
  dataTables?: DataTableScriptApi
  /**
   * 项目级知识库运行时 API（绑定当前 run 所属项目）。注入后脚本可用 `knowledge` 命名空间
   * 沉淀多层级 Markdown 与资产（采集/整理类任务）。缺省时脚本调用 `knowledge.*` 抛出明确错误。
   */
  knowledge?: KnowledgeScriptApi
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
