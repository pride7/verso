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
  Usage,
} from "./acp";

export interface FileDiff {
  /** 绝对路径，原样来自 agent */
  path: string;
  /** null = 新建的文件 */
  oldText: string | null;
  newText: string;
}

export type ChatEntry =
  | {
      kind: "user";
      text: string;
      /** 这一句带上了什么：笔记、选区、附件的名字 */
      context: string[];
      /** 随这一句发出去的图片（data URL），画成缩略图 */
      images?: string[];
    }
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
  /** 旧写法模型列表里的全部 id。Codex 的思考强度藏在这里（见 `effortControl`） */
  variants: string[];
  /** 开这个对话时交给 Claude 的 effort（`_meta`）。null = 用它自己的默认 */
  effort: string | null;
  /** 最近一次 `usage_update`。agent 不报就一直是 null */
  usage: Usage | null;
  /** 这一轮还没回完。各管各的：切走了它照样在后台跑 */
  busy: boolean;
  /** 正在从 agent 那里把以前的历史接回来 */
  loading: boolean;
  /** 毫秒。对话列表按它排 */
  updatedAt: number;
}

export function newConversation(id: string, now: number, title: string | null = null): Conversation {
  return {
    id,
    title,
    entries: [],
    modes: [],
    modeId: null,
    config: [],
    variants: [],
    effort: null,
    usage: null,
    busy: false,
    loading: false,
    updatedAt: now,
  };
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
  variants: string[] = [],
): { id: string; value: string | boolean }[] {
  const out: { id: string; value: string | boolean }[] = [];
  for (const o of options) {
    if (!o.category || !REMEMBERED_CATEGORIES.has(o.category)) continue;
    const want = saved[o.id];
    if (want === undefined || want === o.currentValue) continue;
    if (o.type === "select") {
      // Codex 记住的是带强度的那个（`gpt-5.5/high`），它不在基础列表里、在变体列表里
      const known = configChoices(o).some((c) => c.value === want) || variants.includes(want as string);
      if (typeof want === "string" && known) out.push({ id: o.id, value: want });
    } else if (typeof want === "boolean") {
      out.push({ id: o.id, value: want });
    }
  }
  return out;
}

// ------------------------------------------------------------------ 思考强度

/** 各家都用这几个词，按从低到高排 */
export const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export const EFFORT_LABEL: Record<string, string> = {
  default: "默认",
  none: "不思考",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "极高",
  ultra: "最高",
};

/**
 * Claude Code 认的那几档（`claude --help` 里 `--effort` 的取值）。适配器不报
 * 每个模型支持哪些，所以列全；模型不支持时 Claude Code 自己会忽略
 */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** `gpt-5.5/high` → 基础模型和强度。不带斜杠的就是没有强度可选 */
export function splitModel(value: string): { base: string; effort: string | null } {
  const at = value.lastIndexOf("/");
  return at > 0 ? { base: value.slice(0, at), effort: value.slice(at + 1) } : { base: value, effort: null };
}

