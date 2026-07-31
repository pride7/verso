import { useCallback, useEffect, useRef, useState } from "react";

import { api, pickVaultFolder } from "./api";
import { Editor, type EditorHandle } from "./components/Editor";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { SymbolPanel } from "./components/SymbolPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { Tree } from "./components/Tree";
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
  const [menu, setMenu] = useState<Menu | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const [termOpen, setTermOpenRaw] = useState(
    () => localStorage.getItem("folio.termOpen") === "1",
  );
  /** 面板开关状态跨会话保留 —— 关掉的人不想每次启动又见到它 */
  const setTermOpen = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setTermOpenRaw((prev) => {
      const v = typeof next === "function" ? next(prev) : next;
      localStorage.setItem("folio.termOpen", v ? "1" : "0");
      return v;
    });
  }, []);
  // 面板高度记在 localStorage —— 调好一次就别再调第二次。
  // vault 级的 UI 状态（§2.1 workspace.json）等 M3 有配置系统了再搬过去。
  const [termHeight, setTermHeight] = useState(() => {
    const saved = Number(localStorage.getItem("folio.termHeight"));
    return Number.isFinite(saved) && saved >= 120 ? saved : 280;
  });

  // 「磁盘上这份文件最后一次由我们写入时的 mtime」。
  // 放 ref 不放 state：焦点事件的闭包里要读最新值，state 会拿到旧值。
  const savedMtime = useRef<number>(0);
  const bodyRef = useRef(body);
  const noteRef = useRef(note);
  const dirtyRef = useRef(false);
  bodyRef.current = body;
  noteRef.current = note;
  dirtyRef.current = saveState === "dirty";

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
      if (mod && e.key.toLowerCase() === "p" && !e.shiftKey) {
        e.preventDefault();
        setSwitcherOpen(true);
      } else if (mod && e.key === "`") {
        // 沿用 VS Code 的肌肉记忆（§7.3）
        e.preventDefault();
        setTermOpen((v) => !v);
      } else if (mod && e.key === "/") {
        // §5.3 符号面板：覆盖 snippet 记不住的长尾
        e.preventDefault();
        setSymbolOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  if (!vault) {
    return (
      <div className="welcome">
        <h1>Folio</h1>
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

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="sidebar-head">
          <span className="vault-name" title={vault.root}>
            {vault.name}
          </span>
          <div className="sidebar-actions">
            <button onClick={() => createAndOpen(null, "新建文档")} title="新建文档">
              ＋
            </button>
            <button onClick={() => setSwitcherOpen(true)} title="快速跳转 (Ctrl+P)">
              ⌕
            </button>
            <button
              className={termOpen ? "is-on" : undefined}
              onClick={() => setTermOpen((v) => !v)}
              onContextMenu={(e) => {
                // 右键改成调起独立的系统终端窗口（§7.3 方案 A）
                e.preventDefault();
                api.openTerminal(null).catch((err) => setError((err as Error).message));
              }}
              title="终端 (Ctrl+`)　右键：在系统终端中打开"
            >
              ▤
            </button>
            <button onClick={openVault} title="切换 vault">
              ⤢
            </button>
          </div>
        </header>

        {vault.createdRepo && (
          <p className="hint">已初始化为 git 仓库（分支 main），并写入 .gitignore</p>
        )}
        {vault.renamedBranch && <p className="hint">空仓库的分支已从 master 改为 main</p>}

        <Tree
          nodes={tree}
          activePath={note?.path ?? null}
          onOpen={(n) => openPath(n.path)}
          onAddChild={(n) => createAndOpen(n.path, `在「${n.name}」下新建子文档`)}
          onMenu={(node, x, y) => setMenu({ node, x, y })}
          onMove={moveNode}
        />
      </aside>

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
            breadcrumb={breadcrumb}
            onNavigate={openPath}
            handleRef={editorRef}
          />
        ) : (
          <div className="empty">
            从左侧选一篇笔记，或按 <kbd>Ctrl</kbd>+<kbd>P</kbd> 跳转
          </div>
        )}
      </main>

      {termOpen && (
        <TerminalPanel
          height={termHeight}
          onHeightChange={(h) => {
            setTermHeight(h);
            localStorage.setItem("folio.termHeight", String(h));
          }}
          onClose={() => setTermOpen(false)}
        />
      )}

      <footer className="status">
        <span className={`dot dot-${saveState}`} />
        {{ saved: "已保存", dirty: "未保存", saving: "保存中…", error: "保存失败" }[saveState]}
        {note?.id && <span className="status-id">id {note.id}</span>}
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
