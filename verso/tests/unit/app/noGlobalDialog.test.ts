/**
 * 守住一条规矩：**不许用全局的 `window.confirm` / `window.alert`**，
 * 确认框一律走 `host/dialog.ts`。
 *
 * 为什么需要一条「扫源码」的测试来管这个 —— 因为这类错误组件测试根本看不见。
 * `tauri-plugin-dialog` 会往 webview 里注入一段脚本，把 `window.confirm` 换成
 * **异步**的版本（详见 `host/dialog.ts` 的注释）；而浏览器测试跑在纯 Chromium
 * 里，没有那段注入，`window.confirm` 是原生的同步版本，于是
 *
 * ```ts
 * if (!window.confirm("确定？")) return;   // 测试里：正常；真 app 里：恒为「确定」
 * ```
 *
 * 在测试里表现完全正确，装进 app 就变成「弹窗还没答，东西已经删了」。
 * 这正是它当初能在 7 处代码里一路溜过去的原因。
 *
 * 项目里没有 eslint，所以这条规则由测试来执行。
 *
 * **`window.prompt` 有意不在这里管。** 它同样是坏的（WebView2 压根不实现
 * prompt），但插件没接管它，得换成自绘的输入框才能修，是另一件事。
 * 现存的两处（`App.tsx` 的提交说明、`DatabaseView.tsx` 的属性改名）还欠着。
 */
import { describe, expect, it } from "vitest";

/** `?raw` 拿源码文本。用 `import.meta.glob` 而不是 `fs` —— 这个 tsconfig 里没有 node 的类型 */
const sources = import.meta.glob("../../../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** dialog.ts 自己要调插件的 confirm，也要在注释里讲清楚为什么，豁免 */
const EXEMPT = ["../../../src/host/dialog.ts"];

/**
 * 扫之前先把注释去掉 —— 讲这条规矩的注释本身必然会写出 `window.confirm`，
 * 不去掉的话「解释一下为什么不能这么写」就会把测试搞挂。
 *
 * 只去块注释和整行的 `//`：行尾的 `//` 不碰，免得把 `"https://…"` 里的斜杠
 * 当成注释起点，那会连带吃掉后面的真代码（漏报比误报难查）。
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const files = Object.entries(sources)
  .filter(([path]) => !EXEMPT.includes(path))
  .map(([path, src]) => [path, stripComments(src)] as const);

describe("确认框只走 host/dialog", () => {
  it("扫到了源码（glob 没写错）", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("没有 window.confirm / window.alert", () => {
    const bad = files
      .filter(([, src]) => /window\.(confirm|alert)\b/.test(src))
      .map(([path]) => path);
    expect(bad, "改成 `await confirm(...)`，从 host/dialog 引入").toEqual([]);
  });

  /**
   * 漏掉 `await` 类型检查拦不住（`!promise` 在 TS 里合法，且恒为 false），
   * 所以这里额外要求每次调用都写成 `await confirm(`。
   */
  it("每次 confirm(...) 都 await 了", () => {
    const bad = files
      .filter(([, src]) => /(?<!await\s)(?<![\w.$])confirm\s*\(/.test(src))
      .map(([path]) => path);
    expect(bad, "确认框必须 `await`，否则拿到的是 Promise（恒真）").toEqual([]);
  });
});
