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
