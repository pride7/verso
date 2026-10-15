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
  type ConfigOption,
  type ContentBlock,
  type NewSessionResult,
  type PermissionOutcome,
  type PermissionRequest,
  type SessionInfo,
  type SessionMeta,
} from "../core/acp";
import {
  applyUpdate,
  attachmentBlock,
  attachmentName,
  looksLikeText,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  type Attachment,
  configChoices,
  configToRestore,
  conversationRows,
  conversationTitle,
  CHOICE_LABEL,
  CONFIG_NAME,
  EFFORT_LABEL,
  effortControl,
  parseQuotaText,
  rateLimitOf,
  windowOf,
  type QuotaWindow,
  joinModel,
  MODE_LABEL,
  REMEMBERED_CATEGORIES,
  shortCount,
  splitModel,
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
import { api, onAgentExit, onAgentLine, onAgentStderr, pickFiles } from "../host/api";
import { confirm } from "../host/dialog";
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
  /** 面板关着：只是藏起来，背后的进程和对话都留着（App 的 `agentMounted`） */
  hidden?: boolean;
  /** 藏着的时候有事要人处理（来要许可了）。App 把面板弹出来 */
  onAttention?: () => void;
}

/** 进程这一层的状态。每个对话自己忙不忙记在 `Conversation.busy` 上 */
type Phase =
  /** 还没选跑哪个 AI。什么都不起，等人挑 */
  | { kind: "choose" }
  | { kind: "starting" }
  /** 第一次用某个常用适配器：Verso 正在替人装一份（只有这一次） */
  | { kind: "installing"; label: string }
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

/**
 * 记住的模型、思考强度（`REMEMBERED_CATEGORIES`），按启动命令分开存 ——
 * Claude 的「sonnet」拿到 Codex 那边没有意义。只是界面偏好，存本机
 */
const PREFS_KEY = "verso.agentConfig";
type Prefs = Record<string, Record<string, string | boolean>>;
function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs;
  } catch {
    // 坏了就从头记
    return {};
  }
}
function savePref(command: string, id: string, value: string | boolean) {
  const all = readPrefs();
  all[command] = { ...(all[command] ?? {}), [id]: value };
  localStorage.setItem(PREFS_KEY, JSON.stringify(all));
}

/** Claude 的 effort 不在 agent 报的配置里，单独记在这个键下。空串 = 用它自己的默认 */
const EFFORT_PREF = "__effort";

