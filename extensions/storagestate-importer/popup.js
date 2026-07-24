// 持久化的字段（token 不存，避免把会话令牌留在扩展存储里）。
const PERSIST_FIELDS = ["runnerUrl", "projectId", "profileId", "targetUrlId", "cookieDomains"]
const SESSION_COOKIE = "autovis_session"

const $ = (id) => document.getElementById(id)

let projectsCache = [] // 连接后缓存的 Project[]（含 targetUrls）

function setStatus(kind, text) {
  const el = $("status")
  el.className = kind
  el.textContent = text
}

function persist() {
  const data = {}
  for (const f of PERSIST_FIELDS) data[f] = $(f).value
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
    await chrome.cookies.set({ url: runnerUrl, name: SESSION_COOKIE, value: token, path: "/" })
  } catch {
    // 忽略：拿不到 cookie 写权限就退回无鉴权直传
  }
}

function runnerBase() {
  return $("runnerUrl").value.trim().replace(/\/+$/, "")
}

// 调 AutoVis 接口（带凭据；MV3 host_permissions 下扩展跨域不受 CORS 限制）。
async function api(path) {
  const resp = await fetch(`${runnerBase()}${path}`, { credentials: "include" })
  const text = await resp.text()
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("AUTH")
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  try {
    return JSON.parse(text).data
  } catch {
    return null
  }
}

function fillSelect(sel, items, getVal, getLabel, placeholder) {
  sel.innerHTML = ""
  if (placeholder != null) {
    const o = document.createElement("option")
    o.value = ""
    o.textContent = placeholder
    sel.appendChild(o)
  }
  for (const it of items) {
    const o = document.createElement("option")
    o.value = getVal(it)
    o.textContent = getLabel(it)
    sel.appendChild(o)
  }
}

// 连接 AutoVis：拉项目列表并填充下拉。
async function connect() {
  const base = runnerBase()
  if (!base) {
    setStatus("err", "请先填写 AutoVis 运行机地址。")
    return
  }
  $("connect").disabled = true
  setStatus("info", "连接中…")
  try {
    await ensureSessionCookie(base, $("token").value.trim())
    const projects = await api("/api/projects")
    projectsCache = Array.isArray(projects) ? projects : []
    if (projectsCache.length === 0) {
      setStatus("err", "连接成功，但没有项目。请先在 AutoVis 里创建一个项目。")
      return
    }
    const saved = await chrome.storage.local.get(["projectId", "profileId", "targetUrlId"])
    fillSelect($("projectId"), projectsCache, (p) => p.id, (p) => p.name || p.id, "— 选择项目 —")
    $("projectId").disabled = false
    if (saved.projectId && projectsCache.some((p) => p.id === saved.projectId)) {
      $("projectId").value = saved.projectId
    }
    await onProjectChange(saved.profileId, saved.targetUrlId)
    setStatus("ok", "已连接。选好项目 / Profile 后即可采集。")
  } catch (err) {
    if (err instanceof Error && err.message === "AUTH") {
      setStatus("err", "需要鉴权：在本浏览器登录一下 AutoVis（同地址），或在上方填会话 Token，再点连接。")
    } else {
      setStatus("err", `连接失败：${err instanceof Error ? err.message : String(err)}。检查地址 / 网络。`)
    }
  } finally {
    $("connect").disabled = false
  }
}

