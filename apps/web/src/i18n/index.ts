import { core } from "./messages/core.js"
import { cases } from "./messages/cases.js"
import { authProfiles } from "./messages/auth-profiles.js"
import { workbench } from "./messages/workbench.js"
import { tasks } from "./messages/tasks.js"
import { runs } from "./messages/runs.js"
import { knowledgeData } from "./messages/knowledge-data.js"
import { projectsDashboard } from "./messages/projects-dashboard.js"
import { hub } from "./messages/hub.js"

export type Lang = "zh" | "en"

export interface I18nModule {
  zh: Record<string, string>
  en: Record<string, string>
}

const STORAGE_KEY = "browsewright_lang"

const detectLang = (): Lang => {
  if (typeof window === "undefined") return "zh"
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === "zh" || saved === "en") return saved
  } catch {
    /* localStorage unavailable */
  }
  const nav = window.navigator?.language ?? "zh"
  return nav.toLowerCase().startsWith("zh") ? "zh" : "en"
}

const modules: I18nModule[] = [core, cases, authProfiles, workbench, tasks, runs, knowledgeData, projectsDashboard, hub]

const dicts: Record<Lang, Record<string, string>> = {
  zh: Object.assign({}, ...modules.map((m) => m.zh)),
  en: Object.assign({}, ...modules.map((m) => m.en)),
}

if (import.meta.env.DEV) {
  const zhKeys = new Set(Object.keys(dicts.zh))
  const enKeys = new Set(Object.keys(dicts.en))
  for (const key of zhKeys) if (!enKeys.has(key)) console.warn(`[i18n] missing en translation: ${key}`)
  for (const key of enKeys) if (!zhKeys.has(key)) console.warn(`[i18n] missing zh translation: ${key}`)
}

/** 当前语言。切换语言会刷新页面，因此本值在一次页面生命周期内不变。 */
export const lang: Lang = detectLang()

/**
 * 取当前语言的文案。支持 `{name}` 形式的插值占位符。
 * 未找到 key 时回退到中文文案，再回退到 key 本身。
 */
export const t = (key: string, vars?: Record<string, string | number>): string => {
  let text = dicts[lang][key] ?? dicts.zh[key] ?? key
  if (import.meta.env.DEV && dicts.zh[key] === undefined && dicts.en[key] === undefined) {
    console.warn(`[i18n] missing key: ${key}`)
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v))
    }
  }
  return text
}

/** 持久化语言选择并刷新页面（模块级常量也会用 t()，刷新是最稳妥的生效方式）。 */
export const setLang = (next: Lang): void => {
  if (next === lang) return
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* localStorage unavailable */
  }
  window.location.reload()
}
