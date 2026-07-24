import { createRequire } from "node:module"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readlink, unlink } from "node:fs/promises"
import { join } from "node:path"
import { chromium as playwrightChromium, type Browser, type BrowserContext, type BrowserType } from "@playwright/test"

const nodeRequire = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

/**
 * Linux 侧检查：SingletonLock 是 `hostname-pid` 软链。
 * - 不存在 / 不是软链（macOS 上是被 flock 的普通文件）→ 不算占用，交给进程扫描兜底；
 * - pid 已死（崩溃残留）→ 删掉 stale 锁放行；
 * - pid 仍活 → 占用中。
 */
const isSingletonLockHeld = async (lockPath: string): Promise<boolean> => {
  let target: string
  try {
    target = await readlink(lockPath)
  } catch {
    return false
  }
  // 软链目标形如 `hostname-pid`，pid 在最后一个 '-' 之后。
  const pid = Number.parseInt(target.slice(target.lastIndexOf("-") + 1), 10)
  if (!Number.isInteger(pid) || pid <= 0) {
    await unlink(lockPath).catch(() => undefined) // 解析不出 pid，保守删掉放行
    return false
  }
  let alive = true
  try {
    process.kill(pid, 0)
  } catch (err) {
    // ESRCH=进程不存在；EPERM=存在但无权限（仍算活）。
    alive = (err as NodeJS.ErrnoException).code === "EPERM"
  }
  if (!alive) {
    await unlink(lockPath).catch(() => undefined) // stale 锁，删掉放行
    return false
  }
  return true
}

interface ProfileDirHolder {
  pid: number
  ppid: number
  command: string
}

/** 检测类工具进程：它们的命令行里也带着 pattern（如并发跑着的另一个 pgrep），不是真占用者。 */
const isSearchToolCommand = (command: string): boolean => /(^|\/)(pgrep|pkill|grep|egrep|rg)$/.test(command.trim())

/**
 * 跨平台兜底：扫描命令行里带 `--user-data-dir=<该目录>` 的存活进程，返回占用者信息。
 * macOS 上 Chrome 的 profile 锁是对锁文件的 flock（进程退出内核自动释放，磁盘上无 pid 可读），
 * SingletonLock 并不是软链——readlink 检测在 macOS 恒判"空闲"，等于没有检查，
 * 正是"偶尔 Target page/context/browser has been closed"的来源。
 *
 * 两个坑都踩过，别再犯：
 * - pgrep 的 pattern 以 "--" 开头，参数里必须先给 "--"，否则被当非法选项（退出码 2 落入
 *   catch），检查恒判"空闲"，等于没有兜底；
 * - 并发的另一个 waitForProfileDirFree 正在跑的 pgrep，其命令行同样含该 pattern，会被互相
 *   当成占用者——两个等待者同步轮询时每轮都互相"看见"对方，双双空等到超时。因此 pgrep
 *   结果还要经 ps 复核，只把真正的浏览器进程算作占用者。
 */
