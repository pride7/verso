import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorState } from "@codemirror/state";

import { convertFileSrc } from "@tauri-apps/api/core";

import { api, onVaultChanged, pickVaultFolder } from "./api";
import { ActivityBar, type SidebarView } from "./components/ActivityBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Icon } from "./components/Icon";
import { Editor, type EditorHandle } from "./components/Editor";
import { OutlineFloat, OutlineView, useActiveHeading } from "./components/Outline";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { SearchView } from "./components/SearchView";
import { SettingsPanel } from "./components/SettingsPanel";
import { SymbolPanel } from "./components/SymbolPanel";
import { TagsView } from "./components/TagsView";
import { TerminalPanel } from "./components/TerminalPanel";
import { Tree } from "./components/Tree";
import { TabBar } from "./components/TabBar";
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
import { useEffectiveTheme, useSettings } from "./settings";
import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "./types";
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
  /** 排序菜单开着没有。做成菜单而不是原生 select —— 后者在头部占一大截宽度 */
  const [sortMenu, setSortMenu] = useState(false);
  // 侧栏宽度。和终端高度一样记在 localStorage：调好一次就别再调第二次
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("verso.sidebarWidth"));
    return clampSidebar(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_SIDEBAR_W);
  });
  const [menu, setMenu] = useState<Menu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const editorRef = useRef<EditorHandle | null>(null);
  /** 命令表的最新一份。全局快捷键从这里查，监听器就不必跟着命令表重装 */
  const commandsRef = useRef<Command[]>([]);
  const { settings, update: updateSettings, reset: resetSettings } = useSettings();
  const effectiveTheme = useEffectiveTheme(settings.theme);
  /** vault 内容变化的版本号。反向链接等派生视图靠它重查 */
  const [revision, setRevision] = useState(0);
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

  /**
   * 排序后的树。原始树保持 Rust 给的顺序，排序只影响显示 ——
   * 唯一会写文件的是手动排序，那是用户显式拖拽触发的
   */
  const sortedTree = useMemo(() => sortTree(tree, settings.treeSort), [tree, settings.treeSort]);


  /** 立即落盘。切笔记、失焦、Ctrl+S 都走这里。 */
  const saveNow = useCallback(async () => {
    const n = noteRef.current;
    if (!n) return;
    try {
      setSaveState("saving");
      savedMtime.current = await api.writeNote(n.path, bodyRef.current);
      setSaveState("saved");
      setExternalChange(false);
    } catch (e) {
      setSaveState("error");
      setError((e as Error).message);
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
      setNote(content);
      setBody(content.body);
      savedMtime.current = content.mtimeMs;
      setSaveState("saved");
      setExternalChange(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  /**
   * 打开一篇笔记。
   *
   * `newTab` 明确给了就听它的（Ctrl/⌘+点、中键），否则按设置里的
   * 「点文件时开新标签还是替换当前」。已经开着的那一篇总是切过去。
   */
  const openPath = useCallback(
    async (path: string, opts?: { newTab?: boolean }) => {
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
    if (!vault) return;
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

  const openVault = useCallback(async () => {
    try {
      const path = await pickVaultFolder();
      if (!path) return;
      const info = await api.openVault(path);
      setVault(info);
      setNote(null);
      setBody("");
      setError(null);
      await refresh();
      // 标签是 per-vault 的，换库要换成新库自己那一组
      await restoreTabs(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refresh, restoreTabs]);

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

  const createAndOpen = useCallback(
    async (parentDoc: string | null, promptLabel: string, opts?: { newTab?: boolean }) => {
      const title = window.prompt(promptLabel, "未命名");
      if (!title) return;
      try {
        const meta = await api.createNote(parentDoc, title);
        await refresh();
        await openPath(meta.path, opts);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, openPath],
  );

  const renameNode = useCallback(
    async (node: TreeNode) => {
      const title = window.prompt("重命名为", node.name);
      if (!title || title === node.name) return;
      try {
        const newPath = await api.renameNote(node.path, title);
        await refresh();
        // 开着的标签跟着改路径 —— 连同子树，重命名 `X.md` 时 `X/` 底下那些
        // 也全变了，不跟的话它们会指向不存在的文件
        retagTabs((s) => renameTab(s, node.path, newPath));
        // 改的正是当前打开的这篇，就跟着切到新路径，否则后续保存会写到旧路径
        if (noteRef.current?.path === node.path) await loadNote(newPath);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, loadNote, retagTabs],
  );

  const deleteNode = useCallback(
    async (node: TreeNode) => {
      const n = node.children.length;
      const withChildren =
        n > 0
          ? window.confirm(
              `「${node.name}」有 ${n} 个子文档。\n\n确定 = 连同子文档一起删除\n取消 = 只删除本文档，保留子文档`,
            )
          : false;
      if (n === 0 && !window.confirm(`删除「${node.name}」？`)) return;
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
      if (!window.confirm(`「${clean}」还不存在，现在新建？`)) return;
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
    void (async () => {
      try {
        const restored = await api.reopenLastVault();
        if (!restored) return;
        setVault(restored.vault);
        await refresh();
        await restoreTabs(restored.lastNote);
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

  // §2.7 文件监听推来的外部修改。比「窗口聚焦时比对 mtime」更及时 ——
  // AI 在终端里改文件时，窗口一直是聚焦的，那条路径根本不会触发。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onVaultChanged((paths) => {
      void refresh();
      setRevision((v) => v + 1);
      const cur = noteRef.current;
      if (cur && paths.includes(cur.path)) setExternalChange(true);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refresh]);

  // 失焦立即保存（§2.7）
  useEffect(() => {
    const onBlur = () => {
      if (dirtyRef.current) void saveNow();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [saveNow]);

  // 全局快捷键。键位不写在这里 —— 全部来自下面那张命令表（`commands`），
  // 用户在设置里改过的会盖掉默认值。见 `lib/keymap.ts`
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 浮层（命令面板、设置、快速跳转）里的按键归浮层自己管。设置里正在
      // 录快捷键时尤其重要：按下的组合键不能顺手把那条命令也执行一遍
      if (target?.closest?.(".overlay")) return;
      const spec = eventSpec(e);
      if (!spec) return;
      const hit = commandsRef.current.find((c) => c.binding === spec);
      if (!hit || hit.enabled === false) return;
      // **终端里键盘归 shell**。Ctrl+N/P/E/B 在 readline、vim、tmux 里全都
      // 有各自的意思，被界面截走的话终端就成了半个终端 —— 而在终端里跑
      // AI CLI 正是这个软件的主路径（§7.3）。只留两条出路：关掉终端、
      // 和命令面板
      if (target?.closest?.(".term") && hit.id !== "term.toggle" && hit.id !== "view.palette") {
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
    return [
      {
        id: "note.new",
        group: "笔记",
        label: "新建文档",
        defaultKeys: "Mod+N",
        run: () => createAndOpen(null, "新建文档"),
      },
      {
        id: "note.switch",
        group: "笔记",
        label: "快速跳转",
        defaultKeys: "Mod+P",
        run: () => setSwitcherOpen(true),
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
        defaultKeys: "Mod+B",
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
      {
        id: "formula.symbols",
        group: "公式",
        label: "符号面板",
        // §5.3 符号面板：覆盖 snippet 记不住的长尾
        defaultKeys: "Mod+/",
        run: () => setSymbolOpen(true),
      },
      {
        id: "term.toggle",
        group: "终端",
        label: "打开／关闭终端面板",
        // 沿用 VS Code 的肌肉记忆（§7.3）
        defaultKeys: "Mod+`",
        run: () => setTermOpen((v) => !v),
      },
      {
        id: "term.system",
        group: "终端",
        label: "在系统终端中打开",
        run: () => api.openTerminal(null).catch((e: Error) => setError(e.message)),
      },
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
        run: () => setSettingsOpen(true),
      },
      {
        id: "vault.switch",
        group: "vault",
        label: "切换 vault",
        run: () => void openVault(),
      },
      {
        id: "vault.reindex",
        group: "vault",
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
    tocFloat,
    toggleTocFloat,
    sourceMode,
    toggleSourceMode,
    pickView,
    createAndOpen,
    saveNow,
    renameNode,
    reloadFromDisk,
    openVault,
    setTermOpen,
    updateSettings,
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
      <div className="welcome">
        <h1>Verso</h1>
        <p className="welcome-sub">本地优先的笔记本</p>
        <button className="btn-primary" onClick={openVault}>
          打开 vault 目录
        </button>
        {error && <p className="error">{error}</p>}
      </div>
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
    outline: "大纲",
  };

  return (
    <div
      className={`app${sidebarOpen ? "" : " sidebar-collapsed"}`}
      style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <ActivityBar
        view={sidebarView}
        onView={pickView}
        keyOf={keyOf}
        sidebarOpen={sidebarOpen}
        sourceMode={sourceMode}
        onToggleSourceMode={toggleSourceMode}
        termOpen={termOpen}
        onToggleTerm={() => setTermOpen((v) => !v)}
        onSystemTerminal={() =>
          api.openTerminal(null).catch((err) => setError((err as Error).message))
        }
        onPalette={() => setPaletteOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

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
                  onClick={() => createAndOpen(null, "新建文档")}
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
                onAddChild={(n) => createAndOpen(n.path, `在「${n.name}」下新建子文档`)}
                onMenu={(node, x, y) => setMenu({ node, x, y })}
                onMove={moveNode}
                onReorder={reorder}
              />
            )}
            {sidebarView === "search" && <SearchView onPick={openPath} revision={revision} />}
            {sidebarView === "tags" && (
              <TagsView onPick={openPath} activePath={note?.path ?? null} revision={revision} />
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
            <button
              className="vault-name"
              title={`${vault.root}\n点击切换 vault`}
              onClick={openVault}
            >
              <Icon name="vault" size={13} />
              <span>{vault.name}</span>
            </button>
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
        onPick={(i) => void applyTabs(gotoTab(tabsRef.current, i))}
        onClose={closeTabAt}
        onCloseOthers={closeOtherTabs}
        // 固定只是重排标签栏，不换页 —— 和拖动一样走 retagTabs
        onTogglePin={(i) => retagTabs((s) => togglePin(s, i))}
        onMove={(from, to) => retagTabs((s) => moveTab(s, from, to))}
        // 标签栏的 `+` = 新建文档，而且**一定**开在新标签上：按下它的那一刻
        // 就是在说「我要多一页」，这时候还去看设置里的默认打开方式没有意义
        onNewTab={() => void createAndOpen(null, "新建文档", { newTab: true })}
      />

      <main className="main" ref={mainRef}>
        {externalChange && (
          <div className="banner">
            <span>文件已被外部程序修改</span>
            <button onClick={reloadFromDisk}>加载外部版本</button>
            <button onClick={saveNow}>保留我的</button>
          </div>
        )}

        {note ? (
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
            sourceMode={sourceMode}
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
                [
                  ["note.switch", "跳转到某篇笔记"],
                  ["view.palette", "命令面板"],
                  ["note.search", "全文搜索"],
                  ["term.toggle", "终端"],
                ] as const
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
      {note && tocFloat && headings.length >= 2 && (
        <OutlineFloat headings={headings} activeIndex={activeHeadingIdx} onPick={gotoHeading} />
      )}

      {termOpen && (
        <TerminalPanel
          height={termHeight}
          onHeightChange={(h) => {
            setTermHeight(h);
            localStorage.setItem("verso.termHeight", String(h));
          }}
          onClose={() => setTermOpen(false)}
          fontSize={settings.terminalFontSize}
          dark={effectiveTheme === "dark"}
          theme={`${effectiveTheme}/${settings.terminalFont}/${settings.monoFont}`}
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
        {note && (
          // 显示字数而不是 id：id 是给链接用的内部标识，写东西的人关心的是
          // 写了多少。中文按字符数算才有意义 —— 按空格切词对中文永远是 1
          <span className="status-count" title={note.id ? `id ${note.id}` : undefined}>
            {countChars(body)} 字
          </span>
        )}
        {error && <span className="error">{error}</span>}
      </footer>

      {symbolOpen && (
        <SymbolPanel
          onInsert={(latex) => {
            setSymbolOpen(false);
            editorRef.current?.insert(latex);
          }}
          onClose={() => setSymbolOpen(false)}
        />
      )}

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          commands={commands}
          onChange={updateSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {switcherOpen && (
        <QuickSwitcher
          notes={noteList}
          onPick={(p) => {
            setSwitcherOpen(false);
            void openPath(p);
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      )}

      {menu && (
        <ul className="ctx" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
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
          <li>
            <button
              onClick={() => {
                setMenu(null);
                createAndOpen(menu.node.path, `在「${menu.node.name}」下新建子文档`);
              }}
            >
              新建子文档
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
