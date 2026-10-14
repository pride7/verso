/**
 * AI 会话面板。DESIGN.md §7.8
 *
 * 面板本身不是 AI：它起一个用户自己配的 ACP 程序（通常是他那个 AI CLI 的
 * 适配器），把对话画出来，把 agent 要动手前的许可请求摆到人面前。模型、
 * 登录、计费都在那个程序里，Verso 一概不碰（§7.1、§7.5）。
 *
 * 和终端比，多出来的是三样终端给不了的东西：回答按 Markdown 和公式排好版、
 * 改了哪篇用 diff 摆出来再让人点头、当前笔记和选区一键带上。
 *
 * 一个进程里可以同时开着好几个对话（ACP 的 session），左上角那个名字点开
 * 就能切换；agent 支持的话，以前的对话也列在里面，点一下接着聊。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { version as APP_VERSION } from "../../package.json";
import { AGENT_PRESETS } from "../app/settings";
import {
  AcpConnection,
  AcpError,
  type ContentBlock,
  type NewSessionResult,
  type PermissionOutcome,
  type PermissionRequest,
  type SessionInfo,
} from "../core/acp";
import {
  applyUpdate,
  conversationRows,
  conversationTitle,
  fileUri,
  newConversation,
  PERMISSION_LABEL,
  relativeToVault,
  type ChatEntry,
  type Conversation,
  type FileDiff,
} from "../core/agentChat";
import { relTime } from "../core/relTime";
import type { FileDiff as TextDiff } from "../core/types";
import { renderMarkdown } from "../editor/exportHtml";
import { api, onAgentExit, onAgentLine, onAgentStderr } from "../host/api";
import { openExternalPage } from "../host/external";
import { UnifiedDiff } from "./DiffView";
import { Icon } from "./Icon";

/** 打开面板那一刻编辑器里的东西。App 现取现给 */
export interface AgentContext {
  /** 当前笔记在 vault 里的相对路径；没开笔记就是 null */
  path: string | null;
  /** 编辑器里选中的原文，没选就是空串 */
  selection: string;
}

interface Props {
  /** 设置里那一行命令（`settings.agentCommand`）。空串 = 还没选过 */
  command: string;
  /** 在面板里挑了一个常用的（第一次打开时） */
  onPickCommand: (command: string) => void;
  width: number;
  onWidthChange: (w: number) => void;
  /** 窄窗口上盖住编辑区，而不是再挤出一栏（同终端 §7.3「窄屏」） */
  cover: boolean;
  onClose: () => void;
  getContext: () => AgentContext;
  /** 发问之前先把正在改的那篇落盘 —— agent 读的是磁盘上的文件 */
  beforePrompt: () => Promise<void>;
  onOpenPath: (rel: string) => void;
  onOpenSettings: () => void;
}

/** 进程这一层的状态。每个对话自己忙不忙记在 `Conversation.busy` 上 */
type Phase =
  /** 还没选跑哪个 AI。什么都不起，等人挑 */
  | { kind: "choose" }
  | { kind: "starting" }
  | { kind: "ready" }
  /** 起不来，或者半路没了。`log` 是 stderr 的最后几行 */
  | { kind: "dead"; message: string; log: string[] };

interface PendingPermission {
  req: PermissionRequest;
  resolve: (o: PermissionOutcome) => void;
}

/** stderr 留多少行。够看清最后那个报错，又不至于把面板铺满 */
const LOG_LINES = 12;

/** 协议里「需要先登录」的错误码 */
const AUTH_REQUIRED = -32000;

const errorText = (e: unknown) =>
  e instanceof AcpError ? e.detail : e instanceof Error ? e.message : String(e);

