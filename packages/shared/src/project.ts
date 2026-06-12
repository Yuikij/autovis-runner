import type { Identifier } from "./core"
import type { RunStatus } from "./run"

export interface ProjectSummary {
  totalCases: number
  totalScripts: number
  lastRunStatus: RunStatus
}

export interface Project {
  id: Identifier
  name: string
  description: string
  /** 项目的主域名 / 默认 URL，等价于 targetUrls 中的"主域名"行；保留主要为后端 Playwright 兜底用。 */
  testBaseUrl: string
  version: string
  createdAt: string
  updatedAt: string
  summary: ProjectSummary
  /** 项目下集中管理的 URL 列表，所有运行 / 校验 / 登录态均通过 targetUrlId 引用。 */
  targetUrls: TargetUrl[]
}

/**
 * 项目下统一管理的访问 URL。"主域名"由 project.testBaseUrl 自动维护，其余由用户增删。
 */
export interface TargetUrl {
  id: Identifier
  projectId: Identifier
  label: string
  url: string
  /** 主域名（与 project.testBaseUrl 同步）只能改不能删。 */
  isPrimary?: boolean
  /**
   * 该站点回放/执行时是否默认使用反检测有头模式（真实 Chrome）。默认 false（headless）。
   * 仅反检测敏感站点（如风控登录态）才需要开启；任务用例级可单独覆盖。
   */
  needsStealth?: boolean
  createdAt: string
  updatedAt: string
}

export interface Module {
  id: Identifier
  projectId: Identifier
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface CodeFile {
  id: Identifier
  projectId: Identifier
  filename: string
  content: string
  createdAt: string
}