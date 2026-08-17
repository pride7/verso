/**
 * 浏览器剪贴板里的 HTML → Verso 可保存的普通 Markdown。
 *
 * 只保留笔记里有稳定表达的结构；脚本、样式、表单之类一律丢掉。这里不把
 * HTML 原样塞进正文：网页内容属于外部输入，而且纯 Markdown 才是仓库真源。
 */

import { GFM, parser as baseMarkdownParser } from "@lezer/markdown";

import { latexMathDelimiterChanges, type TextRange } from "../core/mathDelimiters";
import { markdownExtended } from "./markdownExtended";

const markdownParser = baseMarkdownParser.configure([GFM, markdownExtended]);

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "canvas", "form"]);
const BLOCK = new Set([
  "address", "article", "aside", "details", "div", "figcaption", "figure", "footer",
  "header", "main", "nav", "p", "section", "summary",
]);

interface Context {
  pre?: boolean;
  formulas?: FormulaProtection;
  /**
   * 这份 HTML 一个 Markdown 标记也产不出来（只有 `<div>` / `<span>` / `<br>`
   * 这类排版包装）。那正文就是用户自己写的 Markdown 源码，一个反斜杠都不加。
   */
  literal?: boolean;
}

/** `render` 真正会翻译成 Markdown 标记的标签。`div` / `span` / `p` / `br` 不算。 */
const MARKUP = new Set([
  "a", "b", "blockquote", "code", "del", "em", "h1", "h2", "h3", "h4", "h5",
  "h6", "hr", "i", "img", "li", "ol", "pre", "s", "strike", "strong", "table", "td",
  "th", "tr", "ul",
]);

/**
 * 再算上 `<br>` 的那一版。
 *
 * `<br>` 不产出任何 Markdown 标记，但它表达的换行未必出现在同一份 `text/plain`
 * 里（网页把一条块公式拆成三行就是这样），所以「这份 HTML 值不值得转换」要认
 * 它，「正文里的字符要不要转义」不认它。
 */
const STRUCTURE = new Set([...MARKUP, "br"]);

/** 这棵树里有没有出现这些标签。脚本、样式和不可见节点本来就会被丢掉，不算。 */
function hasTags(root: Element, tags: Set<string>): boolean {
  for (const child of [...root.childNodes]) {
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();
    if (SKIP.has(tag) || child.getAttribute("aria-hidden") === "true") continue;
    if (tags.has(tag) || hasTags(child, tags)) return true;
  }
  return false;
}

/**
 * 这份 HTML 是不是只是纯文本的一层包装。
 *
 * 代码编辑器和带语法高亮的输入框（VS Code、各种网页编辑器）复制时都会附一份
 * 只有 `<div>` / `<span>` 加颜色样式的 HTML。里面没有任何值得翻译的结构，却
 * 足以让粘贴走 HTML 这条路 —— 于是用户手写的 `**加粗**` 被当成字面量转义成
 * `\*\*加粗\*\*`，正好毁掉他想要的加粗。这种剪贴板里 `text/plain` 才是原文。
 */
export function htmlIsPlainText(html: string): boolean {
  if (!html.trim()) return true;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return !hasTags(doc.body, STRUCTURE);
}

interface FormulaProtection {
  text: WeakMap<Text, TextRange[]>;
  inlineElements: WeakSet<Element>;
}

/**
 * `_` 和 `*` 只有真的被 Markdown 解析成强调标记时才需要转义。`a_b`、`x_{i}`、
 * `2 * 3`、单独一对没有配对的 `**` 里，它们本来就是普通字符；一律补反斜杠不仅
 * 制造无意义的 diff，也会把从网页或 Verso 自己复制的内容改坏。
 *
 * 列表符号一起算进来：行首那个 `*` 不转义的话，下一次解析会把这一行读成无序
 * 列表项，而它原来只是一行普通文字。
 */
function emphasisMarks(value: string): Set<number> {
  const marks = new Set<number>();
  markdownParser.parse(value).iterate({
    enter(node) {
      if (node.name !== "EmphasisMark" && node.name !== "ListMark") return;
      for (let at = node.from; at < node.to; at += 1) {
        if (value[at] === "_" || value[at] === "*") marks.add(at);
      }
    },
  });
  return marks;
}

