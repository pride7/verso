/**
 * 把 agent 发来的 `session/update` 流折成一份对话记录。DESIGN.md §7.8
 *
 * 流里的东西是碎的：一句回答拆成几十个 chunk，一次改文件先来一条
 * `tool_call`、再来几条只带变化字段的 `tool_call_update`。面板要的是
 * 「一条条能画出来的东西」，这个折叠就在这里做 —— 纯函数，好测。
 */

import type {
  ConfigChoice,
  ConfigOption,
  ContentBlock,
  PlanEntry,
  SessionInfo,
  SessionMode,
  SessionUpdate,
  ToolCallFields,
  ToolKind,
  ToolStatus,
} from "./acp";

export interface FileDiff {
  /** 绝对路径，原样来自 agent */
  path: string;
  /** null = 新建的文件 */
  oldText: string | null;
  newText: string;
}

export type ChatEntry =
  | { kind: "user"; text: string; context: string[] }
  | { kind: "agent"; text: string }
  | { kind: "thought"; text: string }
  | {
      kind: "tool";
      id: string;
      title: string;
      toolKind: ToolKind;
      status: ToolStatus;
      diffs: FileDiff[];
      /** 工具自己的文字输出（命令结果、搜索结果） */
      output: string;
    }
  | { kind: "plan"; entries: PlanEntry[] };

/** 内容块里能当文字显示的部分。图片、音频这一版不画 */
export function blockText(b: ContentBlock): string {
  if (b.type === "text") return (b as { text: string }).text;
  if (b.type === "resource_link") return `[${(b as { name: string }).name}]`;
  return "";
}