/** 某个基础模型有哪些强度可选（照 Codex 的变体列表），按从低到高排 */
export function variantEfforts(base: string, variants: string[]): string[] {
  const rank = (e: string) => (EFFORT_ORDER.includes(e) ? EFFORT_ORDER.indexOf(e) : EFFORT_ORDER.length);
  return variants
    .filter((v) => v.startsWith(`${base}/`))
    .map((v) => v.slice(base.length + 1))
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * 拼回 Codex 认的模型名。这个强度在新模型上没有，就退到「中」，再没有就退到
 * 基础名（用它自己的默认）—— 换模型时不能因为强度对不上就整个设不进去
 */
export function joinModel(base: string, effort: string | null, variants: string[]): string {
  const levels = variantEfforts(base, variants);
  if (effort && levels.includes(effort)) return `${base}/${effort}`;
  if (levels.includes("medium") && effort) return `${base}/medium`;
  return base;
}

/**
 * 这个对话的思考强度怎么调。三家三种做法，按优先级：
 *
 * 1. **协议标准的那一项**（`configOptions` 里 category 是 `thought_level`）——
 *    哪家按标准报了就用它，下面两条都是为眼下还没这么做的适配器补的
 * 2. **编在模型名里**（Codex：`gpt-5.5/high`）
 * 3. **开对话时传进去**（Claude：`_meta.claudeCode.options.effort`）。中途改就得
 *    把对话关掉再接回来，所以这一种要 agent 能关、能接回
 */
export type EffortControl =
  | { kind: "config"; option: ConfigOption }
  | { kind: "variant"; model: ConfigOption; base: string; current: string | null; levels: string[] }
  | { kind: "meta"; current: string | null; levels: string[] }
  | null;

export function effortControl(c: Conversation, metaEffort: boolean): EffortControl {
  const thought = c.config.find((o) => o.category === "thought_level");
  if (thought) return { kind: "config", option: thought };
  const model = c.config.find((o) => o.category === "model" && o.type === "select");
  if (model && model.type === "select") {
    const { base, effort } = splitModel(model.currentValue);
    const levels = variantEfforts(base, c.variants);
    if (levels.length > 0) return { kind: "variant", model, base, current: effort, levels };
  }
  if (metaEffort) return { kind: "meta", current: c.effort, levels: CLAUDE_EFFORTS };
  return null;
}

/**
 * 权限模式给人看的名字。agent 给的是英文，而且两家叫法不一样（Claude 的
 * `bypassPermissions` 和 Codex 的 `full-access` 是同一件事）。`risky` 的那几个
 * 不再逐个确认，界面上要换个颜色提醒
 */
export const MODE_LABEL: Record<string, { label: string; hint?: string; risky?: boolean }> = {
  // Claude
  default: { label: "每次询问", hint: "改文件、跑命令之前都先问你" },
  acceptEdits: { label: "自动接受修改", hint: "改文件不再问，跑命令还会问" },
  plan: { label: "只做计划", hint: "先出一份计划，不动任何文件" },
  // 旧的 Codex 适配器也有一个 `auto`（= 可改仓库），新 Claude 的 `auto` 是这个
  auto: { label: "自动判断", hint: "由它自己判断哪些要先问你" },
  dontAsk: { label: "不询问，未授权的拒绝", hint: "没授权过的操作直接拒绝" },
  bypassPermissions: { label: "完全访问", hint: "什么都不问，直接做", risky: true },
  // Codex
  "read-only": { label: "只读", hint: "只能看，改文件、联网都要先问" },
  "workspace-write": { label: "可改仓库", hint: "能改仓库里的文件；出仓库或联网要先问" },
  agent: { label: "只问有风险的", hint: "只在它觉得可能不安全时才问" },
  "agent-full-access": { label: "完全访问", hint: "任何文件、联网都不问", risky: true },
  "full-access": { label: "完全访问", hint: "任何文件、联网都不问", risky: true },
};

/**
 * 底部那一行里「别的」配置（快速模式、协作模式…）的中文名。按 id 认，认不出
 * 的照 agent 给的英文名
 */
export const CONFIG_NAME: Record<string, string> = {
  fast: "快速",
  "fast-mode": "快速",
  collaboration_mode: "协作",
};

/** 那些配置的常见选项 */
export const CHOICE_LABEL: Record<string, string> = {
  on: "开",
  off: "关",
  default: "默认",
  plan: "先计划",
};

// ------------------------------------------------------------------ 额度

/** 一个额度窗口，界面上就画这个 */
export interface QuotaWindow {
  /** 已经换成中文的名字：「5 小时」「每周（全部模型）」 */
  name: string;
  /** 已用百分比，0–100；不知道就是 null */
  used: number | null;
  /** 什么时候重置，原样（各家的写法不一样） */
  resets: string | null;
  /** 认得出来的话，重置的时刻（毫秒）。认不出就只能原样显示 `resets` */
  resetsAt?: number | null;
  /** 快到头 / 用完了 */
  status?: "warning" | "out";
}

/** 「5-hour limit」「Weekly · all models」「codex Weekly limit」→ 中文 */
export function quotaName(raw: string): string {
  let t = raw.trim().replace(/^codex\s+/i, "").replace(/\s+limit$/i, "").trim();
  const [head, ...rest] = t.split(/\s*·\s*/);
  const base = /^(5[-\s]?h(our)?|five[-_\s]hour)$/i.test(head)
    ? "5 小时"
    : /^(weekly|7[-\s]?day|seven[-_\s]day)$/i.test(head)
      ? "每周"
      : /^daily$/i.test(head)
        ? "每天"
        : head;
  const extra = rest.join(" · ").replace(/^all models$/i, "全部模型");
  t = extra ? `${base}（${extra}）` : base;
  return t;
}

/**
 * 从 `/usage`（Claude）或 `/status`（Codex）的输出里认出额度。
 *
 * 两家都是排好版的 Markdown，不是数据，所以只能照着写法认：
 *
 * - Claude：`**5-hour limit** — **34%** · Resets Oct 15, 1:20 AM EDT`（已用）
 * - Codex：`**codex Weekly limit:** 99% left (resets 04:46 on 10月20日)`（剩余）
 *
 * 认不出的行跳过 —— 哪天格式变了，最坏是不显示额度，不会显示错的
 */
export function parseQuotaText(md: string, now: Date = new Date()): QuotaWindow[] {
  const out: QuotaWindow[] = [];
  const at = (raw: string | undefined) => (raw ? parseResetTime(raw.trim(), now) : null);
  const claude = /\*\*([^*\n]+?)\*\*\s*[—–-]\s*\*\*(\d+(?:\.\d+)?)%\*\*(?:\s*·\s*Resets?\s+([^\n`]+?))?\s*$/gim;
  for (const m of md.matchAll(claude)) {
    out.push({ name: quotaName(m[1]), used: Math.round(Number(m[2])), resets: m[3]?.trim() || null, resetsAt: at(m[3]) });
  }
  const codex = /\*\*([^*\n]*limit[^*\n]*?):?\*\*:?\s*(\d+(?:\.\d+)?)%\s*left(?:\s*\(resets\s+([^)\n]+)\))?/gim;
  for (const m of md.matchAll(codex)) {
    out.push({ name: quotaName(m[1]), used: Math.round(100 - Number(m[2])), resets: m[3]?.trim() || null, resetsAt: at(m[3]) });
  }
  return out;
}

/** 美国那几个时区的缩写 → 相对 UTC 的小时数。Claude 的 `/usage` 按系统时区写缩写 */
const TZ_OFFSET: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * 重置时间的原文 → 时刻（毫秒）。认得两种写法：
 *
 * - Claude：`Oct 15, 12:59 AM EDT`（带时区缩写；没写年份）
 * - Codex：`04:46 on 10月20日`、`13:05`（本地时间）
 *
 * 没写年份、没写日期的，取「离现在最近的将来」—— 重置时间总在将来。
 * 认不出就是 null，界面退回原文
 */
export function parseResetTime(raw: string, now: Date): number | null {
  const en = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{1,2}):(\d{2}) ?(AM|PM)(?: ([A-Z]{2,4}))?$/i.exec(raw);
  if (en) {
    const month = MONTHS.indexOf(en[1].toLowerCase());
    if (month < 0) return null;
    let hour = Number(en[3]) % 12;
    if (en[5].toUpperCase() === "PM") hour += 12;
    const tz = en[6]?.toUpperCase();
    if (tz && !(tz in TZ_OFFSET)) return null;
    const make = (year: number) =>
      tz
        ? Date.UTC(year, month, Number(en[2]), hour - TZ_OFFSET[tz], Number(en[4]))
        : new Date(year, month, Number(en[2]), hour, Number(en[4])).getTime();
    let t = make(now.getFullYear());
    // 跨年：十二月底看到的「Jan 2」是明年的
    if (t < now.getTime() - 86_400_000) t = make(now.getFullYear() + 1);
    return t;
  }
  const zh = /^(\d{1,2}):(\d{2})(?: on (\d{1,2})月(\d{1,2})日)?$/.exec(raw);
  if (zh) {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setHours(Number(zh[1]), Number(zh[2]));
    if (zh[3]) {
      d.setMonth(Number(zh[3]) - 1, Number(zh[4]));
      if (d.getTime() < now.getTime() - 86_400_000) d.setFullYear(d.getFullYear() + 1);
    } else if (d.getTime() < now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }
  return null;
}

/** 「3 小时 12 分后重置」：一天以内说还有多久，再远说日期 */
export function resetPhrase(at: number, now: Date): string {
  const mins = Math.max(0, Math.floor((at - now.getTime()) / 60_000));
  if (mins < 1) return "马上重置";
  if (mins < 60) return `${mins} 分钟后重置`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} 小时 ${m} 分后重置` : `${h} 小时后重置`;
  }
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm} 重置`;
}

/** 结构化的额度事件（`_claude/rateLimit`）换成同一种窗口 */
export function windowOf(r: RateLimit, resetText: (unixSeconds: number) => string): QuotaWindow {
  return {
    name: QUOTA_WINDOW_LABEL[r.rateLimitType ?? ""] ?? r.rateLimitType ?? "额度",
    used: quotaPercent(r),
    resets: r.resetsAt ? resetText(r.resetsAt) : null,
    resetsAt: r.resetsAt ? r.resetsAt * 1000 : null,
    status: r.status === "rejected" ? "out" : r.status === "allowed_warning" ? "warning" : undefined,
  };
}

/**
 * 账号的用量额度（Claude：5 小时窗口、7 天窗口…）。Claude 的适配器在快到
 * 限额时把它塞在 `usage_update` 的 `_meta["_claude/rateLimit"]` 里，一次报
 * 一个窗口 —— 平时不报，平时的数字靠 `/usage`（见 `parseQuotaText`）
 */
export interface RateLimit {
  status: "allowed" | "allowed_warning" | "rejected";
  /** 哪个窗口：five_hour、seven_day… */
  rateLimitType?: string;
  /** 用了多少。可能是 0–1 的比例，也可能已经是百分数 —— 见 `quotaPercent` */
  utilization?: number;
  /** 什么时候重置（Unix 秒） */
  resetsAt?: number;
}

export const QUOTA_WINDOW_LABEL: Record<string, string> = {
  five_hour: "5 小时",
  seven_day: "每周",
  seven_day_opus: "每周（Opus）",
  seven_day_sonnet: "每周（Sonnet）",
  seven_day_overage_included: "每周（含超额）",
  overage: "超额",
};

/** 从 `usage_update` 的私有字段里认出额度。认不出就是 null */
export function rateLimitOf(meta: unknown): RateLimit | null {
  const r = (meta as Record<string, unknown> | null | undefined)?.["_claude/rateLimit"] as RateLimit | undefined;
  return r && typeof r.status === "string" ? r : null;
}

/** 已用百分比，0–100。≤1 的当比例，>1 的当已经是百分数 */
export function quotaPercent(r: RateLimit): number | null {
  if (typeof r.utilization !== "number" || !Number.isFinite(r.utilization)) return null;
  const pct = r.utilization <= 1 ? r.utilization * 100 : r.utilization;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** 一个数字的短写：25109 → 25k，1000000 → 1M */
export function shortCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
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
    // 面板查额度时开的那种（只跑了一个 `/usage`），不是人的对话
    if (/^\/(usage|status)$/.test(p.title?.trim() ?? "")) continue;
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

// ------------------------------------------------------------------ 附件

/**
 * 随一句话发出去的附件。按来源分四种，各有各的送法：
 *
 * - `path`：用「+」选的本机文件。只给路径，让 agent 用它自己的工具去读 ——
 *   PDF、Word 这类 Verso 读不懂的它读得懂，而且它读文件有自己的许可规则
 * - `note`：从文档树拖进来的笔记，同上，路径在 vault 里
 * - `image`：粘贴或拖进来的图片。它没有路径（剪贴板里的截图本来就不是文件），
 *   只能把内容整个带上
 * - `text`：拖进来的文本文件，同理带上内容
 */
export type Attachment =
  | { kind: "path"; path: string; name: string }
  | { kind: "note"; rel: string }
  | { kind: "image"; name: string; mimeType: string; data: string }
  | { kind: "text"; name: string; mimeType: string; text: string };

/** 图片多大还能带上。各家模型的单张上限在 5 MB 上下，超了发出去也是被拒 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 文本文件多大还整个带上。再大就该让 agent 自己按需去读，用「+」选 */
export const MAX_TEXT_BYTES = 512 * 1024;

export function attachmentName(a: Attachment): string {
  return a.kind === "note" ? a.rel.replace(/\.md$/, "") : a.name;
}

/** 本机绝对路径 → `file://` URI。Windows 的盘符、反斜杠都照规矩换 */
export function absFileUri(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const encoded = norm
    .split("/")
    .map((seg) => (/^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join("/");
  return encoded.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

/** 附件 → 协议里的内容块 */
export function attachmentBlock(a: Attachment, vaultRoot: string): ContentBlock {
  switch (a.kind) {
    case "path":
      return { type: "resource_link", uri: absFileUri(a.path), name: a.name };
    case "note":
      return { type: "resource_link", uri: fileUri(vaultRoot, a.rel), name: a.rel };
    case "image":
      return { type: "image", mimeType: a.mimeType, data: a.data };
    case "text":
      return { type: "resource", resource: { uri: `file:///${encodeURIComponent(a.name)}`, text: a.text, mimeType: a.mimeType } };
  }
}

/** 拖进来的文件按文本带上的那些。浏览器给的 MIME 常常是空的，再看扩展名 */
export function looksLikeText(name: string, mimeType: string): boolean {
  if (mimeType.startsWith("text/") || /json|xml|yaml|toml|javascript|typescript/.test(mimeType)) return true;
  return /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|rs|go|java|kt|c|h|cpp|hpp|cs|rb|php|sh|ps1|sql|tex|bib|log|ini|cfg|conf)$/i.test(
    name,
  );
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
