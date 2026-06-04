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
  /** 有序的前置用例：执行本用例前会自动按顺序先跑这些用例（用于登录 / 造数据等可复用前置）。 */
  dependencyCaseIds: Identifier[]
  authProfileId?: Identifier
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