# AutoVis 全局收束（Convergence）计划

> 目标不是加功能、加复杂度，而是**收束**：用更少、更清晰的"接缝（seam）"承载横切关注点，建立可被验证的**不变量（invariants）**，让整套系统变得可预测、可稳定验收。

## 一、全局诊断（系统视角）

整体看，**服务端**结构是健康的：服务分层组合（`store.ts` 作为门面，`*.service.ts` 单一职责）、租约 + 心跳 + 命令日志的并发模型、启动恢复（reap stale tasks）、`/health` `/ready` `/metrics` 可观测端点。问题主要不在后端骨架。

脆弱性高度集中在**前端**与**前后端的"刷新契约"**上：

| # | 反模式 | 后果 |
| --- | --- | --- |
| 1 | **前端"上帝 Hook"**：`useWorkspaceController` 持有 ~50 个 `useState`，向 effects/actions 透传 ~90 字段的巨型参数对象 | 任何改动牵一发动全身；依赖关系不可见；effect 依赖数组极易写错 |
| 2 | **流逻辑四份拷贝**：`useRunStreams / useTaskRunStreams / useRecorderStreams / useAgentStreams` 各自实现 SSE 订阅、终态判定、去重、刷新 | 实现漂移；循环调用 bug 正是从这里长出来的 |
| 3 | **"刷新即全量重拉"**：每个终态事件触发 `loadProjectResources`（9 个接口）+ `loadTestCases` + `loadAllTestCases`，无合并、无防抖 | 请求风暴（9.8 分钟 886 次） |
| 4 | **真相来源重复**：`terminalRunRefreshIds / terminalTaskRunRefreshIds / terminalRecorderRefreshIds`（state 数组）+ 各 hook 内的 `Set`/`ref` + 后端租约 + 内存注册表，多套机制都在描述"谁结束了/谁在跑" | 状态不一致、互相打架 |
| 5 | **缺乏确定性验收**：没有自动化验收；只有根目录的临时脚本 | 无法"稳定验收"，每次回归靠手测 |

## 二、收束原则（本计划的"宪法"）

1. **单一真相来源（SSOT）**：服务端是真相；前端通过 SSE 镜像实体；刷新是**派生**且**合并**的，不是各处随手触发。
2. **每个横切关注点只有一个接缝**：一个 SSE 订阅原语、一个刷新协调器、一个"冲突即接管"助手。删除拷贝，而不是新增封装。
3. **可声明的不变量**：用注释 + 类型 + 少量运行时断言固化关键不变量（见第四节），让违背显式化。
4. **减少状态面积**：能从服务端事件派生的，就不再单独存一份 state；能合并的参数就合并。
5. **失败可见且有界**：超时、终态收敛、就绪探针——不允许"无声悬挂"。

## 三、架构接缝（收束后的目标形态）

### 前端
- `streams/eventSource.ts`（已有，已修 `done`）：底层重连原语，终态不再假重连。
- **`streams/useEntityStream.ts`（新增）**：泛型 SSE 订阅原语——给 URL + `onMessage(parsed)`，内部负责连接/解析/拆除。四个流 hook 不再各写一份 `EventSource` 样板。
- **`streams/useProjectSync.ts`（新增）**：**唯一**的项目刷新协调器。
  - **合并 + 防抖**：把一段时间内的多次终态事件折叠为一次全量刷新；刷新进行中再来事件则只标记"需重跑"，结束后至多再跑一次。
  - **终态去重**：用一个 `Set<id>` 取代 3 个 state 数组 + 各 hook 的局部 `Set`。
  - 这是"刷新即全量重拉"的收束点：**结构上**消除请求风暴。
- 四个流 hook 收敛为统一形状：`订阅 → 用事件载荷增量更新自己的列表 → 终态则交给 sync 协调器`。

### 服务端（本轮不动，列为后续）
- `sse.ts` 已是统一原语；可把各 service 内重复的 `isTerminal(status)` 集合抽到 shared，作为状态机的单一定义。
- "终态后哪些聚合受影响"目前散落在前端；中期可由服务端在 SSE 事件里带上 `affects: [...]` 提示，让前端精确增量刷新（彻底告别全量重拉）。

## 四、关键不变量（可验收）

1. **终态流不重连**：服务端对终态实体发 `done` 后关闭；前端收到 `done` 即停止，不再产生 `/stream` 重连。
2. **刷新单飞 + 合并**：任意时刻最多一个进行中的项目刷新；并发到达的终态事件被折叠，不放大为 N 次全量重拉。
3. **会话不悬挂**：任务/会话一旦创建并通知前端，要么进入受控执行，要么被收敛为终态（error/cancelled）；不存在"running + 空步骤 + 永不终止"。
4. **真相唯一**："谁已终态/需刷新"只由 `useProjectSync` 的去重集合表达，不再有第二份 state。

## 五、分阶段实施（每阶段独立可发布、可回滚）

- **阶段 1（本轮）— 前端流与刷新收束**：新增 `useEntityStream` + `useProjectSync`；把 4 个流 hook 迁移过去；删除 3 个 `terminal*RefreshIds` state 与 `callbackRef` 透传。结果：不变量 1/2/4 成立，请求风暴在结构上消失，删除大量重复代码。
- **阶段 2 — 冲突/接管收束**：`useTestActions` 里 generate/direct/run/verification 重复的 `getStartupConflict + 接管` 逻辑抽成单一 `adoptOnConflict` 助手。
- **阶段 3 — 状态分域**：把"上帝 Hook"按域拆为 `useProjectStore / useExecutionStore / useLlmStore` 等，缩小参数面（与阶段 1 的协调器天然契合）。
- **阶段 4 — 增量刷新**：服务端事件带 `affects` 提示，前端按域增量刷新，淘汰 `loadProjectResources` 全量重拉。
- **阶段 5 — 确定性验收**：基于已有 `/ready` `/metrics` + 一个最小冒烟脚本，建立"启动→建项目→生成→执行→终态"闭环的可重复验收。

## 六、验证

- 类型检查：`pnpm --filter @autovis/server check` 与 `pnpm --filter @autovis/web check`。
- 手动回归：跑完一个 run 后停留观察——`/stream` 不再无限重连；9 个资源接口在连续多个终态事件下只被合并刷新一次。
