/**
 * 冲突定稿的拼装。§2.8 冲突 UI。
 *
 * diff 的方向固定是「old = 本地，new = 远端」。用户对每个 hunk 选边：
 * 选「本地」= 这一段维持原样；选「远端」= 用本地全文里对应的行区间换成
 * 远端那几行。**基底永远是本地全文** —— hunk 之间的未变部分不在 patch
 * 里（Git 只带 3 行上下文），只有拿全文当底才不丢内容。
 *
 * 纯函数，脱离 DOM 可测 —— 行号算错一行，拼出来的定稿就是坏文档，
 * 这里必须钉死。
 */
import type { DiffHunk } from "../types";

export type HunkChoice = "local" | "remote" | "both";

export interface PropertyConflict {
  key: string;
  base: string | null;
  local: string | null;
  remote: string | null;
}

interface PropertyVersion {
  base: string | null;
  local: string | null;
  remote: string | null;
  automatic: string | null;
  conflicted: boolean;
}

export interface MarkdownConflictAnalysis {
  order: string[];
  properties: Record<string, PropertyVersion>;
  conflicts: PropertyConflict[];
  baseBody: string;
  localBody: string;
  remoteBody: string;
  eol: "\n" | "\r\n";
}

interface ParsedMarkdown {
  order: string[];
  blocks: Record<string, string>;
  body: string;
}

/**
 * 只拆合法的顶层 YAML 属性块，并保留每个块的原文。遇到重复键、复杂键或
 * 无法归属的顶层内容就返回 null，让调用方安全退回普通文本冲突。
 */
function parseMarkdown(raw: string): ParsedMarkdown | null {
  const normalized = raw.startsWith("\ufeff") ? raw.slice(1) : raw;
  const open = normalized.startsWith("---\r\n")
    ? "---\r\n"
    : normalized.startsWith("---\n")
      ? "---\n"
      : null;
  if (!open) return { order: [], blocks: {}, body: normalized };

  const rest = normalized.slice(open.length);
  const close = /^(---|\.\.\.)\r?$/m.exec(rest);
  if (!close || close.index === undefined) return null;
  const afterClose = close.index + close[0].length;
  const bodyOffset = rest[afterClose] === "\r" && rest[afterClose + 1] === "\n"
    ? afterClose + 2
    : rest[afterClose] === "\n"
      ? afterClose + 1
      : afterClose;
  const yaml = rest.slice(0, close.index);
  const lines = yaml.match(/.*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
  const order: string[] = [];
  const blocks: Record<string, string> = {};
  let current: string | null = null;

  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, "");
    if (/^[^ \t#][^:\r\n]*:/.test(bare)) {
      const colon = bare.indexOf(":");
      const key = bare.slice(0, colon).trim();
      // 带冒号的引号键、空键和重复键交给普通文本界面，不能猜。
      if (!key || key.startsWith("'") || key.startsWith('"') || key in blocks) return null;
      current = key;
      order.push(key);
      blocks[key] = line;
      continue;
    }
    if (!current) {
      if (bare.trim() === "" || bare.trimStart().startsWith("#")) return null;
      return null;
    }
    // 缩进值、列表项、空行和注释都属于前一个顶层属性块。
    blocks[current] += line;
  }

  return { order, blocks, body: rest.slice(bodyOffset) };
}

const same = (a: string | null, b: string | null) => a === b;

/**
 * 用共同版本判断每个 frontmatter 键由谁修改。返回 null 表示 YAML 结构超出
 * 可靠处理范围；这不是错误，界面会退回原来的逐段对比。
 */
export function analyzeMarkdownConflict(
  baseText: string | null,
  localText: string,
  remoteText: string,
): MarkdownConflictAnalysis | null {
  // 旧版后端与持久化测试夹具里还没有 base 字段，undefined 也安全回退。
  if (baseText == null) return null;
  const base = parseMarkdown(baseText);
  const local = parseMarkdown(localText);
  const remote = parseMarkdown(remoteText);
  if (!base || !local || !remote) return null;

  const order = [...base.order];
  for (const key of [...local.order, ...remote.order]) if (!order.includes(key)) order.push(key);
  const properties: Record<string, PropertyVersion> = {};
  const conflicts: PropertyConflict[] = [];

  for (const key of order) {
    const b = base.blocks[key] ?? null;
    const l = local.blocks[key] ?? null;
    const r = remote.blocks[key] ?? null;
    let automatic: string | null;
    let conflicted = false;
    if (same(l, r)) automatic = l;
    else if (same(l, b)) automatic = r;
    else if (same(r, b)) automatic = l;
    else {
      automatic = l;
      conflicted = true;
      conflicts.push({ key, base: b, local: l, remote: r });
    }
    properties[key] = { base: b, local: l, remote: r, automatic, conflicted };
  }

  return {
    order,
    properties,
    conflicts,
    baseBody: base.body,
    localBody: local.body,
    remoteBody: remote.body,
    eol: localText.includes("\r\n") ? "\r\n" : "\n",
  };
}

