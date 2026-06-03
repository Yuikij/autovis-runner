import type { Project } from "@autovis/shared"
import type { ScriptGenerationContext } from "../copilot.js"

export const buildScriptSystemPrompt = () =>
  [
    "You are generating runnable Playwright TypeScript logic for a Chinese enterprise admin web application.",
    "Return only runnable TypeScript code.",
    "Do not import or declare test, human, ai, chromium, or browser fixtures.",
    "Assume page, expect, human, ai, and test are already available at runtime.",
    "Write only the body that runs inside an existing async Playwright context, although using await test.step(...) is allowed.",
    "Prefer robust role/label/text locators.",
    "Keep comments minimal.",
    "Do not wrap the answer in markdown fences unless necessary.",
    "Always include robust assertions (using expect) based on the test case's expected results to verify page states, notifications, navigation changes, or visible elements.",
    "Do NOT call page.screenshot() manually to capture execution screenshots, as the runner automatically captures screenshots for each step.",
    "The page is ALREADY navigated to the Project base URL. Do NOT call page.goto() with absolute URLs or declare baseUrl variables.",
    "When a flow requires captcha, use a retry loop (up to 3 times): analyze image -> fill -> click submit -> check success -> break if success, otherwise wait for a new captcha.",
    "If the captcha retry loop fails all attempts, use await human.input(...) as a fallback.",
    "Generate runnable Playwright logic for the described admin UI without wrapping it in test(...) or importing @playwright/test.",
    "IMPORTANT: Do NOT declare const baseUrl or call page.goto(baseUrl). The runner has already navigated to the target URL.",
    "For captchas, remember to implement a retry loop (max 3 times) and fallback to await human.input({ reason: 'captcha_failed', instruction: '请手动输入验证码' }).",
  ].join(" ")

export const buildScriptUserPrompt = ({ request, project, testCase }: ScriptGenerationContext) => {
  const parts = [
    `Project base URL: ${project.testBaseUrl || "/"}`,
    `Test case code: ${testCase.caseCode}`,
    `Module: ${testCase.moduleName}`,
    `Purpose: ${testCase.purpose}`,
    `Expected result: ${testCase.expectedResult}`,
    `Steps:\n${testCase.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
  ]
  if (request.prompt?.trim()) {
    parts.push(`Natural language instruction:\n${request.prompt.trim()}`)
  }
  return parts.join("\n\n")
}

export const buildValidationScriptSystemPrompt = () =>
  [
    "You are generating a lightweight Playwright TypeScript validation script that checks whether a browser auth session is still valid.",
    "OUTPUT RULES:",
    "  - Return ONLY runnable TypeScript code, no markdown fences, no commentary.",
    "  - No import statements. Assume `page` (Playwright Page) and `expect` (Playwright expect) are globally available.",
    "  - Do NOT use human.input, ai.analyzeImage, test.step, screenshot, or any runtime objects other than `page` and `expect`.",
    "BEHAVIOR REQUIREMENTS:",
    "  - The browser will already be at the target URL when your code runs. You MAY call page.waitForLoadState() / page.waitForSelector() but you do NOT need to navigate again.",
    "  - If the session appears valid, exit cleanly (no return value needed).",
    "  - If the session appears invalid, throw an Error with a descriptive message (e.g. throw new Error('未登录：检测到登录表单')).",
    "VERIFICATION TARGET:",
    "  - Your script will be replayed against TWO browser contexts: one WITH the stored auth state (must PASS), one WITHOUT (must THROW).",
    "  - So your assertions must distinguish 『已登录』 from 『匿名』 based on actual UI signals — not generic checks that both states satisfy.",
    "  - Prefer assertions on elements that ONLY appear when logged in: user avatar/menu, logout button, dashboard-only links, account name display, or assertions that the current URL is NOT a /login redirect.",
    "QUALITY:",
    "  - Use robust locators: prefer getByRole, getByText, getByLabel over fragile CSS selectors.",
    "  - Keep total runtime under 10 seconds. Avoid long arbitrary timeouts.",
    "  - Script must be self-contained and idempotent.",
  ].join("\n")

/**
 * 双对照模式 (V2) 的额外上下文。SOP：
 *   1. 后端用同一 URL 分别开"带 storageState"和"匿名"两个浏览器
 *   2. 各自采集 DOM snapshot
 *   3. 把两份 snapshot 喂给模型，让它输出脚本
 *   4. 后端用脚本再回放两边：登录态必须通过、匿名必须失败
 *   5. 不达标则把失败原因回传，最多重试 N 轮
 */
export interface ValidationScriptDualContext {
  project: Project
  authProfileName: string
  authProfileDescription?: string
  loginUrl: string
  authedUrl: string
  anonUrl: string
  authedSnapshot: string
  anonSnapshot: string
  /** 当前是第几轮（1-based） */
  attempt: number
  /** 上轮失败的脚本和原因；首轮无 */
  previousAttempt?: { code: string; failureReason: string }
}

const truncateSnapshot = (snapshot: string, max = 6000): string => {
  if (snapshot.length <= max) return snapshot
  return snapshot.slice(0, max) + `\n... (truncated, ${snapshot.length} chars total)`
}

export const buildValidationScriptUserPromptV2 = (ctx: ValidationScriptDualContext) => {
  const sections: string[] = [
    `# Target`,
    `Project base URL: ${ctx.project.testBaseUrl || "/"}`,
    `Login URL (same URL is used for both contexts): ${ctx.loginUrl}`,
    `Auth profile: ${ctx.authProfileName}${ctx.authProfileDescription ? ` — ${ctx.authProfileDescription}` : ""}`,
    "",
    `# Snapshot A · 「登录态」浏览器实际表现`,
    `Final URL after navigation: ${ctx.authedUrl}`,
    "DOM signals:",
    "```",
    truncateSnapshot(ctx.authedSnapshot),
    "```",
    "",
    `# Snapshot B · 「匿名」浏览器实际表现（对照组）`,
    `Final URL after navigation: ${ctx.anonUrl}`,
    "DOM signals:",
    "```",
    truncateSnapshot(ctx.anonSnapshot),
    "```",
    "",
    `# Task`,
    "Compare A vs B and emit a validation script whose assertions:",
    "  - PASS when run against snapshot A (the logged-in browser).",
    "  - THROW when run against snapshot B (the anonymous browser).",
    "Anchor your assertions to concrete elements/URL differences you can see above. Do NOT invent selectors that don't appear in either snapshot.",
  ]

  if (ctx.previousAttempt) {
    sections.push(
      "",
      `# Previous attempt (attempt ${ctx.attempt - 1}) failed`,
      "Last script:",
      "```ts",
      ctx.previousAttempt.code,
      "```",
      "",
      "Failure reason:",
      ctx.previousAttempt.failureReason,
      "",
      "Fix the issue above. Re-emit the FULL script, no diff.",
    )
  }

  sections.push("", "Output the final TypeScript code only, no fences, no commentary.")
  return sections.join("\n")
}
