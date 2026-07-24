import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import type {
  AgentStage,
  AgentStep,
  CaseContract,
  DataTableScriptApi,
  GenerateScriptRequest,
  KnowledgeScriptApi,
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
  /**
   * 复用的浏览器上下文是否为持久 profile（launchPersistentContext）。
   * 持久 context 没有可独立存活的 browser：关掉 context 会连 Chrome 一起退出，且不支持 newContext。
   * 因此 execute_step 的 resetBrowser 在持久模式下必须走"原页重新导航"的轻量恢复，
   * 绝不能 close()+newContext()（否则必崩 "Target page, context or browser has been closed"）。
   */
  persistent?: boolean
  preconditionSummary?: string[]
  preconditionReport?: PreconditionReport
  initialPageState?: InitialPageState
  hasWorkspace?: boolean
  analyzeImage?: (input: { dataUrl: string; mimeType: string; prompt: string }) => Promise<string>
  /** 运行时文本生成。direct 模式由 AgentDirectService 接 run.service 的 generateTextWithCurrentLlm。translate_document 等工具用它逐段翻译。 */
  generateText?: (prompt: string, systemPrompt?: string) => Promise<string>
  requestHumanInput?: (request: { reason: string; instruction: string; inputLabel?: string; placeholder?: string; confirmText?: string; imageUrl?: string }) => Promise<string>
  /** define_contract 工具回调：把 LLM 声明的接口契约冻结进当前用例（生成期使用）。 */
  defineContract?: (contract: CaseContract) => void | Promise<void>
  /** 项目级 data-tables 运行时 API；注入后生成期校验的脚本可用 `tables` 做持久记录 / 去重。 */
  dataTables?: DataTableScriptApi
  /** 项目级知识库运行时 API；注入后脚本可用 `knowledge` 沉淀多层级 Markdown，agent 可用 knowledge_* 工具。 */
  knowledge?: KnowledgeScriptApi
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
  defineContract?: AgentContext["defineContract"]
  /** 项目级共享数据表运行时 API：direct agent 的通用数据表工具（query_data_table / save_data_table_row）用它跨运行持久化（记忆/去重/台账）。 */
  dataTables?: AgentContext["dataTables"]
  /** 项目级知识库运行时 API：knowledge_* 工具用它读写跟项目走的多层级 Markdown 内容树。 */
  knowledge?: AgentContext["knowledge"]
  /** 任务取消信号：长耗时工具（如 translate_document 逐段翻译）应在每步前检查，及时中止避免空烧 LLM。 */
  signal?: AbortSignal
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