/** `[` / `]` 前这一道反斜杠是否是活跃的 LaTeX 定界符反斜杠。 */
function hasActiveBackslash(value: string, at: number): boolean {
  let count = 0;
  for (let cursor = at - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

function text(value: string, pre = false, literal = false): string {
  if (pre) return value.replace(/\r\n?/g, "\n");
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
  // \u8f6c\u4e49\u662f\u4e3a\u4e86\u4fdd\u62a4\u300c\u7f51\u9875\u4e0a\u770b\u89c1\u7684\u5b57\u9762\u91cf\u300d\u4e0d\u548c\u6211\u4eec\u81ea\u5df1\u751f\u6210\u7684\u6807\u8bb0\u649e\u8f66\u3002\u8fd9\u4efd
  // HTML \u4e00\u4e2a\u6807\u8bb0\u90fd\u4e0d\u751f\u6210\u65f6\u5c31\u6ca1\u6709\u8981\u649e\u7684\u4e1c\u897f \u2014\u2014 \u90a3\u4e9b `**`\u3001`[` \u662f\u7528\u6237\u4ece
  // \u7f16\u8f91\u5668\u91cc\u590d\u5236\u51fa\u6765\u7684 Markdown \u6e90\u7801\uff0c\u52a0\u53cd\u659c\u6760\u53ea\u4f1a\u628a\u5b83\u5199\u574f\u3002
  if (literal) return normalized;
  const marks = emphasisMarks(normalized);
  let escaped = "";
  for (let at = 0; at < normalized.length; at += 1) {
    const char = normalized[at];
    if (char === "_" || char === "*") {
      escaped += marks.has(at) ? `\\${char}` : char;
    } else if (char === "[" || char === "]") {
      // `\[...\]` 还要交给下一层转成 `$$...$$`。这里若把方括号写成 `\\[` /
      // `\\]`，定界符反斜杠会被转义，公式转换就再也认不出来。
      escaped += hasActiveBackslash(normalized, at) ? char : `\\${char}`;
    } else {
      escaped += char;
    }
  }
  return escaped;
}

/**
 * 先按整棵 HTML 的文本顺序找公式，而不是让每个 `<span>` 各猜各的。网页常把
 * 一条公式拆成许多行内节点；公式范围跨节点时，里面的 Markdown 特殊字符仍然
 * 必须原样保留，网页为了排版加的 `<em>` / `<strong>` 也不能变成公式源码。
 */
function protectFormulas(root: Element): FormulaProtection {
  const nodes: Text[] = [];
  const offsets = new WeakMap<Text, TextRange>();
  let source = "";
  const collect = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const from = source.length;
      source += textNode.nodeValue ?? "";
      nodes.push(textNode);
      offsets.set(textNode, { from, to: source.length });
      return;
    }
    if (node instanceof Element
      && (SKIP.has(node.tagName.toLowerCase()) || node.getAttribute("aria-hidden") === "true")) {
      return;
    }
    for (const child of [...node.childNodes]) collect(child);
  };
  collect(root);

  const changes = latexMathDelimiterChanges(source);
  const formulas: TextRange[] = [];
  for (let at = 0; at + 1 < changes.length; at += 2) {
    formulas.push({ from: changes[at].from, to: changes[at + 1].to });
  }
  markdownParser.parse(source).iterate({
    enter(node) {
      if (node.name === "InlineMath" || node.name === "BlockMath") {
        formulas.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  formulas.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let at = formulas.length - 1; at > 0; at -= 1) {
    const previous = formulas[at - 1];
    const current = formulas[at];
    if (current.from >= previous.to) continue;
    previous.to = Math.max(previous.to, current.to);
    formulas.splice(at, 1);
  }

  const protectedText = new WeakMap<Text, TextRange[]>();
  for (const node of nodes) {
    const offset = offsets.get(node)!;
    const local = formulas.flatMap((formula) => {
      const from = Math.max(offset.from, formula.from);
      const to = Math.min(offset.to, formula.to);
      return to > from ? [{ from: from - offset.from, to: to - offset.from }] : [];
    });
    if (local.length) protectedText.set(node, local);
  }

  const inlineElements = new WeakSet<Element>();
  const inlineMarkup = new Set(["a", "b", "del", "em", "i", "s", "strike", "strong"]);
  const measure = (node: Node): TextRange | null => {
    if (node.nodeType === Node.TEXT_NODE) return offsets.get(node as Text) ?? null;
    let from = Infinity;
    let to = -Infinity;
    for (const child of [...node.childNodes]) {
      const range = measure(child);
      if (!range) continue;
      from = Math.min(from, range.from);
      to = Math.max(to, range.to);
    }
    if (!Number.isFinite(from)) return null;
    if (node instanceof Element && inlineMarkup.has(node.tagName.toLowerCase())
      && formulas.some((formula) => from >= formula.from && to <= formula.to
        && (from > formula.from || to < formula.to))) {
      inlineElements.add(node);
    }
    return { from, to };
  };
  measure(root);
  return { text: protectedText, inlineElements };
}

function textNode(node: Text, ctx: Context): string {
  const value = node.nodeValue ?? "";
  const ranges = ctx.formulas?.text.get(node) ?? [];
  if (!ranges.length) return text(value, !!ctx.pre, !!ctx.literal);
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += text(value.slice(cursor, range.from), !!ctx.pre, !!ctx.literal);
    // 与原来的 HTML 空白语义一致，但公式源码中的 Markdown 特殊字符一律不碰。
    result += value.slice(range.from, range.to)
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ");
    cursor = range.to;
  }
  return result + text(value.slice(cursor), !!ctx.pre, !!ctx.literal);
}

function children(el: Element, ctx: Context = {}): string {
  return [...el.childNodes].map((node) => render(node, ctx)).join("");
}

function fenced(value: string): string {
  const body = value.replace(/^\n+|\n+$/g, "");
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${body}\n${fence}\n\n`;
}

function inlineCode(value: string): string {
  const body = value.replace(/\s+/g, " ").trim();
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const tick = "`".repeat(longest + 1);
  const pad = body.startsWith("`") || body.endsWith("`") ? " " : "";
  return `${tick}${pad}${body}${pad}${tick}`;
}

function safeHref(raw: string | null): string | null {
  const href = raw?.trim() ?? "";
  if (!href || /^(?:javascript|data|file):/i.test(href)) return null;
  return /^(?:https?:|mailto:)/i.test(href) ? href : null;
}

function renderList(el: Element, ordered: boolean, depth = 0, ctx: Context = {}): string {
  let n = Number(el.getAttribute("start") ?? 1);
  const lines: string[] = [];
  for (const child of [...el.children]) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const nested = [...child.children].filter((item) => {
      const tag = item.tagName.toLowerCase();
      return tag === "ul" || tag === "ol";
    });
    const body = [...child.childNodes]
      .filter((node) => !(node instanceof Element && ["ul", "ol"].includes(node.tagName.toLowerCase())))
      .map((node) => render(node, ctx))
      .join("")
      .replace(/\s*\n+\s*/g, " ")
      .trim();
    const prefix = ordered ? `${n}. ` : "- ";
    lines.push(`${"  ".repeat(depth)}${prefix}${body}`.trimEnd());
    for (const list of nested) {
      lines.push(renderList(list, list.tagName.toLowerCase() === "ol", depth + 1, ctx).trimEnd());
    }
    n += 1;
  }
  return `${lines.join("\n")}\n\n`;
}

function table(el: Element, ctx: Context): string {
  const rows = [...el.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) =>
      children(cell, ctx).replace(/\s*\n+\s*/g, " ").trim().replace(/\|/g, "\\|"),
    ),
  ).filter((row) => row.length > 0);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const fill = (row: string[]) => [...row, ...Array(Math.max(0, width - row.length)).fill("")];
  const header = fill(rows[0]);
  const rest = rows.slice(1).map(fill);
  return [header, header.map(() => "---"), ...rest]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n") + "\n\n";
}

