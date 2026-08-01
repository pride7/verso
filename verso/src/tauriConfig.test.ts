/**
 * 几条 `tauri.conf.json` 里「删掉就会静悄悄坏掉」的配置。
 *
 * 这些东西没法用组件测试盖住 —— 它们是 Tauri 运行时的行为，浏览器里跑的
 * 测试全都感知不到。所以退而求其次：把配置本身钉住，并在这里写清楚为什么。
 */
import { describe, expect, it } from "vitest";

// 直接 import 而不是读文件：`src/` 这个 tsconfig 里没有 node 的类型，
// 而 `resolveJsonModule` 本来就开着
import conf from "../src-tauri/tauri.conf.json";

describe("tauri.conf.json", () => {
  /**
   * Tauri 默认在**操作系统层**接管拖放，webview 里的 `dragstart` / `drop`
   * 根本收不到。tauri-utils 的 config.rs 原话：
   *
   * > Disabling it is required to use HTML5 drag and drop on the frontend on Windows.
   *
   * 文档树的拖拽移动和拖拽排序全靠 HTML5 拖放。这一行没了，两个功能在真
   * app 里就一起变成「拖了毫无反应」，而浏览器测试（纯 Chromium，没有这层
   * 拦截）照样全绿 —— 这正是它当初能一路溜过去的原因。
   *
   * 代价：从资源管理器往窗口里拖文件不再走 Tauri 的 `drag-drop` 事件。
   * 要做那个功能就用 HTML5 的 `drop` + `dataTransfer.files` 自己接。
   */
  it("关掉 OS 层拖放，否则文档树的拖拽全部失灵", () => {
    expect(conf.app.windows[0].dragDropEnabled).toBe(false);
  });
});
