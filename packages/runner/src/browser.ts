import { createRequire } from "node:module"
import { chromium as playwrightChromium, type Browser, type BrowserType } from "@playwright/test"

const nodeRequire = createRequire(import.meta.url)

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
 * 是否对"回放采集的登录态"启用反检测有头模式。
 * - 注入了 storageState 才需要（说明这是登录态回放），且未被 STEALTH_REPLAY=0 关闭；
 * - `STEALTH_ALWAYS=1` 可对无登录态的公网站点也强制走真 Chrome 反检测（服务器需配合 xvfb）。
 */
export const shouldStealthReplay = (storageStateJson?: string | null): boolean => {
  if ((process.env.STEALTH_REPLAY ?? "1").trim() === "0") return false
  if ((process.env.STEALTH_ALWAYS ?? "0").trim() === "1") return true
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
