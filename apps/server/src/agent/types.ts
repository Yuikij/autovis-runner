import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import type {
  AgentStage,
  AgentStep,
  GenerateScriptRequest,
  LlmSessionConfig,
  Project,
  RuntimeOutput,
  TestCase,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceTreeEntry,
} from "@autovis/shared"
import { type LlmSecretState } from "../llm.js"

export interface InitialPageState {
  url: string
  snapshot: string
}

export interface PreconditionCaseDetail {
  caseCode: string
  purpose: string
  expectedResult: string
  scriptCode: string
}

export interface PreconditionSuiteDetail {
  kind?: "suite" | "case"
  name: string
  version: string
  cases: PreconditionCaseDetail[]
}

export interface PreconditionOutputDetail {
  from: string
  description: string
  valuePreview: string
}

export interface PreconditionReport {
  status: "success" | "none"
  suites: PreconditionSuiteDetail[]
  outputs?: PreconditionOutputDetail[]
}

export interface AgentContext {
  /** "generate" = 生成脚本（默认）；"direct" = 直接执行，不输出脚本 */
  mode?: "generate" | "direct"
  request: GenerateScriptRequest
  project: Project
  testCase: TestCase
  session: LlmSessionConfig
  secrets: LlmSecretState
  agentSessionId: string
  artifactsDir: string
  /** 当前 run 的产物目录（direct 模式下来自 warmupSession.runDir）。save_report 写到这里，finalize 扫描后注册为 report 产物。 */
  runDir?: string
  onStep: (step: AgentStep) => void
  listWorkspaceTree: (path?: string) => Promise<WorkspaceTreeEntry[]>
  globWorkspacePaths: (pattern: string) => Promise<string[]>
  searchWorkspaceCode: (query: string, path?: string, limit?: number) => Promise<WorkspaceSearchMatch[]>
  readWorkspaceFile: (path: string, offset?: number, limit?: number) => Promise<WorkspaceFileContent>
  browser?: Browser
  browserContext?: BrowserContext
  page?: Page
  preconditionSummary?: string[]
  preconditionReport?: PreconditionReport
  initialPageState?: InitialPageState
  hasWorkspace?: boolean
  analyzeImage?: (input: { dataUrl: string; mimeType: string; prompt: string }) => Promise<string>
  /** 运行时文本生成。direct 模式由 AgentDirectService 接 run.service 的 generateTextWithCurrentLlm。translate_document 等工具用它逐段翻译。 */
  generateText?: (prompt: string, systemPrompt?: string) => Promise<string>
  requestHumanInput?: (request: { reason: string; instruction: string; inputLabel?: string; placeholder?: string; confirmText?: string; imageUrl?: string }) => Promise<string>
  signal?: AbortSignal
  waitIfPaused?: () => Promise<void>
  lastVerifiedCode?: string
  runtimeContext?: ScriptRuntimeContext
  authProfile?: import("@autovis/shared").AuthProfile
  /** Playwright storageState JSON：由调用方按当前 run.targetUrlId 解析后注入。 */
  authStorageStateJson?: string
  /**
   * 反检测有头模式（真实 Chrome）：由调用方按站点 needsStealth + 用例级覆盖解析后注入。
   * 决定全新启动 / 回放重建浏览器时是否走有头真 Chrome；留空回退到"有登录态即有头"的旧推断。
   */
  stealth?: boolean
  /**
   * 本次生成实际使用的 base URL，来自前端下拉显式选中的 TargetUrl。
   * Agent 的浏览器初始化、recoveryUrl、prompts 里展示给 LLM 的 testBaseUrl、execute_step 的 getBaseUrl()
   * 都用这个值——project.testBaseUrl 不再作为业务 URL 兜底。
   */
  effectiveBaseUrl?: string
}

export interface ScriptRuntimeContext {
  outputs: RuntimeOutput[]
  tempValues: Map<string, unknown>
  producer?: {
    testCaseId?: string
    caseCode?: string
    caseName?: string
  }
}

export interface ToolRuntimeContext {
  page: Page | null
  project: Project
  agentSessionId: string
  artifactsDir: string
  /** 当前 run 产物目录，save_report 写报告 HTML 到这里。 */
  runDir?: string
  hasWorkspace?: boolean
  listWorkspaceTree: AgentContext["listWorkspaceTree"]
  globWorkspacePaths: AgentContext["globWorkspacePaths"]
  searchWorkspaceCode: AgentContext["searchWorkspaceCode"]
  readWorkspaceFile: AgentContext["readWorkspaceFile"]
  analyzeImage?: AgentContext["analyzeImage"]
  generateText?: AgentContext["generateText"]
}

export interface LocatorQuery {
  selector?: string
  role?: string
  text?: string
  label?: string
  placeholder?: string
  index?: number
  /** 目标在某个 iframe 内时，传该 iframe 的 CSS 选择器（取自页面快照的 [iframe ...] 段），定位会进入该 frame。 */
  iframe?: string
}

export interface ToolExecutionResult {
  content: string
  detail?: string
  payloadJson?: string
  screenshotUrl?: string
  url?: string
  fileName?: string
  selector?: string
  stage?: AgentStage
}
