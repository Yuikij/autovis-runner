import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { type Frame, type FrameLocator, type Page } from "@playwright/test"
import { detectRiskControl, riskControlBanner, type RiskControlSignal } from "@autovis/runner"
import { type LocatorQuery } from "./types.js"

// 风控检测与提示文案统一收敛到 @autovis/runner（运行时 risk 方法、server 探索工具共用一份正则，避免漂移）。
export { detectRiskControl, riskControlBanner, type RiskControlSignal }

/**
 * 把 agent 单步的完整调试信息（LLM 生成脚本 + 未截断的执行结果/页面快照）追加到文件，
 * 控制台日志会截断，靠这个文件还原"这一步到底发生了什么"。
 * 路径：<DATA_DIR>/artifacts/<sessionId>/agent-debug.log
 */
export async function appendAgentDebugLog(artifactsDir: string, sessionId: string, section: string): Promise<void> {
  try {
    const dir = join(artifactsDir, sessionId)
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, "agent-debug.log"), section + "\n")
  } catch (error) {
    console.warn(`[agent-debug] 写调试日志失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + `\n... (truncated, ${text.length} chars total)`
}

export function sanitizeFileSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "snapshot"
}

export function toArtifactUrl(sessionId: string, fileName: string): string {
  return `/artifacts/${sessionId}/${fileName}`
}

export async function saveAgentScreenshot(page: Page, artifactsDir: string, sessionId: string, name = "agent-shot"): Promise<string> {
  const dir = join(artifactsDir, sessionId)
  await mkdir(dir, { recursive: true })
  const fileName = `${Date.now()}-${sanitizeFileSegment(name)}.png`
  await waitForPageContent(page).catch(() => undefined)
  // 只截可见视口 + 短超时 + 关动画：京东这类超长懒加载页 fullPage 截图会卡满 30s，
  // 把"其实成功了的步骤"也拖到超时触发整脚本重放。截图失败仅记日志，绝不阻断步骤。
  await page
    .screenshot({ path: join(dir, fileName), fullPage: false, timeout: 8000, animations: "disabled", caret: "initial" })
    .catch((error) => {
      console.warn(`[screenshot] ${name} 截图失败（已忽略）：${error instanceof Error ? error.message : String(error)}`)
    })
  return toArtifactUrl(sessionId, fileName)
}

export async function waitForPageContent(page: Page, timeout = 8000): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined)
  await page.waitForFunction(
    () => {
      const body = document.body
      if (!body) return false
      const text = (body.innerText || body.textContent || "").trim()
      if (text.length > 0) return true

      const root = document.querySelector("#root, #app, [data-reactroot]")
      if (root && root.innerHTML.trim().length > 120) return true

      const interactive = Array.from(document.querySelectorAll("input,button,textarea,select,a,[role='button'],[role='textbox']"))
      if (interactive.some((node) => {
        const el = node as HTMLElement
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      })) {
        return true
      }

      return Array.from(document.querySelectorAll("canvas,svg,img")).some((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return rect.width >= 40 && rect.height >= 40
      })
    },
    undefined,
    { timeout },
  ).catch(() => undefined)
}

async function isVisuallyEmptyPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const body = document.body
    if (!body) return true
    const text = (body.innerText || body.textContent || "").trim()
    if (text.length > 0) return false
    const root = document.querySelector("#root, #app, [data-reactroot]")
    if (root && root.innerHTML.trim().length > 80) return false
    const visible = Array.from(document.querySelectorAll("input,button,textarea,select,a,[role='button'],[role='textbox'],canvas,svg,img"))
      .some((node) => {
        const el = node as HTMLElement
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      })
    return !visible
  }).catch(() => false)
}

export async function recoverBlankSpaRoute(page: Page, attemptedUrl?: string, projectBaseUrl?: string): Promise<boolean> {
  await waitForPageContent(page, 4000).catch(() => undefined)
  if (!(await isVisuallyEmptyPage(page))) return false

  const candidates: string[] = []
  const pushCandidate = (value: string) => {
    if (value && !candidates.includes(value)) candidates.push(value)
  }

  for (const value of [attemptedUrl, projectBaseUrl]) {
    if (!value || !/^https?:\/\//i.test(value)) continue
    try {
      const url = new URL(value)
      const pathname = url.pathname.replace(/\/+$/, "")
      const loginMatch = pathname.match(/^(.*)\/login$/)
      if (loginMatch?.[1] && loginMatch[1] !== "") {
        pushCandidate(`${url.origin}${loginMatch[1]}/#/login`)
        continue
      }
      if (pathname && pathname !== "/") {
        pushCandidate(`${url.origin}${pathname.replace(/\/?$/, "/")}#/login`)
      }
    } catch {
      // Non-critical recovery.
    }
  }

  for (const candidate of candidates) {
    await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined)
    await waitForPageContent(page, 8000).catch(() => undefined)
    if (!(await isVisuallyEmptyPage(page))) {
      console.log(`[agent] recovered blank SPA route: ${attemptedUrl ?? page.url()} -> ${page.url()}`)
      return true
    }
  }

  return false
}

