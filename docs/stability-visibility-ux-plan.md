# AutoVis 稳定性 / 可见性 / 交互体验 优化计划

> 目标：解决当前"系统脆弱、充满未知与 bug"的体感，从 **稳定性**、**可见性**、**用户交互** 三个维度系统性收敛已知问题。

## 一、问题归因（基于代码走查）

### 问题 1：特定场景下接口被循环调用

**现象**：执行记录 / 工作台页面停留时，`runs / task-runs / recorder-sessions / scripts / modules / test-cases / workspace / *-auth-profiles / stream` 等接口被反复调用（截图中 9.8 分钟内 886 次请求）。

**根因**：
- **A. 流 Hook 依赖数组抖动（已在未提交改动中修复）**：`useRunStreams / useTaskRunStreams / useRecorderStreams / useAgentStreams` 的 `EventSource` effect 依赖数组里包含 `projectRuns`、`terminalRunRefreshIds` 这类"每次刷新都会变"的数组。当一个任务进入终态时，回调里会触发 `loadProjectResources()` 等批量刷新 → 这些数组变化 → effect 重新执行 → SSE 断开重连 → 重连时服务端会重放当前（终态）快照 → 再次触发批量刷新……形成自我维持的循环。未提交改动通过 `useRef` 持有这些值 + 去重 `Set` 守卫，切断了这条回路。
- **B. 终态 SSE 流的"假断线重连"（尚未修复，本次处理）**：服务端 `sse.ts` 在实体进入终态时会先发送 `event: done`，随后 `reply.raw.end()` 主动关闭连接。但前端 `connectRetryingEventSource` 只监听默认的 `message` 事件和 `error`，**不识别 `done` 事件**。于是服务端的正常关闭被浏览器 `EventSource` 当作错误，触发指数退避重连（上限 15s），对任何"已结束但面板仍打开"的 run/agent/recorder/taskRun 形成**永久重连**，持续打出 `/stream` 请求并重复回放终态快照。

> A 与 B 叠加：A 制造高频循环，B 制造长尾的、永不停止的低频重连。两者都需修复。

### 问题 2：点了"生成脚本"后长时间停留在"等待生成开始"

**现象**：点击生成后，沙箱顶部长时间显示 `等待生成开始...`，缺乏任何进度反馈。

**根因 / 影响因素**：
- 生成是 fire-and-forget：`POST /scripts/generate` 立即返回 `sessionId`，前端乐观地把 `agentSession` 置为 `running` 且 `steps: []`，此时 UI 文案回落到 `等待生成开始...`。
- 在服务端真正产出第一个 step（warmup 的"执行前置依赖预热"）之前，要先经过 `createManagedController`（租约获取）、`prepareAgentExecutionContext`（workspace 检测 / 连接校验 / 目标 URL 解析 / 鉴权态读取）。其中任一步骤变慢或冷启动（Windows 首次启动 Chromium、磁盘/杀软）都会拉长"空步骤窗口"，而 UI 此时**完全没有反馈**。
- **隐患**：`createManagedController` 在 `try` 块之外调用。一旦它抛错（如租约冲突），会话已被持久化为 `running` + 空步骤并通知前端，但 **`finally` 不会执行**，会话永远停留在 `running`/空步骤，SSE 永不收到终态——表现就是"卡在等待生成开始"。
- warmup 期间没有"耗时可见"与"首次较慢"的提示，用户无法区分"正常准备中"与"卡死"。

### 问题 3：报错 `Run dependencies not found` / "有实例正在运行"，不知所以

**根因**：
- `Run dependencies not found`（`run.service.ts#startRun`）：当 `project / testCase / script` 任一缺失（被删除、hash 复活的陈旧 ID、被删除的脚本版本）时抛出。**英文、笼统、无指向**，用户无法判断缺的是哪一项、该怎么办。`recoverRun` 的 `Run ${id} dependencies not found` 同理。
- "当前用例已有进行中的运行任务" / `TASK_CONFLICT` / `TASK_LEASE_CONFLICT`：是真实的并发保护，但文案与恢复路径让人困惑；陈旧租约（进程重启、未正常 finalize）会在租约过期前持续阻塞新任务。

## 二、改造方案

### 稳定性
1. **修复终态 SSE 假重连（问题 1-B）** — `eventSource.ts`
   - 监听 `done` 命名事件：收到即标记结束并 `close()`，**不再重连**。
   - 暴露可选的 `onStatusChange`，便于 UI 呈现连接状态（connecting / live / reconnecting / closed）。
2. **保留并依赖未提交的 ref 守卫改动（问题 1-A）**，与 1-B 形成合力。
3. **会话启动失败不再悬挂（问题 2 隐患）** — `agent-generation.service.ts` / `agent-direct.service.ts`
   - 将 `createManagedController` 纳入受控错误处理：失败时把会话置为终态（error）并通知，避免"running + 空步骤"永久悬挂。

### 可见性
4. **会话创建即给反馈** — 两个 agent service
   - 在 `createAgentSession` 之后立即 `onStep` 一个"已接收请求，正在准备执行环境…"的 `running` 步骤，保证第一帧 SSE 就有内容，取代回落文案。
5. **沙箱"等待"态升级** — `WorkbenchSandbox.tsx`
   - 用经过时间（elapsed seconds）+ 旋转指示 + "首次启动浏览器可能较慢"的提示替换静态 `等待生成开始...`。

### 用户交互
6. **可读、可行动的报错** — `run.service.ts`
   - `startRun` / `recoverRun`：逐项检查 `project / testCase / script`，给出中文、点名缺失项、附带操作建议（刷新 / 重选用例 / 重新生成脚本）的错误。
   - 租约冲突（`TaskControlRegistry.create`）给出更友好的中文提示。

## 三、改动文件清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/app/hooks/streams/eventSource.ts` | 监听 `done` 事件，终态不再重连；可选连接状态回调 |
| `apps/web/src/app/sections/workbench/WorkbenchSandbox.tsx` | "等待"态显示耗时与提示 |
| `apps/server/src/services/agent-generation.service.ts` | 立即"准备中"步骤 + 控制器创建失败收敛 |
| `apps/server/src/services/agent-direct.service.ts` | 同上 |
| `apps/server/src/services/run.service.ts` | 精确化依赖缺失 / 冲突报错 |
| `apps/server/src/services/task-control.ts` | 租约冲突友好文案 |

## 四、验证

- `pnpm -r typecheck`（或各包 `tsc --noEmit`）。
- 手动回归：
  - 跑完一个 run 后停留在执行记录/工作台，观察 `/stream` 不再无限重连，9 个资源接口不再被循环调用。
  - 点击"生成脚本"，立即出现"正在准备执行环境…"并显示耗时。
  - 对已删除脚本/用例触发执行，得到点名的中文报错。

## 五、后续（本次不一定全做）

- `loadProjectResources` 的去抖 / 增量刷新（只刷新变化的实体）。
- 统一的"进行中任务"指示与"强制取消/接管"入口。
- 进程退出时统一 finalize 租约，缩短陈旧租约阻塞窗口。
