/**
 * 自动更新。DESIGN.md §2.11
 *
 * 三条设计上的取舍，改这个文件之前先看一眼：
 *
 * 1. **下载和安装是两步，不是一步。** 插件提供了 `downloadAndInstall`，
 *    但那意味着「点一下 → 几十秒后应用自己没了」。这中间用户还在打字，
 *    而 Windows 上装的那一刻是安装器把进程杀掉。所以先下完、停下来等，
 *    真正要重启时再落盘（`beforeInstall`）、再装。
 * 2. **自动检查失败一律不打扰。** 没网、GitHub 挂了、代理拦了 —— 这些都
 *    不是用户此刻在做的事。只有他自己按了「检查更新」，失败才报出来。
 * 3. **不支持的平台要说人话。** 安卓上这几个命令根本没注册，直接调会抛
 *    一句 `plugin updater not found`。见 `updatesSupported`。
 * 4. **装不了不等于不该知道。** 移动端没有插件，但「有没有新版本」只需要
 *    一个 HTTPS GET —— 那条路走 Rust 侧的 `latestRelease`。之前那个按钮在
 *    手机上一直是灰的，用户连问都问不出来。
 * 5. **给的是安装包直链，不是发布页。** 发布页上挂着十几个文件，手机上还得
 *    展开 Assets 从里面挑对的那一个。直链由 Rust 侧确认过存在，拿不到才退回
 *    发布页（`downloadUrl` 为 null）。
 * 6. **「是不是更新版」由 Rust 侧判**，这边只读结论。版本比较写两份的下场是
 *    其中一份成了死代码 —— 而死的那份不会跟着活的那份一起改。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Update } from "@tauri-apps/plugin-updater";

import { api } from "../api";

// 版本号从 package.json 取。四处版本号由 `scripts/version.mjs` 保证一致，
// 所以这一份和安装包里的那份必然相同 —— 比多走一次 IPC 去问后端便宜
import { version as APP_VERSION } from "../../package.json";

export { APP_VERSION };

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  /** 已经是最新的。只有手动检查才会走到这儿 —— 自动检查悄悄回 idle */
  | { phase: "latest" }
  | { phase: "found"; version: string; notes: string; date: string }
  | { phase: "downloading"; version: string; received: number; total: number }
  /** 下好了，等用户挑个时间重启 */
  | { phase: "ready"; version: string }
  /**
   * 查到了新版本，但这个平台装不了 —— 只能把人送到发布页（移动端）。
   * 和 `found` 分开而不是加个布尔：两者能做的事完全不同，混在一起的话
   * 每个用到它的地方都要再判一次「这个 found 是能装的那种吗」
   */
  | {
      phase: "manual";
      version: string;
      notes: string;
      date: string;
      /** 直链拿到了没有 —— 界面据此决定按钮写「下载」还是「打开下载页」 */
      downloadUrl: string | null;
      pageUrl: string;
    }
  | { phase: "error"; message: string };

/**
 * 这个平台有没有自动更新。
 *
 * 两道判断缺一不可：
 * - `__TAURI_INTERNALS__`：浏览器测试里跑的是纯 Chromium，没有它。少了这道
 *   判断，每个 App 级 browser 测试都会在启动时去 invoke 一个不存在的东西。
 * - 移动端：updater 插件是 target 依赖，安卓包里压根没编进去。
 */