export function resolveUrl(target: string, projectBaseUrl: string, currentUrl?: string): string {
  if (/^https?:\/\//i.test(target)) {
    return target
  }

  try {
    if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
      return new URL(target, currentUrl).toString()
    }
    if (projectBaseUrl) {
      return new URL(target, projectBaseUrl).toString()
    }
  } catch {
    return target
  }

  return target
}

export function describeLocator(args: LocatorQuery): string {
  if (args.selector) return `选择器 ${args.selector}`
  if (args.label) return `标签“${args.label}”`
  if (args.placeholder) return `placeholder“${args.placeholder}”`
  if (args.role && args.text) return `${args.role}“${args.text}”`
  if (args.role) return `role=${args.role}`
  if (args.text) return `文本“${args.text}”`
  return "目标元素"
}

export async function getPageSnapshot(page: Page): Promise<string> {
  await waitForPageContent(page).catch(() => undefined)
  const sections: string[] = []

  // Layer 1: Page metadata
  try {
    const title = await page.title().catch(() => "")
    const url = page.url()
    const viewport = page.viewportSize()
    const vpStr = viewport ? `${viewport.width}x${viewport.height}` : "unknown"
    sections.push(`[页面] ${title || "(无标题)"} | ${url} | viewport: ${vpStr}`)
  } catch {
    sections.push("[页面] (无法获取页面元信息)")
  }

  // 反爬 / 风控 / 验证 / 登录 信号（放最前面，避免 LLM 把"被风控打回"误判成选择器问题而反复改）。
  // URL/标题/正文/滑块 DOM 四类信号合并判定，覆盖中英文风控页（含淘系 Captcha Interception / error.taobao.com）。
  try {
    const signal = await detectRiskControl(page)
    if (signal.blocked) {
      sections.push(riskControlBanner(signal))
    }
  } catch {
    // Non-critical
  }

  // Layer 2: UI state sensing
  try {
    const uiState = await page.evaluate(() => {
      const signals: string[] = []

      // Dialogs / Modals
      const dialogSelectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        ".ant-modal-wrap:not(.ant-modal-wrap-hidden)",
        ".ant-drawer-open",
        ".el-dialog__wrapper",
        ".el-drawer.el-drawer--open",
        ".modal.show",
        ".modal.fade.show",
        '[data-state="open"][role="dialog"]',
      ]
      const visibleDialogs: string[] = []
      for (const sel of dialogSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const htmlEl = el as HTMLElement
          if (htmlEl.offsetParent !== null || getComputedStyle(htmlEl).display !== "none") {
            const title = htmlEl.getAttribute("aria-label")
              || htmlEl.querySelector(".ant-modal-title, .el-dialog__title, .modal-title, [class*='title']")?.textContent?.trim()
              || ""
            visibleDialogs.push(title ? `"${title.slice(0, 40)}"` : "(无标题)")
          }
        })
      }
      if (visibleDialogs.length > 0) {
        signals.push(`[弹窗] 检测到 ${visibleDialogs.length} 个可见弹窗: ${visibleDialogs.join(", ")}`)
      }

      // Loading state
      const loadingSelectors = [
        ".ant-spin-spinning",
        ".ant-skeleton-active",
        ".el-loading-mask",
        ".el-skeleton.is-animated",
        '[aria-busy="true"]',
        ".spinner-border",
        ".loading",
        '[class*="skeleton"]',
      ]
      let loadingCount = 0
      for (const sel of loadingSelectors) {
        loadingCount += document.querySelectorAll(sel).length
      }
      if (loadingCount > 0) {
        signals.push(`[Loading] 页面存在 ${loadingCount} 个加载中状态`)
      }

      // Error / Alert messages
      const alertSelectors = [
        '[role="alert"]',
        ".ant-message .ant-message-error",
        ".ant-message .ant-message-warning",
        ".ant-alert-error",
        ".ant-alert-warning",
        ".el-message--error",
        ".el-message--warning",
        ".el-alert--error",
        ".el-alert--warning",
        ".alert-danger",
        ".alert-warning",
        ".toast-error",
      ]
      for (const sel of alertSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const text = (el as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 80)
          if (text) {
            signals.push(`[错误/警告] ${text}`)
          }
        })
      }

      // Success messages
      const successSelectors = [
        ".ant-message .ant-message-success",
        ".ant-alert-success",
        ".el-message--success",
        ".el-alert--success",
        ".alert-success",
        ".toast-success",
      ]
      for (const sel of successSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const text = (el as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 80)
          if (text) {
            signals.push(`[成功消息] ${text}`)
          }
        })
      }

      // Form validation errors
      const formErrorSelectors = [
        ".ant-form-item-has-error .ant-form-item-explain",
        ".el-form-item.is-error .el-form-item__error",
        ".is-invalid ~ .invalid-feedback",
        ".field-error",
        '[class*="form"] [class*="error"]',
      ]
      const formErrors: string[] = []
      for (const sel of formErrorSelectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const text = (el as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 60)
          if (text && !formErrors.includes(text)) {
            formErrors.push(text)
          }
        })
      }
      if (formErrors.length > 0) {
        signals.push(`[表单校验] ${formErrors.slice(0, 5).join("; ")}`)
      }

      // Focus element
      const focused = document.activeElement
      if (focused && focused !== document.body && focused.tagName !== "HTML") {
        const tag = focused.tagName.toLowerCase()
        const name = focused.getAttribute("name") || ""
        const label = focused.getAttribute("aria-label") || focused.getAttribute("placeholder") || ""
        const id = focused.id || ""
        let focusDesc = `<${tag}>`
        if (id) focusDesc += ` id="${id}"`
        if (name) focusDesc += ` name="${name}"`
        if (label) focusDesc += ` label="${label}"`
        signals.push(`[焦点] 当前焦点在 ${focusDesc}`)
      }

      return signals
    })
    if (uiState.length > 0) {
      sections.push(uiState.join("\n"))
    }
  } catch {
    // UI state sensing failure is non-critical
  }

  // Layer 3: Form values summary
  try {
    const formSummary = await page.evaluate(() => {
      const entries: string[] = []
      const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
      )
      let count = 0
      inputs.forEach((el) => {
        if (count >= 15) return
        const htmlEl = el as HTMLElement
        if (htmlEl.offsetParent === null && getComputedStyle(htmlEl).display === "none") return

        const tag = el.tagName.toLowerCase()
        const type = el.getAttribute("type") || (tag === "textarea" ? "textarea" : tag === "select" ? "select" : "text")
        const name = el.getAttribute("name") || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.id || ""

        if (type === "checkbox" || type === "radio") {
          const checked = (el as HTMLInputElement).checked
          if (name) {
            entries.push(`  - ${type}[${name}] = ${checked ? "✓ checked" : "☐ unchecked"}`)
            count++
          }
        } else if (tag === "select") {
          const selectEl = el as HTMLSelectElement
          const selected = selectEl.options[selectEl.selectedIndex]?.text?.trim() || ""
          if (name || selected) {
            entries.push(`  - select[${name}] = "${selected.slice(0, 40)}"`)
            count++
          }
        } else {
          const value = el.value?.trim() || ""
          if (name || value) {
            const display = value ? `"${value.slice(0, 40)}"` : "(空)"
            entries.push(`  - ${type}[${name}] = ${display}`)
            count++
          }
        }
      })
      return entries
    })
    if (formSummary.length > 0) {
      sections.push(`[表单值]\n${formSummary.join("\n")}`)
    }
  } catch {
    // Form summary failure is non-critical
  }

  // Layer 3b: 自定义勾选控件（京东购物车等用 div/span + aria-checked 或 class，不是原生 input）
  try {
    const toggles = await page.evaluate(() => {
      const entries: string[] = []
      const seen = new Set<Element>()
      const pushEntry = (el: Element, role: string, state: string) => {
        if (seen.has(el)) return
        seen.add(el)
        const htmlEl = el as HTMLElement
        if (htmlEl.offsetParent === null && getComputedStyle(htmlEl).display === "none") return
        const label = (htmlEl.getAttribute("aria-label") || htmlEl.getAttribute("title") || htmlEl.innerText || "")
          .trim().replace(/\s+/g, " ").slice(0, 40)
        entries.push(`  - ${role}[${label || "?"}] = ${state}`)
      }
      // 标准：aria-checked / role
      document.querySelectorAll('[role="checkbox"],[role="radio"],[role="switch"],[aria-checked]').forEach((el) => {
        if (entries.length >= 20) return
        const checked = el.getAttribute("aria-checked")
        pushEntry(el, el.getAttribute("role") || "toggle", checked === "true" ? "✓ checked" : checked === "false" ? "☐ unchecked" : "(无 aria-checked)")
      })
      // 启发式：class 里含 checkbox 的自定义控件，用 class 是否含 checked/selected/active 判断
      document.querySelectorAll('[class*="checkbox" i],[class*="check-box" i]').forEach((el) => {
        if (entries.length >= 20) return
        const cls = (typeof el.className === "string" ? el.className : "").toLowerCase()
        const checked = /\b(checked|selected|active|on)\b/.test(cls) || /(checked|selected)/.test(cls)
        pushEntry(el, "checkbox?", checked ? "✓ checked?" : "☐ unchecked?")
      })
      return entries
    })
    if (toggles.length > 0) {
      sections.push(`[勾选控件（非原生 input，定位时优先用容器作用域 + 文本/序号，不要只靠 class）]\n${toggles.join("\n")}`)
    }
  } catch {
    // Non-critical
  }

  // Layer 4: Table structure summary
  try {
    const tableSummary = await page.evaluate(() => {
      const tables = document.querySelectorAll('table, [role="grid"], [role="table"]')
      if (tables.length === 0) return ""

      const summaries: string[] = []
      tables.forEach((table, index) => {
        if (index >= 5) return
        const htmlTable = table as HTMLElement
        if (htmlTable.offsetParent === null && getComputedStyle(htmlTable).display === "none") return

        const headers: string[] = []
        table.querySelectorAll("thead th, thead td, [role='columnheader']").forEach((th) => {
          const text = (th as HTMLElement).innerText?.trim().replace(/\s+/g, " ").slice(0, 20)
          if (text) headers.push(text)
        })

        const rows = table.querySelectorAll("tbody tr, [role='row']")
        const rowCount = rows.length
        const colCount = headers.length || (rows[0]?.querySelectorAll("td, [role='gridcell']").length ?? 0)

        let desc = `  表格 ${index + 1}: ${colCount} 列 x ${rowCount} 行`
        if (headers.length > 0) {
          desc += ` | 列标题: ${headers.slice(0, 10).join(", ")}`
        }
        summaries.push(desc)
      })
      return summaries.length > 0 ? summaries.join("\n") : ""
    })
    if (tableSummary) {
      sections.push(`[表格]\n${tableSummary}`)
    }
  } catch {
    // Table summary failure is non-critical
  }

  // Layer 5: Aria snapshot (primary content)
  try {
    const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5000 })
    sections.push(truncate(snapshot, 12000))
  } catch {
    // Fallback: DOM walker
    try {
      const fallback = await page.evaluate(() => {
        const walk = (el: Element, depth: number): string => {
          if (depth > 8) return ""
          const indent = "  ".repeat(depth)
          const tag = el.tagName.toLowerCase()
          const role = el.getAttribute("role") ?? ""
          const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60)
          const roleAttr = role ? ` role="${role}"` : ""
          const textAttr = text ? ` text="${text}"` : ""
          let result = `${indent}<${tag}${roleAttr}${textAttr}>\n`
          for (const child of el.children) {
            result += walk(child, depth + 1)
          }
          return result
        }
        return walk(document.body, 0)
      })
      sections.push(truncate(fallback, 12000))
    } catch {
      sections.push("(无法获取页面结构快照)")
    }
  }

  // Layer 5b: 主内容区可点击链接摘要
  // ariaSnapshot 会丢掉"图片型 <a>"的 href（如搜索结果商品卡片：一张图包一个链接，无可访问文本），
  // 导致 LLM 看不到任何真实可点目标，只能瞎猜 .gl-item/.p-name 这类早就变了的 class。
  // 这里直接从 DOM 枚举主内容区（排除 nav/header/footer）的可见链接，给出 text + href + 是否新标签页，
  // 让 LLM 拿到真实 href 去 page.goto 或构造 a[href*="..."] 选择器。
  try {
    const links = await page.evaluate(() => {
      const out: { text: string; href: string; newTab: boolean }[] = []
      const seen = new Set<string>()
      const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]
      for (const a of anchors) {
        if (out.length >= 40) break
        if (a.closest("nav,header,footer")) continue
        if (a.offsetParent === null && getComputedStyle(a).display === "none") continue
        const rect = a.getBoundingClientRect()
        if (rect.width < 8 || rect.height < 8) continue
        const href = a.getAttribute("href") || ""
        if (!href || href.startsWith("javascript:") || href === "#") continue
        const text = (a.innerText || a.getAttribute("aria-label") || a.querySelector("img")?.getAttribute("alt") || a.title || "")
          .trim().replace(/\s+/g, " ").slice(0, 50)
        const key = `${href}|${text}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ text, href: href.length > 120 ? href.slice(0, 120) + "…" : href, newTab: a.target === "_blank" })
      }
      return out
    })
    if (links.length > 0) {
      sections.push(
        "[主内容区链接（text | href | 是否新标签页）——列表/搜索结果项点这里拿真实 href，别猜 class]\n" +
          links.map((l) => `  - ${l.text || "(无文本)"} | ${l.href}${l.newTab ? " | ↗新标签页" : ""}`).join("\n"),
      )
    }
  } catch {
    // Non-critical
  }

  // Layer 5c: 数据卡片摘要（data-sku / data-spu / data-id 等）
  // 现代电商/列表把"列表项"渲染成带稳定 data-* id 的 <div>（class 是每次构建都变的哈希，且根本不是 <a>，
  // 没有 href）。例如新版京东搜索结果：<div class="_wrapper_xxx" data-sku="100051210211">…标题…</div>，
  // 既没有 item.jd.com 链接、也没有 .gl-item/.p-name。Layer 5b（找 <a href>）对这类页面完全抓不到东西。
  // 这里枚举带稳定 id 属性的可见重复卡片，给出 id + 文本，让 LLM 用 [data-sku] 定位、读出 id 后按详情页 URL 模板跳转。
  try {
    const cards = await page.evaluate(() => {
      const idAttrs = ["data-sku", "data-spu", "data-item-id", "data-pid", "data-product-id", "data-id"]
      const out: { attr: string; id: string; text: string }[] = []
      const seen = new Set<string>()
      for (const attr of idAttrs) {
        const els = Array.from(document.querySelectorAll(`[${attr}]`)) as HTMLElement[]
        for (const el of els) {
          if (out.length >= 24) break
          const id = el.getAttribute(attr) || ""
          if (!id || !/^[\w.-]{4,}$/.test(id)) continue
          const key = `${attr}=${id}`
          if (seen.has(key)) continue
          const rect = el.getBoundingClientRect()
          if (rect.width < 40 || rect.height < 40) continue
          // 标题优先取卡片内带 title 属性的元素（电商卡片标题多放在 [title] 上），否则取 innerText
          const titled = el.querySelector("[title]") as HTMLElement | null
          const text = (titled?.getAttribute("title") || el.innerText || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 70)
          if (!text) continue
          seen.add(key)
          out.push({ attr, id, text })
        }
        if (out.length >= 24) break
      }
      return out
    })
    if (cards.length > 0) {
      const attrName = cards[0].attr
      sections.push(
        `[数据卡片（${attrName} | 文本）——列表/搜索结果项是带稳定 id 的 <div>，不是 <a>、没有 href！]\n` +
          `  用 page.locator('[${attrName}]') 定位卡片；要进详情就读出该属性值，再按本站详情页 URL 的规律拼 URL 跳转。class 是构建哈希，禁止猜。\n` +
          cards.map((c, i) => `  ${i + 1}. [${c.attr}=${c.id}] ${c.text}`).join("\n"),
      )
    }
  } catch {
    // Non-critical
  }

  // Layer 6: 可见 iframe 内容
  // 京东"立即购买"弹出的结算层 (#settlement-lite) 就是个跨域 iframe，主 body 的 ariaSnapshot
  // 看不到里面任何东西。这里把"够大、可见"的 iframe 各自 ariaSnapshot 一段，并给出可用于
  // page.frameLocator(...) 的选择器，让 LLM 能看见结算层 / 内嵌页并正确定位。
  try {
    const frameSnapshots = await snapshotVisibleFrames(page)
    for (const fs of frameSnapshots) {
      sections.push(
        `[iframe ${fs.selector} | ${fs.url}]\n（进入此 iframe：page.frameLocator('${fs.selector}')）\n${truncate(fs.snapshot, 5000)}`,
      )
    }
  } catch {
    // iframe 快照失败不影响主快照
  }

  return sections.join("\n\n")
}

interface FrameSnapshot {
  selector: string
  url: string
  snapshot: string
}

/**
 * 找出页面里"够大、可见"的 iframe（过滤掉广告/埋点小 iframe），各取一段 ariaSnapshot。
 * selector 优先级：iframe 自身 id > name > 最近带 id 的祖先 + " iframe" > src host 片段 > "iframe"。
 */
async function snapshotVisibleFrames(page: Page): Promise<FrameSnapshot[]> {
  const candidates: { frame: Frame; area: number; selector: string; url: string }[] = []
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const url = frame.url()
    if (!url || url === "about:blank") continue
    let handle
    try {
      handle = await frame.frameElement()
    } catch {
      continue
    }
    try {
      const box = await handle.boundingBox().catch(() => null)
      if (!box || box.width < 200 || box.height < 120) continue
      const meta = await handle
        .evaluate((el) => {
          const iframe = el as HTMLIFrameElement
          let parentId = ""
          let p: Element | null = iframe.parentElement
          let hops = 0
          while (p && hops < 5) {
            if (p.id) {
              parentId = p.id
              break
            }
            p = p.parentElement
            hops += 1
          }
          return { id: iframe.id || "", name: iframe.getAttribute("name") || "", parentId, src: iframe.getAttribute("src") || "" }
        })
        .catch(() => ({ id: "", name: "", parentId: "", src: "" }))

      let selector = "iframe"
      if (meta.id) selector = `iframe#${meta.id}`
      else if (meta.name) selector = `iframe[name="${meta.name}"]`
      else if (meta.parentId) selector = `#${meta.parentId} iframe`
      else if (meta.src) {
        try {
          const host = new URL(meta.src, url).host
          if (host) selector = `iframe[src*="${host}"]`
        } catch {
          // ignore
        }
      }
      candidates.push({ frame, area: box.width * box.height, selector, url })
    } finally {
      await handle.dispose().catch(() => undefined)
    }
  }

  candidates.sort((a, b) => b.area - a.area)
  const results: FrameSnapshot[] = []
  for (const candidate of candidates.slice(0, 3)) {
    try {
      const snapshot = await candidate.frame.locator("body").ariaSnapshot({ timeout: 3000 })
      if (snapshot.trim()) {
        results.push({ selector: candidate.selector, url: candidate.url, snapshot })
      }
    } catch {
      // 单个 iframe 取不到快照就跳过
    }
  }
  return results
}

