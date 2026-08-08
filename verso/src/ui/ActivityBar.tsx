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
 * 竖排能排下十二个图标，390px 宽的一行排不下 —— 硬塞进去每个只剩 32px，
 * 又回到「看得见点不中」。所以横排时**只有视图组留在条上**（六个，各约
 * 55px，中间的命中区仍是一根手指），动作组收进最后那个 `⋯` 弹出的面板。
 *
 * 这个划分不是按使用频率拍的，是按语义：条上放的全是「侧栏显示什么」，
 * 于是选中态永远看得见 —— 把其中两个塞进弹出层的话，切到「标签」时整条
 * 栏上没有任何一处亮着，用户会以为没切成功。动作组反过来，本来就不带
 * 选中态（源码模式和导图除外，它们在面板里自己带勾）。
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
}: Props) {
  const bottom = layout === "bottom";
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
  const action = (
    key: string,
    icon: IconName,
    label: string,
    cmd: string | null,
    on: boolean | null,
    run: () => void,
    extra?: { disabled?: boolean; onContextMenu?: (e: React.MouseEvent) => void; title?: string },
  ) => (
    <button
      key={key}
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

  const actions = [
    // 源码模式排在动作组的第一个：它作用于正文，比终端和设置更「靠近内容」。
    // Obsidian 和 Typora 都给了这个开关一个常驻按钮 —— 只藏在快捷键和命令
    // 面板里的话，不知道它存在的人永远不会用到
    action("source", "code", "源码模式", "view.sourceMode", sourceMode, onToggleSourceMode),
    // 导图是「当前这篇」的另一种视图，紧挨着源码模式 —— 它俩是一类：
    // 都是把同一份内容换个样子看。只能靠快捷键进去的话，不知道它存在的人
    // 永远不会用到（§0：不能假设有键盘）
    action("mindmap", "mindmap", "思维导图", "note.mindmap", mindmapOn, onToggleMindmap, {
      disabled: mindmapOn === null,
    }),
    action("project", "project", "项目中心", "view.projects", projectOn, onToggleProject),
    ...(showTerm
      ? [
          action("term", "terminal", "终端", null, termOpen, onToggleTerm, {
            title: `${hint("终端", keyOf("term.toggle"))}　右键：在系统终端中打开`,
            onContextMenu: (e: React.MouseEvent) => {
              // 右键改成调起独立的系统终端窗口（§7.3 方案 A）
              e.preventDefault();
              onSystemTerminal();
            },
          }),
        ]
      : []),
    action("palette", "command", "命令面板", "view.palette", null, onPalette),
    action("settings", "settings", "设置", "view.settings", null, onSettings),
  ];

  return (
    <nav className={`rail${bottom ? " is-bottom" : ""}`} aria-label="侧栏视图">
      {VIEWS.map((v) => (
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
