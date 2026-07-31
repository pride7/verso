/**
 * 触发词匹配与展开。DESIGN.md §5.1
 *
 * 这里全是纯函数，不碰 CodeMirror —— 公式输入的手感成败就在这几十行里，
 * 必须能脱离编辑器单独测。
 */
import type { Snippet } from "./types";

export interface Match {
  snippet: Snippet;
  /** 触发词在 `textBefore` 中的起始下标 */
  start: number;
  /** 正则捕获组，`[[n]]` 用它替换 */
  groups: string[];
}

/** 词边界判定用：这些字符算「词内」 */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9\\]/.test(ch);
}

/**
 * 在光标前的文本里找出该触发哪条 snippet。
 *
 * `textBefore` 是光标所在行从行首到光标的文本 —— 不用整篇文档，因为
 * 触发词不会跨行，而每次按键都扫全文是不能接受的（§4.2 的性能红线同理）。
 */
export function findTrigger(
  snippets: Snippet[],
  textBefore: string,
  inMath: boolean,
): Match | null {
  let best: Match | null = null;

  for (const s of snippets) {
    if (s.mathOnly && !inMath) continue;
    if (s.textOnly && inMath) continue;

    let start: number;
    let groups: string[] = [];

    if (s.regex) {
      const m = s.regex.exec(textBefore);
      if (!m) continue;
      start = textBefore.length - m[0].length;
      groups = m.slice(1).map((g) => g ?? "");
    } else {
      if (!textBefore.endsWith(s.trigger)) continue;
      start = textBefore.length - s.trigger.length;
    }

    // 词边界：触发词前面不能紧挨着字母数字。
    // 没有这条，`sr`（→ ^2）会在打 "users" 时突然把词尾吃掉。
    if (s.wordBoundary && start > 0 && isWordChar(textBefore[start - 1])) continue;

    const candidate: Match = { snippet: s, start, groups };
    if (!best || better(candidate, best)) best = candidate;
  }

  return best;
}

/** 优先级高者胜；同优先级时匹配得更长者胜（更具体） */
function better(a: Match, b: Match): boolean {
  if (a.snippet.priority !== b.snippet.priority) {
    return a.snippet.priority > b.snippet.priority;
  }
  return a.start < b.start;
}

export interface Expansion {
  /** 最终插入的文本（已去掉 `$n` 标记） */
  text: string;
  /** 跳转点在 `text` 中的偏移，按 `$0` `$1` `$2` … 的顺序排列 */
  tabstops: number[];
}

/**
 * 把替换文本展开成「最终文本 + 跳转点位置」。
 *
 * `$` 后面**紧跟数字**才是跳转点，其余一律当字面量。这样 `$$0$`
 * 能正确解析成「字面 `$` + 跳转点 0 + 字面 `$`」，也就不需要转义机制 ——
 * 而 LaTeX 里 `\$` 本来就有自己的含义，另造一套转义只会打架。
 */
export function expand(
  replacement: string,
  groups: string[] = [],
  build?: (groups: string[]) => string,
): Expansion {
  const source = build ? build(groups) : replacement;
  // 先填正则捕获组，再找跳转点 —— 反过来的话，捕获到的内容里若含 `$1`
  // 会被误当成跳转点
  const filled = source.replace(/\[\[(\d+)\]\]/g, (_, n) => groups[Number(n)] ?? "");

  const found: { index: number; pos: number }[] = [];
  let text = "";
  let i = 0;

  while (i < filled.length) {
    const ch = filled[i];
    if (ch === "$") {
      const m = /^\$(\d+)/.exec(filled.slice(i));
      if (m) {
        found.push({ index: Number(m[1]), pos: text.length });
        i += m[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }

  found.sort((a, b) => a.index - b.index || a.pos - b.pos);
  return { text, tabstops: found.map((f) => f.pos) };
}

/** tabout 会跳出的闭合符号 */
const CLOSERS = new Set([")", "]", "}", "$", "|", ">"]);

/**
 * tabout —— 从 `pos` 往后找最近的闭合符号，返回它之后的位置。
 *
 * §5.1：「写完 `\frac{a}{b}` 不需要按四次方向键」。这个功能对手感的贡献
 * 被严重低估 —— 没有它，每个括号都要手动绕出去。
 *
 * 只在当前行内找：跨行跳转会让人完全失去位置感。
 */
export function taboutTarget(lineText: string, offsetInLine: number): number | null {
  for (let i = offsetInLine; i < lineText.length; i++) {
    if (CLOSERS.has(lineText[i])) return i + 1;
  }
  return null;
}