export function buildLocatorTarget(page: Page, args: LocatorQuery) {
  let locator
  let description
  let selector

  // 目标在 iframe 内时，把作用域切到 frameLocator（结算浮层等跨域 iframe 用得上）。
  const scope: Page | FrameLocator = args.iframe ? page.frameLocator(args.iframe) : page
  const scopeDesc = args.iframe ? `iframe(${args.iframe})>` : ""

  if (args.selector) {
    locator = scope.locator(args.selector)
    description = `${scopeDesc}selector=${args.selector}`
    selector = args.selector
  } else if (args.label) {
    locator = scope.getByLabel(args.label)
    description = `${scopeDesc}label=${args.label}`
  } else if (args.placeholder) {
    locator = scope.getByPlaceholder(args.placeholder)
    description = `${scopeDesc}placeholder=${args.placeholder}`
  } else if (args.role) {
    const name = args.text ?? args.label ?? args.placeholder
    locator = scope.getByRole(args.role as never, name ? { name } : undefined)
    description = name ? `${scopeDesc}role=${args.role}, name=${name}` : `${scopeDesc}role=${args.role}`
  } else if (args.text) {
    locator = scope.getByText(args.text)
    description = `${scopeDesc}text=${args.text}`
  } else {
    throw new Error("请至少提供 selector、role、text、label 或 placeholder 之一。")
  }

  if (args.index !== undefined && typeof args.index === "number") {
    locator = locator.nth(args.index)
    description += `, index=${args.index}`
  }

  return { locator, description, selector }
}

