import { createRequire } from "node:module"
import { chromium as playwrightChromium, type Browser, type BrowserType } from "@playwright/test"

const nodeRequire = createRequire(import.meta.url)

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
  if ((process.env.LOCAL_NETWORK_ACCESS ?? "1").trim() === "0") {
    return []
  }
  return [
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForNavigations,PrivateNetworkAccessForWorkers",
  ]
}

/**
 * 是否对"回放采集的登录态"启用反检测有头模式。
 * 注入了 storageState 才需要（说明这是登录态回放），且未被 STEALTH_REPLAY=0 关闭。
 */
export const shouldStealthReplay = (storageStateJson?: string | null): boolean =>
  Boolean(storageStateJson) && (process.env.STEALTH_REPLAY ?? "1").trim() !== "0"

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
  if (!options.stealth) {
    return chromium.launch({
      headless: options.headless ?? true,
      slowMo: options.slowMo,
      args: localNetworkAccessArgs(),
    })
  }
  const channel = (process.env.BROWSER_CHANNEL ?? "chrome").trim()
  const size = options.windowSize ?? { width: 1440, height: 960 }
  const launchOptions = {
    headless: false,
    slowMo: options.slowMo,
    args: [`--window-size=${size.width},${size.height}`, ...localNetworkAccessArgs()],
  }
  try {
    return await chromium.launch(channel ? { ...launchOptions, channel } : launchOptions)
  } catch (error) {
    console.warn(
      `[browser] channel=${channel} 回放启动失败，回退 bundled Chromium（反检测能力下降，建议 npx patchright install chrome）：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return await chromium.launch(launchOptions)
  }
}
