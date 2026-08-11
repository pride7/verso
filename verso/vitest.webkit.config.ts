/**
 * 同一批浏览器测试，换到 **WebKit** 里再跑一遍。
 *
 * 为什么单独一个配置而不是并进 `vitest.browser.config.ts` 的 instances：
 *
 * - 默认那一套跑的是 Chromium，理由写在那个文件里 —— Windows 上 Tauri 用的
 *   WebView2 就是 Chromium 内核，结果和应用里高度一致。**但 macOS 用的是
 *   WKWebView（WebKit），Android 又是 Chromium**，那句话只对两个平台成立。
 * - 两个内核一起跑要一倍时间，而且视觉工作台的截图会互相覆盖（`shot()` 的
 *   路径里没有内核名）。日常改一行 CSS 不需要付这笔账。
 *
 * 所以它是一条**手动车道**：改到编辑器、输入法、布局这些贴着引擎的东西时跑
 * 一遍，出问题在这台 Windows 机器上就能看见，不必等 Mac 上的人来报。
 *
 *   pnpm exec vitest run --config vitest.webkit.config.ts
 *   pnpm exec playwright install webkit   # 第一次要先下引擎
 *
 * 注意它会覆盖 `tests/**\/__shots__/` 里的截图（那些本来就不进版本库）。
 *
 * 已经靠它抓到过的：callout 左边线写成 2.5px，Blink 进位成 3、WebKit 舍成 2，
 * 于是 Mac 上那条线比引用块细一档。
 */
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/browser/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      viewport: { width: 1440, height: 900 },
      instances: [{ browser: "webkit" }],
    },
  },
});
