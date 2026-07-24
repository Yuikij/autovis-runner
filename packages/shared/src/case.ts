import type { CaseContract } from "./contract.js"
import type { Identifier } from "./core.js"
import type { LlmProviderKind } from "./llm.js"
import type { VerificationStatus } from "./run.js"

export type TestCaseType = "functional" | "regression" | "smoke"

export interface TestCase {
  id: Identifier
  projectId: Identifier
  caseCode: string
  moduleName?: string
  moduleId?: Identifier
  purpose: string
  /**
   * The IDs of test cases that must be executed successfully before this case.
   */
  dependencyCaseIds: Identifier[]
  /**
   * Optional AuthProfile ID required for this case to run.
   */
  authProfileId?: Identifier
  /**
   * The TargetUrl ID that this case defaults to executing against.
   * If not set, it will fallback to the project's default TargetUrl.
   */
  defaultTargetUrlId?: Identifier
  /**
   * User-provided steps in plain text.
   */
  steps: string[]
  expectedResult: string
  testType: TestCaseType
  bugId?: string
  note?: string
  aiScript?: string
  /**
   * API 化契约：声明入参 / 响应 schema，是把用例暴露成 API / MCP tool 的地基。
   * 由 `define_contract` 工具或用户 review 后写入并冻结。
   */
  contract?: CaseContract
  /**
   * 是否计划把本用例 API 化（轻量「意图」开关）。
   * 与 `apiEnabled`（实际对外暴露）不同：它可在脚本/契约生成前就开启，
   * 用于在 LLM 生成脚本时注入「API 意识」——先声明契约、再用 params.get() 写参数化脚本。
   * 开启它不要求已有 contract；真正对外暴露仍需 `apiEnabled`（依赖 contract + 脚本）。
   */
  apiIntended?: boolean
  /** 是否对外暴露为 API（「开启 API」开关）。需先有 contract 才有意义。 */
  apiEnabled?: boolean
  latestScriptId?: Identifier
  lastVerifiedRunId?: Identifier
  lastVerifiedStatus?: VerificationStatus
  lastVerifiedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface ScriptArtifact {
  id: Identifier
  testCaseId: Identifier
  version: number
  source: "generated" | "manual"
  provider: LlmProviderKind
  prompt: string
  code: string
  createdAt: string
}