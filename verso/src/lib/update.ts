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
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Update } from "@tauri-apps/plugin-updater";

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
  // 拿到的 Update 对象要留到下载、安装时用。放 ref 不放 state：它不参与渲染，
  // 而且它是个带资源句柄的对象，进 state 会被 React 的相等性判断反复比较
  const pending = useRef<Update | null>(null);
  // 依赖里不带它，否则每次设置一改就重新拨一遍自动检查的计时器
  const beforeRef = useRef(beforeInstall);
  beforeRef.current = beforeInstall;

  const run = useCallback(async (manual: boolean) => {
    if (!updatesSupported()) {
      if (manual) setState({ phase: "error", message: "这个平台不支持自动更新" });
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

  useEffect(() => {
    if (!enabled || !updatesSupported()) return;
    const t = setTimeout(() => void run(false), AUTO_DELAY_MS);
    return () => clearTimeout(t);
    // 只在开关或 `run` 变时重来。`run` 是稳定的，所以实际上只跑一次
  }, [enabled, run]);

  return { state, check, download, install, dismiss };
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