/** 开对话时交给 Claude 适配器的私有选项：它原样转给 Claude Agent SDK（`--effort`） */
const claudeEffortMeta = (effort: string | null): SessionMeta | undefined =>
  effort ? { claudeCode: { options: { effort } } } : undefined;

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
  hidden = false,
  onAttention,
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
  /**
   * Claude 的适配器：effort 只能在开对话时传进去。中途改要关掉再接回，所以
   * 还得它能关（`session/close`）、能接回（`session/load`）
   */
  const [metaEffort, setMetaEffort] = useState(false);
  /** 账号额度，按窗口（5 小时、每周…）。是账号的事、不是某个对话的，所以放在这一层 */
  const [quota, setQuota] = useState<Record<string, QuotaWindow>>({});
  /**
   * 怎么问额度：开一个只给自己看的对话，发一句本地命令（Claude 的 `/usage`、
   * Codex 的 `/status`），读完就删掉。null = 这个 AI 没有这种命令，或者删不掉
   * —— 删不掉的话每查一次都会在它的历史里留下一条，宁可不查
   */
  const probeRef = useRef<{ command: string; running: boolean; at: number; text: Map<string, string> } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [ctx, setCtx] = useState<AgentContext>({ path: null, selection: "" });
  const [withNote, setWithNote] = useState(true);
  const [withSelection, setWithSelection] = useState(true);
  /** 换一下就重启进程（「重新启动」按钮） */
  const [generation, setGeneration] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** 附件带不上时的一句话（太大、读不了），过几秒自己消失 */
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const connRef = useRef<AcpConnection | null>(null);
  const cwdRef = useRef("");
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 用户往上翻了就别再把他拽回底部 */
  const stickRef = useRef(true);

  const cb = useRef({ getContext, beforePrompt, onAttention, hidden });
  cb.current = { getContext, beforePrompt, onAttention, hidden };

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

  /** 新开的对话记下来；agent 给了模式、配置就一起记 */
  const adopt = useCallback(
    (id: string, s: Omit<NewSessionResult, "sessionId">, extra: Partial<Conversation> = {}) => {
      setConvs((all) => ({
        ...all,
        [id]: {
          ...(all[id] ?? newConversation(id, Date.now())),
          modes: s.modes?.availableModes ?? [],
          modeId: s.modes?.currentModeId ?? null,
          config: s.configOptions ?? [],
          variants: (s.models?.availableModels ?? []).map((m) => m.modelId),
          ...extra,
        },
      }));
    },
    [],
  );

  /** 记住的 Claude effort。null = 没选过，用它自己的默认 */
  const savedEffort = useCallback((): string | null => {
    const v = readPrefs()[command]?.[EFFORT_PREF];
    return typeof v === "string" && v ? v : null;
  }, [command]);

  /**
   * 新对话用上次选的模型。agent 每开一个会话都回到它自己的默认值，不补的话，
   * 人每开一个新对话都得重新选一遍
   */
  const restorePrefs = useCallback(
    async (id: string, s: Omit<NewSessionResult, "sessionId">) => {
      const conn = connRef.current;
      const options = s.configOptions;
      if (!conn || !options) return;
      const variants = (s.models?.availableModels ?? []).map((m) => m.modelId);
      for (const { id: configId, value } of configToRestore(options, readPrefs()[command] ?? {}, variants)) {
        try {
          const r = await conn.setConfigOption(id, configId, value);
          if (r.configOptions) patch(id, (c) => ({ ...c, config: r.configOptions! }));
        } catch {
          // 补不上就算了：用的是 agent 自己的默认值，人照样能在下面手动换
        }
      }
    },
    [command, patch],
  );

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
    setMetaEffort(false);
    setQuota({});

    void (async () => {
      try {
        await unlisten;
        // 常用的适配器装在本机，直接运行（见 agent_pkg.rs）。没装过就先装一份
        const preset = AGENT_PRESETS.find((p) => p.command === command && p.package);
        let launch = command;
        if (preset?.package) {
          const installed = await api.agentResolve(preset.package);
          if (installed) launch = installed;
          else {
            setPhase({ kind: "installing", label: preset.label });
            launch = await api.agentInstall(preset.package);
          }
          if (disposed) return;
        }
        const [id, cwd] = await api.agentStart(launch);
        if (disposed) {
          void api.agentStop(id);
          return;
        }
        cwdRef.current = cwd;
        const conn = new AcpConnection((line) => api.agentSend(id, line), {
          onUpdate: (n) => {
            const u = n.update;
            // 查额度那个对话：只收文字，别的一概不进界面
            const probing = probeRef.current?.text;
            if (probing?.has(n.sessionId)) {
              if (u.sessionUpdate === "agent_message_chunk") {
                const t = (u as { content: { type: string; text?: string } }).content;
                if (t.type === "text") probing.set(n.sessionId, probing.get(n.sessionId)! + (t.text ?? ""));
              }
              return;
            }
            if (u.sessionUpdate === "config_option_update") {
              const config = (u as { configOptions: ConfigOption[] }).configOptions;
              patch(n.sessionId, (c) => ({ ...c, config }));
            } else if (u.sessionUpdate === "current_mode_update") {
              const modeId = (u as { currentModeId: string }).currentModeId;
              patch(n.sessionId, (c) => ({ ...c, modeId }));
            } else if (u.sessionUpdate === "usage_update") {
              const { used, size, cost, _meta } = u as unknown as NonNullable<Conversation["usage"]> & {
                _meta?: unknown;
              };
              // 快到限额时 Claude 会顺手报一下（平时的数字靠 `probeQuota`）
              const limit = rateLimitOf(_meta);
              if (limit) {
                const w = windowOf(limit, resetText);
                setQuota((q) => ({ ...q, [w.name]: w }));
              }
              // 只报额度的那种更新也带着 used/size，花费可能没有 —— 别把之前的花费抹掉
              if (typeof used === "number" && typeof size === "number") {
                patch(n.sessionId, (c) => ({ ...c, usage: { used, size, cost: cost ?? c.usage?.cost ?? null } }));
              }
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
              if (cb.current.hidden) cb.current.onAttention?.();
            }),
        });
        connRef.current = conn;
        procId = id;
        for (const e of early.splice(0)) handle(e);

        const info = await conn.initialize(APP_VERSION);
        if (disposed) return;
        setAgentName(info.agentInfo?.title || info.agentInfo?.name || "");
        const caps = info.agentCapabilities;
        setCanLoad(!!caps?.loadSession);
        if (caps?.sessionCapabilities?.list) setPast([]);
        const claude = !!caps?._meta?.claudeCode;
        setMetaEffort(claude && !!caps?.loadSession && !!caps?.sessionCapabilities?.close);
        // 只认得这两家的本地命令。别家的 `/status` 可能会被当成一句话发给模型 ——
        // 那就成了每查一次额度都在花额度
        const codex = /codex/i.test(info.agentInfo?.name ?? "");
        const probeCommand = claude ? "/usage" : codex ? "/status" : null;
        probeRef.current =
          probeCommand && caps?.sessionCapabilities?.delete
            ? { command: probeCommand, running: false, at: 0, text: new Map() }
            : null;
        const effort = claude ? savedEffort() : null;
        const session = await conn.newSession(cwd, claudeEffortMeta(effort));
        if (disposed) return;
        adopt(session.sessionId, session, { effort });
        setActiveId(session.sessionId);
        setPhase({ kind: "ready" });
        void restorePrefs(session.sessionId, session);
        // 有新版就在后台装上，下次启动生效。一天最多真去问一次
        if (preset?.package) void api.agentUpdate(preset.package).catch(() => {});
        void probeQuotaRef.current();
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
  }, [command, generation, patch, adopt, restorePrefs, savedEffort]);

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
    if (!menuOpen && conn && past !== null && phase.kind === "ready") {
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

  /**
   * 问一次额度。起来的时候问一次，之后每轮回答完再问，最多一分钟一次 ——
   * 是本地命令，不花额度，但也没必要每秒都问
   */
  const probeQuota = async () => {
    const probe = probeRef.current;
    const conn = connRef.current;
    if (!probe || !conn || probe.running || Date.now() - probe.at < 60_000) return;
    probe.running = true;
    probe.at = Date.now();
    let sid: string | null = null;
    try {
      const s = await conn.newSession(cwdRef.current);
      sid = s.sessionId;
      probe.text.set(sid, "");
      await conn.prompt(sid, [{ type: "text", text: probe.command }]);
      const windows = parseQuotaText(probe.text.get(sid) ?? "");
      if (windows.length > 0) setQuota(Object.fromEntries(windows.map((w) => [w.name, w])));
    } catch {
      // 问不到就不显示，不打扰人
    } finally {
      if (sid) {
        probe.text.delete(sid);
        void conn.deleteSession(sid).catch(() => {});
      }
      probe.running = false;
    }
  };
  const probeQuotaRef = useRef(probeQuota);
  probeQuotaRef.current = probeQuota;

  const send = async () => {
    const text = draft.trim();
    const conn = connRef.current;
    const sid = activeId;
    if (!text || !conn || !sid || !ready || busy) return;

    const now = cb.current.getContext();
    const blocks: ContentBlock[] = [{ type: "text", text }];
    const labels: string[] = [];
    const sentAttachments = attachments;
    for (const a of sentAttachments) {
      blocks.push(attachmentBlock(a, cwdRef.current));
      labels.push(attachmentName(a));
    }
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
    setAttachments([]);
    stickRef.current = true;
    const images = sentAttachments.flatMap((a) => (a.kind === "image" ? [`data:${a.mimeType};base64,${a.data}`] : []));
    patch(sid, (c) => ({
      ...c,
      busy: true,
      updatedAt: Date.now(),
      entries: [...c.entries, { kind: "user", text, context: labels, ...(images.length ? { images } : {}) }],
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
      void probeQuota();
    }
  };

  // ---- 附件

  const addAttachments = (more: Attachment[]) => {
    if (more.length === 0) return;
    setAttachments((all) => {
      const key = (a: Attachment) => `${a.kind}:${a.kind === "note" ? a.rel : a.kind === "path" ? a.path : a.name}`;
      const seen = new Set(all.map(key));
      return [...all, ...more.filter((a) => !seen.has(key(a)))];
    });
    inputRef.current?.focus();
  };

  const notice = (text: string) => {
    setAttachNotice(text);
    window.setTimeout(() => setAttachNotice((t) => (t === text ? null : t)), 5000);
  };

  /** 「+」：选本机文件。只交路径，读由 agent 自己来（PDF、Word 它读得懂） */
  const pickAttachments = async () => {
    const paths = await pickFiles().catch(() => [] as string[]);
    addAttachments(paths.map((path) => ({ kind: "path", path, name: path.split(/[\\/]/).pop() || path })));
  };

  /**
   * 粘贴或拖进来的文件：浏览器只给内容、不给路径。图片和文本带上内容，
   * 别的（PDF、压缩包…）带不上 —— 说一声，告诉人走「+」
   */
  const readFiles = async (files: File[]) => {
    const out: Attachment[] = [];
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        if (f.size > MAX_IMAGE_BYTES) {
          notice(`「${f.name}」太大了（超过 5 MB），图片发不出去`);
          continue;
        }
        const data = await fileBase64(f);
        out.push({ kind: "image", name: f.name || "粘贴的图片", mimeType: f.type, data });
      } else if (looksLikeText(f.name, f.type)) {
        if (f.size > MAX_TEXT_BYTES) {
          notice(`「${f.name}」太大，整个带上不合适 —— 用「+」选它，让 AI 自己按需去读`);
          continue;
        }
        out.push({ kind: "text", name: f.name, mimeType: f.type || "text/plain", text: await f.text() });
      } else {
        notice(`「${f.name}」拖进来读不了 —— 用「+」选它，AI 会自己去读`);
      }
    }
    addAttachments(out);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return; // 纯文字照常粘贴
    e.preventDefault();
    void readFiles(files);
  };

  const onDrop = (e: React.DragEvent) => {
    setDragOver(false);
    // 从文档树拖来的一篇笔记：带路径，不带内容
    const note = e.dataTransfer.getData("text/verso-path");
    if (note) {
      e.preventDefault();
      addAttachments([{ kind: "note", rel: note }]);
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    void readFiles(files);
  };

  const onDragOver = (e: React.DragEvent) => {
    const types = [...e.dataTransfer.types];
    if (!types.includes("Files") && !types.includes("text/verso-path")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
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
      const effort = metaEffort ? savedEffort() : null;
      const s = await conn.newSession(cwdRef.current, claudeEffortMeta(effort));
      adopt(s.sessionId, s, { effort });
      setActiveId(s.sessionId);
      inputRef.current?.focus();
      void restorePrefs(s.sessionId, s);
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
    const effort = metaEffort ? savedEffort() : null;
    setConvs((all) => ({ ...all, [id]: { ...newConversation(id, Date.now(), title), loading: true, effort } }));
    setActiveId(id);
    try {
      const s = await conn.loadSession(id, cwdRef.current, claudeEffortMeta(effort));
      adopt(id, s);
      patch(id, (c) => ({ ...c, loading: false }));
      void restorePrefs(id, s);
    } catch (e) {
      patch(id, (c) => ({
        ...c,
        loading: false,
        entries: [...c.entries, { kind: "agent", text: `**没能接回这个对话：** ${errorText(e)}` }],
      }));
    }
  };

  /**
   * 换一个 AI。就是改设置里那一行命令 —— 面板跟着重启进程。
   *
   * 手上的对话会跟着旧进程一起没了（以前的对话还在那个 AI 自己那边，换回来
   * 照样列得出来）。有对话正在回答、或者在等人点头时先问一句，免得一点下去
   * 把跑到一半的活掐断
   */
  const switchAgent = async (next: string) => {
    setMenuOpen(false);
    if (next === command) return;
    const working = Object.values(convs).some((c) => c.busy) || Object.keys(permissions).length > 0;
    if (
      working &&
      !(await confirm("换一个 AI 会停掉正在回答的对话，没做完的那一步不会再继续。", {
        title: "换一个 AI",
        okLabel: "换",
        cancelLabel: "不换",
      }))
    ) {
      return;
    }
    onPickCommand(next);
  };

  const pickMode = (modeId: string) => {
    if (!activeId || !connRef.current) return;
    patch(activeId, (c) => ({ ...c, modeId }));
    void connRef.current.setMode(activeId, modeId).catch(() => {});
  };

  /** 改一项配置（模型、思考强度、权限…）。先改界面，agent 回来的那份为准 */
  const pickConfig = async (o: ConfigOption, value: string | boolean) => {
    const sid = activeId;
    const conn = connRef.current;
    if (!sid || !conn) return;
    const before = o.currentValue;
    const set = (v: string | boolean) =>
      patch(sid, (c) => ({
        ...c,
        config: c.config.map((x) => (x.id === o.id ? ({ ...x, currentValue: v } as ConfigOption) : x)),
      }));
    set(value);
    if (o.category && REMEMBERED_CATEGORIES.has(o.category)) savePref(command, o.id, value);
    try {
      const r = await conn.setConfigOption(sid, o.id, value);
      if (r.configOptions) patch(sid, (c) => ({ ...c, config: r.configOptions! }));
    } catch (e) {
      set(before);
      patch(sid, (c) => ({
        ...c,
        entries: [...c.entries, { kind: "agent", text: `**没能切换：** ${errorText(e)}` }],
      }));
    }
  };

  /**
   * 换 Claude 的 effort。它只在开对话时生效，所以：
   *
   * - 还没说过话的空白对话：直接换一个带新 effort 的
   * - 说过话的：在 agent 那边关掉、再带着新 effort 接回来 —— 历史由它重放，
   *   上下文一句不丢，只是这一下要等它重放完
   */
  const changeMetaEffort = async (effort: string | null) => {
    const sid = activeId;
    const conn = connRef.current;
    if (!sid || !conn || !active || active.busy) return;
    savePref(command, EFFORT_PREF, effort ?? "");
    const meta = claudeEffortMeta(effort);
    try {
      if (active.entries.length === 0) {
        const s = await conn.newSession(cwdRef.current, meta);
        adopt(s.sessionId, s, { effort });
        setActiveId(s.sessionId);
        setConvs((all) => {
          const next = { ...all };
          delete next[sid];
          return next;
        });
        void conn.closeSession(sid).catch(() => {});
        void restorePrefs(s.sessionId, s);
        return;
      }
      patch(sid, (c) => ({ ...c, loading: true, entries: [], effort }));
      await conn.closeSession(sid);
      const s = await conn.loadSession(sid, cwdRef.current, meta);
      adopt(sid, s);
      patch(sid, (c) => ({ ...c, loading: false }));
      void restorePrefs(sid, s);
    } catch (e) {
      patch(sid, (c) => ({
        ...c,
        loading: false,
        entries: [...c.entries, { kind: "agent", text: `**没能切换思考强度：** ${errorText(e)}` }],
      }));
    }
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
  const config = active?.config ?? [];
  const modeOption = config.find((o) => o.category === "mode" && o.type === "select");
  const modelOption = config.find((o) => o.category === "model" && o.type === "select");
  const effort = active ? effortControl(active, metaEffort) : null;
  // 底部那一行专门画了权限、模型、强度；agent 另外报的（少见）照原样排在后面
  const otherConfig = config.filter((o) => o !== modeOption && o !== modelOption && !(effort?.kind === "config" && effort.option === o));
  const usage = active?.usage ?? null;
  const now = new Date();

  return (
    <aside
      className={`agent${cover ? " is-cover" : ""}${hidden ? " is-hidden" : ""}${dragOver ? " is-drop" : ""}`}
      aria-label="AI 会话"
      aria-hidden={hidden || undefined}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {!cover && <div className="agent-resizer" onMouseDown={startDrag} />}
      <header className="agent-head">
        <div className="agent-switch" ref={menuRef}>
          <button
            className="agent-title"
            onClick={openMenu}
            disabled={phase.kind === "choose"}
            title={agentName ? `${agentName} · 切换对话` : "切换对话"}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Icon name="spark" size={13} />
            <span className="agent-title-text">{active ? conversationTitle(active) : agentName || "AI"}</span>
            {phase.kind !== "choose" && <Icon name="chevron" size={10} />}
          </button>
          {menuOpen && (
            <div className="agent-menu" role="menu" aria-label="对话">
              <button
                className="agent-menu-item is-new"
                role="menuitem"
                onClick={() => void newChat()}
                disabled={phase.kind !== "ready"}
              >
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
              {past === null && phase.kind === "ready" && (
                <p className="agent-menu-note">{agentName || "这个 AI"} 不提供以前的对话，这里只列这次打开之后的。</p>
              )}
              {/* 跑哪个 AI 也在这里换：它和「在哪个对话里」是同一层的选择，
                  不该让人为了换一个工具跑去设置里找 */}
              <p className="agent-menu-section">用哪个 AI</p>
              {AGENT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  role="menuitemradio"
                  aria-checked={p.command === command}
                  className={`agent-menu-item agent-menu-agent${p.command === command ? " is-current" : ""}`}
                  onClick={() => void switchAgent(p.command)}
                  title={`${p.command}\n${p.needs}`}
                >
                  <span className="agent-menu-title">{p.label}</span>
                  <span className="agent-menu-meta">{p.command === command ? "正在用" : ""}</span>
                </button>
              ))}
              {!AGENT_PRESETS.some((p) => p.command === command) && (
                <button
                  role="menuitemradio"
                  aria-checked
                  className="agent-menu-item agent-menu-agent is-current"
                  onClick={() => setMenuOpen(false)}
                  title={command}
                >
                  <span className="agent-menu-title">{agentName || "自定义命令"}</span>
                  <span className="agent-menu-meta">正在用</span>
                </button>
              )}
              <button
                className="agent-menu-item agent-menu-agent"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
              >
                <span className="agent-menu-title">别的程序…</span>
              </button>
            </div>
          )}
        </div>
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
            {agentName ? `正在用 ${agentName}。` : ""}
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
        {phase.kind === "starting" && <p className="agent-status agent-thinking">正在启动…</p>}
        {phase.kind === "installing" && (
          <p className="agent-status agent-thinking">
            正在安装 {phase.label} 的适配器…只有第一次需要，之后打开就快了。
          </p>
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
        {attachNotice && (
          <p className="agent-attach-notice" role="status">
            {attachNotice}
          </p>
        )}
        {(ctx.path || ctx.selection || attachments.length > 0) && (
          <div className="agent-chips">
            {attachments.map((a, i) => (
              <span key={i} className="agent-chip is-on is-attachment" title={a.kind === "path" ? a.path : attachmentName(a)}>
                {a.kind === "image" ? (
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt="" className="agent-chip-thumb" />
                ) : (
                  <Icon name={a.kind === "text" ? "text" : "doc"} size={12} />
                )}
                <span className="agent-chip-name">{attachmentName(a)}</span>
                <button
                  className="agent-chip-x"
                  onClick={() => setAttachments((all) => all.filter((_, j) => j !== i))}
                  aria-label={`去掉 ${attachmentName(a)}`}
                  title="去掉"
                >
                  <Icon name="close" size={10} />
                </button>
              </span>
            ))}
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
            onPaste={onPaste}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 输入法组词时的回车是「选这个词」，不是「发送」
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {/* 底部一行：左边是权限（这个对话能做什么），右边是模型、思考强度、
              上下文和发送 —— 和常见的 AI 输入框同一个排法，人一眼就知道在哪儿 */}
          <div className="agent-bar">
            <button
              className="agent-attach"
              onClick={() => void pickAttachments()}
              disabled={!ready}
              title="添加附件（也可以粘贴图片、把文件或笔记拖进来）"
              aria-label="添加附件"
            >
              <Icon name="plus" size={14} />
            </button>
            {modeOption && modeOption.type === "select" ? (
              <Picker
                label="权限"
                icon="shield"
                align="left"
                risky={!!MODE_LABEL[modeOption.currentValue]?.risky}
                value={modeOption.currentValue}
                disabled={!ready}
                options={configChoices(modeOption).map((c) => ({
                  value: c.value,
                  label: MODE_LABEL[c.value]?.label ?? c.name,
                  hint: MODE_LABEL[c.value]?.hint,
                  risky: MODE_LABEL[c.value]?.risky,
                  title: c.description ?? c.name,
                }))}
                onChange={(v) => void pickConfig(modeOption, v)}
              />
            ) : (
              modes.length > 0 && (
                <Picker
                  label="权限"
                  icon="shield"
                  align="left"
                  risky={!!MODE_LABEL[active?.modeId ?? ""]?.risky}
                  value={active?.modeId ?? ""}
                  disabled={!ready}
                  options={modes.map((m) => ({
                    value: m.id,
                    label: MODE_LABEL[m.id]?.label ?? m.name,
                    hint: MODE_LABEL[m.id]?.hint,
                    risky: MODE_LABEL[m.id]?.risky,
                    title: m.description ?? m.name,
                  }))}
                  onChange={pickMode}
                />
              )
            )}
            {/* 右边那一组自己换行：面板窄的时候折成两行，发送键始终钉在最右 */}
            <div className="agent-bar-right">
            {otherConfig.map((o) =>
              o.type === "select" ? (
                <Picker
                  key={o.id}
                  label={CONFIG_NAME[o.id] ?? o.name}
                  value={o.currentValue}
                  disabled={!ready}
                  options={configChoices(o).map((c) => ({
                    value: c.value,
                    // 「快速：开」—— 只写一个「开」看不出开的是什么
                    label: `${CONFIG_NAME[o.id] ?? o.name}：${CHOICE_LABEL[c.value] ?? c.name}`,
                    group: c.group,
                    title: c.description ?? undefined,
                  }))}
                  onChange={(v) => void pickConfig(o, v)}
                />
              ) : (
                <label key={o.id} className="agent-pick" title={o.description ?? o.name}>
                  <input
                    type="checkbox"
                    checked={o.currentValue}
                    disabled={!ready}
                    onChange={(e) => void pickConfig(o, e.target.checked)}
                  />
                  <span className="agent-pick-text">{o.name}</span>
                </label>
              ),
            )}
            {modelOption && modelOption.type === "select" && (
              <Picker
                label="模型"
                value={effort?.kind === "variant" ? effort.base : modelOption.currentValue}
                disabled={!ready}
                options={configChoices(modelOption).map((c) => ({
                  value: c.value,
                  label: c.name,
                  group: c.group,
                  title: c.description ?? undefined,
                }))}
                onChange={(v) =>
                  void pickConfig(
                    modelOption,
                    // Codex：换模型时把强度带过去（`gpt-5.4` + 高 → `gpt-5.4/high`）
                    active?.variants.length ? joinModel(splitModel(v).base, effort?.kind === "variant" ? effort.current : null, active.variants) : v,
                  )
                }
              />
            )}
            {effort?.kind === "config" && effort.option.type === "select" && (
              <Picker
                label="思考强度"
                value={effort.option.currentValue}
                disabled={!ready}
                options={configChoices(effort.option).map((c) => ({
                  value: c.value,
                  label: EFFORT_LABEL[c.value] ?? c.name,
                }))}
                onChange={(v) => void pickConfig(effort.option, v)}
              />
            )}
            {effort?.kind === "variant" && (
              <Picker
                label="思考强度"
                value={effort.current ?? ""}
                disabled={!ready}
                options={[
                  ...(effort.current === null ? [{ value: "", label: "默认强度" }] : []),
                  ...effort.levels.map((l) => ({ value: l, label: EFFORT_LABEL[l] ?? l })),
                ]}
                onChange={(v) => void pickConfig(effort.model, v ? `${effort.base}/${v}` : effort.base)}
              />
            )}
            {effort?.kind === "meta" && (
              <Picker
                label="思考强度"
                value={effort.current ?? ""}
                disabled={!ready || busy}
                title={
                  active && active.entries.length > 0
                    ? "换思考强度会把这个对话关掉再接回来，历史不会丢"
                    : undefined
                }
                options={[
                  { value: "", label: "默认强度" },
                  ...effort.levels.map((l) => ({ value: l, label: EFFORT_LABEL[l] ?? l })),
                ]}
                onChange={(v) => void changeMetaEffort(v || null)}
              />
            )}
            {effort === null && modelOption && (
              // 这个模型没有可选的档位（比如 Codex 的 gpt-6.1-sol）：留一格灰的，
              // 不让人以为是面板漏了这个功能
              <Picker
                label="思考强度"
                value=""
                disabled
                title="这个模型没有可选的思考强度"
                options={[{ value: "", label: "默认强度" }]}
                onChange={() => {}}
              />
            )}
            {ready && <ContextRing usage={usage && usage.size > 0 ? usage : null} quota={Object.values(quota)} />}
            </div>
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
        </div>
      </footer>
    </aside>
  );
}

// ------------------------------------------------------------ 对话里的一条

interface PickerOption {
  value: string;
  label: string;
  /** 选项下面一行小字（中文的说明） */
  hint?: string;
  group?: string | null;
  title?: string;
  risky?: boolean;
}

/**
 * 输入框底部那几个「文字 + 小箭头」的选择器，点开是一张往上弹的小菜单。
 *
 * 以前是盖了一层透明的原生 `<select>`：省事，但点开的是系统那种白底灰条的
 * 下拉，和整个面板格格不入（作者原话：「选择框有点丑」）。现在自己画：当前项
 * 打勾、权限这类带一行中文说明、危险的那几项换提醒色；键盘上下选、回车确定、
 * Esc 收起，点别处也收起
 */
function Picker({
  label,
  icon,
  risky = false,
  value,
  options,
  disabled,
  title,
  align = "right",
  onChange,
}: {
  label: string;
  icon?: "shield";
  /** 不再逐个确认的权限，换个颜色提醒 */
  risky?: boolean;
  value: string;
  options: PickerOption[];
  disabled?: boolean;
  title?: string;
  /** 菜单和按钮哪一边对齐。靠左的那个往右展开，免得伸出面板 */
  align?: "left" | "right";
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    // 打开时把焦点放在当前项上，键盘能直接接着选
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus();
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      wrapRef.current?.querySelector<HTMLElement>(".agent-pick")?.focus();
    }
  };

  const groups = [...new Set(options.map((o) => o.group ?? null))];
  const item = (o: PickerOption) => (
    <button
      key={`${o.group ?? ""}/${o.value}`}
      role="option"
      aria-selected={o.value === value}
      data-value={o.value}
      className={`agent-pop-item${o.value === value ? " is-on" : ""}${o.risky ? " is-risky" : ""}`}
      title={o.title}
      onClick={() => choose(o.value)}
    >
      <span className="agent-pop-check">{o.value === value && <Icon name="check" size={12} />}</span>
      <span className="agent-pop-text">
        <span className="agent-pop-label">{o.label}</span>
        {o.hint && <span className="agent-pop-hint">{o.hint}</span>}
      </span>
    </button>
  );

  return (
    <div className="agent-pick-wrap" ref={wrapRef}>
      <button
        className={`agent-pick${risky ? " is-risky" : ""}${open ? " is-open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-value={value}
        disabled={disabled}
        title={title ?? (current ? `${label}：${current.label}` : label)}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon && <Icon name={icon} size={12} />}
        <span className="agent-pick-text">{current?.label ?? (value || label)}</span>
        <Icon name="chevron" size={9} />
      </button>
      {open && (
        <div className={`agent-pop is-${align}`} role="listbox" aria-label={label} ref={listRef} onKeyDown={onListKey}>
          {groups.length === 1 && groups[0] === null
            ? options.map(item)
            : groups.map((g) => (
                <div key={g ?? ""} role="group" aria-label={g ?? undefined}>
                  {g && <div className="agent-pop-group">{g}</div>}
                  {options.filter((o) => (o.group ?? null) === g).map(item)}
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

/** 重置时间说成人话：今天的说钟点，别的天说日期 */
function resetText(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/**
 * 上下文用了多少：一个小圆环，悬停看数字。快满时变色 —— 到那时 agent 会开始
 * 压缩前面的对话，人该知道它正在忘事。
 *
 * 旁边是账号额度：几个窗口（5 小时、每周…）里用得最多的那个，快到头了变色、
 * 用完了变红，悬停看每一个和重置时间。还没发过话时圆环是空的，悬停说明数字
 * 什么时候来
 */
function ContextRing({ usage, quota }: { usage: NonNullable<Conversation["usage"]> | null; quota: QuotaWindow[] }) {
  const ratio = usage ? Math.min(1, Math.max(0, usage.used / usage.size)) : 0;
  const r = 6.5;
  const len = 2 * Math.PI * r;
  const pct = Math.round(ratio * 100);
  const cost = usage?.cost
    ? ` · 这个对话花了 ${usage.cost.currency === "USD" ? "$" : `${usage.cost.currency} `}${usage.cost.amount.toFixed(2)}`
    : "";
  const ctxLine = usage
    ? `上下文：${shortCount(usage.used)} / ${shortCount(usage.size)}（${pct}%）${cost}`
    : "上下文：发出第一句之后才有数字";

  const windows = [...quota].sort((a, b) => (b.used ?? -1) - (a.used ?? -1));
  const top = windows[0];
  const out = quota.some((q) => q.status === "out" || q.used === 100);
  const warning = quota.some((q) => q.status === "warning" || (q.used ?? 0) >= 80);
  const quotaLines = windows.map((q) => {
    const used = q.status === "out" ? "已用完" : q.used === null ? "可用" : `已用 ${q.used}%`;
    return `${q.name}额度：${used}${q.resets ? `，${q.resets} 重置` : ""}`;
  });

  return (
    <span className={`agent-usage${out ? " is-out" : warning ? " is-warn" : ""}`} title={[ctxLine, ...quotaLines].join("\n")}>
      {top && <span className="agent-quota">{out ? "额度用完" : top.used === null ? "额度正常" : `额度 ${top.used}%`}</span>}
      <span
        className={`agent-ctx${ratio > 0.8 ? " is-full" : ""}${usage ? "" : " is-empty"}`}
        aria-label={usage ? `上下文已用 ${pct}%` : "上下文还没有用量"}
        role="img"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r={r} className="agent-ctx-track" />
          {usage && (
            <circle
              cx="9"
              cy="9"
              r={r}
              className="agent-ctx-fill"
              strokeDasharray={`${len * ratio} ${len}`}
              transform="rotate(-90 9 9)"
            />
          )}
        </svg>
      </span>
    </span>
  );
}

/** 文件内容 → base64（不带 `data:` 前缀） */
function fileBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

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
          {entry.images && entry.images.length > 0 && (
            <div className="agent-user-images">
              {entry.images.map((src, i) => (
                <img key={i} src={src} alt="" />
              ))}
            </div>
          )}
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