const findProfileDirHolders = async (userDataDir: string): Promise<ProfileDirHolder[]> => {
  const pattern = `--user-data-dir=${userDataDir}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  let pids: number[]
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "--", pattern])
    pids = stdout
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return [] // pgrep 无匹配时以退出码 1 结束
  }
  if (pids.length === 0) return []
  // ps 在部分 pid 已退出时以非零码结束，但仍会输出存活的那部分——错误对象上的 stdout 不能丢，
  // 否则真占用者会被误判为"空闲"，退回到 Chrome 撞锁的裸报错。
  let psOut: string
  try {
    ;({ stdout: psOut } = await execFileAsync("ps", ["-o", "pid=,ppid=,comm=", "-p", pids.join(",")]))
  } catch (error) {
    psOut = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : ""
  }
  const holders: ProfileDirHolder[] = []
  for (const line of psOut.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    const command = match[3]
    if (isSearchToolCommand(command)) continue
    holders.push({ pid: Number.parseInt(match[1], 10), ppid: Number.parseInt(match[2], 10), command })
  }
  return holders
}

/**
 * 回收孤儿占用者：服务重启（tsx watch / Ctrl+C）后残留的采集 Chrome 会被 init/launchd
 * 收养（ppid=1），再没有任何进程会去关它——用户即使"重启了干净环境"也会一直撞
 * "正在现有的浏览器会话中打开"。父进程仍活着的占用者（如另一个服务正在跑的回放）不动，
 * 交给上层超时后报可读错误。
 */
const reapOrphanHolders = (holders: ProfileDirHolder[]): void => {
  for (const holder of holders) {
    if (holder.ppid !== 1) continue
    try {
      process.kill(holder.pid, "SIGKILL")
    } catch {
      // 已退出或无权限——留给上层的超时报错兜底
    }
  }
}

/**
 * 持久 profile 目录的跨进程互斥：Chrome 锁住 userDataDir（Linux 用 SingletonLock 软链，
 * macOS 用锁文件 flock）。同一目录第二个 Chrome 会把 URL 转发给已存在实例后立刻退出
 * （日志“正在现有的浏览器会话中打开 / Opening in existing browser session”），
 * Playwright 的 pipe 随之断开 → “Target page/context/browser has been closed”。
 *
 * 典型来源：登录采集（sandbox）窗口还开着就跑 run；或上一次 run/sandbox 刚 close()、
 * 进程还没退完锁没释放。这里在启动前轮询「SingletonLock 软链 + 进程命令行扫描」双重检查：
 * - 均无占用 → 放行；
 * - 锁的 pid 已死（崩溃残留）→ 删掉 stale 锁放行；
 * - 仍有存活占用者 → 等待至超时（吸收 close 的释放延迟）；超时仍占用则抛可读报错。
 */
export const waitForProfileDirFree = async (
  userDataDir: string,
  { timeoutMs = 8_000, intervalMs = 250 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> => {
  const lockPath = join(userDataDir, "SingletonLock")
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const holders = await findProfileDirHolders(userDataDir)
    const busy = (await isSingletonLockHeld(lockPath)) || holders.length > 0
    if (!busy) return
    reapOrphanHolders(holders)
    if (Date.now() >= deadline) {
      throw new Error(
        `持久登录态目录正被另一个浏览器占用（${userDataDir}）。` +
          `通常是该登录态的「登录采集」窗口还开着，或上一次执行尚未结束——请关闭后重试。`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

type ObservabilityState = {
  browserStartFailures?: Map<string, number>
}

const OBSERVABILITY_KEY = "__autovisObservabilityState__"

const recordBrowserStartFailure = (surface: string) => {
  const globalState = globalThis as typeof globalThis & {
    [OBSERVABILITY_KEY]?: ObservabilityState
  }
  const state = globalState[OBSERVABILITY_KEY] ??= {}
  const map = state.browserStartFailures ??= new Map<string, number>()
  map.set(surface, (map.get(surface) ?? 0) + 1)
}

/**
 * 浏览器后端选择：
 * - 缺省 `patchright`（反检测的 Chromium，drop-in 兼容 Playwright API）
 * - `BROWSER_BACKEND=playwright` 可切回原版（调试 / 没装 patchright 驱动时）
 *
 * 只有 `chromium`（启动器）走这里；`expect` / 类型仍来自 `@playwright/test`，
 * 因为 patchright 不提供测试运行时（expect/test），但它产出的 Page/Locator 与
 * Playwright 完全兼容，`expect` 可直接作用其上。
 */
const resolveChromium = (): BrowserType => {
  const backend = (process.env.BROWSER_BACKEND ?? "patchright").trim().toLowerCase()
  if (backend === "playwright") {
    return playwrightChromium
  }
  try {
    const patchright = nodeRequire("patchright") as { chromium: BrowserType }
    return patchright.chromium
  } catch (error) {
    recordBrowserStartFailure("runner.patchright_backend_load")
    console.warn(
      `[browser-backend] BROWSER_BACKEND=${backend} 但加载 patchright 失败，回退到 @playwright/test：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return playwrightChromium
  }
}

export const chromium = resolveChromium()

