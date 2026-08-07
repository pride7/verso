/**
 * 自动更新（§2.11）里能在 Node 下验的那部分。
 *
 * 真正的检查 / 下载 / 安装全靠 Tauri 运行时，这里验不了 —— 那部分只能靠
 * 真机跑一次。所以这里只钉两件「写错了不会报错、但会静悄悄坏掉」的事。
 */
import { describe, expect, it } from "vitest";

import { APP_VERSION, progressText, updateChecksSupported, updatesSupported } from "./update";

describe("updatesSupported", () => {
  /**
   * 没有 Tauri 运行时（浏览器测试里的纯 Chromium、Node）就必须是 false。
   *
   * 少了这道判断，每个 App 级 browser 测试都会在启动几秒后去 invoke 一个
   * 不存在的命令；而 `invoke` 是**同步抛**的（AGENTS.md），包不住。
   */
  it("没有 Tauri 运行时时是 false", () => {
    expect(updatesSupported()).toBe(false);
  });
});

describe("progressText", () => {
  it("知道总大小时给「已下载 / 总共」", () => {
    expect(progressText(1024 * 1024 * 2.5, 1024 * 1024 * 10)).toBe("2.5 / 10.0 MB");
  });

  /**
   * 服务器没给 content-length 时**不编百分比**。进度条走到某个数字停住
   * 是最让人烦躁的一种界面，不如老实说下了多少
   */
  it("不知道总大小时不编百分比", () => {
    expect(progressText(1024 * 1024 * 3, 0)).toBe("已下载 3.0 MB");
    expect(progressText(0, 0)).toBe("开始下载…");
  });
});

describe("APP_VERSION", () => {
  // 更新界面上「当前版本」显示的就是它。读的是 package.json，而 updater
  // 拿去和 latest.json 比对的是 tauri.conf.json —— 两处由
  // `scripts/version.mjs` 保证一致（另有 `tauriConfig.test.ts` 钉住）
  it("是个像样的版本号", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("updateChecksSupported", () => {
  /**
   * **和 `updatesSupported` 不是一回事**：移动端装不了、但查得了。
   *
   * 之前两件事共用一个判断，于是手机上「检查更新」按钮一直是灰的 ——
   * 用户连「现在有没有新版本」都问不出来。这里也是 false，只因为 Node 下
   * 连 Tauri 运行时都没有。
   */
  it("没有 Tauri 运行时时是 false", () => {
    expect(updateChecksSupported()).toBe(false);
  });
});
