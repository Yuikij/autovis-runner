import type { AuthProfile, AuthProfileState, StorageStateSummary } from "@autovis/shared"

/**
 * Playwright storage state JSON 的最小结构（实际还有更多字段，这里只取我们要展示的）。
 */
interface RawStorageState {
  cookies?: Array<{
    name: string
    value: string
    domain: string
    path?: string
    expires?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: "Strict" | "Lax" | "None"
  }>
  origins?: Array<{
    origin: string
    localStorage?: Array<{ name: string; value: string }>
  }>
}

/**
 * 解析 storage state JSON，提取 UI 展示用的摘要信息。
 * 返回 undefined 表示无法解析或为空。
 */
export function buildStorageStateSummary(storageStateJson?: string | null): StorageStateSummary | undefined {
  if (!storageStateJson) return undefined
  let parsed: RawStorageState
  try {
    parsed = JSON.parse(storageStateJson) as RawStorageState
  } catch {
    return undefined
  }

  const cookies = (parsed.cookies ?? []).map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  }))

  const origins = (parsed.origins ?? []).map((entry) => ({
    origin: entry.origin,
    localStorageKeys: (entry.localStorage ?? []).map((item) => item.name),
  }))

  return {
    cookieCount: cookies.length,
    originCount: origins.length,
    cookies,
    origins,
  }
}

const decorateState = (state: AuthProfileState): AuthProfileState => ({
  ...state,
  storageStateSummary: buildStorageStateSummary(state.storageStateJson),
  postLoginUrl: state.postLoginUrlOverride ?? state.postLoginUrlAuto,
})

/**
 * 给 AuthProfile 的每个 state 附上 storageStateSummary。
 */
export function decorateAuthProfile<T extends AuthProfile | null | undefined>(profile: T): T {
  if (!profile) return profile
  return {
    ...profile,
    states: (profile as AuthProfile).states.map(decorateState),
  } as T
}

export function decorateAuthProfiles(profiles: AuthProfile[]): AuthProfile[] {
  return profiles.map((profile) => decorateAuthProfile(profile)!)
}
