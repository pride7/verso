/**
 * 用户设置。DESIGN.md §6
 *
 * 落地方式是**把设置写成 CSS 变量挂在 `<html>` 上**，而不是把值传给每个组件。
 * 排版尺度散布在侧栏、编辑器、终端、各种浮层里，逐个传参会漏；而且 CodeMirror
 * 的主题本来就已经全部走 CSS 变量了（见 `editor/theme.ts`），顺着这条路走
 * 深浅主题和字号调整都是免费的。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "./api";
import type { TreeSort } from "./lib/treeSort";

/** 点侧栏文件时：开新标签 / 替换当前标签 */
export type TabOpen = "new" | "replace";

export interface Settings {
  theme: "system" | "light" | "dark";
  bodyFontSize: number;
  lineHeight: number;
  /** 正文栏宽，rem */
  contentWidth: number;
  uiFontSize: number;
  /** 字体**名**，不是完整 font-family —— 会被接在内置回退栈前面 */
  bodyFont: string;
  monoFont: string;
  terminalFontSize: number;
  /** 留空则跟随 monoFont */
  terminalFont: string;
  /** 文档树排序方式 */
  treeSort: TreeSort;
  /**
   * 模板放在 vault 的哪个目录（§4.6）。
   *
   * 是 vault 相对路径，默认 `templates`。设成空串等于关掉模板功能 ——
   * 「插入模板」会说一个都没有，而不是把整个 vault 当模板列出来。
   */
  templateDir: string;
  /**
   * 打开笔记时保持展开的最近日志条数（§2.10）。0 = 不自动折叠。
   *
   * 项目笔记写长之后，最新状态会被埋在一堆旧记录下面。这一条只改**打开时
   * 的默认视图**，文件一个字节都不动。
   */
  journalKeep: number;
  /**
   * 点侧栏里的文件时开新标签还是替换当前标签。
   *
   * 两种模式下 Ctrl/⌘+点 和中键都强制开新标签 —— 那是一个明确的表态，
   * 不该被设置盖掉。
   */
  tabOpen: TabOpen;
  /**
   * 主题色的色相（oklch 的 h，0–360）与鲜艳度（c）。
   *
   * 界面底色是中性灰，这两个值只影响链接、焦点环、选中标记这些「重音」。
   * **明度不开放** —— 深浅两套主题各需要不同的明度才看得清，让人调它等于
   * 给了一个把界面调成看不见的机会。鲜艳度拉到 0 就是完全无彩的石墨风。
   */
  accentHue: number;
  accentChroma: number;
  /** Latex Suite 那种 JSON 文本，由 `editor/snippets` 解析 */
  customSnippets: string;
  /**
   * 改过的快捷键。命令 id → 键位（`Mod+Shift+P` 这种写法）。
   *
   * 只存**与默认不同**的那几条，空串表示显式解绑。没出现在这里的命令
   * 用它自己的默认键位 —— 见 `lib/keymap.ts`。
   */
  keybindings: Record<string, string>;
}

/** 与 Rust 侧 `settings.rs` 的默认值保持一致 —— §6.1 的排版尺度 */
export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  bodyFontSize: 16.5,
  lineHeight: 1.75,
  contentWidth: 42,
  uiFontSize: 14,
  bodyFont: "",
  monoFont: "",
  terminalFontSize: 13.5,
  terminalFont: "",
  treeSort: "name",
  templateDir: "templates",
  journalKeep: 3,
  tabOpen: "new",
  // 应用图标上那点青绿
  accentHue: 195,
  accentChroma: 0.085,
  customSnippets: "",
  keybindings: {},
};

/**
 * 内置回退栈。用户填的字体名接在最前面，所以他只要写一个装了的字体名，
 * 不必自己拼一长串回退。
 */
const FALLBACK_BODY =
  'Inter, system-ui, -apple-system, "PingFang SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif';
const FALLBACK_UI =
  'Inter, system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const FALLBACK_MONO =
  '"JetBrains Mono", "Cascadia Code", ui-monospace, Consolas, "Courier New", monospace';

/**
 * 字体名可能带空格（`Microsoft YaHei`），得加引号才是合法的 CSS。
 *
 * 同时**必须挡掉引号和分号**：这个值原样进 CSS 自定义属性，
 * 放任 `"; } body { display:none } /*` 这种输入进去就等于让设置文件
 * 改写整个界面的样式。设置文件是可以手改的，也可能是从别处抄来的。
 */
