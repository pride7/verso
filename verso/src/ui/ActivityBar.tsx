import { useEffect, useRef, useState } from "react";

import { hint } from "../core/keymap";
import { Icon, type IconName } from "./Icon";

/** 侧栏当前显示哪个面板 */
export type SidebarView =
  | "tree"
  | "search"
  | "tags"
  | "template"
  | "history"
  | "outline";

/** 动作组按钮的 id。和 `SidebarView` 一起构成「图标栏上的一格」 */
export type RailActionId =
  | "source"
  | "scratch"
  | "mindmap"
  | "project"
  | "term"
  | "palette"
  | "settings";

/** 图标栏上任意一格的 id。两组不重名，所以可以共用一个隐藏名单 */
export type RailItemId = SidebarView | RailActionId;

interface Props {
  view: SidebarView;
  onView: (v: SidebarView) => void;
  /**
   * 某条命令当前的快捷键提示文字，没绑就是 undefined。
   *
   * 键位不写死在这里 —— 它们全归命令表管，用户改过之后这一竖条上的
   * tooltip 要跟着变，否则就成了一排骗人的提示。
   */
  keyOf: (commandId: string) => string | undefined;
  /** 侧栏是否展开。点当前已选中的图标会收起它 */
  sidebarOpen: boolean;
  /**
   * 竖排在最左（桌面），还是横排在最底（窄屏）。见 DESIGN.md §6.3
   * 「移动 单栏 + 抽屉：编辑区占满，左滑出文档树，底部工具条固定」。
   */
  layout: "rail" | "bottom";
  activityUnread: number;
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  /** 全库的结构化草稿台。没打开笔记时也能进，首次会建草稿箱。 */
  scratchOn: boolean;
  onToggleScratch: () => void;
  /** 思维导图开着没有。null = 现在没有打开的笔记，这个按钮不该能按 */
  mindmapOn: boolean | null;
  onToggleMindmap: () => void;
  /** 跨笔记的项目中心开着没有。 */
  projectOn: boolean;
  onToggleProject: () => void;
  termOpen: boolean;
  /** 移动端没有终端（§7.3 没有可用的 PTY），整个按钮不渲染 */
  showTerm: boolean;
  onToggleTerm: () => void;
  onSystemTerminal: () => void;
  onPalette: () => void;
  onSettings: () => void;
  /**
   * 用户在设置里收起来的格子（`settings.railHidden`）。
   *
   * 收起来的**只是图标**：对应的命令、快捷键、命令面板一概照旧。这一条也是
   * 这个名单只记 id、不记「启用」的原因 —— 它是界面偏好，不是功能开关。
   */
  hidden: readonly string[];
}

/** `cmd` 是这个图标对应的命令 id —— 快捷键提示从命令表里现取 */
const VIEWS: { id: SidebarView; icon: IconName; label: string; cmd: string }[] = [
  { id: "tree", icon: "tree", label: "文档树", cmd: "view.tree" },
  { id: "search", icon: "search", label: "搜索", cmd: "note.search" },
  { id: "tags", icon: "tag", label: "标签", cmd: "note.tags" },
  // 模板也是跨文档的东西，排在标签之后、大纲之前
  { id: "template", icon: "template", label: "模板", cmd: "note.templates" },
  { id: "history", icon: "history", label: "动态", cmd: "vault.history" },
  // 大纲是「当前这篇」的视图，排在三个跨文档视图后面
  { id: "outline", icon: "outline", label: "大纲", cmd: "note.outline" },
];

/**
 * 动作组。顺序就是条上（或窄屏 `⋯` 面板里）的顺序。
 *
 * 名字和图标定义在这里而不是写在下面的渲染代码里：设置面板要照着同一份表
 * 列出「显示哪些图标」，各写一份迟早会对不上。运行时的状态和回调仍然由
 * 组件按 id 补上 —— 那些东西没法写成模块级常量。
 */
