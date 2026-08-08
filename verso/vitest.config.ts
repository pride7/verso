/**
 * 默认测试配置：纯 Node，不带 DOM，跑得快。
 *
 * `tests/browser/` 归 `vitest.browser.config.ts` 管（真实 Chromium），
 * 这里必须排除掉，否则 `pnpm test` 会在没有 `document` 的环境里去跑它们。
 *
 * 两边都按**目录**分，不再按文件名后缀猜 —— 一个测试属于哪一层，从路径上
 * 就该看得出来。
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/browser/**"],
  },
});
