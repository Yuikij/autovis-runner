import { AutoVisDatabase } from "../db.js"
import { type ScriptArtifact, type TestCase } from "@autovis/shared"

/** 前置用例计划中的一项：一条依赖用例 + 它最新的可执行脚本。 */
export interface PreconditionPlanNode {
  testCase: TestCase
  script: ScriptArtifact
}

export interface PreconditionPlan {
  /** 按拓扑顺序排列的依赖用例（先跑前面的）。 */
  nodes: PreconditionPlanNode[]
}

/**
 * 纯用例级前置解析：用例可以挂"前置用例"(dependencyCaseIds，有序)，
 * 执行前会按拓扑顺序自动先跑这些用例（用于登录 / 造数据等可复用前置）。
 * 不再有"测试集"概念，任务编排是另一层（见 TaskService）。
 */
export class SuiteService {
  constructor(private readonly db: AutoVisDatabase) {}

  public normalizeDependencyCaseIds(caseIds: string[]): string[] {
    return [...new Set((caseIds ?? []).map((id) => id.trim()).filter(Boolean))]
  }

  /**
   * 按拓扑顺序展开 testCase 的前置依赖（含间接依赖），并查环。
   * 每个被引用的依赖用例必须存在且具备 latestScriptId 对应的可执行脚本。
   */
  public buildPreconditionPlan(testCase: TestCase): PreconditionPlan {
    const nodes: PreconditionPlanNode[] = []
    const added = new Set<string>()
    const visiting = new Set<string>()

    const visit = (caseId: string, chain: string[]) => {
      if (caseId === testCase.id) {
        throw new Error(`检测到依赖用例循环依赖：${[...chain, testCase.caseCode].join(" -> ")}`)
      }
      if (added.has(caseId)) {
        return
      }
      if (visiting.has(caseId)) {
        throw new Error(`检测到依赖用例循环依赖：${[...chain, caseId].join(" -> ")}`)
      }

      const dependencyCase = this.db.getTestCase(caseId)
      if (!dependencyCase) {
        throw new Error(`存在缺失的依赖用例：${caseId}`)
      }

      visiting.add(caseId)
      const nextChain = [...chain, dependencyCase.caseCode]
      for (const nestedId of this.normalizeDependencyCaseIds(dependencyCase.dependencyCaseIds)) {
        visit(nestedId, nextChain)
      }
      visiting.delete(caseId)

      if (added.has(caseId)) {
        return
      }

      const script = dependencyCase.latestScriptId ? this.db.getScript(dependencyCase.latestScriptId) : undefined
      if (!script) {
        throw new Error(`依赖用例 ${dependencyCase.caseCode} 缺少可执行脚本。`)
      }

      added.add(dependencyCase.id)
      nodes.push({
        testCase: {
          ...dependencyCase,
          dependencyCaseIds: this.normalizeDependencyCaseIds(dependencyCase.dependencyCaseIds),
        },
        script,
      })
    }

    for (const caseId of this.normalizeDependencyCaseIds(testCase.dependencyCaseIds)) {
      visit(caseId, [testCase.caseCode])
    }

    return { nodes }
  }
}