function render(node: Node, ctx: Context): string {
  if (node.nodeType === Node.TEXT_NODE) return textNode(node as Text, ctx);
  if (!(node instanceof Element)) return "";
  const tag = node.tagName.toLowerCase();
  if (SKIP.has(tag) || node.getAttribute("aria-hidden") === "true") return "";
  if (tag === "br") return "\n";
  if (ctx.formulas?.inlineElements.has(node)) return children(node, ctx);
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children(node, ctx).trim()}\n\n`;
  if (tag === "strong" || tag === "b") return `**${children(node, ctx).trim()}**`;
  if (tag === "em" || tag === "i") return `*${children(node, ctx).trim()}*`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${children(node, ctx).trim()}~~`;
  if (tag === "pre") return fenced(node.textContent ?? "");
  if (tag === "code") return ctx.pre ? text(node.textContent ?? "", true) : inlineCode(node.textContent ?? "");
  if (tag === "blockquote") {
    const body = children(node, ctx).trim().split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
    return `${body}\n\n`;
  }
  if (tag === "ul" || tag === "ol") return renderList(node, tag === "ol", 0, ctx);
  if (tag === "table") return table(node, ctx);
  if (tag === "hr") return "---\n\n";
  if (tag === "a") {
    const label = children(node, ctx).trim();
    const href = safeHref(node.getAttribute("href"));
    return href && label ? `[${label}](${href.replace(/\)/g, "%29")})` : label;
  }
  if (tag === "img") {
    const src = safeHref(node.getAttribute("src"));
    if (!src || src.startsWith("mailto:")) return text(node.getAttribute("alt") ?? "");
    return `![${text(node.getAttribute("alt") ?? "")}](${src.replace(/\)/g, "%29")})`;
  }
  const body = children(node, ctx);
  return BLOCK.has(tag) ? `${body.trim()}\n\n` : body;
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return children(doc.body, {
    formulas: protectFormulas(doc.body),
    literal: !hasTags(doc.body, MARKUP),
  })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
