import type { Page } from "@playwright/test"

/** 脚本运行时把"被风控拦截"标准化成这个前缀的错误，retry 等机制据此识别并跳过无谓重试。 */
export const RISK_CONTROL_ERROR_PREFIX = "RISK_CONTROL_BLOCKED"

export interface RiskControlSignal {
  /** 是否判定为被反自动化/风控拦截（验证码 / 限频错误页 / 登录墙）。 */
  blocked: boolean
  /** 拦截类型：captcha 滑块/人机验证；error_page 限频错误页；login_wall 登录墙。 */
  kind: "captcha" | "error_page" | "login_wall" | null
  /** 用于日志/提示的简短原因（标题或 URL 片段）。 */
  reason: string
}

/**
 * 统一的"风控 / 反自动化拦截"识别（不依赖任何具体站点的 class）。
 * 合并 URL / 标题 / 正文 / 滑块 DOM 四类信号，中英文通吃：
 *   - 标题 `Captcha Interception`
 *   - 正文 `Sorry, we have detected unusual traffic from your network.` / `Please slide to verify`
 *   - 错误页 `error.taobao.com/.../error.html`、`...something's wrong. Please refresh...(error:XXXX)`
 *   - 滑块容器 `#nocaptcha` / `.nc-container` / `nc_1_n1z`
 */
export async function detectRiskControl(page: Page): Promise<RiskControlSignal> {
  let url = ""
  try {
    url = page.url()
  } catch {
    // ignore
  }
  const lowerUrl = url.toLowerCase()
  const urlBlocked =
    /error\.taobao\.com|error\.tmall\.com|\/error\.html|punish|antispider|anti[_-]?spider|nocaptcha|\/_+tmd_+\/|\/verify|captcha|geetest|slidecode|passport\./.test(
      lowerUrl,
    )

  let info = { title: "", bodyText: "", hasSlider: false }
  try {
    info = await page.evaluate(() => {
      const title = document.title || ""
      const bodyText = (document.body?.innerText || document.body?.textContent || "").slice(0, 4000)
      const hasSlider = Boolean(
        document.querySelector(
          "#nocaptcha, .nc-container, .nc_wrapper, .btn_slide, [class*='nc_iconfont'], .geetest_slider, .geetest_radar, [aria-label='滑块']",
        ),
      )
      return { title, bodyText, hasSlider }
    })
  } catch {
    // page may be navigating; fall back to URL-only judgement below
  }

  const title = info.title || ""
  const text = info.bodyText || ""
  const titleBlocked =
    /captcha|interception|forbidden|access denied|robot check|安全验证|访问异常|页面异常|人机验证|滑块验证/i.test(title)
  const textPatterns: RegExp[] = [
    /detected unusual traffic/i,
    /unusual traffic from your network/i,
    /please slide to verify/i,
    /slide to verify/i,
    /please refresh and try again/i,
    /something'?s wrong/i,
    /\(error:[a-z0-9]+\)/i,
    /滑动(完成|下方)?验证|拖动(下方)?滑块|向右滑动|完成安全验证|访问验证/,
  ]
  const textBlocked = textPatterns.some((re) => re.test(text))

  const blocked = urlBlocked || titleBlocked || textBlocked || info.hasSlider
  if (!blocked) {
    return { blocked: false, kind: null, reason: "" }
  }

  let kind: RiskControlSignal["kind"] = "captcha"
  if (/error\.taobao\.com|error\.tmall\.com|\/error\.html|\(error:[a-z0-9]+\)/i.test(lowerUrl + " " + text)) {
    kind = "error_page"
  } else if (info.hasSlider || /slide to verify|滑块|滑动验证/i.test(text + " " + title)) {
    kind = "captcha"
  } else if (/未登录|请登录|passport\.|\/login(\b|\/|\?)/i.test(lowerUrl + " " + title)) {
    kind = "login_wall"
  }
  const reason = (title || url).slice(0, 120)
  return { blocked: true, kind, reason }
}

/** 给快照/工具结果用的统一风控提示文案。 */
export function riskControlBanner(signal: RiskControlSignal): string {
  const label = signal.kind === "error_page" ? "限频/错误页" : signal.kind === "login_wall" ? "登录墙" : "人机验证/滑块"
  return (
    `[⚠️ 风控拦截 / ${label}] 当前页面已被反自动化拦下（${signal.reason}）。这是环境/账号风控，**不是选择器或脚本写错**。\n` +
    "处理原则：①绝不反复改选择器或重写已 PASS 的早期步骤（再导航只会让风控更严）；" +
    "②绝不靠点击/简单拖拽去“解”滑块（淘系滑块带轨迹+设备指纹检测，自动化基本过不了）；" +
    "③若用例要求发通知，先把已拿到的信息（如最低价）发出去，再把本步标记为“风控拦截”并停手；" +
    "④需要人工时用 `human.input({ reason: 'captcha', ... })`，仍不行就输出文本报告结束，不要无脑重试。"
  )
}

/** 错误是否为风控拦截（运行时 retry/兜底用来判定"别重试"）。 */
export function isRiskControlError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(RISK_CONTROL_ERROR_PREFIX)
}
