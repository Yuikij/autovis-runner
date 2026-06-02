import { createRequire } from "node:module"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium as playwrightChromium, type Browser, type BrowserContext, type BrowserType } from "@playwright/test"

const nodeRequire = createRequire(import.meta.url)

/**
 * 浏览器后端选择：
 * - 缺省 `patchright`（反检测的 Chromium，drop-in 兼容 Playwright API）
 * - `BROWSER_BACKEND=playwright` 可切回原版（调试 / 没装 patchright 驱动时）
 *
 * 只有 `chromium`（启动器）走这里；`expect` / 类型仍来自 `@playwright/test`。
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
export const localNetworkAccessArgs = (): string[] => {
  if ((process.env.LOCAL_NETWORK_ACCESS ?? "1").trim() === "0") {
    return []
  }
  return [
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForNavigations,PrivateNetworkAccessForWorkers",
  ]
}

export interface StealthContextOptions {
  /** 默认 false：headless Chrome 极易被风控识别，交互式沙盒必须 headed。 */
  headless?: boolean
  /** 流式视口尺寸；用于 --window-size，viewport 仍走 null 跟随真实窗口。 */
  windowSize?: { width: number; height: number }
  /** 复用已有用户目录（续期登录态时可保活），缺省每次新建临时目录。 */
  userDataDir?: string
}

/**
 * 反检测推荐启动方式（见 Patchright README「Best Practice」）：
 * - `launchPersistentContext`：Patchright 的补丁在持久化 context 下最完整；
 * - `channel: "chrome"`：用真 Google Chrome 而非 bundled Chromium，规避品牌/UA 指纹；
 * - `headless: false`：headless Chrome 是最强的检测信号（京东 / Cloudflare 等都查）；
 * - `viewport: null`：跟随真实窗口尺寸，避免固定 viewport 指纹；
 * - 不注入自定义 userAgent / headers。
 *
 * 服务器（无显示器）部署时需配合 xvfb 跑 headed；本地开发会弹出真实窗口（不影响 WS 推流）。
 * Chrome 没装时自动回退到 bundled Chromium（可用 `npx patchright install chrome` 安装）。
 */
/**
 * 是否对"回放采集的登录态"启用反检测有头模式。
 * 注入了 storageState 才需要（说明这是登录态回放），且未被 STEALTH_REPLAY=0 关闭。
 */
export const shouldStealthReplay = (storageStateJson?: string | null): boolean =>
  Boolean(storageStateJson) && (process.env.STEALTH_REPLAY ?? "1").trim() !== "0"

/**
 * 启动用于"登录态回放"的浏览器（生成 / 校验 / 运行都用它）。
 * - stealth=true：真 Chrome（channel:chrome）+ 有头 + --window-size，回放指纹与采集时一致；
 *   调用方应配合 `viewport: null` 建 context。
 * - stealth=false：维持轻量 bundled Chromium + 传入的 headless。
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

export const launchStealthPersistentContext = async (
  options: StealthContextOptions = {},
): Promise<{ context: BrowserContext; userDataDir: string }> => {
  const headless = options.headless ?? false
  const channel = (process.env.BROWSER_CHANNEL ?? "chrome").trim()
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), "autovis-sbx-")))
  const args: string[] = [...localNetworkAccessArgs()]
  if (options.windowSize) {
    args.push(`--window-size=${options.windowSize.width},${options.windowSize.height}`)
  }
  const baseOptions = { headless, viewport: null, args }
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...baseOptions,
      ...(channel ? { channel } : {}),
    })
    return { context, userDataDir }
  } catch (error) {
    if (channel) {
      console.warn(
        `[browser] channel=${channel} 启动失败，回退到 bundled Chromium（反检测能力下降，建议 npx patchright install chrome）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      const context = await chromium.launchPersistentContext(userDataDir, baseOptions)
      return { context, userDataDir }
    }
    throw error
  }
}
