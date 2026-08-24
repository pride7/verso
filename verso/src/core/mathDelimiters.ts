/**
 * 把 LaTeX 文档常见的 `\(...\)` / `\[...\]` 换成 Verso 的 Markdown 数学定界符。
 *
 * 这里只做纯文本变换，不依赖 CodeMirror。编辑器会把代码块与行内代码的范围
 * 作为 `blocked` 传进来，粘贴和命令面板因此共用完全相同的转换规则。
 */

export interface TextRange {
  from: number;
  to: number;
}

export interface TextChange extends TextRange {
  insert: string;
}

export interface MathDelimiterConversion {
  text: string;
  count: number;
  changes: TextChange[];
}

/** 这个反斜杠自己是否又被前面的反斜杠转义。 */
function escaped(text: string, at: number): boolean {
  let n = 0;
  for (let i = at - 1; i >= 0 && text[i] === "\\"; i--) n++;
  return n % 2 === 1;
}

function normalizedRanges(ranges: readonly TextRange[], length: number): TextRange[] {
  const sorted = ranges
    .map(({ from, to }) => ({
      from: Math.max(0, Math.min(from, length)),
      to: Math.max(0, Math.min(to, length)),
    }))
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** 若 `at` 在禁区里，返回禁区末尾；否则返回 -1。 */
function blockedUntil(at: number, ranges: readonly TextRange[]): number {
  for (const range of ranges) {
    if (range.from > at) break;
    if (at >= range.from && at < range.to) return range.to;
  }
  return -1;
}

function findClose(
  text: string,
  from: number,
  close: ")" | "]",
  blocked: readonly TextRange[],
): number {
  for (let at = from; at < text.length - 1; at++) {
    const skip = blockedUntil(at, blocked);
    if (skip >= 0) {
      at = skip - 1;
      continue;
    }
    if (text[at] === "\\" && text[at + 1] === close && !escaped(text, at)) return at;
  }
  return -1;
}

export function latexMathDelimiterChanges(
  text: string,
  blockedRanges: readonly TextRange[] = [],
): TextChange[] {
  const blocked = normalizedRanges(blockedRanges, text.length);
  const changes: TextChange[] = [];

  for (let at = 0; at < text.length - 1; at++) {
    const skip = blockedUntil(at, blocked);
    if (skip >= 0) {
      at = skip - 1;
      continue;
    }
    if (text[at] !== "\\" || escaped(text, at)) continue;

    const open = text[at + 1];
    if (open !== "(" && open !== "[") continue;
    const display = open === "[";
    const close = findClose(text, at + 2, display ? "]" : ")", blocked);
    if (close < 0) continue;

    const marker = display ? "$$" : "$";
    changes.push(
      { from: at, to: at + 2, insert: marker },
      { from: close, to: close + 2, insert: marker },
    );
    // 数学定界符不嵌套；跳到这一对之后，避免把公式内部的字面量误当下一对。
    at = close + 1;
  }
  return changes;
}

export function applyTextChanges(text: string, changes: readonly TextChange[]): string {
  if (!changes.length) return text;
  let out = "";
  let cursor = 0;
  for (const change of changes) {
    out += text.slice(cursor, change.from) + change.insert;
    cursor = change.to;
  }
  return out + text.slice(cursor);
}

export function convertLatexMathDelimiters(
  text: string,
  blockedRanges: readonly TextRange[] = [],
): MathDelimiterConversion {
  const changes = latexMathDelimiterChanges(text, blockedRanges);
  return {
    text: applyTextChanges(text, changes),
    count: changes.length / 2,
    changes,
  };
}

// ------------------------------------------------------- 块公式的排版

/**
 * 行首已经是别的块结构：列表、引用、表格、标题、缩进代码。
 *
 * 这几种行里的 `$$` 不能拆到新行去 —— 拆一次就把列表项、表格行连同它自己
 * 一起断掉，公式没排好，原来的结构反而没了。
 */
const STRUCTURAL_LINE = /^(?:[ \t]*(?:>|#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|\|)|(?: {4,}|\t))/;

/** 这一行还能不能起一条独占几行的块公式。 */
export function lineAcceptsBlockMath(linePrefix: string): boolean {
  return !STRUCTURAL_LINE.test(linePrefix);
}

function leadingSpace(value: string): number {
  return /^\s*/.exec(value)![0].length;
}

function trailingSpace(value: string): number {
  return /\s*$/.exec(value)![0].length;
}

/** 配对完整的 `$$…$$`。定界符不嵌套，按出现顺序两两配对即可。 */
function displayMathSpans(text: string, blocked: readonly TextRange[]): TextRange[] {
  const spans: TextRange[] = [];
  let open = -1;
  for (let at = 0; at < text.length - 1; at++) {
    const skip = blockedUntil(at, blocked);
    if (skip >= 0) {
      at = skip - 1;
      continue;
    }
    if (text[at] !== "$" || text[at + 1] !== "$" || escaped(text, at)) continue;
    if (open < 0) open = at;
    else {
      spans.push({ from: open, to: at + 2 });
      open = -1;
    }
    at++;
  }
  return spans;
}

/**
 * 把 `$$…$$` 排成块公式该有的样子：两个 `$$` 各自独占一行，公式体在中间。
 *
 * 网页和 AI 对话里的块公式常常是「一行里的一段」—— 复制过来就成了
 * `$$ x^2 $$后文`：Verso 照旧把它渲染成居中公式，但源码里它和前后文挤在同
 * 一行，再编辑、再复制都别扭。这里只动定界符两侧的空白，公式体内部的换行
 * 一字不改。
 */
export function blockMathLayoutChanges(
  text: string,
  blockedRanges: readonly TextRange[] = [],
): TextChange[] {
  const blocked = normalizedRanges(blockedRanges, text.length);
  const changes: TextChange[] = [];

  for (const span of displayMathSpans(text, blocked)) {
    const body = text.slice(span.from + 2, span.to - 2);
    // 空的 `$$$$` 没有「公式体」可以摆到中间，拆开只会多两行空行。
    if (!body.trim()) continue;

    const lineStart = text.lastIndexOf("\n", span.from - 1) + 1;
    const prefix = text.slice(lineStart, span.from);
    if (!lineAcceptsBlockMath(prefix)) continue;
    const lineEnd = text.indexOf("\n", span.to);
    const suffix = text.slice(span.to, lineEnd < 0 ? text.length : lineEnd);

    const pair: TextChange[] = [
      {
        from: span.from - (prefix.trim() ? trailingSpace(prefix) : 0),
        to: span.from + 2 + leadingSpace(body),
        insert: prefix.trim() ? "\n$$\n" : "$$\n",
      },
      {
        from: span.to - 2 - trailingSpace(body),
        to: span.to + (suffix.trim() ? leadingSpace(suffix) : 0),
        insert: suffix.trim() ? "\n$$\n" : "\n$$",
      },
    ];
    // 已经排好的公式不产生改动 —— 否则「有没有变」这件事就问不出来了。
    for (const change of pair) {
      if (text.slice(change.from, change.to) !== change.insert) changes.push(change);
    }
  }
  return changes;
}

export function layoutBlockMath(
  text: string,
  blockedRanges: readonly TextRange[] = [],
): string {
  return applyTextChanges(text, blockMathLayoutChanges(text, blockedRanges));
}
