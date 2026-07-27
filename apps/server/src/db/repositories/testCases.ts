import type { DatabaseSync, SQLOutputValue } from "node:sqlite"

import type { CaseContract, TestCase, UpsertTestCaseRequest } from "@browsewright/shared"
import { mapTestCase, type TestCaseRow } from "../mappers.js"
import { now } from "../shared.js"

const typedRows = <TRow>(rows: Record<string, SQLOutputValue>[]): TRow[] => rows as unknown as TRow[]
const typedRow = <TRow>(row: Record<string, SQLOutputValue> | undefined): TRow | undefined => row as TRow | undefined

export const listTestCases = (db: DatabaseSync, projectId?: string): TestCase[] => {
  const rows = projectId
    ? typedRows<TestCaseRow>(db.prepare("SELECT * FROM test_cases WHERE project_id = ? ORDER BY case_code ASC").all(projectId))
    : typedRows<TestCaseRow>(db.prepare("SELECT * FROM test_cases ORDER BY case_code ASC").all())
  return rows.map(mapTestCase)
}

export const getTestCase = (db: DatabaseSync, testCaseId: string): TestCase | undefined => {
  const row = typedRow<TestCaseRow>(db.prepare("SELECT * FROM test_cases WHERE id = ?").get(testCaseId))
  return row ? mapTestCase(row) : undefined
}