/**
 * 启动参数：放开 Chrome 的"本地网络访问"(Local Network Access / Private Network Access) 限制。
 *
 * 新版 Chromium（≥130）会把"非安全上下文(http) 页面请求更私有地址段(局域网/loopback)的子资源"
 * 当作跨地址段访问拦掉，报 `net::ERR_FAILED` + "blocked by CORS policy ... more-private address space"。
 * 被测系统多是内网 http 部署（如 http://192.168.x.x/...），而且开启 Playwright tracing(snapshots)
 * 会让主包 umi.js/umi.css 也被判成不安全上下文从而被拦 → 页面白屏、什么都加载不出来。
 *
 * 这是自动化测试浏览器（受控环境），关掉该限制是安全且必要的；可用 LOCAL_NETWORK_ACCESS=0 关闭本开关。
 */
const localNetworkAccessArgs = (): string[] => {
  const args = ["--no-sandbox", "--disable-setuid-sandbox"]
  if ((process.env.LOCAL_NETWORK_ACCESS ?? "1").trim() === "0") {
    return args
  }
  args.push(
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForNavigations,PrivateNetworkAccessForWorkers",
  )
  return args
}

/**
 * 性能相关启动参数：无显示器(xvfb)机器上 GPU 走软件渲染，独立 gpu-process 会空烧大量 CPU
 * （见线上 top：gpu-process 常年 ~70%）。`--disable-gpu` 关掉独立 GPU 进程改走 CPU 直绘，
 * `--disable-software-rasterizer` 进一步去掉软件光栅化进程，`--disable-dev-shm-usage` 避免
 * 容器里 /dev/shm 过小导致渲染进程崩溃。可用 BROWSER_DISABLE_GPU=0 关闭（如需真实 WebGL 指纹）。
 */
export const performanceArgs = (): string[] => {
  const args = ["--disable-dev-shm-usage"]
  if ((process.env.BROWSER_DISABLE_GPU ?? "1").trim() !== "0") {
    args.push("--disable-gpu", "--disable-software-rasterizer")
  }
  return args
}

/**
 * 浏览器代理：从 `BROWSER_PROXY` 读取（如 `http://host:port` / `socks5://host:port`）。
 * 风控站点常需要让流量走指定出口；系统级/分流代理对受控浏览器不一定生效，这里支持显式注入。
 */
export interface ProxyConfig {
  server: string
  bypass?: string
  username?: string
  password?: string
}

export const resolveProxy = (): ProxyConfig | undefined => {
  const server = (process.env.BROWSER_PROXY ?? "").trim()
  if (!server) return undefined
  const proxy: ProxyConfig = { server }
  const bypass = (process.env.BROWSER_PROXY_BYPASS ?? "").trim()
  if (bypass) proxy.bypass = bypass
  const username = (process.env.BROWSER_PROXY_USERNAME ?? "").trim()
  const password = process.env.BROWSER_PROXY_PASSWORD ?? ""
  if (username) {
    proxy.username = username
    proxy.password = password
  }
  return proxy
}

/**
 * 是否启用反检测有头模式（真实 Chrome）。
 * 判定优先级（高→低）：
 * - `STEALTH_REPLAY=0`：全局强制关闭（最高优先级，便于内网批量跑时一键禁用）；
 * - `STEALTH_ALWAYS=1`：全局强制开启（服务器需配合 xvfb）；
 * - `explicitStealth`（来自站点/任务用例级配置）：调用方显式拍板，优先于登录态推断；
 * - 兜底：注入了 storageState（登录态回放）才走有头，保持旧行为不破坏未接配置的调用点。
 */
export const shouldStealthReplay = (storageStateJson?: string | null, explicitStealth?: boolean): boolean => {
  if ((process.env.STEALTH_REPLAY ?? "1").trim() === "0") return false
  if ((process.env.STEALTH_ALWAYS ?? "0").trim() === "1") return true
  if (explicitStealth !== undefined) return explicitStealth
  return Boolean(storageStateJson)
}

/**
 * 启动用于"登录态回放"的浏览器。
 * - stealth=true：真 Chrome（channel:chrome）+ 有头（headless:false）+ --window-size，
 *   让回放指纹与登录沙盒采集时一致，避免京东等把注入的 cookie 当异常作废 / 跳回登录。
 *   调用方应配合 `viewport: null` 建 context（见 launchReplayBrowser 注释）。
 * - stealth=false：维持轻量 bundled Chromium + 传入的 headless。
 *
 * 无显示器服务器跑 stealth 需配合 xvfb；Chrome 缺失时回退 bundled Chromium。
 */
