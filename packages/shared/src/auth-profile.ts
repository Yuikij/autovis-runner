import type { Identifier } from "./core"
import type { LiveViewportState } from "./run"

/**
 * 解析 storageState JSON 后得到的概要信息（仅用于 UI 展示，不用于回放）。
 * 后端在 `getAuthProfile` 接口返回时基于 storageStateJson 动态计算。
 */
export interface StorageStateCookieInfo {
  name: string
  domain: string
  path?: string
  expires?: number
  sameSite?: string
  secure?: boolean
  httpOnly?: boolean
}

export interface StorageStateOriginInfo {
  origin: string
  localStorageKeys: string[]
}

export interface StorageStateSummary {
  cookieCount: number
  originCount: number
  cookies: StorageStateCookieInfo[]
  origins: StorageStateOriginInfo[]
}

export interface AuthProfile {
  id: Identifier
  projectId: Identifier
  name: string
  description?: string
  /** 登录用例：刷新登录态时单独执行这一条用例（可自带前置用例），抓取其结束时的 storageState。 */
  sourceCaseId: Identifier
  validationScriptId?: Identifier
  /** 失效校验脚本（与 URL 无关，复用于所有 targetUrl）。 */
  validationScript?: string
  validationScriptGeneratedAt?: string
  /** 一个登录态 × 多个目标 URL：每个 URL 一份独立的 storageState。 */
  states: AuthProfileState[]
  createdAt: string
  updatedAt: string
}

export interface AuthProfileState {
  authProfileId: Identifier
  targetUrlId: Identifier
  storageStateJson?: string
  storageStateSummary?: StorageStateSummary
  lastRefreshedAt?: string
  updatedAt: string
  /** 上一次刷新 sourceSuite 结束时浏览器停留的 URL（自动采集，下一次刷新会被覆盖）。 */
  postLoginUrlAuto?: string
  /** 用户手动覆盖的"登录后 URL"（优先级高于 postLoginUrlAuto，不会被刷新冲掉）。 */
  postLoginUrlOverride?: string
  /** 后端 decorator 计算出的最终生效值：postLoginUrlOverride ?? postLoginUrlAuto。 */
  postLoginUrl?: string
}

export type AuthLoginSandboxStatus =
  | "starting"
  | "live"
  | "saving"
  | "saved"
  | "cancelled"
  | "error"

/**
 * 复杂登录沙盒会话：用户在服务端浏览器里"亲手登录"，登录成功后把 storageState
 * 写入 (authProfile, targetUrl) 的状态行。画面通过 WS-JPEG 实时流推送到前端，
 * 用户的点击/输入/滚动通过 interactions 接口转发到服务端 page。
 * 会话仅存于内存（进程级），不落 DB，关闭即销毁。
 */
export interface AuthLoginSandboxSession {
  id: Identifier
  projectId: Identifier
  authProfileId: Identifier
  targetUrlId: Identifier
  targetUrl: string
  status: AuthLoginSandboxStatus
  currentUrl?: string
  pageTitle?: string
  liveViewport?: LiveViewportState
  /** 保存登录态后的 storageState 概要（cookie / origin 数量等）。 */
  savedSummary?: StorageStateSummary
  /** 保存时浏览器停留的 URL，会写入 auth_profile_states.post_login_url_auto。 */
  postLoginUrl?: string
  error?: string
  startedAt: string
  finishedAt?: string
}

export type ValidationProgressStatus = "running" | "done" | "error" | "skipped"
export type ValidationTaskStatus = "running" | "completed" | "error"
export type ValidationTaskKind = "generate" | "check"

/**
 * 失效校验脚本生成 / 登录状态重放过程中，单个可视化步骤。
 * 兼容旧版（label/status/detail），新版可携带截图、代码预览、元数据。
 */
export type ValidationProgressStepKind =
  | "init"
  | "browser"
  | "navigate"
  | "snapshot"
  | "llm"
  | "verify"
  | "save"
  | "result"

export interface ValidationProgressStep {
  label: string
  status: ValidationProgressStatus
  kind?: ValidationProgressStepKind
  detail?: string
  screenshotUrl?: string
  codePreview?: string
  metaJson?: string
  iteration?: number
}

export interface ValidationTask {
  id: Identifier
  profileId: Identifier
  /** 区分"生成校验脚本"和"检查登录状态"两类任务 */
  kind?: ValidationTaskKind
  /** 任务作用的目标 URL（check / refresh 都按 URL 维度处理）。 */
  targetUrlId?: Identifier
  status: ValidationTaskStatus
  steps: ValidationProgressStep[]
  resultProfile?: AuthProfile
  /** check 任务的最终结果 */
  checkResult?: { valid: boolean; error?: string }
  error?: string
}