export const upsertTestCase = (db: DatabaseSync, input: UpsertTestCaseRequest & { id: string }) => {
  const existing = getTestCase(db, input.id)
  const timestamp = now()

  // contract / apiEnabled / apiIntended 不在每次普通编辑里都带上：input 未提供时保留已有值，避免被清空。
  const contractValue = input.contract !== undefined ? input.contract : existing?.contract
  const contractJson = contractValue ? JSON.stringify(contractValue) : null
  const apiEnabledValue = input.apiEnabled !== undefined ? input.apiEnabled : existing?.apiEnabled
  const apiEnabledInt = apiEnabledValue ? 1 : 0
  const apiIntendedValue = input.apiIntended !== undefined ? input.apiIntended : existing?.apiIntended
  const apiIntendedInt = apiIntendedValue ? 1 : 0

  if (existing) {
    db.prepare(`
          UPDATE test_cases
          SET project_id = ?, case_code = ?, module_name = ?, module_id = ?, purpose = ?, dependency_case_ids = ?, auth_profile_id = ?, target_url_id = ?, steps = ?,
              expected_result = ?, test_type = ?, bug_id = ?, note = ?, ai_script = ?, contract = ?, api_intended = ?, api_enabled = ?, last_verified_run_id = ?, last_verified_status = ?, last_verified_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
      input.projectId,
      input.caseCode,
      input.moduleName ?? null,
      input.moduleId ?? null,
      input.purpose ?? "",
      JSON.stringify(input.dependencyCaseIds ?? []),
      input.authProfileId ?? null,
      input.defaultTargetUrlId ?? null,
      JSON.stringify(input.steps),
      input.expectedResult,
      input.testType,
      input.bugId ?? null,
      input.note ?? null,
      input.aiScript ?? null,
      contractJson,
      apiIntendedInt,
      apiEnabledInt,
      existing.lastVerifiedRunId ?? null,
      existing.lastVerifiedStatus ?? null,
      existing.lastVerifiedAt ?? null,
      timestamp,
      input.id,
    )
  } else {
    db.prepare(`
          INSERT INTO test_cases (
            id, project_id, case_code, module_name, module_id, purpose, dependency_case_ids, auth_profile_id, target_url_id, steps, expected_result,
            test_type, bug_id, note, ai_script, contract, api_intended, api_enabled, latest_script_id, last_verified_run_id, last_verified_status, last_verified_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
      input.id,
      input.projectId,
      input.caseCode,
      input.moduleName ?? null,
      input.moduleId ?? null,
      input.purpose ?? "",
      JSON.stringify(input.dependencyCaseIds ?? []),
      input.authProfileId ?? null,
      input.defaultTargetUrlId ?? null,
      JSON.stringify(input.steps),
      input.expectedResult,
      input.testType,
      input.bugId ?? null,
      input.note ?? null,
      input.aiScript ?? null,
      contractJson,
      apiIntendedInt,
      apiEnabledInt,
      null,
      null,
      null,
      null,
      timestamp,
      timestamp,
    )
  }

  return getTestCase(db, input.id)
}

/** 删除用例及其关联数据，返回被删除的 run / agent session id（用于清理产物目录）。 */
export const deleteTestCase = (db: DatabaseSync, testCaseId: string): string[] => {
  const runIds = (db.prepare("SELECT id FROM runs WHERE test_case_id = ?").all(testCaseId) as Array<{ id: string }>).map((row) => row.id)
  const agentIds = (db.prepare("SELECT id FROM agent_sessions WHERE test_case_id = ?").all(testCaseId) as Array<{ id: string }>).map((row) => row.id)
  db.exec("BEGIN")
  try {
    db.prepare("DELETE FROM agent_steps WHERE session_id IN (SELECT id FROM agent_sessions WHERE test_case_id = ?)").run(testCaseId)
    db.prepare("DELETE FROM agent_sessions WHERE test_case_id = ?").run(testCaseId)
    db.prepare("DELETE FROM recorder_sessions WHERE test_case_id = ?").run(testCaseId)
    db.prepare("DELETE FROM runs WHERE test_case_id = ?").run(testCaseId)
    db.prepare("DELETE FROM scripts WHERE test_case_id = ?").run(testCaseId)
    db.prepare("DELETE FROM test_cases WHERE id = ?").run(testCaseId)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  return [...runIds, ...agentIds]
}

export const listDependentTestCasesForCase = (db: DatabaseSync, dependencyCaseId: string): TestCase[] => {
  const rows = typedRows<TestCaseRow>(db.prepare("SELECT * FROM test_cases WHERE dependency_case_ids LIKE ? ORDER BY case_code ASC").all(`%${dependencyCaseId}%`))
  return rows.map(mapTestCase).filter((item) => item.dependencyCaseIds.includes(dependencyCaseId))
}

/** 写入/更新用例 API 契约（define_contract 工具或用户 review 冻结时调用）。 */
export const updateTestCaseContract = (db: DatabaseSync, testCaseId: string, contract: CaseContract | null) => {
  db.prepare("UPDATE test_cases SET contract = ?, updated_at = ? WHERE id = ?").run(
    contract ? JSON.stringify(contract) : null,
    now(),
    testCaseId,
  )
  return getTestCase(db, testCaseId)
}

/** 开/关用例对外 API 暴露开关。 */
export const setTestCaseApiEnabled = (db: DatabaseSync, testCaseId: string, enabled: boolean) => {
  db.prepare("UPDATE test_cases SET api_enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, now(), testCaseId)
  return getTestCase(db, testCaseId)
}

/** 开/关用例「计划 API 化」意图开关（轻量，不依赖 contract/脚本，用于在生成时注入 API 意识）。 */
export const setTestCaseApiIntended = (db: DatabaseSync, testCaseId: string, intended: boolean) => {
  db.prepare("UPDATE test_cases SET api_intended = ?, updated_at = ? WHERE id = ?").run(intended ? 1 : 0, now(), testCaseId)
  return getTestCase(db, testCaseId)
}

export const updateTestCaseVerification = (
  db: DatabaseSync,
  input: { testCaseId: string; runId?: string; status?: TestCase["lastVerifiedStatus"]; verifiedAt?: string },
) => {
  db.prepare(`
      UPDATE test_cases
      SET last_verified_run_id = ?, last_verified_status = ?, last_verified_at = ?
      WHERE id = ?
    `).run(input.runId ?? null, input.status ?? null, input.verifiedAt ?? null, input.testCaseId)
}