export function AgentPanel({
  command,
  onPickCommand,
  width,
  onWidthChange,
  cover,
  onClose,
  getContext,
  beforePrompt,
  onOpenPath,
  onOpenSettings,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [agentName, setAgentName] = useState("");
  /** 这次打开面板之后开过的对话，按 id */
  const [convs, setConvs] = useState<Record<string, Conversation>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 每个对话手上最多一个没回答的许可请求（agent 问完一个才往下跑） */
  const [permissions, setPermissions] = useState<Record<string, PendingPermission>>({});
  /** agent 记着的以前的对话。null = 它不支持列出来 */
  const [past, setPast] = useState<SessionInfo[] | null>(null);
  const [canLoad, setCanLoad] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [ctx, setCtx] = useState<AgentContext>({ path: null, selection: "" });
  const [withNote, setWithNote] = useState(true);
  const [withSelection, setWithSelection] = useState(true);
  /** 换一下就重启进程（「重新启动」按钮） */
  const [generation, setGeneration] = useState(0);

  const connRef = useRef<AcpConnection | null>(null);
  const cwdRef = useRef("");
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 用户往上翻了就别再把他拽回底部 */
  const stickRef = useRef(true);

  const cb = useRef({ getContext, beforePrompt });
  cb.current = { getContext, beforePrompt };

  /** 改某一个对话。不在了（面板重启过）就什么都不做 */
  const patch = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConvs((all) => (all[id] ? { ...all, [id]: fn(all[id]) } : all));
  }, []);

  const dropPermission = useCallback((id: string, outcome: PermissionOutcome | null) => {
    const p = permissionsRef.current[id];
    if (!p) return;
    if (outcome) p.resolve(outcome);
    setPermissions((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }, []);

  /** 新开的对话记下来；agent 给了模式就一起记 */
  const adopt = useCallback((id: string, s: Pick<NewSessionResult, "modes">, title: string | null = null) => {
    setConvs((all) => ({
      ...all,
      [id]: {
        ...(all[id] ?? newConversation(id, Date.now(), title)),
        modes: s.modes?.availableModes ?? [],
        modeId: s.modes?.currentModeId ?? null,
      },
    }));
  }, []);

  // ---- 起进程、握手、开会话。卸载或「重新启动」时整个停掉
  useEffect(() => {
    // 没选过就不起任何东西 —— 默认替人跑一个他没选的程序，正是 §7.5 那条线
    if (!command.trim()) {
      setPhase({ kind: "choose" });
      return;
    }
    let disposed = false;
    let procId: string | null = null;
    const stderr: string[] = [];
    // 进程可能在 `agentStart` 返回之前就已经说话或者退出了（命令打错时
    // 几乎是立刻退出）—— 那时还不知道 id，先攒着，拿到 id 再按 id 认领
    const early: { kind: "line" | "err" | "exit"; id: string; line?: string; code?: number | null }[] = [];

    const cancelAll = () => {
      for (const p of Object.values(permissionsRef.current)) p.resolve({ outcome: "cancelled" });
      setPermissions({});
    };

    /** 第一个原因说了算：进程退出之后，还在等的请求会接着失败，那句「已经
     *  退出」不能盖掉前面带着退出码的那一句 */
    let dead = false;
    const die = (message: string) => {
      if (disposed || dead) return;
      dead = true;
      cancelAll();
      setConvs((all) => {
        const next: Record<string, Conversation> = {};
        for (const [k, c] of Object.entries(all)) next[k] = { ...c, busy: false, loading: false };
        return next;
      });
      setPhase({ kind: "dead", message, log: stderr.slice(-LOG_LINES) });
    };

    const handle = (e: (typeof early)[number]) => {
      if (e.id !== procId) return;
      if (e.kind === "line") connRef.current?.receive(e.line!);
      else if (e.kind === "err") {
        stderr.push(e.line!);
        if (stderr.length > 200) stderr.splice(0, stderr.length - 200);
      } else {
        connRef.current?.close(new Error("AI 进程已经退出"));
        die(e.code === null || e.code === undefined ? "AI 进程已经退出" : `AI 进程已经退出（退出码 ${e.code}）`);
      }
    };
    const route = (e: (typeof early)[number]) => (procId === null ? early.push(e) : handle(e));

    const unlisten = Promise.all([
      onAgentLine((e) => route({ kind: "line", ...e })),
      onAgentStderr((e) => route({ kind: "err", ...e })),
      onAgentExit((e) => route({ kind: "exit", id: e.id, code: e.code })),
    ]);

    setPhase({ kind: "starting" });
    setConvs({});
    setActiveId(null);
    setPast(null);
    setCanLoad(false);

    void (async () => {
      try {
        await unlisten;
        const [id, cwd] = await api.agentStart(command);
        if (disposed) {
          void api.agentStop(id);
          return;
        }
        cwdRef.current = cwd;
        const conn = new AcpConnection((line) => api.agentSend(id, line), {
          onUpdate: (n) => {
            const u = n.update;
            if (u.sessionUpdate === "current_mode_update") {
              const modeId = (u as { currentModeId: string }).currentModeId;
              patch(n.sessionId, (c) => ({ ...c, modeId }));
            } else if (u.sessionUpdate === "session_info_update") {
              const title = (u as { title?: string | null }).title;
              if (title) patch(n.sessionId, (c) => ({ ...c, title }));
            } else {
              patch(n.sessionId, (c) => {
                const entries = applyUpdate(c.entries, u);
                return entries === c.entries ? c : { ...c, entries };
              });
            }
          },
          onPermission: (req) =>
            new Promise<PermissionOutcome>((resolve) => {
              setPermissions((all) => ({ ...all, [req.sessionId]: { req, resolve } }));
            }),
        });
        connRef.current = conn;
        procId = id;
        for (const e of early.splice(0)) handle(e);

        const info = await conn.initialize(APP_VERSION);
        if (disposed) return;
        setAgentName(info.agentInfo?.title || info.agentInfo?.name || "");
        setCanLoad(!!info.agentCapabilities?.loadSession);
        if (info.agentCapabilities?.sessionCapabilities?.list) setPast([]);
        const session = await conn.newSession(cwd);
        if (disposed) return;
        adopt(session.sessionId, session);
        setActiveId(session.sessionId);
        setPhase({ kind: "ready" });
      } catch (e) {
        if (disposed) return;
        if (e instanceof AcpError && e.code === AUTH_REQUIRED) {
          die("需要先登录。在终端里运行一次你所用的 AI CLI（例如 claude 或 codex）完成登录，再点「重新启动」。");
        } else {
          die(errorText(e));
        }
      }
    })();

    return () => {
      disposed = true;
      cancelAll();
      connRef.current?.close(new Error("面板已关闭"));
      connRef.current = null;
      if (procId) void api.agentStop(procId);
      void unlisten.then((fns) => fns.forEach((f) => f()));
    };
  }, [command, generation, patch, adopt]);

  const active = activeId ? convs[activeId] ?? null : null;
  const entries = active?.entries ?? [];
  const permission = activeId ? permissions[activeId] ?? null : null;
  const ready = phase.kind === "ready" && !!active && !active.loading;
  const busy = !!active?.busy;

  // ---- 新内容进来时贴着底部；换了一个对话就直接到底
  useEffect(() => {
    stickRef.current = true;
  }, [activeId]);
  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries, permission, phase, activeId]);

  const refreshContext = useCallback(() => setCtx(cb.current.getContext()), []);
  useEffect(refreshContext, [refreshContext]);

  // ---- 对话列表：点开时才问 agent 要以前的，问一次很便宜，而它会变
  const openMenu = () => {
    setMenuOpen((v) => !v);
    const conn = connRef.current;
    if (!menuOpen && conn && past !== null) {
      conn
        .listSessions(cwdRef.current)
        .then((r) => setPast(r.sessions ?? []))
        .catch(() => {});
    }
  };
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  const rows = useMemo(
    () => conversationRows(Object.values(convs), past ?? [], activeId),
    [convs, past, activeId],
  );

  const send = async () => {
    const text = draft.trim();
    const conn = connRef.current;
    const sid = activeId;
    if (!text || !conn || !sid || !ready || busy) return;

    const now = cb.current.getContext();
    const blocks: ContentBlock[] = [{ type: "text", text }];
    const labels: string[] = [];
    if (withNote && now.path) {
      blocks.push({ type: "resource_link", uri: fileUri(cwdRef.current, now.path), name: now.path });
      labels.push(now.path);
    }
    if (withSelection && now.selection) {
      // 选区带着原文走：它可能还没存盘，而且 agent 要知道的正是「这一段」
      blocks.push({
        type: "resource",
        resource: {
          uri: fileUri(cwdRef.current, now.path ?? "selection.md"),
          text: now.selection,
          mimeType: "text/markdown",
        },
      });
      labels.push(`选中的 ${now.selection.length} 个字`);
    }

    setDraft("");
    stickRef.current = true;
    patch(sid, (c) => ({
      ...c,
      busy: true,
      updatedAt: Date.now(),
      entries: [...c.entries, { kind: "user", text, context: labels }],
    }));
    const note = (text: string) =>
      patch(sid, (c) => ({ ...c, entries: [...c.entries, { kind: "agent", text }] }));
    try {
      await cb.current.beforePrompt();
      const r = await conn.prompt(sid, blocks);
      if (r.stopReason === "refusal") note("*（它拒绝继续这一轮。）*");
      else if (r.stopReason === "max_tokens" || r.stopReason === "max_turn_requests") {
        note("*（这一轮到了长度上限，停在了这里。）*");
      }
    } catch (e) {
      note(`**出错了：** ${errorText(e)}`);
    } finally {
      patch(sid, (c) => ({ ...c, busy: false, updatedAt: Date.now() }));
    }
  };

  const stop = () => {
    if (!activeId) return;
    // 协议要求：取消时还没回的许可请求一律按「取消」回掉
    dropPermission(activeId, { outcome: "cancelled" });
    connRef.current?.cancel(activeId);
  };

  const newChat = async () => {
    const conn = connRef.current;
    setMenuOpen(false);
    if (!conn || phase.kind !== "ready") return;
    // 手上这个还一句话都没说过：那它就是新对话，不再多开一个空白页
    if (active && active.entries.length === 0 && !active.loading) {
      inputRef.current?.focus();
      return;
    }
    try {
      const s = await conn.newSession(cwdRef.current);
      adopt(s.sessionId, s);
      setActiveId(s.sessionId);
      inputRef.current?.focus();
    } catch (e) {
      if (activeId) {
        patch(activeId, (c) => ({
          ...c,
          entries: [...c.entries, { kind: "agent", text: `**新建对话失败：** ${errorText(e)}` }],
        }));
      }
    }
  };

  /** 切到另一个对话。不在手上的（以前的）先让 agent 把它接回来 */
  const switchTo = async (id: string, title: string) => {
    setMenuOpen(false);
    if (id === activeId) return;
    if (convs[id]) {
      setActiveId(id);
      return;
    }
    const conn = connRef.current;
    if (!conn || !canLoad) return;
    // 先把这个对话摆好再去要：agent 是用 `session/update` 把历史重放过来的，
    // 放完才回这个请求 —— 那时再建就把历史全丢了
    setConvs((all) => ({ ...all, [id]: { ...newConversation(id, Date.now(), title), loading: true } }));
    setActiveId(id);
    try {
      const s = await conn.loadSession(id, cwdRef.current);
      adopt(id, s);
      patch(id, (c) => ({ ...c, loading: false }));
    } catch (e) {
      patch(id, (c) => ({
        ...c,
        loading: false,
        entries: [...c.entries, { kind: "agent", text: `**没能接回这个对话：** ${errorText(e)}` }],
      }));
    }
  };

  const pickMode = (modeId: string) => {
    if (!activeId || !connRef.current) return;
    patch(activeId, (c) => ({ ...c, modeId }));
    void connRef.current.setMode(activeId, modeId).catch(() => {});
  };

  const answer = (o: PermissionOutcome) => {
    if (activeId) dropPermission(activeId, o);
  };

  /** 回答里的链接不能在 webview 里原地跳走 —— 那会把整个应用换成一个网页 */
  const onLogClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) openExternalPage(href);
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const start = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const max = Math.max(window.innerWidth - 420, 300);
      onWidthChange(Math.min(Math.max(startW + (start - ev.clientX), 300), max));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const rel = (abs: string) => relativeToVault(abs, cwdRef.current);
  const modes = active?.modes ?? [];
  const now = new Date();

  return (
    <aside className={`agent${cover ? " is-cover" : ""}`} aria-label="AI 会话">
      {!cover && <div className="agent-resizer" onMouseDown={startDrag} />}
      <header className="agent-head">
        <div className="agent-switch" ref={menuRef}>
          <button
            className="agent-title"
            onClick={openMenu}
            disabled={phase.kind !== "ready"}
            title={agentName ? `${agentName} · 切换对话` : "切换对话"}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Icon name="spark" size={13} />
            <span className="agent-title-text">{active ? conversationTitle(active) : agentName || "AI"}</span>
            {phase.kind === "ready" && <Icon name="chevron" size={10} />}
          </button>
          {menuOpen && (
            <div className="agent-menu" role="menu" aria-label="对话">
              <button className="agent-menu-item is-new" role="menuitem" onClick={() => void newChat()}>
                <Icon name="plus" size={12} />
                新对话
              </button>
              {rows.map((r) => {
                const c = convs[r.id];
                return (
                  <button
                    key={r.id}
                    role="menuitem"
                    className={`agent-menu-item${r.id === activeId ? " is-on" : ""}`}
                    onClick={() => void switchTo(r.id, r.title)}
                    disabled={!r.open && !canLoad}
                    title={r.title}
                  >
                    <span className="agent-menu-title">{r.title}</span>
                    <span className="agent-menu-meta">
                      {permissions[r.id]
                        ? "等你确认"
                        : c?.busy
                          ? "正在回答"
                          : r.updatedAt
                            ? relTime(Math.floor(r.updatedAt / 1000), now)
                            : ""}
                    </span>
                  </button>
                );
              })}
              {past === null && (
                <p className="agent-menu-note">{agentName || "这个 AI"} 不提供以前的对话，这里只列这次打开之后的。</p>
              )}
            </div>
          )}
        </div>
        {modes.length > 0 && (
          <select
            className="agent-mode"
            value={active?.modeId ?? ""}
            onChange={(e) => pickMode(e.target.value)}
            disabled={!ready}
            title={modes.find((m) => m.id === active?.modeId)?.description ?? "权限模式"}
            aria-label="权限模式"
          >
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <span className="agent-actions">
          <button
            className="term-btn"
            onClick={() => void newChat()}
            disabled={phase.kind !== "ready"}
            title="新对话"
            aria-label="新对话"
          >
            <Icon name="plus" size={13} />
          </button>
          <button className="term-btn" onClick={onClose} title="关闭 AI 面板" aria-label="关闭 AI 面板">
            <Icon name="close" size={13} />
          </button>
        </span>
      </header>

      <div
        className="agent-log"
        ref={logRef}
        onClick={onLogClick}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {entries.length === 0 && ready && (
          <p className="agent-empty">
            直接问就行。它看得见整个仓库，改了哪篇会先摆出来给你看。
          </p>
        )}
        {entries.map((entry, i) => (
          <EntryView key={entry.kind === "tool" ? entry.id : i} entry={entry} rel={rel} onOpenPath={onOpenPath} />
        ))}
        {permission && (
          <PermissionCard
            req={permission.req}
            rel={rel}
            onAnswer={(optionId) => answer({ outcome: "selected", optionId })}
          />
        )}
        {phase.kind === "choose" && (
          <div className="agent-choose">
            <p>
              这里跑的是你自己的 AI 工具，Verso 不内置任何一个。选一个你已经在用的 ——
              它会在当前仓库里启动，登录和计费都在它那边。
            </p>
            {AGENT_PRESETS.map((p) => (
              <button key={p.label} className="agent-choice" onClick={() => onPickCommand(p.command)}>
                <span className="agent-choice-name">{p.label}</span>
                <span className="agent-choice-needs">{p.needs}</span>
                <code>{p.command}</code>
              </button>
            ))}
            <button className="agent-link" onClick={onOpenSettings}>
              用别的程序…
            </button>
          </div>
        )}
        {phase.kind === "starting" && (
          <p className="agent-status">正在启动…第一次要先下载适配器，可能要等十几秒。</p>
        )}
        {active?.loading && <p className="agent-status agent-thinking">正在接回这个对话…</p>}
        {busy && !permission && <p className="agent-status agent-thinking">正在回答…</p>}
        {phase.kind === "dead" && (
          <div className="agent-dead" role="alert">
            <p>{phase.message}</p>
            {phase.log.length > 0 && <pre className="agent-stderr">{phase.log.join("\n")}</pre>}
            <p className="agent-dead-hint">
              用的命令是 <code>{command}</code>
            </p>
            <div className="agent-dead-actions">
              <button className="set-save" onClick={() => setGeneration((g) => g + 1)}>
                重新启动
              </button>
              <button className="agent-link" onClick={onOpenSettings}>
                换一个命令…
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="agent-input">
        {(ctx.path || ctx.selection) && (
          <div className="agent-chips">
            {ctx.path && (
              <button
                className={`agent-chip${withNote ? " is-on" : ""}`}
                onClick={() => setWithNote((v) => !v)}
                title={withNote ? "点一下不带这篇" : "点一下带上这篇"}
                aria-pressed={withNote}
              >
                <Icon name="doc" size={12} />
                {ctx.path.replace(/\.md$/, "")}
              </button>
            )}
            {ctx.selection && (
              <button
                className={`agent-chip${withSelection ? " is-on" : ""}`}
                onClick={() => setWithSelection((v) => !v)}
                title={withSelection ? "点一下不带选区" : "点一下带上选区"}
                aria-pressed={withSelection}
              >
                <Icon name="text" size={12} />
                选中的 {ctx.selection.length} 个字
              </button>
            )}
          </div>
        )}
        <div className="agent-box">
          <textarea
            ref={inputRef}
            value={draft}
            rows={3}
            placeholder={
              phase.kind === "choose"
                ? "先在上面选一个 AI 工具"
                : phase.kind === "dead"
                  ? "AI 没有在运行"
                  : "问点什么。Enter 发送，Shift+Enter 换行"
            }
            disabled={phase.kind === "dead" || phase.kind === "choose"}
            onFocus={refreshContext}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 输入法组词时的回车是「选这个词」，不是「发送」
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button className="agent-send is-stop" onClick={stop} title="停下这一轮" aria-label="停下这一轮">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              className="agent-send"
              onClick={() => void send()}
              disabled={!ready || !draft.trim()}
              title="发送"
              aria-label="发送"
            >
              <Icon name="arrow-up" size={14} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}

// ------------------------------------------------------------ 对话里的一条

function Markdown({ text }: { text: string }) {
  // 外链图片不加载（见 `remoteImages`）。流式输出时每个 chunk 都重排一遍，
  // 一段回答通常就几 KB，同步渲染跟得上
  const html = useMemo(() => renderMarkdown(text, { remoteImages: false }), [text]);
  return <div className="agent-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const STATUS_ICON: Record<string, string> = {
  pending: "·",
  in_progress: "…",
  completed: "✓",
  failed: "✕",
};

function EntryView({
  entry,
  rel,
  onOpenPath,
}: {
  entry: ChatEntry;
  rel: (abs: string) => string;
  onOpenPath: (rel: string) => void;
}) {
  const [open, setOpen] = useState(false);
  switch (entry.kind) {
    case "user":
      return (
        <div className="agent-msg is-user">
          <div className="agent-user-text">{entry.text}</div>
          {entry.context.length > 0 && <div className="agent-user-ctx">带上了：{entry.context.join("、")}</div>}
        </div>
      );
    case "agent":
      return (
        <div className="agent-msg is-agent">
          <Markdown text={entry.text} />
        </div>
      );
    case "thought":
      return (
        <div className="agent-thought">
          <button className="agent-fold" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Icon name="chevron" size={11} />
            思考过程
          </button>
          {open && <div className="agent-thought-text">{entry.text}</div>}
        </div>
      );
    case "plan":
      return (
        <ul className="agent-plan" aria-label="计划">
          {entry.entries.map((p, i) => (
            <li key={i} className={`is-${p.status}`}>
              <span className="agent-plan-mark">{p.status === "completed" ? "✓" : p.status === "in_progress" ? "▸" : "○"}</span>
              {p.content}
            </li>
          ))}
        </ul>
      );
    case "tool": {
      const files = entry.diffs.map((d) => rel(d.path));
      const hasDetail = entry.diffs.length > 0 || entry.output.length > 0;
      return (
        <div className={`agent-tool is-${entry.status}`}>
          <div className="agent-tool-row">
            <span className="agent-tool-status" aria-label={entry.status}>
              {STATUS_ICON[entry.status] ?? "·"}
            </span>
            {hasDetail ? (
              <button className="agent-fold" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                <Icon name="chevron" size={11} />
                {entry.title || "工具调用"}
              </button>
            ) : (
              <span className="agent-tool-title">{entry.title || "工具调用"}</span>
            )}
          </div>
          {files.some((f) => f.endsWith(".md") && !/^([a-zA-Z]:)?[\\/]/.test(f)) && (
            <div className="agent-tool-files">
              {files
                .filter((f) => f.endsWith(".md") && !/^([a-zA-Z]:)?[\\/]/.test(f))
                .map((f) => (
                  <button key={f} className="agent-link" onClick={() => onOpenPath(f)}>
                    {f.replace(/\.md$/, "")}
                  </button>
                ))}
            </div>
          )}
          {open && (
            <div className="agent-tool-detail">
              {entry.diffs.map((d, i) => (
                <DiffBlock key={i} diff={d} rel={rel} />
              ))}
              {entry.output && <pre className="agent-tool-output">{entry.output}</pre>}
            </div>
          )}
        </div>
      );
    }
  }
}

/** 一个文件的改动，用版本历史里那个差异视图画（§2.8）—— 同一种东西长一个样 */
function DiffBlock({ diff, rel }: { diff: FileDiff; rel: (abs: string) => string }) {
  const [view, setView] = useState<TextDiff | null>(null);
  const [failed, setFailed] = useState(false);
  const path = rel(diff.path);
  useEffect(() => {
    let alive = true;
    api
      .textDiff(path, diff.oldText ?? "", diff.newText)
      .then((d) => alive && setView(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path, diff.oldText, diff.newText]);
  return (
    <div className="agent-diff">
      <div className="agent-diff-path">
        {path}
        {diff.oldText === null && <span className="agent-diff-new">新文件</span>}
      </div>
      {view ? (
        <UnifiedDiff diff={view} />
      ) : failed ? (
        <pre className="agent-tool-output">{diff.newText}</pre>
      ) : null}
    </div>
  );
}

/** agent 要动手了，先问人。按钮的顺序就是 agent 给的顺序 */
function PermissionCard({
  req,
  rel,
  onAnswer,
}: {
  req: PermissionRequest;
  rel: (abs: string) => string;
  onAnswer: (optionId: string) => void;
}) {
  const diffs: FileDiff[] = (req.toolCall.content ?? [])
    .filter((c): c is Extract<typeof c, { type: "diff" }> => c.type === "diff")
    .map((c) => ({ path: c.path, oldText: c.oldText ?? null, newText: c.newText }));
  const command = (req.toolCall.rawInput as { command?: unknown } | undefined)?.command;
  return (
    <div className="agent-permission" role="alertdialog" aria-label="AI 请求许可">
      <p className="agent-permission-title">
        <strong>它想要：</strong>
        {req.toolCall.title || "执行一个操作"}
      </p>
      {typeof command === "string" && <pre className="agent-tool-output">{command}</pre>}
      {diffs.map((d, i) => (
        <DiffBlock key={i} diff={d} rel={rel} />
      ))}
      <div className="agent-permission-actions">
        {req.options.map((o) => (
          <button
            key={o.optionId}
            className={`agent-permit is-${o.kind}`}
            onClick={() => onAnswer(o.optionId)}
            title={o.name}
          >
            {PERMISSION_LABEL[o.kind] ?? o.name}
          </button>
        ))}
      </div>
    </div>
  );
}
