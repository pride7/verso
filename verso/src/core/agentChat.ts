/**
 * 把 agent 发来的 `session/update` 流折成一份对话记录。DESIGN.md §7.8
 *
 * 流里的东西是碎的：一句回答拆成几十个 chunk，一次改文件先来一条
 * `tool_call`、再来几条只带变化字段的 `tool_call_update`。面板要的是
 * 「一条条能画出来的东西」，这个折叠就在这里做 —— 纯函数，好测。
 */

import type { ContentBlock, PlanEntry, SessionUpdate, ToolCallFields, ToolKind, ToolStatus } from "./acp";

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
