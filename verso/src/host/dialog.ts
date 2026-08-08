/**
 * 确认框。**全项目只走这里，不要用 `window.confirm`。**
 *
 * 为什么：注册了 `tauri_plugin_dialog` 之后，插件会往 webview 里注入一段
 * init 脚本（`tauri-plugin-dialog/src/init-iife.js`），把全局的 confirm 换成
 *
 * ```js
 * window.confirm = async function (m) { return await invoke("plugin:dialog|confirm", ...) }
 * ```
 *
 * 也就是说 `window.confirm(...)` 返回的是一个 **Promise**，不是 boolean。
 * 于是所有 `if (!window.confirm(...)) return;` 都恒为「用户点了确定」——
 * 弹窗还没答，代码已经往下走了；而把它当值传给后端命令时，Promise 会被
 * 序列化成 `{}`，Rust 侧报 `invalid type: map, expected a boolean`。
 *
 * 更阴的是它**在浏览器测试里查不出来**：Chromium 没有那段注入，
 * `window.confirm` 是原生的同步版本，测试怎么写都绿。见 `noGlobalDialog.test.ts`。
 *
 * 注意这段注入在 Android 上**不注入**（安卓的对话框由原生实现），所以直接用
 * 全局 confirm 还会得到两个平台不一样的行为。统一走插件 API 就没这些事。
 */
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";

export interface ConfirmOptions {
  /** 标题栏。不给就是应用名 */
  title?: string;
  /** 确定键的文字，默认「Ok」。给了它就必须连 `cancelLabel` 一起给，否则取消键会是英文的「Cancel」 */
  okLabel?: string;
  cancelLabel?: string;
  /** 图标。删除这类不可逆的动作用 `warning` */
  kind?: "info" | "warning" | "error";
}

/**
 * 弹一个「确定 / 取消」，返回用户是否点了确定。
 *
 * **必须 await。** 这是它和 `window.confirm` 唯一的用法差别，也是它存在的
 * 全部理由。名字故意起成 `confirm` —— 调用点 `await confirm(...)` 读起来和
 * 原来一样，而这个 import 会遮住同名的全局，想用错都用不到。
 *
 * 漏掉 `await` 类型检查是拦不住的（`!promise` 在 TS 里合法），所以由
 * `noGlobalDialog.test.ts` 扫源码兜底。
 */
export function confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return tauriConfirm(message, {
    kind: "warning",
    okLabel: "确定",
    cancelLabel: "取消",
    ...opts,
  });
}