export const launchReplayBrowser = async (options: {
  stealth: boolean
  headless?: boolean
  slowMo?: number
  windowSize?: { width: number; height: number }
}): Promise<Browser> => {
  const proxy = resolveProxy()
  if (!options.stealth) {
    try {
      return await chromium.launch({
        headless: options.headless ?? true,
        slowMo: options.slowMo,
        args: [...localNetworkAccessArgs(), ...performanceArgs()],
        ...(proxy ? { proxy } : {}),
      })
    } catch (error) {
      recordBrowserStartFailure("runner.replay_browser_launch")
      throw error
    }
  }
  const channel = (process.env.BROWSER_CHANNEL ?? "chrome").trim()
  const size = options.windowSize ?? { width: 1440, height: 960 }
  const launchOptions = {
    headless: false,
    slowMo: options.slowMo,
    args: [`--window-size=${size.width},${size.height}`, ...localNetworkAccessArgs(), ...performanceArgs()],
    ...(proxy ? { proxy } : {}),
  }
  try {
    return await chromium.launch(channel ? { ...launchOptions, channel } : launchOptions)
  } catch (error) {
    recordBrowserStartFailure("runner.replay_browser_channel_launch")
    console.warn(
      `[browser] channel=${channel} 回放启动失败，回退 bundled Chromium（反检测能力下降，建议 npx patchright install chrome）：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    try {
      return await chromium.launch(launchOptions)
    } catch (fallbackError) {
      recordBrowserStartFailure("runner.replay_browser_fallback_launch")
      throw fallbackError
    }
  }
}

/**
 * 持久 profile 回放：用磁盘上的 userDataDir 起浏览器（`launchPersistentContext`）。
 * cookie（含 cf_clearance）、缓存、指纹跨运行保留在该目录里——专治 Cloudflare 人机质询这类
 * “风险分”拦截：在同一 profile 里人工过一次，后续运行复用同一目录即可少弹/不弹。
 * 与 storageState 注入互斥：持久模式下登录态来自目录本身，不再注入。
 */
export const launchPersistentReplayContext = async (
  userDataDir: string,
  options: { stealth: boolean; headless?: boolean; slowMo?: number; recordVideoDir?: string },
): Promise<BrowserContext> => {
  const proxy = resolveProxy()
  const size = { width: 1440, height: 960 }
  const contextOptions = {
    viewport: options.stealth ? null : size,
    ignoreHTTPSErrors: true,
    ...(options.recordVideoDir ? { recordVideo: { dir: options.recordVideoDir, size } } : {}),
  }
  if (!options.stealth) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        headless: options.headless ?? true,
        slowMo: options.slowMo,
        args: [...localNetworkAccessArgs(), ...performanceArgs()],
        ...(proxy ? { proxy } : {}),
        ...contextOptions,
      })
    } catch (error) {
      recordBrowserStartFailure("runner.persistent_context_launch")
      throw error
    }
  }
  const channel = (process.env.BROWSER_CHANNEL ?? "chrome").trim()
  const launchOptions = {
    headless: false,
    slowMo: options.slowMo,
    args: [`--window-size=${size.width},${size.height}`, ...localNetworkAccessArgs(), ...performanceArgs()],
    ...(proxy ? { proxy } : {}),
    ...contextOptions,
  }
  try {
    return await chromium.launchPersistentContext(userDataDir, channel ? { ...launchOptions, channel } : launchOptions)
  } catch (error) {
    recordBrowserStartFailure("runner.persistent_context_channel_launch")
    console.warn(
      `[browser] channel=${channel} 持久上下文启动失败，回退 bundled Chromium（反检测能力下降）：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    try {
      return await chromium.launchPersistentContext(userDataDir, launchOptions)
    } catch (fallbackError) {
      recordBrowserStartFailure("runner.persistent_context_fallback_launch")
      throw fallbackError
    }
  }
}
