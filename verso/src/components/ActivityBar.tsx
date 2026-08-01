import { keyLabel } from "../lib/platform";
import { Icon, type IconName } from "./Icon";

/** 侧栏当前显示哪个面板 */
export type SidebarView = "tree" | "search" | "tags" | "outline";

interface Props {
  view: SidebarView;
  onView: (v: SidebarView) => void;
  /** 侧栏是否展开。点当前已选中的图标会收起它 */
  sidebarOpen: boolean;
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  termOpen: boolean;
  onToggleTerm: () => void;
  onSystemTerminal: () => void;
  onPalette: () => void;
  onSettings: () => void;
}

const VIEWS: { id: SidebarView; icon: IconName; label: string; keys?: string }[] = [
  { id: "tree", icon: "tree", label: "文档树" },
  { id: "search", icon: "search", label: "搜索", keys: keyLabel("Mod+Shift+F") },
  { id: "tags", icon: "tag", label: "标签" },
  // 大纲是「当前这篇」的视图，排在三个跨文档视图后面
  { id: "outline", icon: "outline", label: "大纲", keys: keyLabel("Mod+Shift+O") },
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
  sidebarOpen,
  sourceMode,
  onToggleSourceMode,
  termOpen,
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
          title={v.keys ? `${v.label} (${v.keys})` : v.label}
          aria-label={v.label}
          aria-pressed={sidebarOpen && view === v.id}
        >
          <Icon name={v.icon} />
        </button>
      ))}

      <div className="rail-gap" />

      {/* 源码模式排在动作组的第一个：它作用于正文，比终端和设置更「靠近内容」。
          Obsidian 和 Typora 都给了这个开关一个常驻按钮 —— 只藏在快捷键和命令
          面板里的话，不知道它存在的人永远不会用到 */}
      <button
        className={`rail-btn rail-action${sourceMode ? " is-on" : ""}`}
        onClick={onToggleSourceMode}
        title={`源码模式 (${keyLabel("Mod+E")})`}
        aria-label="源码模式"
        aria-pressed={sourceMode}
      >
        <Icon name="code" />
      </button>
      <button
        className={`rail-btn rail-action${termOpen ? " is-on" : ""}`}
        onClick={onToggleTerm}
        onContextMenu={(e) => {
          // 右键改成调起独立的系统终端窗口（§7.3 方案 A）
          e.preventDefault();
          onSystemTerminal();
        }}
        title={`终端 (${keyLabel("Mod+`")})　右键：在系统终端中打开`}
        aria-label="终端"
      >
        <Icon name="terminal" />
      </button>
      <button
        className="rail-btn rail-action"
        onClick={onPalette}
        title={`命令面板 (${keyLabel("Mod+Shift+P")})`}
        aria-label="命令面板"
      >
        <Icon name="command" />
      </button>
      <button
        className="rail-btn rail-action"
        onClick={onSettings}
        title={`设置 (${keyLabel("Mod+,")})`}
        aria-label="设置"
      >
        <Icon name="settings" />
      </button>
    </nav>
  );
}
