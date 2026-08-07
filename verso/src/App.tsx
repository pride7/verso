import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { EditorState } from "@codemirror/state";

import { convertFileSrc } from "@tauri-apps/api/core";

import {
  api,
  onAppClosing,
  onBackendNotice,
  onVaultChanged,
  pickCloneFolder,
  pickVaultFolder,
} from "./api";
import { confirm } from "./lib/dialog";
import { fitFloatingMenu } from "./lib/floatingMenu";
import { NARROW, useMedia } from "./lib/media";
import { ActivityBar, type SidebarView } from "./components/ActivityBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Icon } from "./components/Icon";
import { Editor, type EditorHandle } from "./components/Editor";
import { OutlineFloat, OutlineView, useActiveHeading } from "./components/Outline";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { SearchView } from "./components/SearchView";
import { ConflictView } from "./components/ConflictView";
import { ReviewDialog } from "./components/ReviewDialog";
import { MoveTargetPicker } from "./components/MoveTargetPicker";
import { SettingsPanel, type Tab as SettingsTab } from "./components/SettingsPanel";
import { SymbolPanel } from "./components/SymbolPanel";
import { TagsView } from "./components/TagsView";
import { TerminalPanel, type TermDock } from "./components/TerminalPanel";
import { Tree } from "./components/Tree";
import { TabBar } from "./components/TabBar";
import { TemplatePicker } from "./components/TemplatePicker";
import { TemplatesView } from "./components/TemplatesView";
import { HistoryView, type DiffSelection } from "./components/HistoryView";
import { DiffView } from "./components/DiffView";
import { MathBar } from "./components/MathBar";
import { MindMap } from "./components/MindMap";
import { ProjectCenter } from "./components/ProjectCenter";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { VaultManager, VaultSwitcher, VaultWelcome } from "./components/VaultSwitcher";
import { SharedSpaceDialog } from "./components/SharedSpaceDialog";
import { JoinVaultDialog, type JoinVaultInput } from "./components/JoinVaultDialog";
import { ShareNoteDialog, type ShareNoteInput } from "./components/ShareNoteDialog";
import { setSlashAction } from "./editor/completion";
import type { TableOp } from "./editor/tableOps";
import { expandTemplate, pickTemplates } from "./lib/template";
import { journalInsert } from "./lib/journal";
import { ensureProjectStatusSchema, isProject, markAsProject } from "./lib/project";
import { sendToTerminal } from "./lib/termBus";
import { normalizeIcon, pushRecentIcon } from "./lib/emoji";
import { useUpdate } from "./lib/update";
import { IconPicker } from "./components/IconPicker";
import { parseHeadings, type Heading } from "./lib/outline";
import {
  activePath,
  closeOthers,
  closeTab,
  dropSubtree,
  EMPTY_TABS,
  gotoTab,
  moveTab,
  openTab,
  renameTab,
  stepTab,
  togglePin,
  type TabState,
} from "./lib/tabs";
import { attachmentPath } from "./lib/vaultPath";
import { reorderSiblings, sortTree, SORT_LABELS, type TreeSort } from "./lib/treeSort";
import { bindingOf, eventSpec, hint } from "./lib/keymap";
import { keyLabel } from "./lib/platform";
import {
  readSeenCommits,
  unreadCollaborationEntries,
  writeSeenCommits,
} from "./lib/collaboration";
import { useEffectiveTheme, useSettings } from "./settings";
import type {
  ConflictFile,
  FileChange,
  GitIdentity,
  GitHubAccount,
  GitStatus,
  HistoryEntry,
  NoteContent,
  RecentVault,
  RemoteInfo,
  NoteRef,
  SharePreview,
  SharedSpaceInfo,
  Suggestion,
  SyncOutcome,
  SyncResolution,
  TreeNode,
  VaultInfo,
} from "./types";
import "katex/dist/katex.min.css";
import "./styles.css";

const AUTOSAVE_MS = 800; // §2.7 保存策略

/** 侧栏默认宽度，和双击复位的目标值 */
const DEFAULT_SIDEBAR_W = 252;

/**
 * 侧栏宽度的上下限。
 *
 * 下限是「最短的文件名还看得出是什么」；上限按窗口的一半算而不是写死一个
 * 像素值 —— 小窗口里 480px 的侧栏会把正文挤没。
 */
function clampSidebar(w: number): number {
  const max = Math.max(200, Math.round(window.innerWidth / 2));
  return Math.min(Math.max(Math.round(w), 180), max);
}

type SaveState = "saved" | "dirty" | "saving" | "error";

interface Menu {
  node: TreeNode;
  x: number;
  y: number;
}