function alternateKey(key: string, occupied: Set<string>) {
  let candidate = `${key}（远端）`;
  let n = 2;
  while (occupied.has(candidate)) candidate = `${key}（远端 ${n++}）`;
  occupied.add(candidate);
  return candidate;
}

function renameBlock(block: string, key: string) {
  const first = block.search(/:/);
  return first < 0 ? block : `${key}${block.slice(first)}`;
}

/** 把字段选择与已经解决好的正文重新拼成 Markdown。 */
export function composeMarkdownConflict(
  analysis: MarkdownConflictAnalysis,
  choices: Record<string, HunkChoice>,
  body: string,
): string {
  const occupied = new Set(analysis.order);
  const blocks: string[] = [];
  for (const key of analysis.order) {
    const p = analysis.properties[key];
    const choice = p.conflicted ? choices[key] : undefined;
    if (choice === "both" && p.local !== p.remote) {
      if (p.local !== null) blocks.push(p.local);
      if (p.remote !== null) blocks.push(renameBlock(p.remote, alternateKey(key, occupied)));
      continue;
    }
    const block = choice === "remote" ? p.remote : choice === "local" ? p.local : p.automatic;
    if (block !== null) blocks.push(block);
  }
  if (blocks.length === 0) return body;
  const yaml = blocks.map((b) => b.endsWith("\n") ? b : `${b}${analysis.eol}`).join("");
  return `---${analysis.eol}${yaml}---${analysis.eol}${body}`;
}

/** 属性块在卡片里只显示值，不重复显示键名。 */
export function propertyValue(block: string | null) {
  if (block === null) return "（没有这个属性）";
  const colon = block.indexOf(":");
  const value = colon < 0 ? block : block.slice(colon + 1);
  return value.trim() || "（空值）";
}

/**
 * 按选择拼出定稿。
 *
 * Git hunk 的行号规矩（1 起）：
 *   - `oldLines > 0`：从 `oldStart` 行起、共 `oldLines` 行是本地被动到的区间
 *   - `oldLines === 0`：纯插入，插在 `oldStart` 行**之后**
 *
 * 从后往前替换，前面的行号才不会被后面的改动挪动。
 */
export function mergeChoices(
  localText: string,
  hunks: DiffHunk[],
  choices: HunkChoice[],
): string {
  const lines = localText.split("\n");

  // 从后往前。hunks 本身按位置升序（git 的产出顺序）
  for (let i = hunks.length - 1; i >= 0; i -= 1) {
    if (choices[i] === "local") continue;
    const hunk = hunks[i];
    const localLines = hunk.lines.filter((l) => l.kind !== "added").map((l) => l.text);
    const remoteLines = hunk.lines.filter((l) => l.kind !== "deleted").map((l) => l.text);
    let replacement = remoteLines;
    if (choices[i] === "both") {
      let prefix = 0;
      while (
        prefix < localLines.length &&
        prefix < remoteLines.length &&
        localLines[prefix] === remoteLines[prefix]
      ) prefix += 1;
      let suffix = 0;
      while (
        suffix < localLines.length - prefix &&
        suffix < remoteLines.length - prefix &&
        localLines[localLines.length - 1 - suffix] === remoteLines[remoteLines.length - 1 - suffix]
      ) suffix += 1;
      replacement = [
        ...localLines.slice(0, prefix),
        ...localLines.slice(prefix, localLines.length - suffix),
        ...remoteLines.slice(prefix, remoteLines.length - suffix),
        ...(suffix ? localLines.slice(localLines.length - suffix) : []),
      ];
    }
    const localCovered = hunk.lines.filter((l) => l.kind !== "added").length;
    // 纯插入时 oldStart 是「插在它之后」，其余情况 oldStart 是首行行号。
    // 用 hunk 里实际的行数（context + deleted）而不是 oldLines —— 语义相同，
    // 但和 remoteLines 来自同一份数据，不会因两处口径不一致而错位
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    lines.splice(start, localCovered, ...replacement);
  }
  return lines.join("\n");
}