export function cssFontName(name: string): string | null {
  const clean = name.trim();
  if (!clean || /["';{}()\\]|\/\*/.test(clean)) return null;
  return /^[\w-]+$/.test(clean) ? clean : `"${clean}"`;
}

function stack(userFont: string, fallback: string): string {
  const named = cssFontName(userFont);
  return named ? `${named}, ${fallback}` : fallback;
}

/**
 * 把设置刷到 DOM 上。
 *
 * 主题用 `data-theme` 属性而不是加 class：CSS 那边 `system` 走
 * `@media (prefers-color-scheme)`，明确选了浅/深才用 `:root[data-theme=...]`
 * 覆盖它。这样「跟随系统」不需要监听任何事件 —— 系统一换，媒体查询自己就跟上了。
 */
export function applySettings(s: Settings, root: HTMLElement = document.documentElement) {
  if (s.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", s.theme);

  const style = root.style;
  // 主题色只给这两个自由度，`--accent` 系列由 CSS 从它们算出来 ——
  // 深浅两套主题各用各的明度，那部分不该由这里决定（styles.css §6.2）
  style.setProperty("--accent-h", String(s.accentHue));
  style.setProperty("--accent-c", String(s.accentChroma));
  style.setProperty("--body-font-size", `${s.bodyFontSize}px`);
  style.setProperty("--body-line-height", String(s.lineHeight));
  style.setProperty("--content-width", `${s.contentWidth}rem`);
  style.setProperty("--ui-font-size", `${s.uiFontSize}px`);
  style.setProperty("--font-body", stack(s.bodyFont, FALLBACK_BODY));
  style.setProperty("--font-ui", stack(s.bodyFont, FALLBACK_UI));
  style.setProperty("--font-mono", stack(s.monoFont, FALLBACK_MONO));

  // 终端字体默认跟随等宽字体 —— 大多数人只想调一次「代码字体」
  style.setProperty("--term-font", stack(s.terminalFont || s.monoFont, FALLBACK_MONO));
  style.setProperty("--term-font-size", `${s.terminalFontSize}px`);
}

/** 与 Rust 的 `sanitized()` 对应。前端也夹一次，滑块拖动时立刻预览用得上 */
export function sanitize(s: Settings): Settings {
  const num = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    ...s,
    // 设置文件能手改，这里可能是 null、数组、字符串 —— 全都会让设置界面
    // 里的快捷键那一页崩掉，而那正是唯一能把它改回来的地方
    keybindings:
      s.keybindings && typeof s.keybindings === "object" && !Array.isArray(s.keybindings)
        ? Object.fromEntries(
            Object.entries(s.keybindings).filter(([, v]) => typeof v === "string"),
          )
        : {},
    theme: (["system", "light", "dark"] as const).includes(s.theme) ? s.theme : "system",
    treeSort: (["manual", "name", "name-desc", "created", "updated"] as const).includes(s.treeSort)
      ? s.treeSort
      : "name",
    tabOpen: (["new", "replace"] as const).includes(s.tabOpen) ? s.tabOpen : "new",
    // 手改的设置文件里可能是数字、null。当成「没设」而不是让界面崩掉
    templateDir: typeof s.templateDir === "string" ? s.templateDir : DEFAULT_SETTINGS.templateDir,
    // 上限 50：再多就等于没折叠，而一个手滑打成 500 的值会让「只看最新」
    // 悄悄失效，比报错更难查
    journalKeep: Math.round(num(s.journalKeep, 0, 50, DEFAULT_SETTINGS.journalKeep)),
    // 色相是环形的：绕回来而不是夹到端点。夹的话 370 会变成 360（红），
    // 而它本该是 10（也是红）—— 在别的角度上这个差别会很明显
    accentHue: Number.isFinite(s.accentHue)
      ? ((s.accentHue % 360) + 360) % 360
      : DEFAULT_SETTINGS.accentHue,
    accentChroma: num(s.accentChroma, 0, 0.16, DEFAULT_SETTINGS.accentChroma),
    bodyFontSize: num(s.bodyFontSize, 12, 28, DEFAULT_SETTINGS.bodyFontSize),
    lineHeight: num(s.lineHeight, 1.2, 2.4, DEFAULT_SETTINGS.lineHeight),
    contentWidth: num(s.contentWidth, 24, 80, DEFAULT_SETTINGS.contentWidth),
    uiFontSize: num(s.uiFontSize, 11, 20, DEFAULT_SETTINGS.uiFontSize),
    terminalFontSize: num(s.terminalFontSize, 9, 24, DEFAULT_SETTINGS.terminalFontSize),
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    return sanitize({ ...DEFAULT_SETTINGS, ...(await api.getSettings()) });
  } catch {
    // 读不到设置不该让应用起不来 —— 用默认值先跑起来
    return DEFAULT_SETTINGS;
  }
}

/**
 * 当前**实际**生效的是浅色还是深色。
 *
 * 界面本身不需要它 —— CSS 那边媒体查询自己就跟上了。需要它的是画布类组件：
 * xterm 的配色是建终端时传进去的 JS 对象，不参与 CSS 级联，系统主题切换时
 * 它不会自己变色。这个 hook 就是把「系统换主题了」这件事变成一次 React 重渲染。
 */
export function useEffectiveTheme(setting: Settings["theme"]): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    // 只在跟随系统时才需要监听，明确选了浅/深就与系统无关了
    if (setting !== "system" || typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    setSystemDark(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, [setting]);

  if (setting === "system") return systemDark ? "dark" : "light";
  return setting;
}

/**
 * 设置的读写口子。
 *
 * 改动**先落到界面再落到磁盘**：拖字号滑块时要能立刻看见效果，等一次 IPC
 * 往返再重绘会有明显的迟滞感。磁盘写失败就把 Rust 夹紧后的值同步回来，
 * 界面上显示的始终是真正存下去的那份。
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      applySettings(s);
    });
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = sanitize({ ...prev, ...patch });
      applySettings(next);
      void api
        .setSettings(next)
        .then((stored) => {
          setError(null);
          // Rust 那边可能又夹了一次，以它为准
          if (JSON.stringify(stored) !== JSON.stringify(next)) {
            setSettings(stored);
            applySettings(stored);
          }
        })
        .catch((e: Error) => setError(e.message));
      return next;
    });
  }, []);

  const reset = useCallback(() => update(DEFAULT_SETTINGS), [update]);

  return { settings, update, reset, error };
}