/** 文档树是嵌套的（§2.1），按路径找节点得先摊平 */
function flatten(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

/**
 * 正文字数。
 *
 * 用 `Array.from` 而不是 `.length`：后者数的是 UTF-16 码元，emoji 和一些
 * 生僻字会被算成两个。中日韩按**字符**数，西文按**词**数 —— 这是两种语言
 * 各自的习惯，混着数出来的数字对谁都没意义。
 */
export function countChars(text: string): number {
  const stripped = text
    .replace(/```[\s\S]*?```/g, "") // 代码块不算正文
    .replace(/\$\$[\s\S]*?\$\$/g, "") // 块级公式同理
    .replace(/!?\[\[[^\]]*\]\]/g, ""); // 链接与嵌入只留下它们的位置
  const cjk = stripped.match(/[一-鿿぀-ヿ가-힯]/g)?.length ?? 0;
  const words = stripped.replace(/[一-鿿぀-ヿ가-힯]/g, " ").match(/[A-Za-z0-9'’-]+/g)?.length ?? 0;
  return cjk + words;
}

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  /** 换库装载 workspace 的短窗口里，不能让旧标签被 effect 写进新仓库。 */
  const activatingVault = useRef(false);
  /** 这台设备记住的仓库。目录本身不在这里，只有快速入口（§2.1）。 */
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [vaultManagerOpen, setVaultManagerOpen] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [sharePreview, setSharePreview] = useState<SharePreview | null>(null);
  const [shareSpaces, setShareSpaces] = useState<SharedSpaceInfo[]>([]);
  const [managedSpace, setManagedSpace] = useState<SharedSpaceInfo | null>(null);
  const [githubAccount, setGitHubAccount] = useState<GitHubAccount | null>(null);
  const [githubChecking, setGitHubChecking] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  /** 非 null 时锁住所有仓库入口，避免两次打开并发替换后端的当前 vault。 */
  const [switchingVault, setSwitchingVault] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [noteList, setNoteList] = useState<NoteRef[]>([]);
  const [note, setNote] = useState<NoteContent | null>(null);
  const [body, setBody] = useState("");
  /**
   * 打开着的标签。`note` 始终是当前那一页的内容 —— 别的页不在内存里留正文，
   * 因为切页之前一定会先落盘（`openPath` 开头那句），没有未保存的东西要护。
   */
  const [tabState, setTabState] = useState<TabState>(EMPTY_TABS);
  const tabsRef = useRef(tabState);
  tabsRef.current = tabState;
  /**
   * 每一页离开时存下的编辑器状态：光标、选区、撤销历史。
   *
   * 放 ref 不放 state：它变了不该触发重渲染，而且 `EditorState` 是个不可变
   * 的大对象，进 state 只会让每次比较都白跑一趟。
   */
  const editorStates = useRef(new Map<string, EditorState>());
  /** 每一页的滚动位置。滚的是 `.main`，不是编辑器自己（见 styles.css） */
  const scrollTops = useRef(new Map<string, number>());
  const mainRef = useRef<HTMLElement | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  /**
   * 一句「做完了」的话，几秒后自己消失（同步用）。
   *
   * 和 `error` 分开：错误要留着等人处理，而「拿到 3 个版本」看一眼就够了 ——
   * 让人动手关掉一条好消息是多余的一步
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // 拖拽把排序方式从规则切成手动时提示一句。静悄悄地改一个下拉框的值，
  // 用户下次发现按名字排失效了会莫名其妙
  const [sortNotice, setSortNotice] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  // 侧栏显示哪个视图、以及展不展开。都跨会话保留 —— 收起侧栏是为了把
  // 编辑区拉宽，每次启动又弹回来就没意义了
  const [sidebarView, setSidebarView] = useState<SidebarView>(
    () => (localStorage.getItem("verso.sidebarView") as SidebarView | null) ?? "tree",
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("verso.sidebarOpen") !== "0",
  );
  /**
   * 窄屏（§6.1「移动」那一列）。侧栏在这里是抽屉，正文用满宽。
   *
   * `openPath` 是个长期存在的 callback，闭包里的 `narrow` 会过期 —— 和
   * `settingsRef` 同样的道理，读 ref 而不是读那个值
   */
  const narrow = useMedia(NARROW);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  /**
   * 跑在手机上吗。**和「窄屏」是两回事**：窄屏跟视口走（桌面拖窄也算），
   * 这个跟平台走 —— 决定的是「有没有目录选择器」这类平台能力。
   *
   * 用 ref 而不是 state：读它的地方是 `openVault` 那个长期存在的 callback
   */
  const [mobile, setMobile] = useState(false);
  const mobileRef = useRef(false);
  useEffect(() => {
    // 老后端没有这个命令时 invoke 是**同步抛**的，包住整个调用点
    try {
      void api
        .isMobile()
        .then((v) => {
          mobileRef.current = v;
          setMobile(v);
          // 移动端没有终端（§7.3：iOS/Android 没有可用的 PTY）。termOpen
          // 存在 localStorage，桌面上开过的状态不该在手机上把面板顶出来。
          // 用 Raw：只关这一次，不把「0」写回存储去覆盖用户在桌面的偏好
          if (v) setTermOpenRaw(false);
        })
        .catch(() => {});
    } catch {
      /* 桌面老版本：当作不是手机 */
    }
  }, []);
  /** 排序菜单开着没有。做成菜单而不是原生 select —— 后者在头部占一大截宽度 */
  const [sortMenu, setSortMenu] = useState(false);
  // 侧栏宽度。和终端高度一样记在 localStorage：调好一次就别再调第二次
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("verso.sidebarWidth"));
    return clampSidebar(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_SIDEBAR_W);
  });
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  /** 「移动到…」选择器正在为哪个节点服务。null = 没开。
      拖拽移动在触摸屏上完全不可用，这是它的可点击等价物（M6） */
  const [moveFor, setMoveFor] = useState<TreeNode | null>(null);
  /**
   * 模板选择器开着做什么：插进当前笔记，还是用它新建一篇（`parent` 是父文档）。
   * null = 没开。
   */
  const [templateFor, setTemplateFor] = useState<
    null | { mode: "insert" } | { mode: "new"; parent: string | null }
  >(null);
  /** 思维导图铺在正文上（§4.7）。它不是浮层，是同一篇笔记的另一种编辑视图 */
  const [mindmapOpen, setMindmapOpen] = useState(false);
  /** 一屏项目总览；正文编辑器仍留在 DOM 中，退出时光标和撤销历史都还在。 */
  const [projectOpen, setProjectOpen] = useState(false);
  /** 跨笔记的项目中心；从这里进入某一张项目卡，才下钻到单项目总览。 */
  const [projectCenterOpen, setProjectCenterOpen] = useState(false);
  /**
   * §2.8 的只读差异页。它不进标签状态：这是在检查一次改动，不是一篇文档。
   * null 就显示原笔记。
   */
  const [diffSelection, setDiffSelection] = useState<DiffSelection | null>(null);
  const diffReturnScroll = useRef<number | null>(null);
  /**
   * 图标选择器开在哪篇笔记上（§2.3 的 frontmatter `icon`）。null = 没开。
   *
   * `at` 是弹出坐标；命令面板那条入口没有可以贴的坐标，给 null 就居中弹
   */
  const [iconFor, setIconFor] = useState<null | {
    path: string;
    at: { x: number; y: number } | null;
  }>(null);
  /** 正在树里就地改名的那个路径。新建文档之后立刻进这个状态 */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 设置打开时停在哪一页。状态栏那个「有新版本」要能直接跳到「更新」 */
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const editorRef = useRef<EditorHandle | null>(null);
  /** 命令表的最新一份。全局快捷键从这里查，监听器就不必跟着命令表重装 */
  const commandsRef = useRef<Command[]>([]);
  const { settings, update: updateSettings, reset: resetSettings } = useSettings();
  const effectiveTheme = useEffectiveTheme(settings.theme);
  /** vault 内容变化的版本号。反向链接等派生视图靠它重查 */
  const [revision, setRevision] = useState(0);
  /**
   * 工作区最后一次活动。`git.dirty` 只记录数量，同一篇被连续改十次仍然是 1；
   * 自动记录的空闲计时必须看这份活动序号，不能只看文件数。
   */
  const [gitActivity, setGitActivity] = useState(0);
  const [termOpen, setTermOpenRaw] = useState(
    () => localStorage.getItem("verso.termOpen") === "1",
  );
  /** 面板开关状态跨会话保留 —— 关掉的人不想每次启动又见到它 */
  const setTermOpen = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setTermOpenRaw((prev) => {
      const v = typeof next === "function" ? next(prev) : next;
      localStorage.setItem("verso.termOpen", v ? "1" : "0");
      return v;
    });
  }, []);
  // 面板高度记在 localStorage —— 调好一次就别再调第二次。
  // vault 级的 UI 状态（§2.1 workspace.json）等 M3 有配置系统了再搬过去。
  const [termHeight, setTermHeight] = useState(() => {
    const saved = Number(localStorage.getItem("verso.termHeight"));
    return Number.isFinite(saved) && saved >= 120 ? saved : 280;
  });
  /**
   * 终端吸底还是靠右（§7.3）。跑 AI CLI 时那条会话流吃的是竖向空间，
   * 靠右分栏才看得下去。
   */
  const [termDock, setTermDock] = useState<TermDock>(() =>
    localStorage.getItem("verso.termDock") === "right" ? "right" : "bottom",
  );
  /**
   * 靠右时的宽度。**和高度分开存** —— 「面板高 280」和「分栏宽 280」之间
   * 没有可比性，共用一个数的话每切一次停靠都要重调一遍。
   */
  const [termWidth, setTermWidth] = useState(() => {
    const saved = Number(localStorage.getItem("verso.termWidth"));
    return Number.isFinite(saved) && saved >= 260 ? saved : 460;
  });
  /**
   * 实际用哪个方向。窄屏强制吸底 —— 左右分栏在窄窗口上等于把正文压成一条缝；
   * 但**存下来的偏好不动**，窗口拉宽回来靠右还在（§7.3）。
   */
  const termDockEffective: TermDock = narrow ? "bottom" : termDock;
  const toggleTermDock = useCallback(() => {
    setTermDock((v) => {
      const next = v === "bottom" ? "right" : "bottom";
      localStorage.setItem("verso.termDock", next);
      return next;
    });
  }, []);
  /**
   * §7.6 把上下文送进终端。终端没开就先开 —— PTY 起来要几十毫秒，这段窗口里
   * `termBus` 会替我们把文本排着队，就绪时补发，所以这里不用等。
   */
  const sendToTerm = useCallback(
    (text: string) => {
      setTermOpen(true);
      sendToTerminal(text);
    },
    [setTermOpen],
  );

  /** 浮动大纲开不开。和终端面板一样跨会话保留 —— 嫌它挡事的人不想每次启动再关一遍 */
  const [tocFloat, setTocFloat] = useState(() => localStorage.getItem("verso.tocFloat") !== "0");
  const toggleTocFloat = useCallback(() => {
    setTocFloat((v) => {
      localStorage.setItem("verso.tocFloat", v ? "0" : "1");
      return !v;
    });
  }, []);

  /**
   * 源码模式：摘掉全部 live preview 装饰，直接看 Markdown 源码。
   *
   * 是**全局**开关不是每篇一个 —— 切进源码模式通常是为了做一件事（改一段
   * 表格、抠一个链接、看 AI 到底写了什么），做完就切回来。每篇记一个状态的话，
   * 过两天打开某篇笔记发现它"坏了"，其实只是上次忘了切回来。
   */
  const [sourceMode, setSourceMode] = useState(
    () => localStorage.getItem("verso.sourceMode") === "1",
  );
  const toggleSourceMode = useCallback(() => {
    setSourceMode((v) => {
      localStorage.setItem("verso.sourceMode", v ? "0" : "1");
      return !v;
    });
  }, []);

  // 大纲跟着**正文**走而不是跟着磁盘上的文件走：新敲的标题必须立刻出现在
  // 大纲里，等自动保存那 800ms 才更新的话，它就成了个滞后的东西
  const headings = useMemo(() => parseHeadings(body), [body]);
  const activeHeadingIdx = useActiveHeading(headings, editorRef);
  const gotoHeading = useCallback((h: Heading) => editorRef.current?.gotoLine(h.line), []);

  // 「磁盘上这份文件最后一次由我们写入时的 mtime」。
  // 放 ref 不放 state：焦点事件的闭包里要读最新值，state 会拿到旧值。
  const savedMtime = useRef<number>(0);
  const bodyRef = useRef(body);
  const noteRef = useRef(note);
  const dirtyRef = useRef(false);
  // `[[` 补全通过 getter 读它 —— 清单变化时不必重建编辑器
  const noteListRef = useRef<NoteRef[]>([]);
  // 设置放 ref：失焦那个监听器只装一次，闭包里读 state 会永远拿到初值
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  bodyRef.current = body;
  noteRef.current = note;
  dirtyRef.current = saveState === "dirty";
  noteListRef.current = noteList;

  /**
   * 点侧栏图标。点当前那个 = 收起侧栏（VS Code 的行为），点别的 = 切过去。
   *
   * 搜索视图要顺手把焦点给输入框 —— 它是常驻面板，不能像弹窗那样自动
   * 抢焦点（会把正在正文里打字的人踢出去），所以只在**主动切过去**时聚焦。
   */
  const pickView = useCallback(
    (v: SidebarView) => {
      const closing = sidebarOpen && v === sidebarView;
      setSidebarOpen(!closing);
      setSidebarView(v);
      localStorage.setItem("verso.sidebarOpen", closing ? "0" : "1");
      localStorage.setItem("verso.sidebarView", v);
      if (!closing && v === "search") {
        // 等这一轮渲染把面板挂上去
        requestAnimationFrame(() =>
          document.getElementById("verso-search-input")?.focus(),
        );
      }
    },
    [sidebarOpen, sidebarView],
  );

  const refresh = useCallback(async () => {
    try {
      const [t, list] = await Promise.all([api.tree(), api.listNotes()]);
      setTree(t);
      setNoteList(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refreshRecentVaults = useCallback(async () => {
    try {
      setRecentVaults(await api.recentVaults());
    } catch {
      // 老后端没有这条命令时继续沿用单仓库界面；快捷入口不该让应用启动失败。
      setRecentVaults([]);
    }
  }, []);

  /**
   * 排序后的树。原始树保持 Rust 给的顺序，排序只影响显示 ——
   * 唯一会写文件的是手动排序，那是用户显式拖拽触发的
   */
  const sortedTree = useMemo(() => sortTree(tree, settings.treeSort), [tree, settings.treeSort]);

  /**
   * 路径 → 文档图标。标签栏和快速切换器都按路径查，摊平成一张表最省事。
   *
   * 树本身用 `node.icon`，不走这张表 —— 那边已经拿着节点了。
   */
  const iconMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of tree.flatMap(flatten)) {
      const ch = n.icon ? normalizeIcon(n.icon) : null;
      if (ch) out[n.path] = ch;
    }
    return out;
  }, [tree]);


  /** 立即落盘。切笔记、失焦、Ctrl+S 都走这里。 */
  const saveNow = useCallback(async () => {
    const n = noteRef.current;
    if (!n) return true;
    try {
      setSaveState("saving");
      savedMtime.current = await api.writeNote(n.path, bodyRef.current);
      dirtyRef.current = false;
      setSaveState("saved");
      setExternalChange(false);
      setGitActivity((v) => v + 1);
      return true;
    } catch (e) {
      setSaveState("error");
      setError((e as Error).message);
      return false;
    }
  }, []);

  /**
   * 源码模式里手改的 frontmatter 落盘。
   *
   * **先把正文冲掉再写。** 两条写入路径各写文件的一半，都是「读文件 → 换掉
   * 自己那一半 → 整篇写回」；同时飞的话，后写的那个是拿改动前的另一半算出来的，
   * 会把先写的那次盖掉。串起来就没有这个缝。
   *
   * 写完重读一遍：Rust 会补上 `updated:` 时间戳、把键序规整一遍，界面上得
   * 是文件里真实的样子。YAML 没通过解析时 `writeFrontmatter` 抛错、文件没被动，
   * 错误交给输入框自己显示 —— 那里离出错的地方最近。
   */
  const saveFrontmatter = useCallback(
    async (yaml: string) => {
      const n = noteRef.current;
      if (!n) return;
      if (dirtyRef.current) await saveNow();
      savedMtime.current = await api.writeFrontmatter(n.path, yaml);
      const content = await api.readNote(n.path);
      setNote(content);
      await refresh();
      setRevision((v) => v + 1);
    },
    [saveNow, refresh],
  );

  /**
   * 粘贴进来的图片存进 vault（§4.3）。返回相对路径，编辑器据此插入 `![[]]`。
   */
  const saveImage = useCallback(
    (name: string, dataBase64: string) => api.writeAttachment(name, dataBase64),
    [],
  );

  /**
   * `![[图.png]]` 的目标名 → webview 能显示的 URL。
   *
   * 本地文件必须过 Tauri 的 asset 协议（`convertFileSrc`）。路径怎么拼见
   * `lib/vaultPath.ts` —— Windows 上 vault 根是扩展长度写法（`\\?\D:\…`），
   * 照着直接拼出来的 URL 协议那边解析不了，表现是「图片找不到」而文件明明在。
   */
  const imageSrc = useCallback(
    (target: string) => {
      const abs = vault && attachmentPath(vault.root, target);
      return abs ? convertFileSrc(abs) : null;
    },
    [vault],
  );

  /** 一页不再开着了：它的编辑器状态和滚动位置都没有留着的理由 */
  const forgetTab = useCallback((path: string) => {
    editorStates.current.delete(path);
    scrollTops.current.delete(path);
  }, []);

  /**
   * 把某一页的内容读进来并显示。**只管内容，不碰标签**。
   *
   * 拆成两半是因为「换标签」和「换内容」不总是一起发生：关掉一页之后要显示
   * 邻居的内容，但那不是一次「打开」；重启恢复时标签是一次性摆好的。
   */
  const loadNote = useCallback(async (path: string) => {
    try {
      const content = await api.readNote(path);
      setDiffSelection(null);
      diffReturnScroll.current = null;
      setNote(content);
      setBody(content.body);
      const project = isProject(content);
      setProjectOpen(project);
      if (project) setMindmapOpen(false);
      savedMtime.current = content.mtimeMs;
      setSaveState("saved");
      setExternalChange(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** 打开差异之前先落盘，否则“当前改动”会漏掉最后 800ms 里打的字。 */
  const openDiff = useCallback(
    async (selection: DiffSelection) => {
      if (dirtyRef.current) await saveNow();
      if (!diffSelection && mainRef.current) diffReturnScroll.current = mainRef.current.scrollTop;
      setMindmapOpen(false);
      setDiffSelection(selection);
      if (narrowRef.current) setSidebarOpen(false);
      setProjectCenterOpen(false);
      setProjectOpen(false);
      requestAnimationFrame(() => {
        if (mainRef.current) mainRef.current.scrollTop = 0;
      });
    },
    [diffSelection, saveNow],
  );

  const closeDiff = useCallback(() => {
    const top = diffReturnScroll.current ?? 0;
    diffReturnScroll.current = null;
    setDiffSelection(null);
    // 原编辑器要等这一轮渲染才重新挂上；同一篇 note 的 path 没变，下面那条
    // “换页恢复滚动”的 effect 不会跑，所以在这里单独放回去。
    requestAnimationFrame(() => {
      if (mainRef.current) mainRef.current.scrollTop = top;
    });
  }, []);

  /**
   * 打开一篇笔记。
   *
   * `newTab` 明确给了就听它的（Ctrl/⌘+点、中键），否则按设置里的
   * 「点文件时开新标签还是替换当前」。已经开着的那一篇总是切过去。
   */
  const openPath = useCallback(
    async (path: string, opts?: { newTab?: boolean }) => {
      // 窄屏上侧栏是**盖在正文上的抽屉**：点开一篇之后自己收起来。
      // 不收的话用户还得再关一次，而他刚才那一下表达的正是「我要看这一篇」
      if (narrowRef.current) setSidebarOpen(false);
      // 项目中心是跨笔记的上一层。点卡片已经明确表达「进入这个项目」，
      // 即使这篇恰好就在当前标签里，也必须先撤掉中心，才能露出单项目总览。
      setProjectCenterOpen(false);
      setProjectOpen(false);
      if (noteRef.current && dirtyRef.current) await saveNow();
      // 离开当前页之前记下滚动位置，切回来时还在原处
      const leaving = activePath(tabsRef.current);
      if (leaving && mainRef.current) scrollTops.current.set(leaving, mainRef.current.scrollTop);

      const mode = (opts?.newTab ?? settings.tabOpen === "new") ? "new" : "replace";
      const next = openTab(tabsRef.current, path, mode);
      // 替换模式下被顶掉的那一页，缓存也跟着丢 —— 留着只会占内存，
      // 而且下次它再被打开时，文件很可能已经变了
      if (mode === "replace") {
        const dropped = tabsRef.current.tabs[tabsRef.current.active];
        if (dropped && !next.tabs.includes(dropped)) forgetTab(dropped);
      }
      tabsRef.current = next;
      setTabState(next);
      await loadNote(path);
    },
    [saveNow, loadNote, settings.tabOpen, forgetTab],
  );

  /**
   * 换到另一组标签状态，并把当前页的内容跟上。
   *
   * 切换、关闭、快捷键全走这一条 —— 它们的差别只在于怎么算出那个新状态，
   * 而「先存盘、记滚动位置、再载入新页」这套流程是共用的。
   */
  const applyTabs = useCallback(
    async (next: TabState) => {
      const before = activePath(tabsRef.current);
      const after = activePath(next);
      tabsRef.current = next;
      setTabState(next);

      if (before === after) return;
      if (before) {
        if (dirtyRef.current) await saveNow();
        if (mainRef.current) scrollTops.current.set(before, mainRef.current.scrollTop);
      }
      if (after) {
        await loadNote(after);
      } else {
        // 一个都不剩了。回到空状态，别留着最后那篇的内容假装还开着
        setNote(null);
        setBody("");
        setSaveState("saved");
      }
    },
    [saveNow, loadNote],
  );

  const closeTabAt = useCallback(
    (i: number) => {
      const path = tabsRef.current.tabs[i];
      if (path) forgetTab(path);
      void applyTabs(closeTab(tabsRef.current, i));
    },
    [applyTabs, forgetTab],
  );

  const closeOtherTabs = useCallback(
    (i: number) => {
      const keep = tabsRef.current.tabs[i];
      for (const p of tabsRef.current.tabs) if (p !== keep) forgetTab(p);
      void applyTabs(closeOthers(tabsRef.current, i));
    },
    [applyTabs, forgetTab],
  );

  /**
   * 打开 vault 之后恢复上次的标签。
   *
   * `fallback` 是 `recent.json` 里记的「上次那篇」—— 给从旧版本升上来的人用：
   * 那时还没有 workspace.json，只有一篇笔记的记录。
   */
  const restoreTabs = useCallback(
    async (fallback?: string | null) => {
      let ws = EMPTY_TABS;
      try {
        ws = await api.workspaceGet();
      } catch {
        /* 读不到就当没开过标签，见 workspace.rs */
      }
      if (ws.tabs.length === 0 && fallback) ws = { tabs: [fallback], active: 0, pinnedCount: 0 };

      editorStates.current.clear();
      scrollTops.current.clear();
      tabsRef.current = ws;
      setTabState(ws);

      const path = activePath(ws);
      if (path) await loadNote(path);
      else {
        setNote(null);
        setBody("");
      }
    },
    [loadNote],
  );

  /**
   * 标签一变就落盘。
   *
   * 不做防抖：开关标签本来就不密集，而且这份状态的全部意义就是「下次启动
   * 回到原处」—— 崩溃时丢掉最后一次操作会比多写几次文件更让人恼火。
   */
  useEffect(() => {
    if (!vault || activatingVault.current) return;
    // try/catch 包住整个调用而不是只 .catch()：这一条**存不下也不该拦住任何
    // 事**，而同步抛出的错（比如后端还没起来）会直接把整个 App 打掉
    try {
      void Promise.resolve(api.workspaceSet(tabState)).catch(() => {});
    } catch {
      /* 界面状态存不下不值得打扰用户 */
    }
  }, [tabState, vault]);

  /**
   * 只改标签上的**路径**，不换页也不重新载入。
   *
   * 重命名和移动走这条：那一页显示的还是同一篇笔记，只是它换了个位置。
   * 走 `applyTabs` 的话会因为「当前路径变了」白载入一次。
   */
  const retagTabs = useCallback((fn: (s: TabState) => TabState) => {
    const next = fn(tabsRef.current);
    // 缓存是按路径存的，路径变了得跟着搬，否则切回来时那份撤销历史就丢了
    const remap = new Map<string, string>();
    tabsRef.current.tabs.forEach((old, i) => {
      if (next.tabs[i] && next.tabs[i] !== old) remap.set(old, next.tabs[i]);
    });
    for (const [from, to] of remap) {
      const st = editorStates.current.get(from);
      if (st) {
        editorStates.current.set(to, st);
        editorStates.current.delete(from);
      }
      const top = scrollTops.current.get(from);
      if (top !== undefined) {
        scrollTops.current.set(to, top);
        scrollTops.current.delete(from);
      }
    }
    tabsRef.current = next;
    setTabState(next);
  }, []);

  /** 后端已经换好 vault 后，把所有前端的 per-vault 状态一起接过去。 */
  const activateVault = useCallback(
    async (info: VaultInfo, fallback?: string | null) => {
      activatingVault.current = true;
      try {
        setVault(info);
        setNote(null);
        setBody("");
        setDiffSelection(null);
        setExternalChange(false);
        setError(null);
        await refresh();
        // 标签、编辑器历史与滚动位置都是 per-vault，绝不能从上一个库带过来。
        await restoreTabs(fallback);
        await refreshRecentVaults();
      } finally {
        activatingVault.current = false;
      }
    },
    [refresh, restoreTabs, refreshRecentVaults],
  );

  /**
   * 换页之后把滚动位置放回去。
   *
   * 等一帧：这一刻编辑器刚挂上，`.main` 的 scrollHeight 还没算出来，
   * 直接写 scrollTop 会被夹成 0。
   */
  useEffect(() => {
    const el = mainRef.current;
    if (!el || !note) return;
    const top = scrollTops.current.get(note.path) ?? 0;
    const id = requestAnimationFrame(() => {
      el.scrollTop = top;
    });
    return () => cancelAnimationFrame(id);
  }, [note?.path]);

  /**
   * 新建文档：**先建出来，再就地改名**。
   *
   * 以前是先弹一个 `window.prompt` 问名字。那个弹窗最难受的地方不是丑，是它
   * 把顺序搞反了 —— 逼着人在还没开始写之前先想好标题，而标题往往是写完才
   * 定得下来的。现在建一篇「未命名」，光标落在树里那个名字上：想好了就敲，
   * 没想好按 Esc 走人，文档已经在那儿了。Obsidian 和思源都是这个路子。
   */
  const createAndOpen = useCallback(
    async (parentDoc: string | null, opts?: { newTab?: boolean }) => {
      try {
        const meta = await api.createUntitled(parentDoc);
        await refresh();
        await openPath(meta.path, opts);
        setRenaming(meta.path);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, openPath],
  );

  const createProjectAndOpen = useCallback(async () => {
    try {
      await ensureProjectStatusSchema(api, ["进行中"]);
      const meta = await api.createUntitled(null);
      await api.propSet(meta.path, "type", "project");
      await api.propSet(meta.path, "status", "进行中");
      await refresh();
      await openPath(meta.path);
      setRenaming(meta.path);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [openPath, refresh]);

  /**
   * 改名交回来了。空、或者没改，都当作放弃 —— 不去调后端，也就不会因为
   * 「新名字和旧名字一样」收到一句「已存在同名文档」。
   */
  const submitRename = useCallback(
    async (path: string, title: string) => {
      setRenaming(null);
      const name = title.trim();
      const old = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
      if (!name || name === old) return;
      try {
        const newPath = await api.renameNote(path, name);
        await refresh();
        // 开着的标签跟着改路径 —— 连同子树，重命名 `X.md` 时 `X/` 底下那些
        // 也全变了，不跟的话它们会指向不存在的文件
        retagTabs((s) => renameTab(s, path, newPath));
        // 改的正是当前打开的这篇，就跟着切到新路径，否则后续保存会写到旧路径
        if (noteRef.current?.path === path) await loadNote(newPath);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, loadNote, retagTabs],
  );

  // ---------------------------------------------------------------- 模板（§4.6）

  /** 模板就是模板目录下的普通 `.md`，从已有的笔记清单里挑，不另开一条 IPC */
  const templates = useMemo(
    () => pickTemplates(noteList, settings.templateDir),
    [noteList, settings.templateDir],
  );

  /** 模板面板里直接新建。目录不存在也由后端一起建好，再在原地改名。 */
  const createTemplate = useCallback(async () => {
    const dir = settingsRef.current.templateDir;
    if (!dir.trim()) return;
    try {
      const meta = await api.createTemplate(dir);
      await refresh();
      await openPath(meta.path);
      setRenaming(meta.path);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refresh, openPath]);

  /** 读一个模板并展开变量。`title`/`path` 按**目标笔记**算，不是模板自己 */
  const renderTemplate = useCallback(
    async (tplPath: string, target: { title: string; path: string }) => {
      const tpl = await api.readNote(tplPath);
      return expandTemplate(tpl.body, {
        ...target,
        selection: editorRef.current?.selectedText() ?? "",
        now: new Date(),
      });
    },
    [],
  );

  const insertTemplate = useCallback(
    async (tplPath: string) => {
      const cur = noteRef.current;
      if (!cur) return;
      try {
        const { text, cursor } = await renderTemplate(tplPath, {
          title: cur.title,
          path: cur.path,
        });
        editorRef.current?.insert(text, cursor ?? undefined);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [renderTemplate],
  );

  /**
   * 用模板新建一篇。
   *
   * 建的仍然是一篇「未命名」并进改名态 —— 和普通新建同一条路径（v0.5.22
   * 那条：别在写之前先逼人想标题）。模板只决定内容。
   *
   * 正文和 frontmatter **分两次写**：它们在 Rust 侧是两条各写各的路径
   * （§4.2），各自都会从磁盘读另一半，顺序无所谓，但不能塞进一次调用。
   */
  const createFromTemplate = useCallback(
    async (tplPath: string, parentDoc: string | null) => {
      try {
        const meta = await api.createUntitled(parentDoc);
        const { text } = await renderTemplate(tplPath, {
          title: meta.title,
          path: meta.path,
        });
        await api.writeNote(meta.path, text);
        // 模板自己的 frontmatter 也带过去 —— 「读书笔记」这类模板的价值
        // 一半在那几个属性上（status、评分、作者）
        const tpl = await api.readNote(tplPath);
        if (tpl.frontmatterText) await api.writeFrontmatter(meta.path, tpl.frontmatterText);
        await refresh();
        await openPath(meta.path);
        setRenaming(meta.path);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [renderTemplate, refresh, openPath],
  );

  // ---------------------------------------------------------------- 版本历史（§2.8）
  //
  // M5 的第一块：**只做本地提交**，不碰远端也不处理冲突。有了逐次提交，
  // 用 AI 改完一整篇也能一眼 diff、一键回退 —— 那是这个软件最容易丢数据的
  // 路径（§7.4）。

  const [git, setGit] = useState<GitStatus | null>(null);
  /** §2.8 配的远端。null = 没打开 vault 或者后端不支持 */
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  /** 这个远端存过令牌没有。**令牌本身永远不到前端** */
  const [tokenSaved, setTokenSaved] = useState(false);
  /** 提交署名。null = 没打开 vault 或者后端不支持 */
  const [identity, setIdentity] = useState<GitIdentity | null>(null);
  /** 尚未看过的其他人修改；只影响协作入口上的小点，不是共享数据。 */
  const [collaborationUnread, setCollaborationUnread] = useState(0);
  /** 正在同步。同步要走网络，可能要好几秒 */
  const [syncing, setSyncing] = useState(false);
  /** 同步撞上的冲突。非 null 时弹 ConflictView，选完边重放同步（§2.8） */
  const [conflicts, setConflicts] = useState<ConflictFile[] | null>(null);
  /** 正在看的修改建议，以及冲突面板重放时必须保留的建议上下文。 */
  const [reviewing, setReviewing] = useState<Suggestion | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewConflict, setReviewConflict] = useState<{ id: string; accepted: string[] } | null>(null);
  /** 正在提交。挡住重入：自动提交和手动点可能撞在一起 */
  const committing = useRef(false);

  const refreshGit = useCallback(() => {
    // **用 try 包住而不是只挂 .catch**：命令不存在时（老版本的后端、
    // 或者测试里的桩）是**同步抛**的，那会让整个 App 崩在这一句上。
    // 这只是状态栏上的一个点，不该有这种权力（和 DatabaseView 读 schema
    // 那处是同一个坑）
    try {
      void api.gitStatus().then(setGit).catch(() => setGit(null));
    } catch {
      setGit(null);
    }
  }, []);

  /** 远端配置。和 `refreshGit` 一样要防同步抛 —— 老后端没有这个命令 */
  const refreshRemote = useCallback(() => {
    try {
      void api
        .syncRemoteGet()
        .then((r) => {
          setRemote(r);
          if (r.url) void api.syncTokenHas(r.url).then(setTokenSaved).catch(() => {});
          else setTokenSaved(false);
        })
        .catch(() => setRemote(null));
    } catch {
      setRemote(null);
    }
    // 独立的 try：署名取不到只该让署名显示为空，不能连远端配置一起打断
    try {
      void api.gitIdentityGet().then(setIdentity).catch(() => setIdentity(null));
    } catch {
      setIdentity(null);
    }
  }, []);

  /**
   * 提交一次。
   *
   * **先把正文冲盘再提交** —— 不然刚敲的那几行还在内存里，提交上去的是
   * 上一版，而状态栏立刻显示「已提交」，最误导。
   */
  const commitNow = useCallback(
    async (message?: string) => {
      if (committing.current) return false;
      committing.current = true;
      try {
        // 外部 AI 改了文件、编辑器自己却是干净的情况下绝不能先保存：那会拿
        // 内存里的旧正文盖掉 AI 的修改。只有最后 800ms 的键入还没落盘才冲盘。
        if (dirtyRef.current && !(await saveNow())) return false;
        await api.gitCommit(message);
        // 反馈就是状态栏那个点自己变成「已记录」—— 再弹一个提示条是噪音，
        // 而这件事本来就该悄悄发生
        refreshGit();
        // 历史侧栏同时要把「当前改动」清掉，并把刚记的版本放到最上面。
        setRevision((v) => v + 1);
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        committing.current = false;
      }
    },
    [saveNow, refreshGit],
  );

  /**
   * 把某篇笔记回退到某一版。
   *
   * **先问一句**：这会覆盖当前内容。虽然后端在回退前会把现状先记一个版本
   * （所以什么都丢不了），但那是「事后能找回来」，不是「本来就没事」——
   * 覆盖正文这种事该由人点头。
   */
  const restoreFile = useCallback(
    async (commit: string, path: string) => {
      const name = path.replace(/\.md$/, "");
      const ok = await confirm(`把「${name}」恢复成这一版的内容？

当前内容会先被记成一个版本，随时能再退回来。`);
      if (!ok) return;
      try {
        await api.gitRestoreFile(commit, path);
        await refresh();
        setRevision((v) => v + 1);
        // 正在看的就是这一篇的话，把编辑器里那份也换掉
        if (noteRef.current?.path === path) await loadNote(path);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, loadNote],
  );

  /** 撤销一项尚未记录的改动。和历史回退不同，这一步没有自动备份，必须确认。 */
  const discardWorkingFile = useCallback(
    async (file: FileChange) => {
      const name = file.path.replace(/\.md$/, "");
      const deleting = file.kind === "added";
      const ok = await confirm(
        deleting
          ? `删除尚未记录的新文件「${name}」？\n\n这个文件还没有进入版本记录，删除后无法从历史中找回。`
          : `撤销「${name}」尚未记录的改动？\n\n文件会恢复到最近一次版本记录，未记录的内容会丢失。`,
      );
      if (!ok) return;

      try {
        const isCurrent = noteRef.current?.path === file.path;
        // 撤销当前页包含“放弃内存里还没落盘的字”。先把 dirty ref 压掉，
        // 否则删标签时 applyTabs 会按正常离页流程把它重新写回来。
        if (isCurrent) {
          dirtyRef.current = false;
          setSaveState("saved");
        }
        await api.gitDiscardFile(file.path);
        if (diffSelection?.commit === null && diffSelection.path === file.path) {
          setDiffSelection(null);
          diffReturnScroll.current = null;
        }

        if (deleting) {
          forgetTab(file.path);
          const tabIndex = tabsRef.current.tabs.indexOf(file.path);
          if (tabIndex >= 0) await applyTabs(closeTab(tabsRef.current, tabIndex));
        } else if (isCurrent) {
          await loadNote(file.path);
        }

        await refresh();
        refreshGit();
        setGitActivity((v) => v + 1);
        setRevision((v) => v + 1);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [applyTabs, diffSelection, forgetTab, loadNote, refresh, refreshGit],
  );

  // 报完就散。挂在 notice 上而不是在 setNotice 那处 setTimeout：
  // 连着同步两次时，后一句的计时会覆盖前一句，而不会被前一句的定时器提前抹掉
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // 打开 vault 后先问一次，之后每次内容活动也跟着更新。`revision` 管树和索引，
  // `gitActivity` 还覆盖「同一文件连续改写但改动数量没变」的情况。
  // vault 可能还没打开（首屏是「选个目录」），那时不问
  useEffect(refreshGit, [refreshGit, vault?.root, revision, gitActivity]);
  // 远端只跟着 vault 变 —— 它不会因为改了一篇笔记而变
  useEffect(refreshRemote, [refreshRemote, vault?.root]);

  // 协作动态直接来自现有版本历史。第一次启用只建立基线，不把几年的旧记录
  // 一股脑标成未读；之后只数没看过且不是自己的提交。
  useEffect(() => {
    if (!vault?.root || !remote?.url) {
      setCollaborationUnread(0);
      return;
    }
    let alive = true;
    const load = () => {
      try {
        return api.gitHistory(100).catch(() => [] as HistoryEntry[]);
      } catch {
        return Promise.resolve([] as HistoryEntry[]);
      }
    };
    void load().then((entries) => {
      if (!alive) return;
      const seen = readSeenCommits(vault.root);
      if (seen === null) writeSeenCommits(vault.root, entries);
      setCollaborationUnread(unreadCollaborationEntries(entries, seen, identity).length);
    });
    return () => {
      alive = false;
    };
  }, [vault?.root, remote?.url, identity, revision, gitActivity]);

  const markCollaborationSeen = useCallback(
    (entries: HistoryEntry[]) => {
      if (!vault?.root) return;
      writeSeenCommits(vault.root, entries);
      setCollaborationUnread(0);
    },
    [vault?.root],
  );

  /**
   * 同步一次。§2.8
   *
   * 结果只报一句话，报完就散 —— 「拉下来 3 个、推上去 1 个」这种话看一眼
   * 就够了，留在界面上反而要人动手关掉。**只有冲突留着**：那是需要人去
   * 处理的事，一闪而过等于没说。
   */
  /** 同步结果的统一收尾：冲突弹面板，其余报一句话就散 */
  const handleSyncOutcome = useCallback(
    async (out: SyncOutcome) => {
      if (out.conflicts.length > 0) {
        setConflicts(out.conflicts);
      } else {
        setConflicts(null);
        const bits = [];
        if (out.pulled > 0) bits.push(`拿到 ${out.pulled} 个版本`);
        if (out.pushed > 0) bits.push(`传出 ${out.pushed} 个版本`);
        setNotice(bits.length ? bits.join("，") : "已经是最新的");
      }

      // 同步改了磁盘上正打开的这篇（拉取和冲突定稿都算）时，直接换成
      // 磁盘版，**不要**弹「文件已被外部程序修改」—— 拉哪边的决定用户
      // 刚在同步/冲突面板里做过，再问一次是重复，而且那条横幅上的
      // 「保留我的」会把刚被否掉的旧内容救活，等于白解决一轮。
      // 只在没有新的未保存输入时换：同步跑着的几秒里用户还在打字的话，
      // 静默覆盖会丢字，那种罕见情况留给横幅去问。
      const cur = noteRef.current;
      if (cur && !dirtyRef.current) {
        try {
          if ((await api.statNote(cur.path)) !== savedMtime.current) {
            const content = await api.readNote(cur.path);
            setNote(content);
            setBody(content.body);
            savedMtime.current = content.mtimeMs;
            setSaveState("saved");
            setExternalChange(false);
          }
        } catch {
          // 这篇可能被同步删掉了 —— 树的刷新会把它收走，这里不报
        }
      }

      refreshGit();
      await refresh();
      setRevision((v) => v + 1);
    },
    [refreshGit, refresh],
  );

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      if (dirtyRef.current && !(await saveNow())) return;
      await handleSyncOutcome(await api.vaultSync());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [syncing, saveNow, handleSyncOutcome]);

  /** Git 在后台换过正式内容后，把树、当前页和动态一起对齐。 */
  const refreshAfterReview = useCallback(async () => {
    refreshGit();
    await refresh();
    setRevision((value) => value + 1);
    const cur = noteRef.current;
    if (!cur || dirtyRef.current) return;
    try {
      const content = await api.readNote(cur.path);
      setNote(content);
      setBody(content.body);
      savedMtime.current = content.mtimeMs;
      setSaveState("saved");
      setExternalChange(false);
    } catch {
      const index = tabsRef.current.tabs.indexOf(cur.path);
      if (index >= 0) {
        forgetTab(cur.path);
        await applyTabs(closeTab(tabsRef.current, index));
      }
    }
  }, [applyTabs, forgetTab, refresh, refreshGit]);

  /** 把本地尚未同步的版本隔离成一批建议；成功后工作区回到正式版本。 */
  const submitSuggestion = useCallback(async () => {
    if (reviewBusy || syncing) return;
    const fallback = noteRef.current?.title ? `修改《${noteRef.current.title}》` : "一批修改";
    const title = window.prompt("这批修改建议做了什么？", fallback)?.trim();
    if (!title) return;
    setReviewBusy(true);
    try {
      if (dirtyRef.current && !(await saveNow())) return;
      await api.reviewSuggestionSubmit(title);
      await refreshAfterReview();
      setNotice("修改建议已提交；当前内容已回到正式版本");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewBusy(false);
    }
  }, [reviewBusy, syncing, saveNow, refreshAfterReview]);

  const finishReview = useCallback(
    async (suggestion: Suggestion, accepted: string[], resolutions: SyncResolution[] = []) => {
      if (reviewBusy || syncing) return;
      setReviewBusy(true);
      try {
        const out = await api.reviewSuggestionResolve(suggestion.id, accepted, resolutions);
        if (out.conflicts.length > 0) {
          setReviewConflict({ id: suggestion.id, accepted });
          setConflicts(out.conflicts);
          return;
        }
        setReviewConflict(null);
        setConflicts(null);
        setReviewing(null);
        await refreshAfterReview();
        setNotice(out.warning ?? (accepted.length > 0 ? "审阅完成，接受的内容已进入正式版本" : "审阅完成，这批建议已退回"));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReviewBusy(false);
      }
    },
    [reviewBusy, syncing, refreshAfterReview],
  );

  /** 冲突 UI 的提交按钮：带着逐篇定稿重放同步（§2.8） */
  const resolveConflicts = useCallback(
    async (resolutions: SyncResolution[]) => {
      if (reviewConflict && reviewing) {
        await finishReview(reviewing, reviewConflict.accepted, resolutions);
        return;
      }
      if (syncing || reviewBusy) return;
      setSyncing(true);
      try {
        const out = await api.vaultSyncResolve(resolutions);
        await handleSyncOutcome(out);
        // 两次同步之间远端又动了 —— 面板留着，换成新一轮的内容
        if (out.conflicts.length > 0) setNotice("远端又有了新改动，再确认一轮");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSyncing(false);
      }
    },
    [reviewConflict, reviewing, finishReview, syncing, reviewBusy, handleSyncOutcome],
  );

  /** 配远端。改完立刻重问一次 —— needsToken 会跟着 URL 变 */
  const setRemoteUrl = useCallback(
    async (url: string) => {
      try {
        const r = await api.syncRemoteSet(url);
        setRemote(r);
        setTokenSaved(r.url ? await api.syncTokenHas(r.url) : false);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [],
  );

  /** 存提交署名。写进 vault 仓库级 git 配置；两项都空 = 回到本机全局配置 */
  const setGitIdentity = useCallback(async (name: string, email: string) => {
    try {
      setIdentity(await api.gitIdentitySet(name, email));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /** 存/删令牌。空串 = 删掉 */
  const setToken = useCallback(
    async (token: string) => {
      const url = remote?.url;
      if (!url) return;
      try {
        await api.syncTokenSet(url, token);
        setTokenSaved(!!token);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [remote?.url],
  );

  /**
   * 自动提交：**停手一段时间之后才提交一次**（§2.8「按时间窗聚合」）。
   *
   * 不能每次保存都提交 —— 保存是停手 800ms 就发生的，那样一小时能造出
   * 上百个提交，历史就成了一片噪音，反而没法从里面找回任何东西。
   */
  useEffect(() => {
    const minutes = settings.autoCommitIdleMin;
    // 对比页是在主动审阅改动；审阅到一半把它自动挪进历史，会让眼前内容消失。
    // 关掉对比后重新计完整的一段空闲时间。
    if (minutes <= 0 || !git?.enabled || git.dirty === 0 || diffSelection) return;
    const t = setTimeout(() => void commitNow(), minutes * 60_000);
    return () => clearTimeout(t);
    // `dirty` 只是文件数；同一个文件连续被 AI 写入时它不会变。
    // `gitActivity` 才让每次真实活动都把计时器重新拨一遍。
  }, [settings.autoCommitIdleMin, git?.enabled, git?.dirty, gitActivity, diffSelection, commitNow]);

  // ---------------------------------------------------------------- 项目日志（§2.10）

  /**
   * 记一条进展：在最前面插一节 `## 年-月-日 时:分`，光标落在它下面。
   *
   * 走编辑器的 dispatch（和思维导图同一条路）—— 撤销、自动保存全都免费正确。
   */
  const addJournal = useCallback(() => {
    const cur = noteRef.current;
    if (!cur) return;
    const e = journalInsert(bodyRef.current, new Date());
    editorRef.current?.replaceLines(e.fromLine, e.toLine, e.insert);
    // 插完把光标送过去 —— 记一条进展的下一个动作永远是「开始写」
    requestAnimationFrame(() => editorRef.current?.gotoLine(e.cursorLine));
  }, []);

  /**
   * 插一张「未关闭的条目」表：把当前笔记的子文档列出来，滤掉已关闭的。
   *
   * `from` 要现算 —— 它是当前这篇笔记的子目录，`/` 菜单里那条静态模板
   * 填不出来（那正是它做成 action 而不是文本模板的原因）。
   */
  const insertIssueView = useCallback(() => {
    const cur = noteRef.current;
    if (!cur) return;
    const dir = cur.path.replace(/\.md$/, "");
    const yaml = [
      "```verso-view",
      `from: "${dir}/**"`,
      'where: status != 已关闭',
      "sort: updated desc",
      "view: list",
      "columns: [title, status, updated]",
      "```",
      "",
    ].join("\n");
    editorRef.current?.insert(yaml);
  }, []);

  /** `/` 菜单里那几条动作交回到这儿（见 editor/completion.ts） */
  useEffect(() => {
    setSlashAction((id) => {
      if (id === "template") setTemplateFor({ mode: "insert" });
      else if (id === "journal") addJournal();
      else if (id === "issues") insertIssueView();
    });
    return () => setSlashAction(null);
  }, [addJournal, insertIssueView]);

  /** 右键菜单和 F2 都只是**进入**改名态，真正的改名在 `submitRename` */
  const renameNode = useCallback((node: TreeNode) => setRenaming(node.path), []);

  /**
   * §2.1「创建为文档」：把纯文件夹升级成文档节点 —— 在旁边补一个同名 `.md`，
   * 树上两者就合并成一个「既有内容、又能展开」的节点。
   */
  const upgradeFolder = useCallback(
    async (node: TreeNode) => {
      try {
        const i = node.path.lastIndexOf("/");
        const meta = await api.createNote(i < 0 ? null : node.path.slice(0, i), node.name);
        await refresh();
        await openPath(meta.path);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, openPath],
  );


  const deleteNode = useCallback(
    async (node: TreeNode) => {
      const n = node.children.length;
      // 有子文档时，这一问同时决定「删不删」和「子文档跟不跟着走」，两个按钮
      // 都是「删」—— 所以把结果写在按钮上，别让人对着「确定/取消」猜
      let withChildren = false;
      if (node.kind === "folder") {
        // 纯文件夹就是那个目录本身，没有「只删文档留子文档」可言 ——
        // 但会连里面的东西一起删，弹窗必须说清楚
        const msg =
          n > 0
            ? `删除文件夹「${node.name}」和其中 ${n} 个子文档？`
            : `删除文件夹「${node.name}」？`;
        if (!(await confirm(msg))) return;
        withChildren = true;
      } else if (n > 0) {
        withChildren = await confirm(`「${node.name}」有 ${n} 个子文档。`, {
          okLabel: "连同子文档一起删除",
          cancelLabel: "只删本文档，留下子文档",
        });
      } else if (!(await confirm(`删除「${node.name}」？`))) {
        return;
      }
      try {
        await api.deleteNote(node.path, withChildren);
        await refresh();
        // 删掉的那些页要从标签栏消失（连同子树）。当前页正好被删时，
        // applyTabs 会切到最接近的邻居，而不是弹回第一个
        for (const p of tabsRef.current.tabs) {
          if (p === node.path || p.startsWith(`${node.path.replace(/\.md$/, "")}/`)) forgetTab(p);
        }
        await applyTabs(dropSubtree(tabsRef.current, node.path));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, applyTabs, forgetTab],
  );

  const moveNode = useCallback(
    async (path: string, newParentDoc: string | null) => {
      try {
        const newPath = await api.moveNote(path, newParentDoc);
        await refresh();
        retagTabs((s) => renameTab(s, path, newPath));
        if (noteRef.current?.path === path) await loadNote(newPath);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, loadNote, retagTabs],
  );

  /**
   * 拖拽调顺序：把 `moved` 放到 `target` 的前/后，整组兄弟一起记下次序。
   * 顺序写进 vault 根的 `.verso-order.json`，笔记本身一个字不动。
   *
   * **任何排序模式下都能拖**。拖动本身就是「我要自己定顺序」的意思，
   * 再要求先去下拉框里选一次「手动排序」纯属多余 —— 所以这里顺手切过去。
   */
  const reorder = useCallback(
    async (movedPath: string, targetPath: string, place: "before" | "after") => {
      const parentOf = (p: string) => {
        const cut = p.lastIndexOf("/");
        return cut < 0 ? "" : p.slice(0, cut);
      };
      // 落点看的是**目标**在哪一组，不是被拖的那个原来在哪一组
      const parent = parentOf(targetPath);
      const host = parent ? tree.flatMap(flatten).find((n) => n.childDir === parent) : undefined;
      const siblings = parent ? (host?.children ?? []) : tree;

      let moved = movedPath;
      try {
        if (parentOf(movedPath) !== parent) {
          // 跨目录拖到边缘：先移过去，再排到那个位置。行已经高亮着「插到这里」，
          // 只因为来源目录不同就静悄悄什么都不做，是最难受的一种失败
          //
          // 纯文件夹没有同名文档，当不了「父文档」，这一种只能放弃
          if (parent && host?.kind !== "document") return;
          moved = await api.moveNote(movedPath, host?.path ?? null);
          if (noteRef.current?.path === movedPath) await openPath(moved);
        }

        // 起点是**当前屏幕上的顺序**，不是文件里记着的。从规则排序切过来时这点
        // 很关键：按名字排的时候拖一下，除了被拖的那个，别的都不该动
        const display = sortTree(siblings, settings.treeSort).map((n) => n.path);
        const ordered = reorderSiblings(
          display.includes(moved) ? display : [...display, moved],
          moved,
          targetPath,
          place,
        );
        await api.reorder(parent, ordered);

        // 默认是按名称排。不自动切的话，拖完立刻被规则盖回去，看着像没生效
        if (settings.treeSort !== "manual") {
          await updateSettings({ treeSort: "manual" });
          setSortNotice(true);
        }
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [tree, settings.treeSort, updateSettings, refresh, openPath],
  );

  /**
   * 这一行在**屏幕顺序**里的兄弟组（路径列表）。右键菜单的上移/下移用 ——
   * 和拖拽排序一样，起点是用户看到的顺序，不是文件里记着的（见 reorder）。
   */
  const displaySiblings = useCallback(
    (path: string) => {
      const cut = path.lastIndexOf("/");
      const parent = cut < 0 ? "" : path.slice(0, cut);
      const host = parent ? tree.flatMap(flatten).find((n) => n.childDir === parent) : undefined;
      return sortTree(parent ? (host?.children ?? []) : tree, settings.treeSort).map((n) => n.path);
    },
    [tree, settings.treeSort],
  );

  // 提示自己消失。它是一次性的说明，不是状态，赖着不走就成了侧栏里的一行垃圾
  useEffect(() => {
    if (!sortNotice) return;
    const t = setTimeout(() => setSortNotice(false), 6000);
    return () => clearTimeout(t);
  }, [sortNotice]);

  /** 拖侧栏右边缘。宽度落 localStorage，下次启动还是这么宽 */
  const startSidebarDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      // 拖的时候整页禁选，否则鼠标划过正文会把文字一路选中
      document.body.classList.add("is-resizing");
      const onMove = (ev: MouseEvent) => setSidebarWidth(clampSidebar(startW + ev.clientX - startX));
      const onUp = () => {
        document.body.classList.remove("is-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  useEffect(() => {
    localStorage.setItem("verso.sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  // 窗口变窄时上限会跟着变小，宽度得重新夹一次，否则侧栏能把正文挤没
  useEffect(() => {
    const onResize = () => setSidebarWidth((w) => clampSidebar(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 点别处关掉排序菜单。菜单自己 stopPropagation，所以点菜单里不会关
  useEffect(() => {
    if (!sortMenu) return;
    const close = () => setSortMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSortMenu(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [sortMenu]);

  /** `[[链接]]` 跳转。目标不存在时按名字新建 —— 这正是 wiki 式写作的用法。 */
  const followLink = useCallback(
    async (target: string) => {
      const clean = target.split("#")[0].trim();
      const hit =
        noteList.find((n) => n.name === clean) ??
        noteList.find((n) => n.path.replace(/\.md$/, "") === clean);
      if (hit) {
        await openPath(hit.path);
        return;
      }
      if (!(await confirm(`「${clean}」还不存在，现在新建？`, { kind: "info" }))) return;
      try {
        const meta = await api.createNote(null, clean);
        await refresh();
        await openPath(meta.path);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [noteList, openPath, refresh],
  );

  // 启动时自动重开上次的 vault 和笔记，回到离开时的位置
  useEffect(() => {
    void refreshRecentVaults();
    void (async () => {
      try {
        const restored = await api.reopenLastVault();
        if (!restored) return;
        await activateVault(restored.vault, restored.lastNote);
      } catch {
        /* 上次的目录没了就停在欢迎页 */
      }
    })();
    // 只在挂载时跑一次；openPath/refresh 的身份变化不该触发重新打开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动保存：停止输入 AUTOSAVE_MS 后落盘
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(saveNow, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [body, saveState, saveNow]);

  // §7.4 —— 窗口重新获得焦点时比对 mtime，看文件有没有被外部程序改过。
  // 有了终端跑 AI 之后这是日常主路径：没有这个检查，用完 AI 回到编辑器
  // 一保存就把它的修改全覆盖了。
  useEffect(() => {
    const onFocus = async () => {
      const n = noteRef.current;
      if (!n) return;
      try {
        if ((await api.statNote(n.path)) !== savedMtime.current) setExternalChange(true);
      } catch {
        /* 文件可能已被删除，留给下一次操作报错 */
      }
      void refresh(); // 外部可能新增/删除了笔记，树也要跟上
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // §2.7 移动端补充：App 从后台恢复时主动做一次全量刷新。
  //
  // iOS 后台期间收不到文件事件；安卓共享存储那层 FUSE 的 inotify 本来就
  // 不可靠 —— 在后台的这段时间里，另一台设备可能推了新内容、别的 app
  // 可能改了文件，监听器一概不知道。恢复的那一刻把文档树、索引、打开的
  // 这篇全部对一遍，代价是几百毫秒的一次重建（500 篇 < 1s，§3）。
  //
  // 桌面不走这条：窗口聚焦那条路（上面的 onFocus）已经覆盖同样的场景，
  // 而桌面的 visibilitychange 和 focus 几乎总是一起来，重复跑一次全量
  // 重建纯属浪费。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !mobileRef.current) return;
      void refresh();
      setGitActivity((v) => v + 1);
      try {
        void api
          .rebuildIndex()
          .then(() => setRevision((v) => v + 1))
          .catch(() => {});
      } catch {
        /* 老后端没有这个命令 */
      }
      const n = noteRef.current;
      if (!n) return;
      void api
        .statNote(n.path)
        .then((m) => {
          if (m !== savedMtime.current) setExternalChange(true);
        })
        .catch(() => {
          /* 文件可能已被删除，留给下一次操作报错 —— 和聚焦那条路一致 */
        });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // 后端的非致命提示。以前发了没人听，等于白发
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onBackendNotice(setError).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // §2.7 文件监听推来的外部修改。比「窗口聚焦时比对 mtime」更及时 ——
  // AI 在终端里改文件时，窗口一直是聚焦的，那条路径根本不会触发。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onVaultChanged((paths) => {
      void refresh();
      setGitActivity((v) => v + 1);
      setRevision((v) => v + 1);
      const cur = noteRef.current;
      if (!cur || !paths.includes(cur.path)) return;
      // **必须比一次 mtime 再报**，不能见到事件就报。
      //
      // 我们自己写的那一次同样会让监听器响：原子写是「写临时文件 + rename」，
      // 一次 rename 在 Windows 上能产生不止一个事件，而 Rust 侧的自写登记
      // （`watcher.rs` 的 `SelfWrites`）只能抵掉第一个，剩下的漏过来就成了
      // 一条「文件已被外部程序修改」。
      //
      // 后果不是闪一下而已 —— 那条提示上的「保留我的」按的就是保存，
      // 保存又触发一次监听，提示立刻回来：**点它永远关不掉**。
      void api
        .statNote(cur.path)
        .then((m) => {
          if (m !== savedMtime.current) setExternalChange(true);
        })
        .catch(() => {
          /* 文件可能已被删除，留给下一次操作报错 —— 和聚焦那条路一致 */
        });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refresh]);

  // 失焦立即保存（§2.7），顺带按设置记一个版本（§2.8）
  useEffect(() => {
    const onBlur = () => {
      // **切到别的程序**是一个天然的「一件事做完了」的时刻 —— §2.8 把它
      // 和「空闲 5 分钟」并列为聚合窗口。没有改动时 `commitNow` 什么都不做，
      // 所以反复 alt-tab 不会造出一串空版本
      // commitNow 自己会先冲掉未保存内容；两条异步保存并发会互相覆盖。
      if (settingsRef.current.autoCommitOnBlur) void commitNow();
      else if (dirtyRef.current) void saveNow();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [saveNow, commitNow]);

  /**
   * 进程要没了之前的收尾（§2.7 落盘 + §2.8 记一个版本）。
   *
   * 两条路共用它：点 X 关窗，以及装完更新重启（§2.11）。两处的处境是同一个 ——
   * 最后敲的几个字可能还在自动保存的 800ms 窗口里，进程一没就真的没了。
   */
  const finishUp = useCallback(async () => {
    // commitNow 已包含必要的冲盘。先 save 再 commit 会因为 React state 尚未
    // 重渲染而重复写一次，关窗时尤其没必要。
    if (settingsRef.current.autoCommitOnClose) await commitNow();
    else if (dirtyRef.current) await saveNow();
  }, [saveNow, commitNow]);

  /**
   * 快速切库不能绕过关窗时的安全网：正文先落盘，配置要求时再记一个版本，
   * 最后把当前标签状态明确写回旧仓库。失败就留在原处。
   */
  const prepareVaultSwitch = useCallback(async () => {
    if (!vault) return true;
    const ready = settingsRef.current.autoCommitOnClose
      ? await commitNow()
      : !dirtyRef.current || (await saveNow());
    if (!ready) return false;
    try {
      await api.workspaceSet(tabsRef.current);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, [vault, commitNow, saveNow]);

  const switchToVault = useCallback(
    async (path: string) => {
      if (switchingVault || path === vault?.root) {
        if (path === vault?.root) setVaultManagerOpen(false);
        return;
      }
      setSwitchingVault(path);
      setVaultError(null);
      try {
        if (!(await prepareVaultSwitch())) {
          setVaultError("当前仓库未能完成保存，已取消切换。");
          return;
        }
        const info = await api.openVault(path);
        await activateVault(info, null);
        setVaultManagerOpen(false);
      } catch (e) {
        const message = (e as Error).message;
        setError(message);
        setVaultError(message);
        await refreshRecentVaults();
      } finally {
        setSwitchingVault(null);
      }
    },
    [switchingVault, vault?.root, prepareVaultSwitch, activateVault, refreshRecentVaults],
  );

  const openVault = useCallback(async () => {
    if (switchingVault) return;
    setVaultError(null);
    try {
      // 手机上没有目录选择器，也没有多仓库管理：位置仍由 Rust 挑。
      if (mobileRef.current) {
        setSwitchingVault("__default__");
        const info = await api.openDefaultVault();
        await activateVault(info, null);
        return;
      }
      const path = await pickVaultFolder();
      if (path) await switchToVault(path);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      setVaultError(message);
    } finally {
      setSwitchingVault(null);
    }
  }, [switchingVault, activateVault, switchToVault]);

  const joinVault = useCallback(
    async (input: JoinVaultInput) => {
      if (joining || switchingVault) return;
      setJoining(true);
      setSwitchingVault(input.path);
      setJoinError(null);
      try {
        if (!(await prepareVaultSwitch())) {
          setJoinError("当前仓库未能完成保存，已取消切换。");
          return;
        }
        const info = await api.cloneVault(input);
        await activateVault(info, null);
        setJoinOpen(false);
        setVaultManagerOpen(false);
      } catch (e) {
        setJoinError((e as Error).message);
      } finally {
        setJoining(false);
        setSwitchingVault(null);
      }
    },
    [joining, switchingVault, prepareVaultSwitch, activateVault],
  );

  const checkShareGitHub = useCallback(() => {
    setGitHubChecking(true);
    void api.githubAccount()
      .then(setGitHubAccount)
      .catch(() => setGitHubAccount(null))
      .finally(() => setGitHubChecking(false));
  }, []);

  const connectGitHub = useCallback(async (token: string) => {
    const account = await api.githubConnect(token);
    setGitHubAccount(account);
    return account;
  }, []);

  const disconnectGitHub = useCallback(async () => {
    await api.githubDisconnect();
    setGitHubAccount(null);
  }, []);

  const beginShareNote = useCallback(
    async (node: TreeNode) => {
      setMenu(null);
      setShareError(null);
      setGitHubAccount(null);
      setShareSpaces([]);
      setGitHubChecking(false);
      try {
        // 清单必须对应用户此刻看到的正文；最后 800ms 还没自动保存时，直接
        // 从磁盘预检会漏掉刚插入的附件链接。
        if (node.path === noteRef.current?.path && dirtyRef.current && !(await saveNow())) return;
        const [preview, spaces] = await Promise.all([
          api.shareNotePreview(node.path),
          api.shareSpaces().catch(() => []),
        ]);
        setShareSpaces(spaces);
        setSharePreview(preview);
        if (spaces.length === 0) checkShareGitHub();
      } catch (error) {
        setGitHubChecking(false);
        setError((error as Error).message);
      }
    },
    [saveNow, checkShareGitHub],
  );

  const shareNote = useCallback(
    async (input: ShareNoteInput) => {
      if (sharing || switchingVault) return;
      setSharing(true);
      setSwitchingVault(
        input.mode === "space"
          ? input.spaceRoot
          : input.mode === "existing"
            ? input.path
            : "github-share",
      );
      setShareError(null);
      try {
        if (!(await prepareVaultSwitch())) {
          setShareError("当前仓库未能完成保存，已取消共享。");
          return;
        }
        const result = input.mode === "space"
          ? await api.shareNoteToSpace({
              note: input.note,
              spaceRoot: input.spaceRoot,
              name: input.name,
              email: input.email,
            })
          : input.mode === "github"
          ? await api.shareNoteToGitHub({
              note: input.note,
              collaborators: input.collaborators,
              name: input.name,
              email: input.email,
            })
          : await api.shareNote({
              note: input.note,
              url: input.url,
              path: input.path,
              token: input.token,
              name: input.name,
              email: input.email,
            });
        await activateVault(result.vault, result.note);
        setSharePreview(null);
        setNotice(result.notice ?? "已移到共享空间");
      } catch (error) {
        setShareError((error as Error).message);
      } finally {
        setSharing(false);
        setSwitchingVault(null);
      }
    },
    [sharing, switchingVault, prepareVaultSwitch, activateVault],
  );

  const manageSharedSpace = useCallback(async (root: string) => {
    try {
      const spaces = await api.shareSpaces();
      const space = spaces.find((item) => item.root === root);
      if (!space) throw new Error("这个共享空间的位置或标记已经不可用");
      setVaultManagerOpen(false);
      setManagedSpace(space);
      if (!githubAccount) checkShareGitHub();
    } catch (reason) {
      setVaultError((reason as Error).message);
    }
  }, [githubAccount, checkShareGitHub]);

  const unshareNote = useCallback(
    async (spaceRoot: string, path: string, privateRoot: string) => {
      if (sharing || switchingVault) return;
      setSharing(true);
      setSwitchingVault(privateRoot);
      try {
        if (!(await prepareVaultSwitch())) {
          throw new Error("当前空间未能完成保存，已取消迁移。");
        }
        const result = await api.unshareNote(spaceRoot, path, privateRoot);
        await activateVault(result.vault, result.note);
        setManagedSpace(null);
        setNotice(result.notice ?? "已移回私人空间");
      } finally {
        setSharing(false);
        setSwitchingVault(null);
      }
    },
    [sharing, switchingVault, prepareVaultSwitch, activateVault],
  );

  const forgetVault = useCallback(
    async (path: string) => {
      if (path === vault?.root) return;
      try {
        await api.forgetVault(path);
        await refreshRecentVaults();
      } catch (e) {
        const message = (e as Error).message;
        setError(message);
        setVaultError(message);
      }
    },
    [vault?.root, refreshRecentVaults],
  );

  /**
   * 关窗。Rust 那边先把关窗拦下来发 `app:closing`，我们做完再让它关。
   *
   * **`closeNow` 必须在 finally 里**：保存失败、提交失败、vault 已经关了 ——
   * 任何一条岔路上漏掉它，用户看到的都是「点 X 没反应」。Rust 那边虽然有
   * 5 秒的兜底，但让人干等 5 秒和坏掉没区别。
   */
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onAppClosing(async () => {
      try {
        await finishUp();
      } finally {
        await api.closeNow();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [finishUp]);

  /**
   * 自动更新（§2.11）。状态机整个在 `lib/update.ts` 里，这里只是把它挂起来。
   *
   * 放在 App 上而不是设置面板里：设置面板一关就卸载，而「下载中」这件事
   * 不该因为关掉一个弹窗就消失。状态栏那个提示看的也是这一份。
   */
  const updater = useUpdate(settings.autoUpdateCheck, finishUp);

  /** 打开设置，可以指定停在哪一页 */
  const openSettings = useCallback((tab: SettingsTab = "appearance") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  // 全局快捷键。键位不写在这里 —— 全部来自下面那张命令表（`commands`），
  // 用户在设置里改过的会盖掉默认值。见 `lib/keymap.ts`
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 浮层（命令面板、设置、快速跳转）里的按键归浮层自己管。设置里正在
      // 录快捷键时尤其重要：按下的组合键不能顺手把那条命令也执行一遍
      if (target?.closest?.(".overlay")) return;
      // 思维导图同理：它整片盖住正文，里面的 Enter / Tab / F2 / Delete 都
      // 有自己的意思（加同级、加子级、改字、删子树）。不挡的话按 F2 会去
      // 给文档树上的笔记改名 —— 而那时侧栏在导图后面，看都看不见
      if (target?.closest?.(".mindmap")) return;
      const spec = eventSpec(e);
      if (!spec) return;
      const hit = commandsRef.current.find((c) => c.binding === spec);
      if (!hit || hit.enabled === false) return;
      // **终端里键盘归 shell**。Ctrl+N/P/E/B 在 readline、vim、tmux 里全都
      // 有各自的意思，被界面截走的话终端就成了半个终端 —— 而在终端里跑
      // AI CLI 正是这个软件的主路径（§7.3）。
      //
      // 例外是**对象就是终端面板自己**的那些命令（`term.*`）加上命令面板。
      // 「把笔记发给终端」尤其不能挡：送完一次焦点就落在终端里（§7.6），
      // 挡掉的话想再送第二篇就得先点回正文 —— 把刚省下的那一步又加了回来。
      // 这几个键位也不在 shell 的键位空间里（readline/vim/tmux 都没占
      // Ctrl+Alt+K 这一档），放行不会让终端缺掉半个。
      if (target?.closest?.(".term") && !hit.id.startsWith("term.") && hit.id !== "view.palette") {
        return;
      }
      // 挂在 capture 阶段、并且掐断传播：CodeMirror 自己也绑了 Mod-s 和
      // Ctrl-Shift-[，让事件传下去的话这两处会各跑一遍（折叠那条正好互相
      // 抵消，表现成「按了没反应」）
      e.preventDefault();
      e.stopPropagation();
      hit.run();
    };
    // 命令表每次渲染都是新数组，靠 ref 读最新的一份，监听器只装一次
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // 点任意位置关掉右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // 右键点在侧栏底部时，菜单不能继续向下长到窗口外。实际渲染后再量，新增菜单项、
  // 系统字体和缩放比例都不会让这里的高度预估失效。
  useLayoutEffect(() => {
    if (menu && menuRef.current) fitFloatingMenu(menuRef.current, menu.x, menu.y);
  }, [menu]);

  const reloadFromDisk = useCallback(async () => {
    const n = noteRef.current;
    if (!n) return;
    try {
      const content = await api.readNote(n.path);
      setNote(content);
      setBody(content.body);
      savedMtime.current = content.mtimeMs;
      setSaveState("saved");
      setExternalChange(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refresh]);

  const toggleProject = useCallback(async () => {
    let current = noteRef.current;
    if (!current) return;
    if (projectOpen && !projectCenterOpen) {
      setProjectOpen(false);
      return;
    }
    if (projectOpen && projectCenterOpen && isProject(current)) {
      setProjectCenterOpen(false);
      return;
    }
    if (!isProject(current)) {
      // 从实验/问题等子文档也能一键回到所属项目，不会误把子条目再建成项目。
      const parts = current.path.replace(/\.md$/i, "").split("/");
      const ancestorPaths = parts
        .slice(0, -1)
        .map((_, index) => `${parts.slice(0, index + 1).join("/")}.md`)
        .reverse();
      for (const path of ancestorPaths) {
        if (!noteListRef.current.some((candidate) => candidate.path === path)) continue;
        try {
          const candidate = await api.readNote(path);
          if (isProject(candidate)) {
            await openPath(path);
            current = candidate;
            break;
          }
        } catch {
          // 路径清单可能刚被外部程序改过；继续检查更上一级即可。
        }
      }
    }
    if (!isProject(current)) {
      const ok = await confirm(
        `把「${current.title}」设为项目？\n\nVerso 会在同名目录里整理进展、实验、问题、决策和资料，正文不会被改动。`,
        { title: "启用项目总览", okLabel: "设为项目", cancelLabel: "取消", kind: "info" },
      );
      if (!ok) return;
      if (dirtyRef.current && !(await saveNow())) return;
      try {
        await markAsProject(api, current);
        await reloadFromDisk();
        await refresh();
        setRevision((value) => value + 1);
      } catch (cause) {
        setError((cause as Error).message);
        return;
      }
    }
    setMindmapOpen(false);
    setProjectCenterOpen(false);
    setProjectOpen(true);
  }, [openPath, projectCenterOpen, projectOpen, refresh, reloadFromDisk, saveNow]);

  /**
   * 设置/去掉一篇笔记的图标（§2.3）。`icon` 为 null = 去掉。
   *
   * 走的是 `prop_set` —— 和属性条、database 视图**同一条写入路径**。图标
   * 说到底就是 frontmatter 里的一个普通字段，不给它开第二条写文件的路：
   * 那条路迟早会在类型保持、`updated` 刷新、索引更新上和这条分叉。
   */
  const setNoteIcon = useCallback(
    async (path: string, icon: string | null) => {
      setIconFor(null);
      try {
        await api.propSet(path, "icon", icon);
        if (icon) pushRecentIcon(icon);
        // 改的正好是当前这篇时要重读 —— 面包屑上的图标和属性条都来自
        // `note.frontmatter`，不重读的话屏幕上还是旧的那个。
        // `reloadFromDisk` 自己会刷新文档树
        if (noteRef.current?.path === path) await reloadFromDisk();
        else await refresh();
        setRevision((v) => v + 1);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, reloadFromDisk],
  );

  /**
   * 命令表。**全局快捷键、命令面板、设置里那份键位清单都从这里来**。
   *
   * 每条带一个 `defaultKeys` 默认键位，用户在设置里改过的会盖掉它。以前
   * 键位写死在 keydown 那条 if 链里、提示文字又在这里各写一遍，两处迟早对
   * 不上；现在只有这一份真相。
   *
   * 依赖数组有意写全：`enabled` 依赖当前有没有打开笔记，漏掉的话面板里
   * 会显示出一条点了没反应的命令。
   */
  const baseCommands: Command[] = useMemo(() => {
    const hasNote = !!note;
    const cur = note?.path ?? null;
    const node = cur ? tree.flatMap(flatten).find((n) => n.path === cur) : undefined;
    // §4.9 表格的结构操作。渲染态的表格上有把手可以点，这里是键盘那一路 ——
    // 做不成要说一声（光标不在表格里最常见），静默失败会让人以为软件坏了
    const table = (op: TableOp) => () => {
      if (!editorRef.current?.tableOp(op)) setNotice("光标不在表格里");
    };
    return [
      {
        id: "note.new",
        group: "笔记",
        label: "新建文档",
        defaultKeys: "Mod+N",
        run: () => createAndOpen(null),
      },
      {
        id: "note.switch",
        group: "笔记",
        label: "快速跳转",
        defaultKeys: "Mod+P",
        run: () => setSwitcherOpen(true),
      },
      {
        id: "note.journal",
        group: "笔记",
        label: "记一条进展",
        // 和 GitHub 上「提交评论」的 Ctrl+Enter 是同一个语义位置
        defaultKeys: "Mod+Shift+Enter",
        enabled: hasNote,
        run: addJournal,
      },
      {
        id: "note.newChild",
        group: "笔记",
        label: "在这篇下面新建子文档",
        // 项目笔记下面开一个新条目（issue）走的就是它
        defaultKeys: "Mod+Shift+N",
        enabled: hasNote,
        run: () => createAndOpen(cur),
      },
      {
        id: "note.icon",
        group: "笔记",
        label: "设置文档图标",
        // 默认不绑键位。面包屑上那个图标是主入口，这一条是给「手不想离开
        // 键盘」的人留的路，以及命令面板本身的可发现性
        enabled: hasNote,
        run: () => cur && setIconFor({ path: cur, at: null }),
      },
      {
        id: "note.template",
        group: "笔记",
        label: "插入模板",
        // T = Template。**不用 Mod+Shift+T**，那是标签面板；也不用 Mod+M，
        // macOS 上 Cmd+M 是系统级的「最小化窗口」，抢不过来
        defaultKeys: "Mod+Alt+T",
        enabled: hasNote,
        run: () => setTemplateFor({ mode: "insert" }),
      },
      {
        id: "note.newFromTemplate",
        group: "笔记",
        label: "用模板新建文档",
        // 和「新建文档」的 Mod+N 成一对：多按一个 Alt = 这次带模板
        defaultKeys: "Mod+Alt+N",
        run: () => setTemplateFor({ mode: "new", parent: null }),
      },
      {
        id: "tab.close",
        group: "标签页",
        label: "关闭当前标签",
        defaultKeys: "Mod+W",
        enabled: tabState.tabs.length > 0,
        run: () => closeTabAt(tabsRef.current.active),
      },
      {
        id: "tab.next",
        group: "标签页",
        label: "下一个标签",
        defaultKeys: "Mod+Alt+Right",
        enabled: tabState.tabs.length > 1,
        run: () => void applyTabs(stepTab(tabsRef.current, 1)),
      },
      {
        id: "tab.prev",
        group: "标签页",
        label: "上一个标签",
        defaultKeys: "Mod+Alt+Left",
        enabled: tabState.tabs.length > 1,
        run: () => void applyTabs(stepTab(tabsRef.current, -1)),
      },
      {
        id: "tab.closeOthers",
        group: "标签页",
        label: "关闭其他标签",
        enabled: tabState.tabs.length > 1,
        run: () => closeOtherTabs(tabsRef.current.active),
      },
      {
        id: "tab.pin",
        group: "标签页",
        name: "固定／取消固定标签",
        label:
          tabState.active < tabState.pinnedCount ? "取消固定当前标签" : "固定当前标签",
        // 默认不绑键位 —— 固定是低频操作，不该占掉一个组合键。想要的人
        // 去设置里绑
        enabled: tabState.tabs.length > 0,
        run: () => retagTabs((s) => togglePin(s, s.active)),
      },
      {
        id: "note.search",
        group: "笔记",
        label: "全文搜索",
        // §2.2 全文搜索。沿用 VS Code 的 Ctrl+Shift+F
        defaultKeys: "Mod+Shift+F",
        run: () => {
          // 已经在搜索视图时不要收起侧栏 —— 再按一次的意图是「回到搜索框」，
          // 不是「关掉搜索」。pickView 的 toggle 语义只对点图标成立
          if (sidebarOpen && sidebarView === "search") {
            document.getElementById("verso-search-input")?.focus();
          } else {
            pickView("search");
          }
        },
      },
      {
        id: "note.tags",
        group: "笔记",
        label: "标签面板",
        // VS Code 那一竖条上的视图都是 Ctrl+Shift+字母，标签取 T
        defaultKeys: "Mod+Shift+T",
        run: () => pickView("tags"),
      },
      {
        id: "note.templates",
        group: "笔记",
        label: "模板面板",
        // 侧栏那几个面板都是 Mod+Shift+字母（树 E、搜索 F、标签 T、大纲 O），
        // 模板取 M
        defaultKeys: "Mod+Shift+M",
        run: () => pickView("template"),
      },
      {
        id: "note.mindmap",
        group: "笔记",
        label: mindmapOpen ? "回到正文" : "思维导图",
        // G = Graph。Mod+Shift+D（Diagram）在浏览器里是「添加书签」，
        // WebView2 未必让给我们
        defaultKeys: "Mod+Shift+G",
        enabled: hasNote,
        run: () => setMindmapOpen((v) => !v),
      },
      {
        id: "note.project",
        group: "笔记",
        name: "项目总览",
        label: projectOpen ? "回到项目正文" : "项目总览",
        // J = Project Journal。和现有「记一条进展」同属一组，但不占 Enter。
        defaultKeys: "Mod+Shift+J",
        enabled: hasNote,
        run: () => void toggleProject(),
      },
      {
        id: "view.projects",
        group: "视图",
        name: "项目中心",
        label: projectCenterOpen ? "回到当前笔记" : "项目中心",
        // 与单项目总览的 Mod+Shift+J 成对：Alt 表示再向上一层看全部项目。
        defaultKeys: "Mod+Alt+J",
        run: () => {
          setMindmapOpen(false);
          setProjectCenterOpen((value) => !value);
        },
      },
      {
        id: "vault.history",
        group: "仓库",
        label: "版本历史",
        run: () => pickView("history"),
      },
      {
        id: "note.outline",
        group: "笔记",
        label: "大纲",
        // VS Code 的 Ctrl+Shift+O 是「跳转到符号」，笔记里的符号就是标题
        defaultKeys: "Mod+Shift+O",
        run: () => pickView("outline"),
      },
      {
        id: "view.tree",
        group: "外观",
        label: "文档树",
        // VS Code 的资源管理器就是 Ctrl+Shift+E
        defaultKeys: "Mod+Shift+E",
        run: () => pickView("tree"),
      },
      {
        id: "view.sidebar",
        group: "外观",
        name: "展开／收起侧栏",
        label: sidebarOpen ? "收起侧栏" : "展开侧栏",
        // 原来是 Mod+B（VS Code 的键位）。**让给加粗了** —— 这是笔记软件，
        // 在这里 Ctrl+B 是加粗几乎是所有人的第一预期，而收侧栏一天按不了两次
        defaultKeys: "Mod+Alt+B",
        run: () => pickView(sidebarView),
      },
      {
        id: "view.sourceMode",
        group: "外观",
        name: "源码模式",
        label: sourceMode ? "退出源码模式" : "源码模式",
        // Obsidian 用 Ctrl+E 在源码与预览之间切，沿用它的肌肉记忆
        defaultKeys: "Mod+E",
        run: toggleSourceMode,
      },
      {
        id: "view.tocFloat",
        group: "外观",
        name: "浮动大纲",
        label: tocFloat ? "隐藏浮动大纲" : "显示浮动大纲",
        run: toggleTocFloat,
      },
      {
        id: "note.save",
        group: "笔记",
        label: "立即保存",
        defaultKeys: "Mod+S",
        enabled: hasNote,
        run: () => void saveNow(),
      },
      {
        id: "note.rename",
        group: "笔记",
        label: "重命名当前文档",
        // 文件管理器里重命名都是 F2
        defaultKeys: "F2",
        enabled: !!node,
        run: () => node && void renameNode(node),
      },
      {
        id: "note.reload",
        group: "笔记",
        label: "从磁盘重新加载",
        enabled: hasNote,
        run: () => void reloadFromDisk(),
      },
      {
        id: "fold.toggle",
        group: "标题",
        label: "折叠／展开当前小节",
        defaultKeys: "Mod+Shift+[",
        enabled: hasNote,
        run: () => editorRef.current?.toggleFold(),
      },
      {
        id: "fold.all",
        group: "标题",
        label: "折叠全部标题",
        enabled: hasNote,
        run: () => editorRef.current?.foldAll(),
      },
      {
        id: "fold.none",
        group: "标题",
        label: "展开全部标题",
        enabled: hasNote,
        run: () => editorRef.current?.unfoldAll(),
      },
      // §4.8 行内格式。粗体和斜体是所有编辑器都一样的两个键，别的几种
      // 各家都不一样 —— 与其抄一个大多数人没有肌肉记忆的组合，不如放在
      // Mod+Alt 这一族里，成一套自洽的东西
      {
        id: "format.bold",
        group: "格式",
        label: "粗体",
        defaultKeys: "Mod+B",
        enabled: hasNote,
        run: () => editorRef.current?.toggleFormat("bold"),
      },
      {
        id: "format.italic",
        group: "格式",
        label: "斜体",
        defaultKeys: "Mod+I",
        enabled: hasNote,
        run: () => editorRef.current?.toggleFormat("italic"),
      },
      {
        id: "format.code",
        group: "格式",
        label: "行内代码",
        defaultKeys: "Mod+Alt+C",
        enabled: hasNote,
        run: () => editorRef.current?.toggleFormat("code"),
      },
      {
        id: "format.highlight",
        group: "格式",
        label: "高亮",
        defaultKeys: "Mod+Alt+H",
        enabled: hasNote,
        run: () => editorRef.current?.toggleFormat("highlight"),
      },
      {
        id: "format.strike",
        group: "格式",
        label: "删除线",
        defaultKeys: "Mod+Alt+X",
        enabled: hasNote,
        run: () => editorRef.current?.toggleFormat("strike"),
      },
      // §4.9 表格。**默认一个键位都不绑** —— 这七条谁也不值得占一个全局
      // 快捷键，而它们真正的入口是渲染态表格上的把手。放进命令面板是为了
      // §0 那条反过来的一半：不能假设有鼠标。要的人可以在设置里绑
      {
        id: "table.rowAbove",
        group: "表格",
        label: "在上方插入行",
        enabled: hasNote,
        run: table("row-above"),
      },
      {
        id: "table.rowBelow",
        group: "表格",
        label: "在下方插入行",
        enabled: hasNote,
        run: table("row-below"),
      },
      {
        id: "table.rowDelete",
        group: "表格",
        label: "删除这一行",
        enabled: hasNote,
        run: table("row-delete"),
      },
      {
        id: "table.colLeft",
        group: "表格",
        label: "在左侧插入列",
        enabled: hasNote,
        run: table("col-left"),
      },
      {
        id: "table.colRight",
        group: "表格",
        label: "在右侧插入列",
        enabled: hasNote,
        run: table("col-right"),
      },
      {
        id: "table.colDelete",
        group: "表格",
        label: "删除这一列",
        enabled: hasNote,
        run: table("col-delete"),
      },
      // 三条对齐命令会把「表格」这一组撑长一倍，而对齐是个来回试的动作 ——
      // 一条命令按三次转一圈，比在菜单里挑三次快
      {
        id: "table.align",
        group: "表格",
        label: "这一列的对齐（左 → 中 → 右）",
        enabled: hasNote,
        run: table("align-cycle"),
      },
      {
        id: "formula.symbols",
        group: "公式",
        label: "符号面板",
        // §5.3 符号面板：覆盖 snippet 记不住的长尾
        defaultKeys: "Mod+/",
        run: () => setSymbolOpen(true),
      },
      // 移动端整组不出现（§7.3：iOS/Android 没有可用的 PTY）——
      // 摆一条点了没反应的命令比没有更糟
      ...(mobile
        ? []
        : [
            {
              id: "term.toggle",
              group: "终端",
              label: "打开／关闭终端面板",
              // 沿用 VS Code 的肌肉记忆（§7.3）
              defaultKeys: "Mod+`",
              run: () => setTermOpen((v) => !v),
            },
            {
              id: "term.dock",
              group: "终端",
              name: "终端停靠位置",
              label: termDock === "bottom" ? "终端：靠右竖排" : "终端：放回底部",
              // 窄屏强制吸底（§7.3），摆一条按了不动的命令比没有更糟
              enabled: !narrow,
              run: toggleTermDock,
            },
            {
              id: "term.sendNote",
              group: "终端",
              label: "把当前笔记发给终端",
              // Claude Code 的 VS Code 插件用 Cmd+Alt+K 插入文件引用，
              // 这里对齐它（§7.6）
              defaultKeys: "Mod+Alt+K",
              enabled: hasNote,
              run: () => {
                if (cur) sendToTerm(`${settings.terminalMention}${cur} `);
              },
            },
            {
              id: "term.sendSelection",
              group: "终端",
              label: "把选中内容发给终端",
              defaultKeys: "Mod+Alt+Shift+K",
              enabled: hasNote,
              run: () => {
                const sel = editorRef.current?.selectedText() ?? "";
                // 和表格那几条一个处理：做不成要说一声，静默失败会让人以为软件坏了
                if (!sel.trim()) {
                  setNotice("没有选中内容");
                  return;
                }
                // 末尾**不加换行**：括号粘贴模式没开的对面（普通 shell）会把
                // 它当成回车，等于替用户按了执行 —— 越过 §7.5 那条边界
                if (cur) sendToTerm(`${settings.terminalMention}${cur}\n${sel}`);
              },
            },
            {
              id: "term.system",
              group: "终端",
              label: "在系统终端中打开",
              run: () => api.openTerminal(null).catch((e: Error) => setError(e.message)),
            },
          ]),
      {
        id: "view.theme",
        group: "外观",
        name: "切换主题",
        label: `主题：切换到${{ system: "浅色", light: "深色", dark: "跟随系统" }[settings.theme]}`,
        run: () =>
          updateSettings({
            // 三态循环，跟系统设置里的行为一致
            theme: ({ system: "light", light: "dark", dark: "system" } as const)[settings.theme],
          }),
      },
      {
        id: "view.palette",
        group: "外观",
        label: "命令面板",
        defaultKeys: "Mod+Shift+P",
        run: () => setPaletteOpen(true),
      },
      {
        id: "view.settings",
        group: "外观",
        label: "打开设置",
        // 沿用几乎所有桌面软件的「设置」快捷键
        defaultKeys: "Mod+,",
        run: () => openSettings(),
      },
      {
        id: "vault.switch",
        group: "仓库",
        label: mobile ? "打开仓库" : "管理空间",
        run: () => {
          if (mobile) void openVault();
          else {
            setVaultError(null);
            setVaultManagerOpen(true);
          }
        },
      },
      {
        id: "vault.commit",
        group: "仓库",
        label: "记一个版本",
        // 不绑默认键位：它是低频的兜底操作，日常靠自动记
        enabled: !!git?.enabled && (git?.dirty ?? 0) > 0,
        run: () => void commitNow(),
      },
      {
        id: "vault.sync",
        group: "仓库",
        label: "同步",
        // 不绑默认键位：它会走网络、可能要好几秒，不该是手滑就触发的动作
        enabled: !!remote?.url && !syncing,
        run: () => void syncNow(),
      },
      {
        id: "vault.suggest",
        group: "仓库",
        label: "提交修改建议…",
        enabled:
          !!remote?.url &&
          recentVaults.some((item) => item.root === vault?.root && item.shared) &&
          !syncing &&
          !reviewBusy,
        run: () => void submitSuggestion(),
      },
      {
        id: "vault.commitNamed",
        group: "仓库",
        label: "记一个版本并写说明…",
        // 自动生成的说明只说「动了哪几篇」，说不出「为什么」。
        // 做完一件完整的事时，自己写一句在历史里价值大得多
        enabled: !!git?.enabled && (git?.dirty ?? 0) > 0,
        run: () => {
          const msg = window.prompt("这一版做了什么？", "")?.trim();
          if (msg) void commitNow(msg);
        },
      },
      {
        id: "vault.agentsDoc",
        group: "仓库",
        label: "打开 AI 仓库说明",
        enabled: !!vault,
        // 覆盖是有损动作，统一去设置页读完说明并确认；命令面板不再一按就改文件。
        run: () => openSettings("ai"),
      },
      {
        id: "vault.reindex",
        group: "仓库",
        label: "重建索引",
        run: () =>
          api
            .rebuildIndex()
            .then(() => setRevision((v) => v + 1))
            .catch((e: Error) => setError(e.message)),
      },
    ];
  }, [
    note,
    tree,
    settings.theme,
    sidebarOpen,
    sidebarView,
    // label 会随它在「思维导图 / 回到正文」之间换 —— 漏掉的话命令面板里
    // 会一直显示「思维导图」，点它反而是关掉
    mindmapOpen,
    projectOpen,
    projectCenterOpen,
    toggleProject,
    tocFloat,
    toggleTocFloat,
    sourceMode,
    toggleSourceMode,
    pickView,
    createAndOpen,
    addJournal,
    commitNow,
    git,
    saveNow,
    renameNode,
    reloadFromDisk,
    openVault,
    mobile,
    narrow,
    setTermOpen,
    // label 在「靠右竖排 / 放回底部」之间换，和 mindmapOpen 同理
    termDock,
    toggleTermDock,
    sendToTerm,
    settings.terminalMention,
    updateSettings,
    vault,
    recentVaults,
    remote,
    syncing,
    reviewBusy,
    submitSuggestion,
    openSettings,
  ]);

  /**
   * 把默认键位和用户改过的键位合成每条命令**当前生效**的那一个。
   *
   * 派发（`binding`）和显示（`keys`）都从这里出，所以命令面板里写着什么，
   * 按下去就一定是什么 —— 包括用户自己改过的。
   */
  const commands: Command[] = useMemo(
    () =>
      baseCommands.map((c) => {
        const spec = bindingOf(c, settings.keybindings);
        return spec ? { ...c, binding: spec, keys: keyLabel(spec) } : c;
      }),
    [baseCommands, settings.keybindings],
  );
  commandsRef.current = commands;

  /** 按钮上的快捷键提示。改了键位，tooltip 跟着变 */
  const keyOf = useCallback(
    (id: string) => commands.find((c) => c.id === id)?.keys,
    [commands],
  );

  if (!vault) {
    return (
      <>
        <div className="welcome">
          <h1>Verso</h1>
          <p className="welcome-sub">本地优先的笔记本</p>
          {mobile ? (
            <button className="btn-primary" onClick={() => void openVault()}>
              开始使用
            </button>
          ) : (
            <VaultWelcome
              vaults={recentVaults}
              switching={switchingVault}
              onSwitch={(path) => void switchToVault(path)}
              onOpenFolder={() => void openVault()}
              onJoin={() => {
                setJoinError(null);
                setJoinOpen(true);
              }}
              onManage={() => {
                setVaultError(null);
                setVaultManagerOpen(true);
              }}
            />
          )}
          {error && <p className="error">{error}</p>}
        </div>
        {vaultManagerOpen && (
          <VaultManager
            vaults={recentVaults}
            current={null}
            switching={switchingVault}
            error={vaultError}
            onSwitch={(path) => void switchToVault(path)}
            onOpenFolder={() => void openVault()}
            onJoin={() => {
              setVaultManagerOpen(false);
              setJoinError(null);
              setJoinOpen(true);
            }}
            onForget={(path) => void forgetVault(path)}
            onManageShared={(root) => void manageSharedSpace(root)}
            onClose={() => setVaultManagerOpen(false)}
          />
        )}
        {managedSpace && (
          <SharedSpaceDialog
            space={managedSpace}
            privateVaults={recentVaults}
            account={githubAccount}
            busy={sharing}
            onLoadAccess={api.shareSpaceAccess}
            onInvite={api.sharedSpaceInvite}
            onRemove={api.sharedSpaceRemoveMember}
            onUnshare={unshareNote}
            onClose={() => !sharing && setManagedSpace(null)}
          />
        )}
        {joinOpen && (
          <JoinVaultDialog
            busy={joining}
            error={joinError}
            onPickFolder={pickCloneFolder}
            onJoin={(input) => void joinVault(input)}
            onClose={() => !joining && setJoinOpen(false)}
          />
        )}
      </>
    );
  }

  const breadcrumb = note
    ? note.path
        .replace(/\.md$/, "")
        .split("/")
        .map((name, i, arr) => ({
          name,
          // 每一级都对应一篇同名文档，最后一级是当前笔记（不可点）
          path: i === arr.length - 1 ? null : `${arr.slice(0, i + 1).join("/")}.md`,
        }))
    : [];

  const VIEW_TITLE: Record<SidebarView, string> = {
    tree: "文档",
    search: "搜索",
    tags: "标签",
    template: "模板",
    history: "动态",
    outline: "大纲",
  };

  return (
    <div
      className={`app${sidebarOpen ? "" : " sidebar-collapsed"}${narrow ? " is-narrow" : ""}${
        termOpen && !mobile && termDockEffective === "right" ? " term-right" : ""
      }`}
      style={
        { "--sidebar-w": `${sidebarWidth}px`, "--term-w": `${termWidth}px` } as React.CSSProperties
      }
    >
      <ActivityBar
        view={sidebarView}
        onView={pickView}
        keyOf={keyOf}
        sidebarOpen={sidebarOpen}
        activityUnread={collaborationUnread}
        sourceMode={sourceMode}
        onToggleSourceMode={toggleSourceMode}
        mindmapOn={note ? mindmapOpen : null}
        onToggleMindmap={() => setMindmapOpen((v) => !v)}
        projectOn={projectCenterOpen}
        onToggleProject={() => {
          setMindmapOpen(false);
          setProjectCenterOpen((value) => !value);
        }}
        termOpen={termOpen}
        showTerm={!mobile}
        onToggleTerm={() => setTermOpen((v) => !v)}
        onSystemTerminal={() =>
          api.openTerminal(null).catch((err) => setError((err as Error).message))
        }
        onPalette={() => setPaletteOpen(true)}
        onSettings={() => openSettings()}
      />

      {/* 抽屉打开时正文上盖一层，点它就关。窄屏上没有「点旁边空白处」
          这回事 —— 抽屉几乎占满屏，剩下那点正文正是唯一的出口 */}
      {narrow && sidebarOpen && (
        <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      {sidebarOpen && (
        <aside className="sidebar">
          {/* 头部只留「这是哪个视图」和这个视图的动作。vault 名挪到了底部 ——
              换库是低频操作，不该占着头部的黄金位置，那正是之前挤成一团的原因 */}
          <header className="sidebar-head">
            <span className="side-title">{VIEW_TITLE[sidebarView]}</span>
            {sidebarView === "tree" && (
              <div className="side-actions">
                <div className="side-menu-wrap">
                  <button
                    className={`side-act${sortMenu ? " is-on" : ""}`}
                    // 关菜单靠 window 上的 mousedown。不拦下这一发的话，点按钮
                    // 会先被关掉再被 onClick 打开，看起来就是「点了没反应」
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setSortMenu((v) => !v)}
                    title="排序方式。直接拖动文件也会切到手动排序"
                    aria-label="排序方式"
                    aria-expanded={sortMenu}
                  >
                    <Icon name="sort" size={15} />
                  </button>
                  {sortMenu && (
                    <ul className="side-menu" onMouseDown={(e) => e.stopPropagation()}>
                      {(Object.keys(SORT_LABELS) as TreeSort[]).map((k) => (
                        <li key={k}>
                          <button
                            className={settings.treeSort === k ? "is-current" : ""}
                            onClick={() => {
                              setSortNotice(false);
                              setSortMenu(false);
                              updateSettings({ treeSort: k });
                            }}
                          >
                            {/* 勾始终占位，不然选中项的文字会比别的往右挪一格 */}
                            <span className="side-menu-check">
                              {settings.treeSort === k && <Icon name="check" size={12} />}
                            </span>
                            {SORT_LABELS[k]}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  className="side-act"
                  onClick={() => void createAndOpen(null)}
                  title={hint("新建文档", keyOf("note.new"))}
                  aria-label="新建文档"
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>
            )}
          </header>

          {/* 视图本体单独滚，好让 vault 那一条钉在底部 */}
          <div className="sidebar-body">
            {sortNotice && sidebarView === "tree" && (
              <p className="hint">已切换到手动排序。想换回按名称排，用上面的排序按钮</p>
            )}

            {vault.createdRepo && (
              <p className="hint">已初始化为 git 仓库（分支 main），并写入 .gitignore</p>
            )}
            {vault.renamedBranch && <p className="hint">空仓库的分支已从 master 改为 main</p>}

            {sidebarView === "tree" && (
              <Tree
                nodes={sortedTree}
                activePath={note?.path ?? null}
                onOpen={(n, o) => openPath(n.path, o)}
                onAddChild={(n) => void createAndOpen(n.path)}
                onMenu={(node, x, y) => setMenu({ node, x, y })}
                onMove={moveNode}
                onReorder={reorder}
                renamingPath={renaming}
                onRenameSubmit={(p, v) => void submitRename(p, v)}
                onRenameCancel={() => setRenaming(null)}
              />
            )}
            {sidebarView === "search" && <SearchView onPick={openPath} revision={revision} />}
            {sidebarView === "tags" && (
              <TagsView onPick={openPath} activePath={note?.path ?? null} revision={revision} />
            )}
            {sidebarView === "template" && (
              <TemplatesView
                templates={templates}
                dir={settings.templateDir}
                hasNote={!!note}
                activePath={note?.path ?? null}
                onInsert={(t) => void insertTemplate(t.path)}
                onCreate={(t) => void createFromTemplate(t.path, null)}
                onOpen={(p) => void openPath(p)}
                onNew={() => void createTemplate()}
                onRename={setRenaming}
                onDelete={(t) => {
                  const node = tree.flatMap(flatten).find((candidate) => candidate.path === t.path);
                  if (node) void deleteNode(node);
                }}
                renamingPath={renaming}
                onRenameSubmit={(path, title) => void submitRename(path, title)}
                onRenameCancel={() => setRenaming(null)}
              />
            )}
            {sidebarView === "history" && (
              <HistoryView
                root={vault.root}
                revision={revision}
                identity={identity}
                collaborationEnabled={!!remote?.url}
                onSeen={markCollaborationSeen}
                selected={diffSelection}
                onDiff={(selection) => void openDiff(selection)}
                onRestore={(commit, path) => void restoreFile(commit, path)}
                onDiscard={(file) => void discardWorkingFile(file)}
                onReview={setReviewing}
              />
            )}
            {sidebarView === "outline" &&
              (note ? (
                <OutlineView
                  headings={headings}
                  activeIndex={activeHeadingIdx}
                  onPick={gotoHeading}
                />
              ) : (
                <p className="side-empty">先打开一篇笔记。</p>
              ))}
          </div>

          {/* 当前在哪个库 —— 常驻底部，点它换库。和 Obsidian 一个位置 */}
          <footer className="sidebar-foot">
            {mobile ? (
              <div className="vault-name is-static" title={vault.root}>
                <Icon name="vault" size={14} />
                <span>{vault.name}</span>
              </div>
            ) : (
              <VaultSwitcher
                vaults={recentVaults}
                current={vault}
                switching={switchingVault}
                onSwitch={(path) => void switchToVault(path)}
                onOpenFolder={() => void openVault()}
                onJoin={() => {
                  setJoinError(null);
                  setJoinOpen(true);
                }}
                onManage={() => {
                  setVaultError(null);
                  setVaultManagerOpen(true);
                }}
              />
            )}
          </footer>

          {/* 拖右边缘调宽度。双击回默认 */}
          <div
            className="sidebar-resizer"
            onMouseDown={startSidebarDrag}
            onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_W)}
            title="拖动调整宽度，双击复位"
            role="separator"
            aria-orientation="vertical"
          />
        </aside>
      )}

      <TabBar
        tabs={tabState.tabs}
        active={tabState.active}
        pinnedCount={tabState.pinnedCount}
        dirtyPath={saveState === "dirty" ? (note?.path ?? null) : null}
        icons={iconMap}
        onPick={(i) => {
          // 点标签就是明确地回到笔记。尤其是点当前标签时，applyTabs 会因为
          // 路径没变而直接返回，不能指望它顺手关掉差异页。
          if (diffSelection) closeDiff();
          setProjectCenterOpen(false);
          setProjectOpen(isProject(note));
          void applyTabs(gotoTab(tabsRef.current, i));
        }}
        onClose={closeTabAt}
        onCloseOthers={closeOtherTabs}
        // 固定只是重排标签栏，不换页 —— 和拖动一样走 retagTabs
        onTogglePin={(i) => retagTabs((s) => togglePin(s, i))}
        onMove={(from, to) => retagTabs((s) => moveTab(s, from, to))}
        // 标签栏的 `+` = 新建文档，而且**一定**开在新标签上：按下它的那一刻
        // 就是在说「我要多一页」，这时候还去看设置里的默认打开方式没有意义
        onNewTab={() => void createAndOpen(null, { newTab: true })}
      />

      {/* 思维导图铺满编辑区。**放在 main 外面、和它占同一片区域** ——
          Editor 必须留在 DOM 里：图上的每一次改动都要走它的 dispatch，
          卸载了就没有编辑器可 dispatch，撤销历史也一并没了（§4.7） */}
      {note && mindmapOpen && !diffSelection && !projectCenterOpen && (
        <MindMap
          key={note.path}
          storageKey={note.path}
          title={note.title}
          body={body}
          touch={mobile}
          onEdit={(e) => editorRef.current?.replaceLines(e.fromLine, e.toLine, e.insert)}
          onUndo={() => editorRef.current?.undo()}
          onRedo={() => editorRef.current?.redo()}
          onGoto={(line) => {
            setMindmapOpen(false);
            // 等这一轮渲染把导图撤掉、编辑器重新可见，再跳
            requestAnimationFrame(() => editorRef.current?.gotoLine(line));
          }}
          onClose={() => setMindmapOpen(false)}
        />
      )}

      {projectCenterOpen && (
        <ProjectCenter
          revision={revision}
          promotableNote={note && !isProject(note) ? note.title : null}
          onOpen={(path) => void openPath(path)}
          onNew={() => void createProjectAndOpen()}
          onPromote={() => void toggleProject()}
          onClose={() => setProjectCenterOpen(false)}
          onError={setError}
        />
      )}

      {note && projectOpen && !diffSelection && !projectCenterOpen && (
        <ProjectDashboard
          key={note.path}
          project={note}
          notes={noteList}
          revision={revision}
          onOpen={(path) => void openPath(path)}
          onEdit={() => setProjectOpen(false)}
          onChanged={() => {
            void refresh();
            void reloadFromDisk();
            setRevision((value) => value + 1);
          }}
          onError={setError}
        />
      )}

      <main className="main" ref={mainRef}>
        {externalChange && !diffSelection && (
          <div className="banner">
            <span>文件已被外部程序修改</span>
            <button onClick={reloadFromDisk}>加载外部版本</button>
            <button onClick={saveNow}>保留我的</button>
          </div>
        )}

        {diffSelection ? (
          <DiffView selection={diffSelection} revision={revision} onClose={closeDiff} />
        ) : note ? (
          <Editor
            key={note.path}
            note={note}
            onChange={(v) => {
              setBody(v);
              setSaveState("dirty");
            }}
            onSaveNow={saveNow}
            onFollowLink={followLink}
            getNotes={() => noteListRef.current}
            breadcrumb={breadcrumb}
            onPickIcon={(at) => setIconFor({ path: note.path, at })}
            onNavigate={openPath}
            handleRef={editorRef}
            revision={revision}
            onNoteChanged={() => {
              // 属性条和 database 视图都会改 frontmatter，改完必须**重读
              // 这篇笔记**，否则界面上还是旧的属性值。正文没变，所以
              // 编辑器里的光标和撤销历史不会被打断
              void reloadFromDisk();
              void refresh();
              setRevision((v) => v + 1);
            }}
            customSnippets={settings.customSnippets}
            slashHidden={settings.slashHidden}
            slashCustom={settings.slashCustom}
            sourceMode={sourceMode}
            journalKeep={settings.journalKeep}
            onSaveFrontmatter={saveFrontmatter}
            onSaveImage={saveImage}
            imageSrc={imageSrc}
            onError={setError}
            restoreState={editorStates.current.get(note.path) ?? null}
            onStashState={(s) => editorStates.current.set(note.path, s)}
          />
        ) : (
          // 空状态是「顺便教一下快捷键」最自然的位置 —— 不做插件系统的软件，
          // 功能全靠内置，用户没有别的地方能发现它们
          <div className="empty">
            <p className="empty-lead">从左侧选一篇笔记开始</p>
            {/* 键位从命令表里现取：用户改过之后，这里教的必须是他自己那一套 */}
            <ul className="empty-keys">
              {(
                ([
                  ["note.switch", "跳转到某篇笔记"],
                  ["view.palette", "命令面板"],
                  ["note.search", "全文搜索"],
                  // 移动端没有终端，也没有能按这些快捷键的键盘可言，
                  // 但前三条至少还有对应的界面入口，终端这条纯属误导
                  ...(mobile ? [] : ([["term.toggle", "终端"]] as const)),
                ] as const)
              ).map(([id, what]) => {
                const k = keyOf(id);
                return k ? (
                  <li key={id}>
                    <kbd>{k}</kbd> {what}
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        )}
      </main>

      {/* 浮动目录压在编辑区右侧：它和 <main> 占同一个 grid area（网格项
          本来就可以重叠），于是侧栏收起、终端打开时它自己会跟着挪，
          不需要任何 JS 参与布局。
          只有一条标题时不显示 —— 那不叫目录，只是一块挡视线的东西 */}
      {note && !diffSelection && !mindmapOpen && !projectOpen && !projectCenterOpen && tocFloat && headings.length >= 2 && (
        <OutlineFloat headings={headings} activeIndex={activeHeadingIdx} onPick={gotoHeading} />
      )}

      {termOpen && !mobile && (
        <TerminalPanel
          key={vault.root}
          dock={termDockEffective}
          size={termDockEffective === "bottom" ? termHeight : termWidth}
          onSizeChange={(px) => {
            if (termDockEffective === "bottom") {
              setTermHeight(px);
              localStorage.setItem("verso.termHeight", String(px));
            } else {
              setTermWidth(px);
              localStorage.setItem("verso.termWidth", String(px));
            }
          }}
          // 窄屏没有「靠右」这个选项，那个按钮就不该在（§7.3）
          onDockToggle={narrow ? undefined : toggleTermDock}
          onClose={() => setTermOpen(false)}
          fontSize={settings.terminalFontSize}
          dark={effectiveTheme === "dark"}
          theme={`${effectiveTheme}/${settings.terminalFont}/${settings.monoFont}`}
        />
      )}

      {/* §5.5 公式工具条。只在窄屏、且真的打开了一篇笔记时出现 ——
          它占的是软键盘上方那一条，没有编辑对象时那一条不该存在。
          终端开着时也不显示：两个都想占底部，而在手机上根本没有终端 */}
      {narrow && note && !diffSelection && !termOpen && !mindmapOpen && !projectOpen && !projectCenterOpen && (
        <MathBar
          onInsert={(replacement) => editorRef.current?.insertSnippet(replacement)}
          onNext={() => editorRef.current?.nextStop()}
          onPrev={() => editorRef.current?.prevStop()}
        />
      )}

      <footer className="status">
        <span className={`dot dot-${saveState}`} />
        {{ saved: "已保存", dirty: "未保存", saving: "保存中…", error: "保存失败" }[saveState]}
        {sourceMode && (
          // 光看正文分不清「现在是源码模式」和「这篇笔记本来就没排版」，
          // 状态栏挂一条。做成按钮而不是文字：这是退出这个模式最直接的入口，
          // 也是不用键盘的那条路（§1.2）
          <button
            className="status-mode"
            onClick={toggleSourceMode}
            title={hint("退出源码模式", keyOf("view.sourceMode"))}
          >
            源码模式
          </button>
        )}
        {git?.enabled && (
          // 版本历史的状态点。**只说「有几个改动」**，不出现 commit / branch
          // 这些字眼 —— §2.8：对用户隐藏 git
          <button
            className={`status-git${git.dirty > 0 ? " is-dirty" : ""}`}
            onClick={() => void commitNow()}
            disabled={git.dirty === 0}
            title={
              git.dirty > 0
                ? `点一下立刻记一个版本（新增 ${git.added} · 更新 ${git.modified} · 删除 ${git.deleted}）`
                : git.lastMessage
                  ? `最近一次：${git.lastMessage}`
                  : "还没有版本记录"
            }
          >
            <Icon name="history" size={13} />
            {git.dirty > 0 ? `${git.dirty} 个改动` : "已记录"}
          </button>
        )}
        {remote?.url && (
          // 同步。**只有配了远端才出现** —— 没配的人不该看见一个永远点不动的按钮
          <button
            className={`status-git${syncing ? " is-busy" : ""}`}
            onClick={() => void syncNow()}
            disabled={syncing}
            title={syncing ? "正在同步…" : `和 ${remote.url} 对齐一次`}
          >
            <Icon name="sync" size={13} />
            {syncing ? "同步中…" : "同步"}
          </button>
        )}
        {remote?.url && recentVaults.some((item) => item.root === vault.root && item.shared) && (
          <button
            className={`status-git${reviewBusy ? " is-busy" : ""}`}
            onClick={() => void submitSuggestion()}
            disabled={reviewBusy || syncing}
            title="把本地变化交给其他成员审阅，不直接进入正式版本"
          >
            <Icon name="people" size={13} />
            {reviewBusy ? "处理中…" : "提交建议"}
          </button>
        )}
        {(updater.state.phase === "found" ||
          updater.state.phase === "downloading" ||
          updater.state.phase === "ready") && (
          // 有新版本时才出现（§2.11）。**不弹窗、不打断** —— 更新这件事
          // 永远没有「正在写的这句话」重要，所以它只在状态栏上等着
          <button
            className={`status-git${updater.state.phase === "ready" ? " is-dirty" : ""}`}
            onClick={() => openSettings("update")}
            title="到设置里看看这一版改了什么"
          >
            <Icon name="arrow-down" size={13} />
            {updater.state.phase === "downloading"
              ? "下载中…"
              : updater.state.phase === "ready"
                ? "重启即可更新"
                : `新版本 ${updater.state.version}`}
          </button>
        )}
        {note && (
          // 显示字数而不是 id：id 是给链接用的内部标识，写东西的人关心的是
          // 写了多少。中文按字符数算才有意义 —— 按空格切词对中文永远是 1
          <span className="status-count" title={note.id ? `id ${note.id}` : undefined}>
            {countChars(body)} 字
          </span>
        )}
        {notice && <span className="status-notice">{notice}</span>}
        {error && <span className="error">{error}</span>}
      </footer>

      {symbolOpen && (
        <SymbolPanel
          customSnippets={settings.customSnippets}
          onInsert={(replacement) => {
            setSymbolOpen(false);
            editorRef.current?.insertSnippet(replacement);
          }}
          onClose={() => setSymbolOpen(false)}
        />
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}

      {reviewing && (
        <ReviewDialog
          suggestion={reviewing}
          busy={reviewBusy}
          onClose={() => !reviewBusy && setReviewing(null)}
          onSubmit={(accepted) => void finishReview(reviewing, accepted)}
        />
      )}

      {conflicts && (
        <ConflictView
          conflicts={conflicts}
          busy={syncing || reviewBusy}
          onCancel={() => {
            setConflicts(null);
            setReviewConflict(null);
          }}
          onSubmit={(r) => void resolveConflicts(r)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          commands={commands}
          onChange={updateSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          remote={remote}
          tokenSaved={tokenSaved}
          identity={identity}
          githubAccount={githubAccount}
          githubChecking={githubChecking}
          onRemoteChange={(url) => void setRemoteUrl(url)}
          onTokenChange={(token) => void setToken(token)}
          onIdentityChange={(name, email) => void setGitIdentity(name, email)}
          onGitHubCheck={checkShareGitHub}
          onGitHubConnect={connectGitHub}
          onGitHubDisconnect={disconnectGitHub}
          agentsDocAvailable={!!vault}
          onOpenAgentsDoc={() => {
            setSettingsOpen(false);
            void openPath("AGENTS.md", { newTab: true });
          }}
          onRewriteAgentsDoc={async () => {
            const currentPath = noteRef.current?.path;
            if (
              (currentPath === "AGENTS.md" || currentPath === "CLAUDE.md") &&
              dirtyRef.current
            ) {
              await saveNow();
            }
            await api.agentsDocWrite();
            if (currentPath === "AGENTS.md" || currentPath === "CLAUDE.md") {
              await loadNote(currentPath);
            }
            setNotice("已恢复 AGENTS.md 和 CLAUDE.md 的默认说明");
            setGitActivity((v) => v + 1);
          }}
          update={updater}
          initialTab={settingsTab}
        />
      )}

      {vaultManagerOpen && !mobile && (
        <VaultManager
          vaults={recentVaults}
          current={vault}
          switching={switchingVault}
          error={vaultError}
          onSwitch={(path) => void switchToVault(path)}
          onOpenFolder={() => void openVault()}
          onJoin={() => {
            setVaultManagerOpen(false);
            setJoinError(null);
            setJoinOpen(true);
          }}
          onForget={(path) => void forgetVault(path)}
          onManageShared={(root) => void manageSharedSpace(root)}
          onClose={() => setVaultManagerOpen(false)}
        />
      )}

      {managedSpace && !mobile && (
        <SharedSpaceDialog
          space={managedSpace}
          privateVaults={recentVaults}
          account={githubAccount}
          busy={sharing}
          onLoadAccess={api.shareSpaceAccess}
          onInvite={api.sharedSpaceInvite}
          onRemove={api.sharedSpaceRemoveMember}
          onUnshare={unshareNote}
          onClose={() => !sharing && setManagedSpace(null)}
        />
      )}

      {joinOpen && !mobile && (
        <JoinVaultDialog
          busy={joining}
          error={joinError}
          onPickFolder={pickCloneFolder}
          onJoin={(input) => void joinVault(input)}
          onClose={() => !joining && setJoinOpen(false)}
        />
      )}

      {sharePreview && !mobile && (
        <ShareNoteDialog
          preview={sharePreview}
          spaces={shareSpaces}
          identity={identity}
          githubAccount={githubAccount}
          githubChecking={githubChecking}
          onCheckGitHub={checkShareGitHub}
          onCheckSpaceAccess={api.shareSpaceAccess}
          onOpenConnectionSettings={() => {
            setSharePreview(null);
            openSettings("sync");
          }}
          busy={sharing}
          error={shareError}
          onPickFolder={pickCloneFolder}
          onShare={(input) => void shareNote(input)}
          onClose={() => !sharing && setSharePreview(null)}
        />
      )}

      {moveFor && (
        <MoveTargetPicker
          notes={noteList}
          icons={iconMap}
          moving={{ path: moveFor.path, childDir: moveFor.childDir, name: moveFor.name }}
          onPick={(target) => {
            const n = moveFor;
            setMoveFor(null);
            void moveNode(n.path, target);
          }}
          onClose={() => setMoveFor(null)}
        />
      )}

      {switcherOpen && (
        <QuickSwitcher
          notes={noteList}
          icons={iconMap}
          onPick={(p) => {
            setSwitcherOpen(false);
            void openPath(p);
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      )}

      {iconFor && (
        <IconPicker
          current={iconMap[iconFor.path] ?? null}
          anchor={iconFor.at}
          onPick={(ch) => void setNoteIcon(iconFor.path, ch)}
          onClose={() => setIconFor(null)}
        />
      )}

      {templateFor && (
        <TemplatePicker
          templates={templates}
          dir={settings.templateDir}
          title={templateFor.mode === "insert" ? "插入模板…" : "用哪个模板新建…"}
          onPick={(t) => {
            const what = templateFor;
            setTemplateFor(null);
            if (what.mode === "insert") void insertTemplate(t.path);
            else void createFromTemplate(t.path, what.parent);
          }}
          onClose={() => setTemplateFor(null)}
        />
      )}

      {menu && (
        <ul ref={menuRef} className="ctx" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {/* Ctrl/⌘+点 和中键都要键盘或三键鼠标。这一条是它们的等价入口 ——
              §0：只能用快捷键完成的操作必须有能点的地方 */}
          {menu.node.kind === "document" && (
            <li>
              <button
                onClick={() => {
                  setMenu(null);
                  void openPath(menu.node.path, { newTab: true });
                }}
              >
                在新标签页打开
              </button>
            </li>
          )}
          {menu.node.kind === "document" &&
            !mobile &&
            !recentVaults.some((item) => item.root === vault?.root && item.shared) && (
              <li>
                <button
                  onClick={() => {
                    const { node } = menu;
                    void beginShareNote(node);
                  }}
                >
                  {menu.node.childDir || menu.node.children.length > 0 ? "共享这个项目…" : "共享这篇…"}
                </button>
              </li>
            )}
          <li>
            <button
              onClick={() => {
                setMenu(null);
                void createAndOpen(menu.node.path);
              }}
            >
              新建子文档
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                const parent = menu.node.path;
                setMenu(null);
                setTemplateFor({ mode: "new", parent });
              }}
            >
              用模板新建子文档…
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                setMenu(null);
                renameNode(menu.node);
              }}
            >
              重命名
            </button>
          </li>
          {/* §2.1：把纯文件夹升级成文档节点。升级之后图标、打开、拖拽这些
              文档才有的能力就都有了 */}
          {menu.node.kind === "folder" && (
            <li>
              <button
                onClick={() => {
                  const { node } = menu;
                  setMenu(null);
                  void upgradeFolder(node);
                }}
              >
                创建为文档
              </button>
            </li>
          )}
          {/* 纯文件夹没有同名 .md，也就没有能放 `icon:` 的 frontmatter ——
              §0 第 1 条要求图标跟着用户的文件走，不另建一份索引外的状态 */}
          {menu.node.kind === "document" && (
            <li>
              <button
                onClick={() => {
                  const { node, x, y } = menu;
                  setMenu(null);
                  setIconFor({ path: node.path, at: { x, y } });
                }}
              >
                {menu.node.icon ? "换个图标…" : "设置图标…"}
              </button>
            </li>
          )}
          {/* 上移/下移/移动到…：拖拽的可点击等价物（M6）。触摸屏上
              HTML5 拖放完全不可用，没有这几条，手机上就无法调整结构。
              和拖拽一样只给文档 —— 纯文件夹没有同名文档，当不了拖拽源 */}
          {menu.node.kind === "document" &&
            (() => {
              const sibs = displaySiblings(menu.node.path);
              const idx = sibs.indexOf(menu.node.path);
              return (
                <>
                  <li>
                    <button
                      disabled={idx <= 0}
                      onClick={() => {
                        const { node } = menu;
                        const target = sibs[idx - 1];
                        setMenu(null);
                        void reorder(node.path, target, "before");
                      }}
                    >
                      上移
                    </button>
                  </li>
                  <li>
                    <button
                      disabled={idx < 0 || idx >= sibs.length - 1}
                      onClick={() => {
                        const { node } = menu;
                        const target = sibs[idx + 1];
                        setMenu(null);
                        void reorder(node.path, target, "after");
                      }}
                    >
                      下移
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => {
                        const { node } = menu;
                        setMenu(null);
                        setMoveFor(node);
                      }}
                    >
                      移动到…
                    </button>
                  </li>
                </>
              );
            })()}
          <li>
            <button
              onClick={() => {
                setMenu(null);
                moveNode(menu.node.path, null);
              }}
            >
              移到顶层
            </button>
          </li>
          <li>
            <button
              className="ctx-danger"
              onClick={() => {
                setMenu(null);
                deleteNode(menu.node);
              }}
            >
              删除
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
