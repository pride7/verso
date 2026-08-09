/**
 * 改 `verso-view` 代码块里的那几行 YAML。DESIGN.md §2.6
 *
 * ## 为什么按行改，不解析成对象再序列化回去
 *
 * 那个代码块是**用户写的**：键的顺序、注释、缩进都是他排的。解析→序列化会
 * 把这些全抹平，点一次表头排序就在 git 里炸出一整块 diff。这里只动要动的
 * 那一行，别的一个字节都不碰 —— 和源码模式显示 frontmatter 原文是同一条
 * 原则（§0 第 1 条：文件是用户的）。
 */

export type SortDir = "asc" | "desc";

/** 读 `sort: 难度 desc`。没有这一行、或者写法不认识就返回 null */
export function readSort(yaml: string): { key: string; dir: SortDir } | null {
  for (const line of yaml.split("\n")) {
    const m = /^\s*sort\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const raw = m[1].replace(/^["']|["']$/g, "").trim();
    const parts = raw.split(/\s+/);
    if (!parts[0]) return null;
    const dir = parts[1]?.toLowerCase() === "desc" ? "desc" : "asc";
    return { key: parts[0], dir };
  }
  return null;
}

/**
 * 写回 `sort:`。`null` = 去掉这一行（回到默认顺序）。
 *
 * 已经有那一行就原地替换 —— 保住它在块里的位置，diff 才只有一行。
 */
export function writeSort(yaml: string, sort: { key: string; dir: SortDir } | null): string {
  const lines = yaml.split("\n");
  const at = lines.findIndex((l) => /^\s*sort\s*:/.test(l));
  const value = sort ? `sort: ${sort.key}${sort.dir === "desc" ? " desc" : ""}` : null;

  if (at >= 0) {
    if (value === null) {
      lines.splice(at, 1);
    } else {
      // 缩进跟着原来那一行 —— 块里可能整体缩进过
      const indent = /^\s*/.exec(lines[at])![0];
      lines[at] = indent + value;
    }
    return lines.join("\n");
  }
  if (value === null) return yaml;

  // 没有就加在末尾（去掉可能存在的尾随空行，免得越加越空）
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push(value);
  return lines.join("\n");
}

/** 点一次表头：无序 → 升 → 降 → 无序 */
export function nextSort(
  current: { key: string; dir: SortDir } | null,
  key: string,
): { key: string; dir: SortDir } | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

/**
 * 「新建一行」应当把笔记建在哪 —— 返回父文档的 `.md` 路径，null = vault 根。
 *
 * `from: "论文/**"` 说的是这个视图收哪些笔记；新建的那篇当然要落进同一片
 * 范围里，否则它建完就不在表里，等于什么都没发生。按 §2.1，`论文/` 下的
 * 子文档，父文档就是 `论文.md`。
 */
export function newNoteParent(yaml: string): string | null {
  for (const line of yaml.split("\n")) {
    const m = /^\s*from\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const raw = m[1].replace(/^["']|["']$/g, "").trim();
    // 取通配符之前的那一段目录
    const dir = raw
      .split("/")
      .filter((seg) => seg && !seg.includes("*") && !seg.includes("?"))
      .join("/");
    return dir ? `${dir}.md` : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 通用的「读一个键 / 写一个键」—— 上面的 sort 是它的特例，
// 但 sort 那三个函数还带着「点一次换一个方向」的语义，留着不动
// ---------------------------------------------------------------------------

/** 读某个键的值（去掉引号）。没有这一行就是 null */
export function readKey(yaml: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`);
  for (const line of yaml.split("\n")) {
    const m = re.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * 写某个键。`null` = 删掉这一行。
 *
 * 和 `writeSort` 同一条规矩：有就原地替换、缩进跟着原行，没有才追加。
 * 那个代码块是用户写的，键序和注释都是他排的（§0 第 1 条）。
 */
export function writeKey(yaml: string, key: string, value: string | null): string {
  const lines = yaml.split("\n");
  const re = new RegExp(`^\\s*${key}\\s*:`);
  const at = lines.findIndex((l) => re.test(l));
  if (at >= 0) {
    if (value === null) {
      lines.splice(at, 1);
    } else {
      lines[at] = /^\s*/.exec(lines[at])![0] + `${key}: ${value}`;
    }
    return lines.join("\n");
  }
  if (value === null) return yaml;
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push(`${key}: ${value}`);
  return lines.join("\n");
}

export type SourceScope = "direct" | "recursive" | "custom";

export interface SourceScopeInfo {
  root: string;
  scope: SourceScope;
}

/**
 * 把最常见的两种来源读成人话：`目录/*` 只取直属文档，`目录/**` 取全部后代。
 *
 * 其他 glob 仍然允许手写，但界面不替用户猜它的根目录和层级。尤其根目录本身
 * 带通配符时，贸然改写末尾会让查询含义悄悄变化。
 */
export function readSourceScope(from: string): SourceScopeInfo {
  const value = from.trim();
  const suffix = value.endsWith("/**") ? "/**" : value.endsWith("/*") ? "/*" : null;
  if (!suffix) return { root: value, scope: "custom" };

  const root = value.slice(0, -suffix.length).replace(/\/+$/, "");
  if (!root || /[*?\[\]]/.test(root)) return { root, scope: "custom" };
  return { root, scope: suffix === "/*" ? "direct" : "recursive" };
}

/** 改来源层级，只在能明确识别根目录时改写。 */
export function sourceWithScope(from: string, scope: Exclude<SourceScope, "custom">): string | null {
  const info = readSourceScope(from);
  if (info.scope === "custom") return null;
  return `${info.root}/${scope === "direct" ? "*" : "**"}`;
}

/** `columns: [title, 作者]` → `["title", "作者"]`。没写就是 null（= 由后端决定显示哪些） */
export function readColumns(yaml: string): string[] | null {
  const raw = readKey(yaml, "columns");
  if (raw === null) return null;
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** 空数组等于「一列都不要」，那是误操作 —— 当成「回到默认」处理 */
export function writeColumns(yaml: string, cols: string[] | null): string {
  if (!cols || cols.length === 0) return writeKey(yaml, "columns", null);
  return writeKey(yaml, "columns", `[${cols.join(", ")}]`);
}

/** `where` 里的一个条件。运算符只用 Rust 侧认识的那七个 */
export interface Condition {
  key: string;
  op: string;
  value: string;
}

export const OPS = ["=", "!=", ">", ">=", "<", "<=", "contains"] as const;

/**
 * 解析 `status != "已读" and 难度 >= 3`。
 *
 * 只认 `and` 串起来的简单条件 —— Rust 侧的 `parse_condition` 就是这么解析的，
 * UI 认得比它多没有意义。看不懂的部分**原样留着**（返回 null），界面上会说
 * 「这个筛选是手写的，去代码块里改」，绝不擅自重写掉用户的表达式。
 */
export function readWhere(yaml: string): Condition[] | null {
  const raw = readKey(yaml, "where");
  if (raw === null) return [];
  const out: Condition[] = [];
  for (const part of raw.split(/\s+and\s+/i)) {
    const m = /^\s*(\S+?)\s*(!=|>=|<=|==|=|>|<|contains|~)\s*(.+?)\s*$/.exec(part);
    if (!m) return null;
    const value = m[3].replace(/^["']|["']$/g, "");
    // `or`、括号：Rust 侧不支持，它会把整段当成一个值。用户显然是想表达
    // 别的意思 —— 这种就当「看不懂」，让他自己去代码块里改，别在界面上
    // 把它规范化成一个语义不同的东西
    if (/[()]/.test(part) || /\bor\b/i.test(value)) return null;
    const op = m[2] === "==" ? "=" : m[2] === "~" ? "contains" : m[2];
    out.push({ key: m[1], op, value });
  }
  return out;
}

/**
 * 相对时间的单位。**写进文件的是这几个字母**，界面上才显示中文 ——
 * 中文一旦进了 `.md`，这篇笔记就不能拖进别的编辑器用了（§0 第 1 条）。
 */
export const RELATIVE_UNITS = [
  { unit: "d", label: "天" },
  { unit: "w", label: "周" },
  { unit: "m", label: "个月" },
  { unit: "y", label: "年" },
] as const;

/**
 * `90d ago` → `{ n: 90, unit: "d" }`。认不出来返回 null —— 那就是个普通字面值，
 * 用户可能真想找 `updated = "2026-05-01"`。
 *
 * 规则必须和 Rust 侧的 `relative_modifier` 一致：界面读作一个意思、查询按另一个
 * 意思跑，是最难查的一类毛病。
 */
export function readRelative(value: string): { n: number; unit: string } | null {
  const m = /^\s*(\d+)\s*([dwmy])\s+ago\s*$/.exec(value);
  if (!m) return null;
  return { n: Number(m[1]), unit: m[2] };
}

/** 给人看的写法：`90d ago` → `90 天前`。不是相对时间就返回 null */
export function describeRelative(value: string): string | null {
  const rel = readRelative(value);
  if (!rel) return null;
  return `${rel.n} ${RELATIVE_UNITS.find((u) => u.unit === rel.unit)?.label ?? rel.unit}前`;
}

/** 值里有空格就加引号 —— Rust 侧按空格切 token */
function quote(v: string): string {
  return /^-?\d+(\.\d+)?$/.test(v) || !/[\s"']/.test(v) ? v : `"${v.replace(/"/g, "")}"`;
}

export function writeWhere(yaml: string, conds: Condition[]): string {
  if (conds.length === 0) return writeKey(yaml, "where", null);
  return writeKey(
    yaml,
    "where",
    conds.map((c) => `${c.key} ${c.op} ${quote(c.value)}`).join(" and "),
  );
}

/**
 * 时间戳 → 给人看的写法。
 *
 * 索引里的时间是 RFC3339（`2026-06-06T21:04:11+08:00`），直接摆进表格是一串
 * 没人读的东西。只显示日期，鼠标停上去才看完整时刻 —— 表格里同一天的几十
 * 行，真正要比较的是「哪天」。
 *
 * 认不出来就**原样返回**：用户可能自己写了 `2026 年 6 月` 这种，替他猜一个
 * 日期比显示原文糟得多。
 */
export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : value;
}

/** `<input type="date">` 只认 `YYYY-MM-DD`，别的写法给它会显示成空 */
export function toDateInput(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : "";
}

/** 文件本身的时间，不在 frontmatter 里 —— 改不了，也不该让人以为能改 */
export const BUILTIN_COLUMNS = ["created", "updated"] as const;

export function isBuiltin(key: string): boolean {
  return (BUILTIN_COLUMNS as readonly string[]).includes(key);
}

/**
 * 列宽。写成一行 `widths: title=320, 作者=140`。
 *
 * ## 为什么进代码块而不是界面状态
 *
 * 和排序、列的显隐同一条理由（§0 第 1 条）：它写在笔记里、跟着 `.md` 走，
 * 换台机器、换个编辑器打开都还在。`.verso/` 放不了 —— 那里只放派生数据，
 * 而「这一列我调过宽」推断不出来。
 *
 * ## 为什么是一行而不是 YAML 映射
 *
 * 这个代码块是**用户手写**的，改动只动一行是这里的一贯做法（见文件头）。
 * 展开成多行映射的话，调一次列宽就在 git 里炸出一整块 diff。
 *
 * 属性名里带逗号或等号的情况不支持 —— 那种键名本来就会让 `columns: [a, b]`
 * 也失效，遇到就整条忽略、退回自适应，而不是解析出半个错误的结果。
 */
export function readWidths(yaml: string): Record<string, number> {
  const raw = readKey(yaml, "widths");
  if (raw === null) return {};
  const out: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const px = Number(part.slice(at + 1).trim());
    if (key && Number.isFinite(px) && px > 0) out[key] = Math.round(px);
  }
  return out;
}

/** 传 null 或空对象 = 删掉这一行，回到按内容自适应 */
export function writeWidths(yaml: string, widths: Record<string, number> | null): string {
  const entries = Object.entries(widths ?? {}).filter(([, px]) => Number.isFinite(px) && px > 0);
  if (entries.length === 0) return writeKey(yaml, "widths", null);
  return writeKey(yaml, "widths", entries.map(([k, px]) => `${k}=${Math.round(px)}`).join(", "));
}

/** 列宽的上下限。太窄了连一个字都放不下，太宽了横向滚动条会长到没边 */
export const MIN_COL_W = 56;
export const MAX_COL_W = 720;

export const clampColW = (px: number) => Math.min(MAX_COL_W, Math.max(MIN_COL_W, Math.round(px)));
