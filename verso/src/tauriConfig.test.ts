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
import capabilities from "../src-tauri/capabilities/default.json";
import desktopCaps from "../src-tauri/capabilities/desktop.json";
import pkg from "../package.json";

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

  /**
   * 更新包必须签名，客户端只认公钥对应的那一把私钥（§2.11）。
   *
   * 这一条在**发布时**才会露馅，而那时已经晚了：没有 `pubkey` 的话
   * `tauri build` 不会去签，做出来的包在别人机器上装不上；而 CI 里
   * 私钥是 secret，本地根本复现不出来。所以钉在这儿。
   */
  it("更新器配了公钥和更新地址", () => {
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    expect(conf.plugins.updater.pubkey.length).toBeGreaterThan(40);
    // `releases/latest/download/…` 只认「已发布、非预发布」的那一个 release
    // —— 草稿状态的版本不会被任何人下载到，这是发布流程的安全垫
    expect(conf.plugins.updater.endpoints[0]).toMatch(
      /^https:\/\/github\.com\/.+\/releases\/latest\/download\/latest\.json$/,
    );
  });

  /**
   * 版本号存在四个文件里（AGENTS.md「版本号」），`scripts/version.mjs`
   * 负责一起改。这里只钉住其中两处 —— 它俩恰好都能 import 进来。
   *
   * 现在这件事比以前更要紧：更新界面上显示的「当前版本」读的是
   * `package.json`，而 updater 拿来和 `latest.json` 比对的是
   * `tauri.conf.json`。两者不一致 = 界面说 0.6.13、软件觉得自己是 0.6.14。
   */
  it("package.json 和 tauri.conf.json 的版本号一致", () => {
    expect(conf.version).toBe(pkg.version);
  });
});

describe("capabilities/desktop.json", () => {
  /**
   * updater 和 process 是**桌面专属**的 target 依赖，安卓包里根本没编进去。
   *
   * 权限声明必须跟着一起分平台。写进 `default.json` 的话，`tauri android
   * build` 会在 ACL 解析阶段直接失败（找不到 `updater:default` 这条权限）
   * —— 而那是一条完全看不出和「加了自动更新」有关的错误。
   */
  it("更新权限只授给桌面，别把安卓构建带崩", () => {
    expect(desktopCaps.permissions).toContain("updater:default");
    expect(desktopCaps.permissions).toContain("process:allow-restart");
    expect(desktopCaps.platforms).toEqual(["windows", "macOS", "linux"]);
    // 反过来也要钉：这几条一旦漏进那个不分平台的文件，安卓就完了
    for (const p of desktopCaps.permissions) {
      expect(capabilities.permissions).not.toContain(p);
    }
  });
});

describe("capabilities/default.json", () => {
  /**
   * `dialog:allow-open` 管的是选目录（`pickVaultFolder`），**不包括确认框**。
   * 确认框走的是 `plugin:dialog|message` 这个命令（`ask` / `confirm` 在
   * plugin-dialog 2.7 里都是它的包装，`allow-confirm` 只是它的过时别名）。
   *
   * 少了这一条，`lib/dialog.ts` 的 `confirm()` 会被权限层挡回来 —— 弹窗压根
   * 不出现，Promise 直接 reject。删笔记、回退版本、重置设置全都变成
   * 「点了没反应」或者「报一句看不懂的错」。
   */
  it("放行 dialog 的 message 命令，否则所有确认框都弹不出来", () => {
    expect(capabilities.permissions).toContain("dialog:allow-message");
  });
});
