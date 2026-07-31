import { useCallback, useEffect, useRef, useState } from "react";

import { api, pickVaultFolder } from "./api";
import { Editor } from "./components/Editor";
import { Tree } from "./components/Tree";
import type { NoteContent, TreeNode, VaultInfo } from "./types";
import "./styles.css";

const AUTOSAVE_MS = 800; // §2.7 保存策略

type SaveState = "saved" | "dirty" | "saving" | "error";

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [note, setNote] = useState<NoteContent | null>(null);
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  /** 外部程序（AI CLI、git、另一个编辑器）改了当前文件 —— §7.4 */
  const [externalChange, setExternalChange] = useState(false);

  // 「磁盘上这份文件最后一次由我们写入时的 mtime」。
  // 放 ref 不放 state：焦点事件的闭包里要读最新值，state 会拿到旧值。
  const savedMtime = useRef<number>(0);
  const bodyRef = useRef(body);
  const noteRef = useRef(note);
  bodyRef.current = body;
  noteRef.current = note;

  const refreshTree = useCallback(async () => {
    try {
      setTree(await api.tree());
    } catch (e) {
      setError((e as Error).message);
    }
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
      await refreshTree();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refreshTree]);

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

  const openNote = useCallback(
    async (node: TreeNode) => {
      if (noteRef.current && saveState === "dirty") await saveNow();
      try {
        const content = await api.readNote(node.path);
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
    [saveNow, saveState],
  );

  const createAndOpen = useCallback(
    async (parentDoc: string | null, promptLabel: string) => {
      const title = window.prompt(promptLabel, "未命名");
      if (!title) return;
      try {
        const meta = await api.createNote(parentDoc, title);
        await refreshTree();
        await openNote({
          name: meta.title,
          path: meta.path,
          kind: "document",
          childDir: null,
          children: [],
        });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refreshTree, openNote],
  );

  // 启动时自动重开上次的 vault —— 每次启动都要重选目录是不能接受的
  useEffect(() => {
    void (async () => {
      try {
        const info = await api.reopenLastVault();
        if (!info) return;
        setVault(info);
        setTree(await api.tree());
      } catch {
        /* 上次的目录没了就停在欢迎页 */
      }
    })();
  }, []);

  // 自动保存：停止输入 AUTOSAVE_MS 后落盘
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(saveNow, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [body, saveState, saveNow]);

  // §7.4 —— 窗口重新获得焦点时比对 mtime，看文件有没有被外部程序改过。
  // 有了终端跑 AI 之后这是日常主路径：没有这个检查，用完 AI 回到编辑器
  // 一保存就把它的修改全覆盖了。会丢数据，所以 M0 就得有。
  useEffect(() => {
    const onFocus = async () => {
      const n = noteRef.current;
      if (!n) return;
      try {
        const mtime = await api.statNote(n.path);
        if (mtime !== savedMtime.current) setExternalChange(true);
      } catch {
        /* 文件可能已被删除，留给下一次操作报错 */
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // 失焦立即保存（§2.7）
  useEffect(() => {
    const onBlur = () => {
      if (saveState === "dirty") void saveNow();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [saveState, saveNow]);

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
      await refreshTree();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refreshTree]);

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
            <button onClick={openVault} title="切换 vault">
              ⤢
            </button>
          </div>
        </header>

        {vault.createdRepo && <p className="hint">已初始化为 git 仓库，并写入 .gitignore</p>}

        <Tree
          nodes={tree}
          activePath={note?.path ?? null}
          onOpen={openNote}
          onAddChild={(n) => createAndOpen(n.path, `在「${n.name}」下新建子文档`)}
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
            value={body}
            onChange={(v) => {
              setBody(v);
              setSaveState("dirty");
            }}
            onSaveNow={saveNow}
            breadcrumb={note.path.replace(/\.md$/, "").split("/")}
          />
        ) : (
          <div className="empty">从左侧选一篇笔记，或新建一篇</div>
        )}
      </main>

      <footer className="status">
        <span className={`dot dot-${saveState}`} />
        {{ saved: "已保存", dirty: "未保存", saving: "保存中…", error: "保存失败" }[saveState]}
        {note?.id && <span className="status-id">id {note.id}</span>}
        {error && <span className="error">{error}</span>}
      </footer>
    </div>
  );
}