function mergeTool(
  prev: Extract<ChatEntry, { kind: "tool" }> | undefined,
  u: ToolCallFields,
): Extract<ChatEntry, { kind: "tool" }> {
  const base = prev ?? {
    kind: "tool" as const,
    id: u.toolCallId,
    title: "",
    toolKind: "other" as ToolKind,
    status: "pending" as ToolStatus,
    diffs: [],
    output: "",
  };
  const next = { ...base };
  if (u.title) next.title = u.title;
  if (u.kind) next.toolKind = u.kind;
  if (u.status) next.status = u.status;
  // `content` 给了就是**整份替换**（协议如此），不是追加
  if (u.content) {
    next.diffs = u.content
      .filter((c): c is Extract<typeof c, { type: "diff" }> => c.type === "diff")
      .map((c) => ({ path: c.path, oldText: c.oldText ?? null, newText: c.newText }));
    next.output = u.content
      .map((c) => (c.type === "content" ? blockText(c.content) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return next;
}

/** 接一条更新，返回新的一份记录（不改原数组 —— React 要靠引用判断变没变） */
export function applyUpdate(entries: ChatEntry[], u: SessionUpdate): ChatEntry[] {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "user_message_chunk": {
      const kind =
        u.sessionUpdate === "agent_message_chunk"
          ? "agent"
          : u.sessionUpdate === "agent_thought_chunk"
            ? "thought"
            : "user";
      const text = blockText((u as { content: ContentBlock }).content);
      if (!text) return entries;
      const last = entries[entries.length - 1];
      // 同一种的碎片接在一起；中间插进来一个工具调用，就是新的一段话
      if (last && last.kind === kind) {
        const merged = { ...last, text: last.text + text } as ChatEntry;
        return [...entries.slice(0, -1), merged];
      }
      return [...entries, kind === "user" ? { kind, text, context: [] } : { kind, text }];
    }
    case "tool_call":
    case "tool_call_update": {
      const f = u as ToolCallFields;
      const at = entries.findIndex((e) => e.kind === "tool" && e.id === f.toolCallId);
      if (at < 0) return [...entries, mergeTool(undefined, f)];
      const out = entries.slice();
      out[at] = mergeTool(entries[at] as Extract<ChatEntry, { kind: "tool" }>, f);
      return out;
    }
    case "plan": {
      // 计划每次都是整份重发。只留一份，就地更新 —— 十条「计划」排在
      // 对话里，人分不清哪一份是现在的
      const entriesOf = (u as { entries: PlanEntry[] }).entries;
      const at = entries.findIndex((e) => e.kind === "plan");
      const plan: ChatEntry = { kind: "plan", entries: entriesOf };
      if (at < 0) return [...entries, plan];
      const out = entries.slice();
      out[at] = plan;
      return out;
    }
    default:
      return entries;
  }
}

// ------------------------------------------------------------------ 多个对话

/** 面板里的一次对话。同一个 agent 进程可以同时开着好几个 */
export interface Conversation {
  id: string;
  /** agent 给的标题（`session/list`、`session_info_update`）。没有就从第一句话里取 */
  title: string | null;
  entries: ChatEntry[];
  modes: SessionMode[];
  modeId: string | null;
  /** agent 报上来的可调配置（模型、权限模式…）。给了它就不再用 `modes` */
  config: ConfigOption[];
  /** 这一轮还没回完。各管各的：切走了它照样在后台跑 */
  busy: boolean;
  /** 正在从 agent 那里把以前的历史接回来 */
  loading: boolean;
  /** 毫秒。对话列表按它排 */
  updatedAt: number;
}

export function newConversation(id: string, now: number, title: string | null = null): Conversation {
  return { id, title, entries: [], modes: [], modeId: null, config: [], busy: false, loading: false, updatedAt: now };
}

// ------------------------------------------------------------------ 可调配置

/** 下拉里的全部选项，分组的摊平。组名带在 `group` 上，画成 `<optgroup>` */
export function configChoices(o: ConfigOption): (ConfigChoice & { group: string | null })[] {
  if (o.type !== "select") return [];
  const out: (ConfigChoice & { group: string | null })[] = [];
  for (const item of o.options) {
    if ("group" in item) for (const c of item.options) out.push({ ...c, group: item.name });
    else out.push({ ...item, group: null });
  }
  return out;
}

/**
 * 哪些配置值得替人记住、下一个对话自动沿用：模型和思考强度。
 *
 * **权限模式不记。** 「跳过所有确认」是为眼前这件事开的口子，悄悄延续到下一个
 * 对话里，人就不知道自己是在什么规则下让它改文件的。
 */
export const REMEMBERED_CATEGORIES = new Set(["model", "model_config", "thought_level"]);

/** 控件旁边的小字。agent 给的名字是英文的（「Model」），常见的几类换成中文 */
export function configLabel(o: ConfigOption): string {
  const byCategory: Record<string, string> = {
    model: "模型",
    thought_level: "思考",
    mode: "权限",
  };
  return (o.category && byCategory[o.category]) || o.name;
}

/**
 * 记住的值里，哪些要在新对话上补设：这一项还在、记住的值还在选项里、
 * 而且和现在的不一样。模型下架了、换了一家 AI，就安静地不补。
 */
export function configToRestore(
  options: ConfigOption[],
  saved: Record<string, string | boolean>,
): { id: string; value: string | boolean }[] {
  const out: { id: string; value: string | boolean }[] = [];
  for (const o of options) {
    if (!o.category || !REMEMBERED_CATEGORIES.has(o.category)) continue;
    const want = saved[o.id];
    if (want === undefined || want === o.currentValue) continue;
    if (o.type === "select") {
      if (typeof want === "string" && configChoices(o).some((c) => c.value === want)) out.push({ id: o.id, value: want });
    } else if (typeof want === "boolean") {
      out.push({ id: o.id, value: want });
    }
  }
  return out;
}

/** 列表里给人看的名字 */
export function conversationTitle(c: Pick<Conversation, "title" | "entries">): string {
  if (c.title?.trim()) return c.title.trim();
  const first = c.entries.find((e) => e.kind === "user");
  if (!first) return "新对话";
  const line = (first as { text: string }).text.trim().split(/\r?\n/)[0];
  return line.length > 30 ? `${line.slice(0, 30)}…` : line;
}

/** 对话列表里的一行：开着的，或者 agent 那边记着的以前的 */
export interface ConversationRow {
  id: string;
  title: string;
  updatedAt: number;
  /** 这次打开面板之后开过的（在内存里） */
  open: boolean;
}

/**
 * 开着的和以前的合成一张表，新的在前。
 *
 * 同一个对话两边都有时只留开着的那一份 —— 它的内容更新。开着但一句话都
 * 没说过的不列（点「新对话」点出来的空白页），当前这一个除外。
 */
export function conversationRows(
  open: Conversation[],
  past: SessionInfo[],
  activeId: string | null,
): ConversationRow[] {
  const rows: ConversationRow[] = open
    .filter((c) => c.entries.length > 0 || c.id === activeId)
    .map((c) => ({ id: c.id, title: conversationTitle(c), updatedAt: c.updatedAt, open: true }));
  const seen = new Set(open.map((c) => c.id));
  for (const p of past) {
    if (seen.has(p.sessionId)) continue;
    const t = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
    rows.push({
      id: p.sessionId,
      title: p.title?.trim() || "没有标题的对话",
      updatedAt: Number.isFinite(t) ? t : 0,
      open: false,
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * agent 报上来的绝对路径 → vault 里的相对路径；不在 vault 里就原样返回。
 *
 * 比较时不分大小写、不分斜杠方向：Windows 上 agent 给的是 `D:\Notes\a.md`，
 * 而 vault 根可能写成 `d:/Notes`。
 */
export function relativeToVault(abs: string, root: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const a = norm(abs);
  const r = norm(root);
  const windows = /^[a-zA-Z]:\//.test(r);
  const same = windows ? a.toLowerCase().startsWith(r.toLowerCase() + "/") : a.startsWith(r + "/");
  return same ? a.slice(r.length + 1) : abs;
}

/** vault 里的相对路径 → `file://` URI，给 `resource_link` 用 */
export function fileUri(root: string, rel: string): string {
  const path = `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${rel}`;
  const encoded = path
    .split("/")
    .map((seg) => (/^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join("/");
  return encoded.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

/** 许可按钮上的字。agent 给的名字是英文的（「Always Allow」），按种类换成中文 */
export const PERMISSION_LABEL: Record<string, string> = {
  allow_once: "允许",
  allow_always: "总是允许",
  reject_once: "拒绝",
  reject_always: "总是拒绝",
};
