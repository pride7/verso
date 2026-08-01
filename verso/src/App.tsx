import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { parseHeadings, type Heading } from "./lib/outline";
import { keyLabel } from "./lib/platform";
import { useEffectiveTheme, useSettings } from "./settings";
import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "./types";
import "katex/dist/katex.min.css";
import "./styles.css";

const AUTOSAVE_MS = 800; // §2.7 保存策略

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
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  // 侧栏显示哪个视图、以及展不展开。都跨会话保留 —— 收起侧栏是为了把
  // 编辑区拉宽，每次启动又弹回来就没意义了
  const [sidebarView, setSidebarView] = useState<SidebarView>(
    () => (localStorage.getItem("verso.sidebarView") as SidebarView | null) ?? "tree",
  );
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("verso.sidebarOpen") !== "0",
  );
  const [menu, setMenu] = useState<Menu | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const editorRef = useRef<EditorHandle | null>(null);
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

  const openPath = useCallback(
    async (path: string) => {
      if (noteRef.current && dirtyRef.current) await saveNow();
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
    },
    [saveNow],
  );

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
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refresh]);

  const createAndOpen = useCallback(
    async (parentDoc: string | null, promptLabel: string) => {
      const title = window.prompt(promptLabel, "未命名");
      if (!title) return;
      try {
        const meta = await api.createNote(parentDoc, title);
        await refresh();
        await openPath(meta.path);
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
        // 改的正是当前打开的这篇，就跟着切到新路径，否则后续保存会写到旧路径
        if (noteRef.current?.path === node.path) await openPath(newPath);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, openPath],
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
        if (noteRef.current?.path === node.path) {
          setNote(null);
          setBody("");
        }
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh],
  );

  const moveNode = useCallback(
    async (path: string, newParentDoc: string | null) => {
      try {
        const newPath = await api.moveNote(path, newParentDoc);
        await refresh();
        if (noteRef.current?.path === path) await openPath(newPath);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, openPath],
  );

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
        if (restored.lastNote) await openPath(restored.lastNote);
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

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        // 命令面板要排在快速切换器前面判断 —— 否则 Shift 被忽略，
        // Ctrl+Shift+P 会先被上一条吃掉
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === "p" && !e.shiftKey) {
        e.preventDefault();
        setSwitcherOpen(true);
      } else if (mod && e.key === ",") {
        // 沿用几乎所有桌面软件的「设置」快捷键
        e.preventDefault();
        setSettingsOpen(true);
      } else if (mod && e.key === "`") {
        // 沿用 VS Code 的肌肉记忆（§7.3）
        e.preventDefault();
        setTermOpen((v) => !v);
      } else if (mod && e.key === "/") {
        // §5.3 符号面板：覆盖 snippet 记不住的长尾
        e.preventDefault();
        setSymbolOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        // §2.2 全文搜索。沿用 VS Code 的 Ctrl+Shift+F
        e.preventDefault();
        // 已经在搜索视图时不要收起侧栏 —— 再按一次的意图是「回到搜索框」，
        // 不是「关掉搜索」。pickView 的 toggle 语义只对点图标成立
        if (sidebarOpen && sidebarView === "search") {
          document.getElementById("verso-search-input")?.focus();
        } else {
          pickView("search");
        }
      } else if (mod && e.key.toLowerCase() === "e" && !e.shiftKey) {
        // Obsidian 用 Ctrl+E 在源码与预览之间切，沿用它的肌肉记忆
        e.preventDefault();
        toggleSourceMode();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        // VS Code 的 Ctrl+Shift+O 是「跳转到符号」，笔记里的符号就是标题
        e.preventDefault();
        pickView("outline");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // pickView 依赖当前视图状态，漏掉的话 Ctrl+Shift+F 会用到旧的闭包，
    // 表现是切过一次视图之后快捷键就不灵了
  }, [pickView, sidebarOpen, sidebarView, setTermOpen, toggleSourceMode]);

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
   * 命令面板的命令表。
   *
   * 每条都带着快捷键一起显示 —— 一个不做插件系统的软件，功能全靠内置，
   * 命令面板是用户唯一能「发现」这些快捷键的地方。
   *
   * 依赖数组有意写全：`enabled` 依赖当前有没有打开笔记，漏掉的话面板里
   * 会显示出一条点了没反应的命令。
   */
  const commands: Command[] = useMemo(() => {
    const hasNote = !!note;
    const cur = note?.path ?? null;
    const node = cur ? tree.flatMap(flatten).find((n) => n.path === cur) : undefined;
    return [
      {
        id: "note.new",
        group: "笔记",
        label: "新建文档",
        run: () => createAndOpen(null, "新建文档"),
      },
      {
        id: "note.switch",
        group: "笔记",
        label: "快速跳转",
        keys: keyLabel("Mod+P"),
        run: () => setSwitcherOpen(true),
      },
      {
        id: "note.search",
        group: "笔记",
        label: "全文搜索",
        keys: keyLabel("Mod+Shift+F"),
        run: () => pickView("search"),
      },
      {
        id: "note.tags",
        group: "笔记",
        label: "标签面板",
        run: () => pickView("tags"),
      },
      {
        id: "note.outline",
        group: "笔记",
        label: "大纲",
        keys: keyLabel("Mod+Shift+O"),
        run: () => pickView("outline"),
      },
      {
        id: "view.tree",
        group: "外观",
        label: "文档树",
        run: () => pickView("tree"),
      },
      {
        id: "view.sidebar",
        group: "外观",
        label: sidebarOpen ? "收起侧栏" : "展开侧栏",
        run: () => pickView(sidebarView),
      },
      {
        id: "view.sourceMode",
        group: "外观",
        label: sourceMode ? "退出源码模式" : "源码模式",
        keys: keyLabel("Mod+E"),
        run: toggleSourceMode,
      },
      {
        id: "view.tocFloat",
        group: "外观",
        label: tocFloat ? "隐藏浮动大纲" : "显示浮动大纲",
        run: toggleTocFloat,
      },
      {
        id: "note.save",
        group: "笔记",
        label: "立即保存",
        keys: keyLabel("Mod+S"),
        enabled: hasNote,
        run: () => void saveNow(),
      },
      {
        id: "note.rename",
        group: "笔记",
        label: "重命名当前文档",
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
        id: "formula.symbols",
        group: "公式",
        label: "符号面板",
        keys: keyLabel("Mod+/"),
        run: () => setSymbolOpen(true),
      },
      {
        id: "term.toggle",
        group: "终端",
        label: "打开／关闭终端面板",
        keys: keyLabel("Mod+`"),
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
        label: `主题：切换到${{ system: "浅色", light: "深色", dark: "跟随系统" }[settings.theme]}`,
        run: () =>
          updateSettings({
            // 三态循环，跟系统设置里的行为一致
            theme: ({ system: "light", light: "dark", dark: "system" } as const)[settings.theme],
          }),
      },
      {
        id: "view.settings",
        group: "外观",
        label: "打开设置",
        keys: keyLabel("Mod+,"),
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
    <div className={`app${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <ActivityBar
        view={sidebarView}
        onView={pickView}
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
          <header className="sidebar-head">
            <span className="side-title">{VIEW_TITLE[sidebarView]}</span>
            {/* vault 名做成按钮：它本来就是「当前在哪个库」的指示，
                点它换库比多一个图标更自然 */}
            <button
              className="vault-name"
              title={`${vault.root}\n点击切换 vault`}
              onClick={openVault}
            >
              {vault.name}
            </button>
            {sidebarView === "tree" && (
              <button
                className="side-add"
                onClick={() => createAndOpen(null, "新建文档")}
                title="新建文档"
                aria-label="新建文档"
              >
                <Icon name="plus" />
              </button>
            )}
          </header>

          {vault.createdRepo && (
            <p className="hint">已初始化为 git 仓库（分支 main），并写入 .gitignore</p>
          )}
          {vault.renamedBranch && <p className="hint">空仓库的分支已从 master 改为 main</p>}

          {sidebarView === "tree" && (
            <Tree
              nodes={tree}
              activePath={note?.path ?? null}
              onOpen={(n) => openPath(n.path)}
              onAddChild={(n) => createAndOpen(n.path, `在「${n.name}」下新建子文档`)}
              onMenu={(node, x, y) => setMenu({ node, x, y })}
              onMove={moveNode}
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
        </aside>
      )}

      <main className="main">
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
              void refresh();
              setRevision((v) => v + 1);
            }}
            customSnippets={settings.customSnippets}
            sourceMode={sourceMode}
          />
        ) : (
          // 空状态是「顺便教一下快捷键」最自然的位置 —— 不做插件系统的软件，
          // 功能全靠内置，用户没有别的地方能发现它们
          <div className="empty">
            <p className="empty-lead">从左侧选一篇笔记开始</p>
            <ul className="empty-keys">
              <li>
                <kbd>{keyLabel("Mod+P")}</kbd> 跳转到某篇笔记
              </li>
              <li>
                <kbd>{keyLabel("Mod+Shift+P")}</kbd> 命令面板
              </li>
              <li>
                <kbd>{keyLabel("Mod+Shift+F")}</kbd> 全文搜索
              </li>
              <li>
                <kbd>{keyLabel("Mod+`")}</kbd> 终端
              </li>
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
            title={`退出源码模式 (${keyLabel("Mod+E")})`}
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
