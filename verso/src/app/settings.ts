/**
 * 用户设置。DESIGN.md §6
 *
 * 落地方式是**把设置写成 CSS 变量挂在 `<html>` 上**，而不是把值传给每个组件。
 * 排版尺度散布在侧栏、编辑器、终端、各种浮层里，逐个传参会漏；而且 CodeMirror
 * 的主题本来就已经全部走 CSS 变量了（见 `editor/theme.ts`），顺着这条路走
 * 深浅主题和字号调整都是免费的。
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "../host/api";
import type { TreeSort } from "../core/treeSort";

/** 点侧栏文件时：开新标签 / 替换当前标签 */
export type TabOpen = "new" | "replace";

export interface Settings {
  theme: "system" | "light" | "dark";
  bodyFontSize: number;
  lineHeight: number;
  /** 正文段落之间的额外留白，em；段内 Shift+Enter 不使用 */
  paragraphSpacing: number;
  /** 正文栏宽，rem */
  contentWidth: number;
  uiFontSize: number;
  /** 字体**名**，不是完整 font-family —— 会被接在内置回退栈前面 */
  bodyFont: string;
  monoFont: string;
  terminalFontSize: number;
  /** 留空则跟随 monoFont */
  terminalFont: string;
  /**
   * 「把笔记发给终端」时加在相对路径前面的前缀（§7.6）。
   *
   * 默认 `@` —— Claude Code 和 Codex 都用它引文件。但 §7.1 说了不绑定任何
   * 工具，所以它是个可改的字符串而不是硬编码：用别的 CLI 的人清空它就得到
   * 裸路径。
   */
  terminalMention: string;
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
   * 自动记版本的总开关（§2.8）。关掉之后**下面那三条一律不发生**，
   * 什么时候记版本完全由人决定（状态栏那个点、命令面板里那两条）。
   *
   * 为什么要一个总开关：让 AI CLI 在仓库里改东西的人（§7）不希望改到一半
   * 被自动记一版 —— 那会把「一次完整的改动」切成几段，而分别关掉三个开关
   * 才能停掉这件事，等于把一个是非题拆成三个。
   */
  autoCommit: boolean;
  /**
   * 停手多少分钟之后自动记一个版本（§2.8）。0 = 不自动记。
   *
   * **按时间窗聚合**，不是每次保存都记 —— 保存是停手 800ms 就发生的，
   * 那样一小时能造出上百个提交，历史反而没法用。
   */
  autoCommitIdleMin: number;
  /**
   * 切到别的程序时也记一个版本（§2.8 把它和「空闲」并列为聚合窗口）。
   *
   * 没有改动时不会记，所以反复 alt-tab 不会造出一串空版本。
   */
  autoCommitOnBlur: boolean;
  /**
   * 关软件之前也记一个版本（§2.8）。
   *
   * 默认开：合上电脑就走的人，「停手 N 分钟」那一档对他等于不存在 ——
   * 他停手的那一刻正是关窗的那一刻。
   */
  autoCommitOnClose: boolean;
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
  /**
   * 启动几秒后悄悄检查一次有没有新版本（§2.11）。
   *
   * 默认开。**失败一律不报** —— 没网、GitHub 连不上都不该在开软件的时候
   * 弹东西出来。只有在设置里手动按「检查更新」，失败才说得出原因。
   */
  autoUpdateCheck: boolean;
  /** Latex Suite 那种 JSON 文本，由 `editor/snippets` 解析 */
  customSnippets: string;
  /**
   * `/` 菜单里隐藏掉的内置条目（记的是它们的名字，见 `lib/slash.ts`）。
   *
   * 和快捷键一样只存**与默认不同**的那部分：将来内置表加了新条目，
   * 没动过它的人会自动跟着有。
   */
  slashHidden: string[];
  /** 自己加的 `/` 菜单条目，JSON 文本，由 `lib/slash.ts` 解析 */
  slashCustom: string;
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
  lineHeight: 1.85,
  paragraphSpacing: 0.35,
  contentWidth: 42,
  uiFontSize: 14,
  bodyFont: "",
  monoFont: "",
  terminalFontSize: 13.5,
  terminalFont: "",
  terminalMention: "@",
  treeSort: "name",
  templateDir: "templates",
  journalKeep: 3,
  autoCommit: true,
  autoCommitIdleMin: 5,
  autoCommitOnBlur: true,
  autoCommitOnClose: true,
  tabOpen: "new",
  // 应用图标上那点青绿
  accentHue: 195,
  accentChroma: 0.11,
  autoUpdateCheck: true,
  customSnippets: "",
  slashHidden: [],
  slashCustom: "",
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
  style.setProperty("--paragraph-spacing", `${s.paragraphSpacing}em`);
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
    // 手改的设置文件里可能是字符串、null、数字数组
    slashHidden: Array.isArray(s.slashHidden)
      ? s.slashHidden.filter((v): v is string => typeof v === "string")
      : [],
    slashCustom: typeof s.slashCustom === "string" ? s.slashCustom : "",
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
    autoCommit: typeof s.autoCommit === "boolean" ? s.autoCommit : DEFAULT_SETTINGS.autoCommit,
    autoCommitIdleMin: Math.round(
      num(s.autoCommitIdleMin, 0, 120, DEFAULT_SETTINGS.autoCommitIdleMin),
    ),
    autoCommitOnBlur:
      typeof s.autoCommitOnBlur === "boolean" ? s.autoCommitOnBlur : DEFAULT_SETTINGS.autoCommitOnBlur,
    autoCommitOnClose:
      typeof s.autoCommitOnClose === "boolean"
        ? s.autoCommitOnClose
        : DEFAULT_SETTINGS.autoCommitOnClose,
    autoUpdateCheck:
      typeof s.autoUpdateCheck === "boolean"
        ? s.autoUpdateCheck
        : DEFAULT_SETTINGS.autoUpdateCheck,
    // 色相是环形的：绕回来而不是夹到端点。夹的话 370 会变成 360（红），
    // 而它本该是 10（也是红）—— 在别的角度上这个差别会很明显
    accentHue: Number.isFinite(s.accentHue)
      ? ((s.accentHue % 360) + 360) % 360
      : DEFAULT_SETTINGS.accentHue,
    accentChroma: num(s.accentChroma, 0, 0.16, DEFAULT_SETTINGS.accentChroma),
    bodyFontSize: num(s.bodyFontSize, 12, 28, DEFAULT_SETTINGS.bodyFontSize),
    lineHeight: num(s.lineHeight, 1.2, 2.4, DEFAULT_SETTINGS.lineHeight),
    paragraphSpacing: num(s.paragraphSpacing, 0, 1.2, DEFAULT_SETTINGS.paragraphSpacing),
    contentWidth: num(s.contentWidth, 24, 80, DEFAULT_SETTINGS.contentWidth),
    uiFontSize: num(s.uiFontSize, 11, 20, DEFAULT_SETTINGS.uiFontSize),
    terminalFontSize: num(s.terminalFontSize, 9, 24, DEFAULT_SETTINGS.terminalFontSize),
    // 空串是有意义的取值（不要前缀），所以只在**不是字符串**时才回落到默认。
    // 用 `|| DEFAULT` 的话，清空前缀会在下次启动时又变回 `@`
    terminalMention:
      typeof s.terminalMention === "string" ? s.terminalMention : DEFAULT_SETTINGS.terminalMention,
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
