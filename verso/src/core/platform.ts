/**
 * 平台差异。DESIGN.md §8 M4「macOS 适配」
 *
 * 只做**表现层**的适配。功能层早就是平台无关的了 —— 全局快捷键一直判的是
 * `e.ctrlKey || e.metaKey`，CodeMirror 的 `Mod-` 前缀也会自己按平台解析。
 * 真正会露馅的是提示文字：在 Mac 上写着 `Ctrl+P` 的按钮，用户按 Ctrl 是
 * 没反应的。
 */

/**
 * 判断 macOS。`navigator.platform` 已废弃但在 WebView 里最可靠 ——
 * `userAgentData` 在 WKWebView 上根本不存在，而我们在 macOS 上跑的正是它。
 */
export const isMac: boolean =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

/**
 * 把 `Mod+Shift+P` 这种写法转成当前平台该显示的样子。
 *
 * Mac 上用符号且**不加分隔符**（`⇧⌘P`），这是系统菜单的写法；其他平台
 * 用 `Ctrl+Shift+P`。顺序也不一样：Mac 的惯例是 ⌃⌥⇧⌘ 固定次序。
 *
 * `mac` 可以显式传，只为让这两条路都能测 —— 和 `keymap.ts` 的 `eventSpec`
 * 同一个口子。不留这个参数的话，跑测试的那台机器是什么系统，就只有那一半
 * 被测到：开发机从 Windows 换到 Mac 之后，这五条用例全红。
 */
export function keyLabel(spec: string, mac: boolean = isMac): string {
  const parts = spec.split("+").map((p) => p.trim());
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));

  if (!mac) {
    const order = ["ctrl", "alt", "shift"];
    const names: Record<string, string> = { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
    const out = [
      ...(mods.has("mod") ? ["Ctrl"] : []),
      ...order.filter((m) => mods.has(m) && m !== "ctrl").map((m) => names[m]),
      ...(mods.has("ctrl") && !mods.has("mod") ? ["Ctrl"] : []),
    ];
    return [...new Set(out), key].join("+");
  }

  const out: string[] = [];
  if (mods.has("ctrl")) out.push("⌃");
  if (mods.has("alt")) out.push("⌥");
  if (mods.has("shift")) out.push("⇧");
  if (mods.has("mod")) out.push("⌘");
  return out.join("") + key;
}
