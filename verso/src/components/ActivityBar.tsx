import { hint } from "../lib/keymap";
import { Icon, type IconName } from "./Icon";

/** 侧栏当前显示哪个面板 */
export type SidebarView =
  | "tree"
  | "search"
  | "tags"
  | "template"
  | "history"
  | "outline";

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
  activityUnread: number;
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  /** 思维导图开着没有。null = 现在没有打开的笔记，这个按钮不该能按 */
  mindmapOn: boolean | null;
  onToggleMindmap: () => void;
  termOpen: boolean;
  /** 移动端没有终端（§7.3 没有可用的 PTY），整个按钮不渲染 */
  showTerm: boolean;
  onToggleTerm: () => void;
  onSystemTerminal: () => void;
  onPalette: () => void;
  onSettings: () => void;
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
 * 最左边那一竖条。VS Code 的 activity bar。
 *
 * 分成两组，中间用 `margin-top: auto` 撑开：
 *
 * - **上组切换侧栏显示什么**（文档树 / 搜索 / 标签）。这是 §6.3 里
 *   「文档树/搜索/标签 ｜ 编辑区 ｜ 大纲/反向链接」那一栏的落地方式 ——
 *   三栏挤在窄屏上放不下，改成一栏三视图。
 * - **下组是直接执行的动作**（终端 / 命令面板 / 设置），不改变侧栏。
 *
 * 两组必须在视觉上分得开，否则用户点了「设置」会预期侧栏变成设置面板。
 * 这里靠留白和一条分隔线区分，选中态只给上组。
 */
export function ActivityBar({
  view,
  onView,
  keyOf,
  sidebarOpen,
  activityUnread,
  sourceMode,
  onToggleSourceMode,
  mindmapOn,
  onToggleMindmap,
  termOpen,
  showTerm,
  onToggleTerm,
  onSystemTerminal,
  onPalette,
  onSettings,
}: Props) {
  return (
    <nav className="rail" aria-label="侧栏视图">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={`rail-btn${sidebarOpen && view === v.id ? " is-on" : ""}`}
          // 点已经选中的那个就收起侧栏 —— 和 VS Code 一致，也是唯一能
          // 把编辑区拉到最宽的办法
          onClick={() => onView(v.id)}
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

      <div className="rail-gap" />

      {/* 源码模式排在动作组的第一个：它作用于正文，比终端和设置更「靠近内容」。
          Obsidian 和 Typora 都给了这个开关一个常驻按钮 —— 只藏在快捷键和命令
          面板里的话，不知道它存在的人永远不会用到 */}
      <button
        className={`rail-btn rail-action${sourceMode ? " is-on" : ""}`}
        onClick={onToggleSourceMode}
        title={hint("源码模式", keyOf("view.sourceMode"))}
        aria-label="源码模式"
        aria-pressed={sourceMode}
      >
        <Icon name="code" />
      </button>
      {/* 导图是「当前这篇」的另一种视图，紧挨着源码模式 —— 它俩是一类：
          都是把同一份内容换个样子看。只能靠快捷键进去的话，不知道它存在的人
          永远不会用到（§0：不能假设有键盘） */}
      <button
        className={`rail-btn rail-action${mindmapOn ? " is-on" : ""}`}
        onClick={onToggleMindmap}
        disabled={mindmapOn === null}
        title={hint("思维导图", keyOf("note.mindmap"))}
        aria-label="思维导图"
        aria-pressed={!!mindmapOn}
      >
        <Icon name="mindmap" />
      </button>
      {showTerm && (
        <button
          className={`rail-btn rail-action${termOpen ? " is-on" : ""}`}
          onClick={onToggleTerm}
          onContextMenu={(e) => {
            // 右键改成调起独立的系统终端窗口（§7.3 方案 A）
            e.preventDefault();
            onSystemTerminal();
          }}
          title={`${hint("终端", keyOf("term.toggle"))}　右键：在系统终端中打开`}
          aria-label="终端"
        >
          <Icon name="terminal" />
        </button>
      )}
      <button
        className="rail-btn rail-action"
        onClick={onPalette}
        title={hint("命令面板", keyOf("view.palette"))}
        aria-label="命令面板"
      >
        <Icon name="command" />
      </button>
      <button
        className="rail-btn rail-action"
        onClick={onSettings}
        title={hint("设置", keyOf("view.settings"))}
        aria-label="设置"
      >
        <Icon name="settings" />
      </button>
    </nav>
  );
}
