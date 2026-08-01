/**
 * 在真实 Chromium 里跑的测试。
 *
 * 为什么需要它：CodeMirror 的补全、tooltip 定位、块级 decoration 的解析
 * 时序，全都依赖真实的布局引擎。happy-dom 没有布局，连最朴素的
 * `autocompletion()` 加显式 `startCompletion` 都拿不到补全状态 —— 对这类
 * 问题它只会给假阴性，查不出任何东西。
 *
 * Tauri 在 Windows 上用的是 WebView2，内核就是 Chromium，所以这里跑出来
 * 的结果和应用里高度一致。
 *
 * 与默认的 happy-dom 测试分开：`*.browser.test.ts` 只在这个配置里跑。
 */
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // 视口固定成常见的笔记本尺寸 —— 视觉工作台的截图要能反映
      // 真实使用时的比例，默认的小视口会把三栏挤成一条
      viewport: { width: 1440, height: 900 },
      instances: [{ browser: "chromium" }],
    },
  },
});