const ACTIONS: { id: RailActionId; icon: IconName; label: string; cmd: string | null }[] = [
  // 源码模式排在动作组的第一个：它作用于正文，比终端和设置更「靠近内容」。
  // Obsidian 和 Typora 都给了这个开关一个常驻按钮 —— 只藏在快捷键和命令
  // 面板里的话，不知道它存在的人永远不会用到
  { id: "source", icon: "code", label: "源码模式", cmd: "view.sourceMode" },
  // 草稿台是全库入口，不要绑在「当前已打开一篇」上。
  // 和导图相邻，因为两者都是 Markdown 结构的另一种看法。
  { id: "scratch", icon: "pencil", label: "草稿台", cmd: "note.scratchpad" },
  // 导图是「当前这篇」的另一种视图，紧挨着源码模式 —— 它俩是一类：
  // 都是把同一份内容换个样子看。只能靠快捷键进去的话，不知道它存在的人
  // 永远不会用到（§0：不能假设有键盘）
  { id: "mindmap", icon: "mindmap", label: "思维导图", cmd: "note.mindmap" },
  { id: "project", icon: "project", label: "项目中心", cmd: "view.projects" },
  // 终端的 tooltip 要额外说右键，所以它的提示由组件自己拼，这里不给 cmd
  { id: "term", icon: "terminal", label: "终端", cmd: null },
  { id: "palette", icon: "command", label: "命令面板", cmd: "view.palette" },
  { id: "settings", icon: "settings", label: "设置", cmd: "view.settings" },
];

/**
 * 「设置」这一格不可隐藏 —— 它是把别的格子找回来的唯一入口。
 *
 * 命令面板也能开设置，但那要么靠快捷键、要么靠另一个同样可隐藏的图标；
 * 在没有键盘的设备上（§0）把两个都收起来就真的出不来了。
 */
export const RAIL_FIXED: RailItemId = "settings";

/** 动作组一项的运行时部分：现在是不是开着、点了做什么 */
interface ActionState {
  /** null = 这个按钮不带开关态（命令面板、设置），或者现在没有可操作的对象 */
  on: boolean | null;
  run: () => void;
  extra?: { disabled?: boolean; onContextMenu?: (e: React.MouseEvent) => void; title?: string };
}

/** 图标栏上全部可选的格子。设置面板照着它列出「显示哪些」 */
export const RAIL_ITEMS: {
  id: RailItemId;
  icon: IconName;
  label: string;
  group: "view" | "action";
}[] = [
  ...VIEWS.map((v) => ({
    id: v.id as RailItemId,
    icon: v.icon,
    label: v.label,
    group: "view" as const,
  })),
  ...ACTIONS.map((a) => ({
    id: a.id as RailItemId,
    icon: a.icon,
    label: a.label,
    group: "action" as const,
  })),
];

/**
 * 图标栏。桌面上是最左边那一竖条（VS Code 的 activity bar），窄屏上横过来
 * 钉在底部。
 *
 * 分成两组：
 *
 * - **上组切换侧栏显示什么**（文档树 / 搜索 / 标签…）。这是 §6.3 里
 *   「文档树/搜索/标签 ｜ 编辑区 ｜ 大纲/反向链接」那一栏的落地方式 ——
 *   三栏挤在窄屏上放不下，改成一栏多视图。
 * - **下组是直接执行的动作**（源码模式 / 导图 / 终端 / 命令面板 / 设置），
 *   不改变侧栏。
 *
 * 两组必须在视觉上分得开，否则用户点了「设置」会预期侧栏变成设置面板。
 * 竖排时靠 `margin-top: auto` 撑开的一段留白区分，选中态只给上组。
 *
 * ## 横排时动作组收进 `⋯`
 *
 * 竖排能排下十三个图标，390px 宽的一行排不下 —— 硬塞进去每个只剩 30px，
 * 又回到「看得见点不中」。所以横排时**只有视图组留在条上**（六个，各约
 * 55px，中间的命中区仍是一根手指），动作组收进最后那个 `⋯` 弹出的面板。
 *
 * 这个划分不是按使用频率拍的，是按语义：条上放的全是「侧栏显示什么」，
 * 于是选中态永远看得见 —— 把其中两个塞进弹出层的话，切到「标签」时整条
 * 栏上没有任何一处亮着，用户会以为没切成功。动作组反过来，本来就不带
 * 选中态（源码模式和导图除外，它们在面板里自己带勾）。
 *
 * ## 可以收起其中几格
 *
 * 功能越加越多，这条栏也就越长；十三个图标里总有几个某个人从来不用。
 * `hidden` 把它们摘掉，**但只摘图标** —— 命令、快捷键、命令面板全不受影响，
 * 所以这是一个界面偏好而不是功能开关。「设置」那一格摘不掉（见 `RAIL_FIXED`）。
 */