export function buildToolTitle(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "list_workspace_tree": return `列出代码目录 ${String(args.path ?? "/")}`
    case "glob_workspace_paths": return `查找代码路径 ${String(args.pattern ?? "")}`.trim()
    case "search_workspace_code": return `搜索代码关键字 ${String(args.query ?? "")}`.trim()
    case "read_workspace_file": return `读取代码文件 ${String(args.path ?? "")}`.trim()
    case "inspect_page":
    case "navigate_to": return `访问测试网站 ${String(args.url ?? "")}`.trim()
    case "query_elements": return `查找${describeLocator(args as LocatorQuery)}位置`
    case "click_element": return `点击${describeLocator(args as LocatorQuery)}`
    case "fill_input": return `填写${describeLocator(args as LocatorQuery)}`
    case "press_key": return `发送按键 ${String(args.key ?? "")}`.trim()
    case "wait_for_page_state": return "等待页面变化"
    case "get_element_html": return `查看元素详情 ${String(args.selector ?? "")}`.trim()
    case "capture_screenshot": return `保存页面截图${args.name ? ` ${String(args.name)}` : ""}`
    case "analyze_image": return `调用视觉模型分析 ${String(args.selector ?? "")}`.trim()
    case "analyze_current_page": return `视觉分析当前页面`
    case "execute_step": return `执行验证 · ${String(args.title ?? "")}`.trim()
    default: return toolName
  }
}

export function buildToolSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "list_workspace_tree": return String(args.path ?? "/")
    case "glob_workspace_paths": return String(args.pattern ?? "")
    case "search_workspace_code": return String(args.query ?? "")
    case "read_workspace_file": return String(args.path ?? "")
    case "inspect_page":
    case "navigate_to": return String(args.url ?? "")
    case "query_elements":
    case "click_element":
    case "fill_input": return describeLocator(args as LocatorQuery)
    case "press_key": return String(args.key ?? "")
    case "wait_for_page_state": return JSON.stringify(args)
    case "get_element_html": return String(args.selector ?? "")
    case "capture_screenshot": return String(args.name ?? "当前页面")
    case "analyze_image": return `识别目标 ${String(args.selector ?? "")}`
    case "analyze_current_page": return String(args.prompt ?? "分析当前页面").slice(0, 40)
    case "execute_step": return String(args.title ?? "执行脚本步骤")
    default: return JSON.stringify(args)
  }
}
