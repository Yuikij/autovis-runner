import type { Identifier } from "./core"
import type { LlmProviderKind } from "./llm"
import type { VerificationStatus } from "./run"

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