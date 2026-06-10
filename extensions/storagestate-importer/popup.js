const FIELDS = ["runnerUrl", "projectId", "profileId", "targetUrlId", "cookieDomains", "token"]
const SESSION_COOKIE = "autovis_session"

const $ = (id) => document.getElementById(id)

function setStatus(kind, text) {
  const el = $("status")
  el.className = kind
  el.textContent = text
}

// 持久化表单（除 token 外都存下来，方便复用）。
async function loadSaved() {
  const saved = await chrome.storage.local.get(FIELDS)
  for (const f of FIELDS) {
    if (saved[f] != null) $(f).value = saved[f]
  }
  if (!$("cookieDomains").value) $("cookieDomains").value = "taobao.com,tmall.com"
  // 自动用当前标签页域名兜底补全采集域名。
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.url) {
      const host = new URL(tab.url).hostname
      const reg = registrableDomain(host)
      const existing = parseDomains($("cookieDomains").value)
      if (reg && !existing.includes(reg)) {
        $("cookieDomains").value = [...existing, reg].join(",")
      }
    }
  } catch {
    // 忽略：拿不到标签页就用默认值
  }
}

function persist() {
  const data = {}
  for (const f of FIELDS) data[f] = $(f).value.trim()
  void chrome.storage.local.set(data)
}

function parseDomains(raw) {
  return (raw || "")
    .split(",")
    .map((d) => d.trim().replace(/^\./, ""))
    .filter(Boolean)
}

// 极简「可注册域名」推断：覆盖常见多段后缀（com.cn 等），其余取末两段。
const MULTI_PART_TLDS = new Set(["com.cn", "net.cn", "org.cn", "gov.cn", "co.uk", "com.hk"])
function registrableDomain(hostname) {
  const parts = hostname.split(".").filter(Boolean)
  if (parts.length <= 2) return hostname
  const lastTwo = parts.slice(-2).join(".")
  const lastThree = parts.slice(-3).join(".")
  if (MULTI_PART_TLDS.has(lastTwo)) return lastThree
  return lastTwo
}

// chrome cookie sameSite → Playwright sameSite。None 需要 secure，否则降级 Lax 避免被拒。
function mapSameSite(cookie) {
  switch (cookie.sameSite) {
    case "strict":
      return "Strict"
    case "no_restriction":
      return cookie.secure ? "None" : "Lax"
    case "lax":
    case "unspecified":
    default:
      return "Lax"
  }
}

function toPlaywrightCookie(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.session || c.expirationDate == null ? -1 : Math.round(c.expirationDate),
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: mapSameSite(c),
  }
}

async function collectCookies(domains) {
  const byKey = new Map()
  for (const domain of domains) {
    let cookies = []
    try {
      cookies = await chrome.cookies.getAll({ domain })
    } catch {
      cookies = []
    }
    for (const c of cookies) {
      byKey.set(`${c.name}|${c.domain}|${c.path}`, toPlaywrightCookie(c))
    }
  }
  return [...byKey.values()]
}

async function collectLocalStorage(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const items = []
        for (let i = 0; i < localStorage.length; i++) {
          const name = localStorage.key(i)
          if (name == null) continue
          items.push({ name, value: localStorage.getItem(name) ?? "" })
        }
        return { origin: location.origin, items }
      },
    })
    return res?.result ?? null
  } catch {
    return null
  }
}

async function ensureSessionCookie(runnerUrl, token) {
  if (!token) return
  try {
    await chrome.cookies.set({
      url: runnerUrl,
      name: SESSION_COOKIE,
      value: token,
      path: "/",
    })
  } catch {
    // 忽略：拿不到 cookie 写权限就退回无鉴权直传
  }
}

async function capture() {
  const runnerUrl = $("runnerUrl").value.trim().replace(/\/+$/, "")
  const projectId = $("projectId").value.trim()
  const profileId = $("profileId").value.trim()
  const targetUrlId = $("targetUrlId").value.trim()
  const token = $("token").value.trim()
  const domains = parseDomains($("cookieDomains").value)

  if (!runnerUrl || !projectId || !profileId) {
    setStatus("err", "请先填写运行机地址、Project ID、Auth Profile ID。")
    return
  }
  if (domains.length === 0) {
    setStatus("err", "请至少填写一个采集域名（如 taobao.com）。")
    return
  }

  $("capture").disabled = true
  setStatus("info", "采集中…")

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error("拿不到当前标签页，请在目标站点页面打开本插件。")

    const cookies = await collectCookies(domains)
    const ls = tab.id != null ? await collectLocalStorage(tab.id) : null
    const origins = ls && ls.items.length > 0 ? [{ origin: ls.origin, localStorage: ls.items }] : []

    if (cookies.length === 0 && origins.length === 0) {
      throw new Error("没采到任何 cookie / localStorage。请确认已登录、采集域名正确、且当前标签页停在目标站点上。")
    }

    const storageState = { cookies, origins }
    const body = {
      projectId,
      storageStateJson: JSON.stringify(storageState),
      postLoginUrl: tab.url,
    }
    if (targetUrlId) body.targetUrlId = targetUrlId

    await ensureSessionCookie(runnerUrl, token)

    const resp = await fetch(`${runnerUrl}/api/auth-profiles/${encodeURIComponent(profileId)}/states/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: token ? "include" : "omit",
      body: JSON.stringify(body),
    })

    const text = await resp.text()
    if (!resp.ok) {
      let message = text
      try {
        message = JSON.parse(text).message ?? text
      } catch {
        // 非 JSON 错误体，原样展示
      }
      throw new Error(`导入失败（HTTP ${resp.status}）：${message}`)
    }

    const summary = (() => {
      try {
        return JSON.parse(text).data?.storageStateSummary
      } catch {
        return undefined
      }
    })()
    const cookieCount = summary?.cookieCount ?? cookies.length
    const originCount = summary?.originCount ?? origins.length
    setStatus("ok", `已导入：${cookieCount} 个 cookie · ${originCount} 个 localStorage origin。\n回 AutoVis 用「检查登录状态」验证即可。`)
  } catch (err) {
    setStatus("err", err instanceof Error ? err.message : String(err))
  } finally {
    $("capture").disabled = false
  }
}

document.addEventListener("DOMContentLoaded", () => {
  void loadSaved()
  for (const f of FIELDS) $(f).addEventListener("input", persist)
  $("capture").addEventListener("click", () => void capture())
})