export function updatesSupported(): boolean {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Rust 侧 `update_latest_release` 返回的东西 */
export interface LatestRelease {
  version: string;
  notes: string;
  date: string;
  /**
   * 比当前这一版新吗。**比较由 Rust 侧做** —— 一度两边各写了一份同样的
   * 规则，而 Rust 那份从来没被调用过，等于留了一份不会跟着改的死代码。
   */
  newer: boolean;
  /**
   * 安装包直链。**Rust 侧确认过它存在**才有值 —— 拼错的直链是个 404 页面，
   * 比发布页更糟
   */
  downloadUrl: string | null;
  /** 发布页。永远有值，是直链拿不到时的退路 */
  pageUrl: string;
}

/**
 * 在这个平台上，「检查更新」这件事做不做得了。
 *
 * 和 `updatesSupported` 的区别是**能不能装**：移动端查得了、装不了。
 * 唯一查不了的是浏览器测试环境（连 Tauri 都没有）。
 */
export function updateChecksSupported(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 自动检查往后推一会儿：开软件那几秒要留给打开 vault 和建索引 */
const AUTO_DELAY_MS = 8000;

export interface UpdateApi {
  state: UpdateState;
  /** 手动检查。失败会报到界面上 */
  check: () => void;
  /** 开始下载。只在 `found` 时有意义 */
  download: () => void;
  /** 装上并重启。只在 `ready` 时有意义 */
  install: () => void;
  /** 把「有新版本」那个提示收起来，回到 idle */
  dismiss: () => void;
  /**
   * 去下载。只在 `manual` 时有意义 —— 移动端由用户自己装。
   *
   * 拿得到直链就直接开那个 APK（浏览器立刻开始下，下完系统安装器接手），
   * 拿不到才退回发布页。
   */
  openReleases: () => void;
}

/**
 * 更新流程的全部状态。**整个应用只该有一个** —— 挂在 App 上，设置界面和
 * 状态栏共用它，不然「状态栏说有新版本、设置里说没有」这种事迟早出现。
 *
 * @param enabled  启动时自动检查一次（设置项）
 * @param beforeInstall 重启前要做完的事：落盘、按设置记一个版本。
 *        和关窗那条路（`onAppClosing`）做的是同一件事，理由也一样 ——
 *        进程一没，自动保存那 800ms 窗口里的字就真的没了
 */
export function useUpdate(enabled: boolean, beforeInstall: () => Promise<void>): UpdateApi {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  // `openReleases` 要读当前状态里的地址，但它不该因为状态一变就换个身份 ——
  // 它挂在按钮上，重建会让 SettingsPanel 白重渲染一轮
  const stateRef = useRef<UpdateState>(state);
  stateRef.current = state;
  // 拿到的 Update 对象要留到下载、安装时用。放 ref 不放 state：它不参与渲染，
  // 而且它是个带资源句柄的对象，进 state 会被 React 的相等性判断反复比较
  const pending = useRef<Update | null>(null);
  // 依赖里不带它，否则每次设置一改就重新拨一遍自动检查的计时器
  const beforeRef = useRef(beforeInstall);
  beforeRef.current = beforeInstall;

  const run = useCallback(async (manual: boolean) => {
    if (!updateChecksSupported()) {
      if (manual) setState({ phase: "error", message: "这个平台不支持检查更新" });
      return;
    }
    // 装不了的平台（移动端）只查，查到就把人送去发布页
    if (!updatesSupported()) {
      setState({ phase: "checking" });
      try {
        const latest = await api.latestRelease();
        if (!latest.newer) {
          setState(manual ? { phase: "latest" } : { phase: "idle" });
          return;
        }
        setState({
          phase: "manual",
          version: latest.version,
          notes: latest.notes,
          date: latest.date,
          downloadUrl: latest.downloadUrl,
          pageUrl: latest.pageUrl,
        });
      } catch (e) {
        setState(manual ? { phase: "error", message: describe(e) } : { phase: "idle" });
      }
      return;
    }
    setState({ phase: "checking" });
    // 上一次查出来的那个 Update 是个 Rust 侧的资源句柄。反复按「检查更新」
    // 会一次攒一个，到退出才释放
    void pending.current?.close().catch(() => {});
    pending.current = null;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (!found) {
        pending.current = null;
        setState(manual ? { phase: "latest" } : { phase: "idle" });
        return;
      }
      pending.current = found;
      setState({
        phase: "found",
        version: found.version,
        notes: found.body ?? "",
        date: found.date ?? "",
      });
    } catch (e) {
      // 自动检查失败不打扰：没网、被代理拦了、GitHub 挂了，都不是用户
      // 此刻在做的事
      setState(manual ? { phase: "error", message: describe(e) } : { phase: "idle" });
    }
  }, []);

  const check = useCallback(() => void run(true), [run]);

  const download = useCallback(async () => {
    const up = pending.current;
    if (!up) return;
    setState({ phase: "downloading", version: up.version, received: 0, total: 0 });
    try {
      let received = 0;
      let total = 0;
      await up.download((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") received += e.data.chunkLength;
        else if (e.event === "Finished") received = total || received;
        setState({ phase: "downloading", version: up.version, received, total });
      });
      setState({ phase: "ready", version: up.version });
    } catch (e) {
      setState({ phase: "error", message: describe(e) });
    }
  }, []);

  const install = useCallback(async () => {
    const up = pending.current;
    if (!up) return;
    try {
      // 顺序要紧：先把手里的东西落盘，再交给安装器。Windows 上
      // `install()` 之后进程是被安装器杀掉的，那之后前端一个 tick 都没有
      await beforeRef.current();
      await up.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: describe(e) });
    }
  }, []);

  const dismiss = useCallback(() => setState({ phase: "idle" }), []);

  const openReleases = useCallback(() => {
    const s = stateRef.current;
    const url = s.phase === "manual" ? (s.downloadUrl ?? s.pageUrl) : null;
    if (!url) return;
    void import("@tauri-apps/plugin-opener")
      .then((m) => m.openUrl(url))
      .catch((e) => setState({ phase: "error", message: describe(e) }));
  }, []);

  useEffect(() => {
    if (!enabled || !updateChecksSupported()) return;
    const t = setTimeout(() => void run(false), AUTO_DELAY_MS);
    return () => clearTimeout(t);
    // 只在开关或 `run` 变时重来。`run` 是稳定的，所以实际上只跑一次
  }, [enabled, run]);

  return { state, check, download, install, dismiss, openReleases };
}

/** 插件抛出来的可能是 Error、字符串，也可能是个对象 */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}

/**
 * 下载进度的人话版本。
 *
 * 总大小拿不到时（服务器没给 `content-length`）只说下了多少 —— 编一个
 * 百分比出来比不说更糟：进度条走到 90% 停住是最让人烦躁的一种界面。
 */
export function progressText(received: number, total: number): string {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  if (total > 0) return `${mb(received)} / ${mb(total)} MB`;
  return received > 0 ? `已下载 ${mb(received)} MB` : "开始下载…";
}