// 项目切换：填目标网址（来自 project.targetUrls）+ 拉该项目的 Profile 列表。
async function onProjectChange(restoreProfileId, restoreTargetUrlId) {
  const project = projectsCache.find((p) => p.id === $("projectId").value)
  const targets = project?.targetUrls ?? []
  fillSelect($("targetUrlId"), targets, (t) => t.id, (t) => `${t.label || t.url}`, "（项目主域名）")
  $("targetUrlId").disabled = false
  if (restoreTargetUrlId && targets.some((t) => t.id === restoreTargetUrlId)) {
    $("targetUrlId").value = restoreTargetUrlId
  }

  $("profileId").disabled = true
  fillSelect($("profileId"), [], () => "", () => "", "加载中…")
  $("capture").disabled = true
  if (!project) return

  try {
    const profiles = await api(`/api/projects/${encodeURIComponent(project.id)}/auth-profiles`)
    const list = Array.isArray(profiles) ? profiles : []
    if (list.length === 0) {
      fillSelect($("profileId"), [], () => "", () => "", "（该项目还没有 Profile，请先在 AutoVis 创建）")
    } else {
      fillSelect($("profileId"), list, (p) => p.id, (p) => p.name || p.id, "— 选择 Profile —")
      $("profileId").disabled = false
      if (restoreProfileId && list.some((p) => p.id === restoreProfileId)) {
        $("profileId").value = restoreProfileId
      }
    }
  } catch (err) {
    fillSelect($("profileId"), [], () => "", () => "", "加载 Profile 失败")
  }
  refreshCaptureEnabled()
  persist()
}

function refreshCaptureEnabled() {
  $("capture").disabled = !($("projectId").value && $("profileId").value)
}

async function capture() {
  const base = runnerBase()
  const projectId = $("projectId").value
  const profileId = $("profileId").value
  const targetUrlId = $("targetUrlId").value
  const token = $("token").value.trim()
  const domains = parseDomains($("cookieDomains").value)

  if (!base || !projectId || !profileId) {
    setStatus("err", "请先连接并选好项目 / Profile。")
    return
  }
  if (domains.length === 0) {
    setStatus("err", "没识别到采集域名。请确认当前标签页停在目标站点上。")
    return
  }

  $("capture").disabled = true
  setStatus("info", "采集中…")
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error("拿不到当前标签页，请在目标站点页面打开本插件。")

    const cookies = await collectCookies(domains)
    const ls = await collectLocalStorage(tab.id)
    const origins = ls && ls.items.length > 0 ? [{ origin: ls.origin, localStorage: ls.items }] : []

    if (cookies.length === 0 && origins.length === 0) {
      throw new Error("没采到任何 cookie / localStorage。请确认已登录、且当前标签页停在目标站点上。")
    }

    const body = {
      projectId,
      storageStateJson: JSON.stringify({ cookies, origins }),
      postLoginUrl: tab.url,
    }
    if (targetUrlId) body.targetUrlId = targetUrlId

    await ensureSessionCookie(base, token)
    const resp = await fetch(`${base}/api/auth-profiles/${encodeURIComponent(profileId)}/states/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
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

    let summary
    try {
      summary = JSON.parse(text).data?.storageStateSummary
    } catch {
      summary = undefined
    }
    const cookieCount = summary?.cookieCount ?? cookies.length
    const originCount = summary?.originCount ?? origins.length
    setStatus("ok", `已导入：${cookieCount} 个 cookie · ${originCount} 个 localStorage origin。\n回 AutoVis 用「检查登录状态」验证即可。`)
  } catch (err) {
    setStatus("err", err instanceof Error ? err.message : String(err))
  } finally {
    refreshCaptureEnabled()
  }
}

// 用当前标签页域名自动填采集域名（去掉 taobao 默认值，纯自动）。
async function autofillDomains() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) return
    const reg = registrableDomain(new URL(tab.url).hostname)
    const existing = parseDomains($("cookieDomains").value)
    if (reg && !existing.includes(reg)) {
      $("cookieDomains").value = [...existing, reg].join(",")
    }
  } catch {
    // 忽略：拿不到标签页
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(PERSIST_FIELDS)
  if (saved.runnerUrl) $("runnerUrl").value = saved.runnerUrl
  if (saved.cookieDomains) $("cookieDomains").value = saved.cookieDomains
  await autofillDomains()

  $("connect").addEventListener("click", () => void connect())
  $("projectId").addEventListener("change", () => void onProjectChange())
  $("profileId").addEventListener("change", () => {
    refreshCaptureEnabled()
    persist()
  })
  $("targetUrlId").addEventListener("change", persist)
  $("runnerUrl").addEventListener("input", persist)
  $("cookieDomains").addEventListener("input", persist)
  $("capture").addEventListener("click", () => void capture())

  // 填过地址就自动连一次，省一步点击。
  if (saved.runnerUrl) void connect()
})