export function ActivityBar({
  view,
  onView,
  keyOf,
  sidebarOpen,
  layout,
  activityUnread,
  sourceMode,
  onToggleSourceMode,
  scratchOn,
  onToggleScratch,
  mindmapOn,
  onToggleMindmap,
  projectOn,
  onToggleProject,
  termOpen,
  showTerm,
  onToggleTerm,
  onSystemTerminal,
  onPalette,
  onSettings,
  hidden,
}: Props) {
  const bottom = layout === "bottom";
  const off = new Set(hidden);
  const shown = (id: RailItemId) => id === RAIL_FIXED || !off.has(id);
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // 竖排时不存在这个面板；从窄屏拉宽的瞬间它必须跟着消失，否则会留下一个
  // 谁也点不掉的浮层（它的关闭入口 `⋯` 已经不渲染了）
  useEffect(() => {
    if (!bottom) setSheet(false);
  }, [bottom]);

  useEffect(() => {
    if (!sheet) return;
    const close = (e: MouseEvent) => {
      if (!sheetRef.current?.contains(e.target as Node)) setSheet(false);
    };
    // 捕获阶段：面板底下那些按钮的 onClick 不该在关闭之前先被触发一次
    window.addEventListener("mousedown", close, true);
    return () => window.removeEventListener("mousedown", close, true);
  }, [sheet]);

  /** 动作组的一项。竖排时是个光图标的按钮，横排时是面板里带文字的一行 */
  const renderAction = (
    { id, icon, label, cmd }: (typeof ACTIONS)[number],
    { on, run, extra }: ActionState,
  ) => (
    <button
      key={id}
      className={
        bottom
          ? `rail-sheet-item${on ? " is-on" : ""}`
          : `rail-btn rail-action${on ? " is-on" : ""}`
      }
      onClick={() => {
        run();
        setSheet(false);
      }}
      disabled={extra?.disabled}
      onContextMenu={extra?.onContextMenu}
      title={extra?.title ?? (cmd ? hint(label, keyOf(cmd)) : label)}
      aria-label={label}
      {...(on === null ? {} : { "aria-pressed": on })}
    >
      <Icon name={icon} />
      {bottom && <span>{label}</span>}
      {bottom && on && <span className="rail-sheet-on">开</span>}
    </button>
  );

  const state: Record<RailActionId, ActionState> = {
    source: { on: sourceMode, run: onToggleSourceMode },
    scratch: { on: scratchOn, run: onToggleScratch },
    mindmap: { on: mindmapOn, run: onToggleMindmap, extra: { disabled: mindmapOn === null } },
    project: { on: projectOn, run: onToggleProject },
    term: {
      on: termOpen,
      run: onToggleTerm,
      extra: {
        title: `${hint("终端", keyOf("term.toggle"))}　右键：在系统终端中打开`,
        onContextMenu: (e: React.MouseEvent) => {
          // 右键改成调起独立的系统终端窗口（§7.3 方案 A）
          e.preventDefault();
          onSystemTerminal();
        },
      },
    },
    palette: { on: null, run: onPalette },
    settings: { on: null, run: onSettings },
  };

  const actions = ACTIONS
    // 移动端没有终端（§7.3 没有可用的 PTY），整个按钮不渲染
    .filter((a) => (a.id !== "term" || showTerm) && shown(a.id))
    .map((a) => renderAction(a, state[a.id]));

  return (
    <nav className={`rail${bottom ? " is-bottom" : ""}`} aria-label="侧栏视图">
      {VIEWS.filter((v) => shown(v.id)).map((v) => (
        <button
          key={v.id}
          className={`rail-btn${sidebarOpen && view === v.id ? " is-on" : ""}`}
          // 点已经选中的那个就收起侧栏 —— 和 VS Code 一致，也是唯一能
          // 把编辑区拉到最宽的办法
          onClick={() => {
            onView(v.id);
            setSheet(false);
          }}
          title={hint(v.label, keyOf(v.cmd))}
          aria-label={v.label}
          aria-pressed={sidebarOpen && view === v.id}
        >
          <Icon name={v.icon} />
          {v.id === "history" && activityUnread > 0 && (
            <span className="rail-badge" aria-label={`${activityUnread} 条未读动态`}>
              {activityUnread > 9 ? "9+" : activityUnread}
            </span>
          )}
        </button>
      ))}

      {bottom ? (
        <div className="rail-more" ref={sheetRef}>
          <button
            className={`rail-btn${sheet ? " is-on" : ""}`}
            onClick={() => setSheet((v) => !v)}
            aria-label="更多"
            aria-expanded={sheet}
          >
            <Icon name="more" />
          </button>
          {sheet && <div className="rail-sheet">{actions}</div>}
        </div>
      ) : (
        <>
          <div className="rail-gap" />
          {actions}
        </>
      )}
    </nav>
  );
}
