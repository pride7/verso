/**
 * Markdown → HTML。导出与打印用（PDF 由系统打印对话框产出）。
 *
 * ## 为什么不能直接打印编辑器
 *
 * CodeMirror 6 只渲染视口 —— 屏幕外的段落根本不在 DOM 里。直接 `window.print()`
 * 打出来的是被截断的一段。更麻烦的是**短笔记全在 DOM 里、打印正常**，只有长
 * 笔记才出问题，而那正是最需要导出的那些。所以导出必须自己把整篇渲染一遍。
 *
 * ## 为什么在 `editor/` 而不是 `core/`
 *
 * 它要用 `markdownExtended` —— 方言定义（§2.4）就在这一层。渲染器必须和编辑器
 * 认同一套语法，抄一份到 `core/` 才是真正的分层问题：两份定义一定会漂，症状是
 * 「屏幕上和纸上不一样」。这个文件自己**不 import 任何 `@codemirror/*`**，纯
 * 字符串进、字符串出，所以能在 Node 里测。
 *
 * ## 安全：一律转义，不透传原文 HTML
 *
 * `inline.ts` 那条「只构造 DOM 节点、绝不拼字符串」的规矩在这里换个形式落地：
 * 这里产出的就是字符串，所以**每一段文本都必须过 `esc()`**。笔记可能来自分享、
 * 协作者或 AI（§7.5），透传 `<script>` 等于「打开一篇笔记 = 执行一段陌生程序」——
 * 而导出的 HTML 会在应用自己的 webview 里打开，那里够得着 IPC。
 *
 * 例外只有三处，每处都受控：
 *   - KaTeX 的输出。`trust: false` 已经禁掉 `\href` `\htmlClass` 这类注入命令
 *   - `ALLOWED_TAGS` 里那几个**不带任何属性**的排版标签（`<br>` `<sub>` …）。
 *     没有属性就没有 `onerror`、没有 `href`，攻击面为零；带属性的一律当文本
 *   - `Entity`（`&nbsp;` `&#39;`）。实体在文本上下文里只解出一个字符，
 *     解不出标签
 *
 * 链接的 href 另外过 `safeHref()` —— `[点我](javascript:…)` 是同一类问题。
 *
 * ## 不做的事（有意，不是忘了）
 *
 * - **代码块不高亮。** 高亮要把 `@codemirror/language` 和按需 import 的语法包
 *   拽进来，而印在纸上的代码没有颜色本来也读得下去。等真需要再说
 * - **`verso-view` 视图不查询。** 它的内容是对整库的查询结果，不是这篇笔记
 *   自己的内容，这个纯函数拿不到索引 —— 由调用方通过 `renderView` 注入
 */
import type { SyntaxNode } from "@lezer/common";
import { GFM, parser as baseParser } from "@lezer/markdown";
import katex from "katex";

import type { ViewResult } from "../core/types";

import { calloutKind } from "./callout";
import { looksLikeImage, parseWidth } from "./image";
import { markdownExtended } from "./markdownExtended";

/** 和 `editor/index.ts` 里给 CM6 的是同一份配置 —— 两处漂了就是屏幕和纸不一致 */
const parser = baseParser.configure([GFM, markdownExtended]);

export interface ExportOptions {
  /**
   * `![[图.png]]` / `![](图.png)` 的目标 → 能塞进 `<img src>` 的 URL。
   *
   * 返回 null = 找不到，渲染成一行写着文件名的提示。和编辑器里 `ImageWidget`
   * 的失败态同一个道理：得让人知道是**哪个**文件没找到，不能给个碎图标。
   */
  resolveImage?: (target: string) => string | null;
  /**
   * `[[笔记]]` → href。返回 null 表示这篇不在导出范围里。
   *
   * 那时渲染成不可点的文本，而不是留一个死链 —— 在 PDF 里点一个跳不到任何
   * 地方的链接，比一开始就看得出它不可点更糟。
   */
  resolveLink?: (target: string) => string | null;
  /** ` ```verso-view ` 代码块。不给就渲染成一句占位说明 */
  renderView?: (source: string) => string;
  /**
   * 标题降级。把子文档接在父文档后面一起导出时用：子文档的 `## ` 变 `### `，
   * 免得两篇的一级标题在同一份 PDF 里平起平坐。
   */
  headingOffset?: number;
}

interface Ctx {
  src: string;
  opts: ExportOptions;
  /** 标题 id 去重。同名标题在一篇笔记里很常见（「小结」） */
  usedIds: Set<string>;
}

/**
 * 把一段 Markdown 正文渲染成 HTML 片段（不含 `<html>` 外壳与样式）。
 *
 * 传进来的应当是 `NoteContent.body` —— frontmatter 已经被剥掉的那部分。
 */
export function renderMarkdown(src: string, opts: ExportOptions = {}): string {
  const ctx: Ctx = { src, opts, usedIds: new Set() };
  return blocks(ctx, parser.parse(src).topNode);
}

/**
 * 正文里所有 ` ```verso-view ` 块的 YAML 源码，按出现顺序。
 *
 * 给调用方用来「先把查询跑完，再渲染」—— `renderMarkdown` 是同步的，而查询
 * 要过 IPC。走语法树而不是正则：`verso-view` 三个字可能出现在别的代码块里，
 * 或者出现在正文中被反引号括起来的一段说明里。
 */
export function viewSources(src: string): string[] {
  const out: string[] = [];
  parser.parse(src).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const info = node.node.getChild("CodeInfo");
      if (!info || src.slice(info.from, info.to).trim() !== "verso-view") return;
      const body = node.node.getChild("CodeText");
      out.push(body ? src.slice(body.from, body.to) : "");
    },
  });
  return out;
}

// ---------------------------------------------------------------- 转义

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** 源码里 `[from, to)` 那一段，转义后的样子 */
function text(ctx: Ctx, from: number, to: number): string {
  return to > from ? esc(ctx.src.slice(from, to)) : "";
}

/**
 * 只放行这几个协议。
 *
 * `javascript:` 和 `data:` 都能在打开的那一刻执行东西，而导出的 HTML 是在
 * 应用自己的 webview 里打开的。相对路径（`./图.png`、`#锚点`）不带冒号，
 * 走 else 分支照常放行。
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (!scheme) return href;
  return /^(https?|mailto|tel)$/i.test(scheme[1]) ? href : null;
}

/**
 * 允许原样输出的 HTML 标签 —— **必须不带任何属性**。
 *
 * 挑选标准是「Obsidian 用户真的会在 Markdown 里手写的排版标签」。带属性的
 * 一律当文本：属性才是注入面（`onerror`、`href`、`style` 里的 `url()`），
 * 而这几个标签不带属性时能做的事只有排版。
 */
const ALLOWED_TAGS = new Set([
  "br", "u", "sub", "sup", "kbd", "mark", "small",
  "b", "i", "s", "em", "strong", "del", "ins", "code",
]);

function sanitizeTag(raw: string): string {
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\s*\/?>$/.exec(raw.trim());
  if (!m || !ALLOWED_TAGS.has(m[2].toLowerCase())) return esc(raw);
  // 重新拼而不是原样返回：`</U>` 这种大小写不统一的写法会污染输出
  return `<${m[1]}${m[2].toLowerCase()}>`;
}

// -------------------------------------------------------------- 树的取用

function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name === name) out.push(ch);
  }
  return out;
}

/**
 * 块级标记与已经被上层单独取走的节点，走到就跳过。
 *
 * `CodeInfo` 在这里 —— 围栏上的语言名由 `FencedCode` 自己读，不该再作为
 * 正文出现一次。
 */
const SKIP = new Set([
  "HeaderMark", "QuoteMark", "ListMark", "CodeMark", "CodeInfo",
  "EmphasisMark", "StrikethroughMark", "LinkMark", "MathMarker",
  "HighlightMarker", "TaskMarker", "TableDelimiter", "Comment", "CommentBlock",
  // 链接引用定义（`[foo]: https://…`）本身不出现在正文里
  "LinkReference",
]);

// ---------------------------------------------------------------- 块级

function blocks(ctx: Ctx, parent: SyntaxNode): string {
  let out = "";
  for (let ch = parent.firstChild; ch; ch = ch.nextSibling) out += block(ctx, ch);
  return out;
}

const HEADING = /^(?:ATX|Setext)Heading([1-6])$/;

function block(ctx: Ctx, node: SyntaxNode): string {
  if (SKIP.has(node.name)) return "";

  const heading = HEADING.exec(node.name);
  if (heading) return renderHeading(ctx, node, Number(heading[1]));

  switch (node.name) {
    case "Paragraph": {
      const body = inline(ctx, node);
      return body.trim() ? `<p>${body}</p>` : "";
    }
    case "Blockquote":
      return renderBlockquote(ctx, node);
    case "BulletList":
      return `<ul>${blocks(ctx, node)}</ul>`;
    case "OrderedList": {
      const start = orderedStart(ctx, node);
      return `<ol${start === 1 ? "" : ` start="${start}"`}>${blocks(ctx, node)}</ol>`;
    }
    case "ListItem":
      return renderListItem(ctx, node);
    case "FencedCode":
    case "CodeBlock":
      return renderCode(ctx, node);
    case "HorizontalRule":
      return "<hr />";
    case "Table":
      return renderTable(ctx, node);
    case "BlockMath":
      return renderMath(ctx, node, true);
    case "HTMLBlock":
      return sanitizeTag(ctx.src.slice(node.from, node.to));
    default:
      // 认不出的块**不能吞掉内容**。有子节点就往下走，是叶子就当一段文本 ——
      // 上游加一种新节点时，最坏结果是排版朴素，而不是那一段凭空消失
      return node.firstChild ? blocks(ctx, node) : wrapUnknown(text(ctx, node.from, node.to));
  }
}

function wrapUnknown(body: string): string {
  return body.trim() ? `<p>${body}</p>` : "";
}

// ---------------------------------------------------------------- 标题

function renderHeading(ctx: Ctx, node: SyntaxNode, level: number): string {
  const lv = Math.min(6, Math.max(1, level + (ctx.opts.headingOffset ?? 0)));
  const body = inline(ctx, node);
  const id = headingId(ctx, ctx.src.slice(node.from, node.to));
  return `<h${lv} id="${esc(id)}">${body}</h${lv}>`;
}

/**
 * 标题的锚点 id。
 *
 * 从**源码**算而不是从渲染结果算 —— 渲染结果里有 KaTeX 吐的一大坨 span，
 * 而 `[[笔记#标题]]` 里写的本来就是源码里那几个字。中文原样保留：现代浏览器
 * 的片段标识符接受非 ASCII，转成拼音或哈希只会让链接不可读。
 */
function headingId(ctx: Ctx, raw: string): string {
  const base =
    raw
      // Setext 标题的源码带着下一行的 `===`，只要第一行
      .split("\n")[0]
      .replace(/^\s*#{1,6}\s*/, "")
      .replace(/\s*#+\s*$/, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/["'<>&#%?/\\]/g, "") || "节";

  let id = base;
  for (let n = 2; ctx.usedIds.has(id); n++) id = `${base}-${n}`;
  ctx.usedIds.add(id);
  return id;
}

// ------------------------------------------------------------ 引用 / callout

function renderBlockquote(ctx: Ctx, node: SyntaxNode): string {
  const para = firstBlockChild(node);
  const marker = para && para.name === "Paragraph" ? firstInlineChild(para) : null;

  if (!para || !marker || marker.name !== "CalloutMarker") {
    return `<blockquote>${blocks(ctx, node)}</blockquote>`;
  }

  const kind = calloutKind(ctx.src.slice(marker.from, marker.to));

  // `> [!note] 标题` 的标题只到行末，同一段里换行之后的内容是正文 ——
  // Markdown 的惰性续行会把它们并进同一个 Paragraph，所以这里按第一个
  // 换行切开，而不是把整段当标题
  const nl = ctx.src.indexOf("\n", marker.to);
  const lineEnd = nl < 0 || nl > para.to ? para.to : nl;

  const title = inlineRange(ctx, para, marker.to, lineEnd).trim();
  const lead = inlineRange(ctx, para, lineEnd, para.to).trim();

  let body = lead ? `<p>${lead}</p>` : "";
  for (let ch = para.nextSibling; ch; ch = ch.nextSibling) body += block(ctx, ch);

  return (
    `<div class="callout callout-${kind.tone}">` +
    `<p class="callout-title">${title || esc(kind.label)}</p>` +
    body +
    `</div>`
  );
}

/** 跳过 QuoteMark 之类的标记，取第一个真正的块 */
function firstBlockChild(node: SyntaxNode): SyntaxNode | null {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (!SKIP.has(ch.name)) return ch;
  }
  return null;
}

function firstInlineChild(node: SyntaxNode): SyntaxNode | null {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (ch.name !== "QuoteMark") return ch;
  }
  return null;
}

// ---------------------------------------------------------------- 列表

/** `3. 甲` 开头的有序列表要从 3 开始数，不是从 1 */
function orderedStart(ctx: Ctx, list: SyntaxNode): number {
  const item = childrenNamed(list, "ListItem")[0];
  const mark = item ? item.getChild("ListMark") : null;
  if (!mark) return 1;
  const n = parseInt(ctx.src.slice(mark.from, mark.to), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function renderListItem(ctx: Ctx, node: SyntaxNode): string {
  const task = childrenNamed(node, "Task")[0];
  if (!task) return `<li>${blocks(ctx, node)}</li>`;

  // `- [x] 甲`：TaskList 扩展把那一段正文换成了 Task 节点，勾选状态写在
  // TaskMarker 里。用真的 checkbox 而不是 ☐/☑ 字形 —— 字形要赌字体里有，
  // 而 disabled 的 checkbox 到哪儿都长一样，也不需要额外样式才看得见
  const marker = task.getChild("TaskMarker");
  const done = marker ? /\[[xX]\]/.test(ctx.src.slice(marker.from, marker.to)) : false;

  let rest = "";
  for (let ch = task.nextSibling; ch; ch = ch.nextSibling) rest += block(ctx, ch);

  return (
    `<li class="task${done ? " is-done" : ""}">` +
    `<input class="task-check" type="checkbox" disabled${done ? " checked" : ""} />` +
    inline(ctx, task) +
    rest +
    `</li>`
  );
}

// ---------------------------------------------------------------- 代码

function renderCode(ctx: Ctx, node: SyntaxNode): string {
  const info = node.getChild("CodeInfo");
  const lang = info ? ctx.src.slice(info.from, info.to).trim() : "";
  const body = node.getChild("CodeText");
  // 缩进式代码块万一没有 CodeText 子节点，也不能把整块吞掉 —— 退回切源码，
  // 顺手把四格缩进去掉。围栏式的没有 CodeText 就是真的空块
  const code = body
    ? ctx.src.slice(body.from, body.to)
    : node.name === "CodeBlock"
      ? ctx.src.slice(node.from, node.to).replace(/^ {4}/gm, "")
      : "";

  if (lang === "verso-view") {
    return (
      ctx.opts.renderView?.(code) ??
      `<div class="dbview-placeholder"><p>database 视图（未打印查询结果）</p></div>`
    );
  }

  const cls = lang ? ` class="language-${esc(lang.split(/\s+/)[0])}"` : "";
  return `<pre><code${cls}>${esc(code)}</code></pre>`;
}

// ---------------------------------------------------------------- 表格

const ALIGN = ["", " style=\"text-align:center\"", " style=\"text-align:right\""];

/**
 * 对齐从**分隔行的源码**里读，不从语法树里读。
 *
 * `TableDelimiter` 在表头行、正文行和分隔行里都会出现，靠节点名分不出哪个是
 * 分隔行；而分隔行永远是表格的第二行，直接切源码更短也更稳。
 */
function tableAlign(ctx: Ctx, table: SyntaxNode): number[] {
  const line = ctx.src.slice(table.from, table.to).split("\n")[1] ?? "";
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => {
      const t = cell.trim();
      if (t.startsWith(":") && t.endsWith(":")) return 1;
      if (t.endsWith(":")) return 2;
      return 0;
    });
}

function renderTable(ctx: Ctx, node: SyntaxNode): string {
  const align = tableAlign(ctx, node);
  let head = "";
  let body = "";

  for (let row = node.firstChild; row; row = row.nextSibling) {
    if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
    const isHead = row.name === "TableHeader";
    const tag = isHead ? "th" : "td";
    let cells = "";
    childrenNamed(row, "TableCell").forEach((cell, i) => {
      cells += `<${tag}${align[i] ? ALIGN[align[i]] : ""}>${inline(ctx, cell)}</${tag}>`;
    });
    if (isHead) head += `<tr>${cells}</tr>`;
    else body += `<tr>${cells}</tr>`;
  }

  return (
    `<table>${head ? `<thead>${head}</thead>` : ""}${body ? `<tbody>${body}</tbody>` : ""}</table>`
  );
}

// ---------------------------------------------------------------- 公式

/**
 * 公式源码。两种 BlockMath 的形状不一样：
 *   - 行内解析器产出的（`$$x$$` 写在一行里）带 MathContent 子节点
 *   - 块解析器产出的（独占若干行）没有子节点，得自己剥定界符
 */
function mathSource(ctx: Ctx, node: SyntaxNode): string {
  const content = node.getChild("MathContent");
  if (content) return ctx.src.slice(content.from, content.to);
  return ctx.src
    .slice(node.from, node.to)
    .replace(/^\$\$/, "")
    .replace(/\$\$\s*$/, "");
}

function renderMath(ctx: Ctx, node: SyntaxNode, display: boolean): string {
  const src = mathSource(ctx, node);
  try {
    // trust: false —— 禁掉 \href \htmlClass 这类能注入的命令（§7.5），
    // 和 inline.ts 里那条是同一道边界
    const html = katex.renderToString(src, { throwOnError: false, trust: false, displayMode: display });
    return display ? `<div class="math-block">${html}</div>` : html;
  } catch {
    // 写坏的公式退回源码，不要让它把整篇导出弄空。§5.3：错误要看得见，
    // 而不是让那一块消失
    const fallback = `<span class="math-error">${esc(display ? `$$${src}$$` : `$${src}$`)}</span>`;
    return display ? `<div class="math-block">${fallback}</div>` : fallback;
  }
}

// ---------------------------------------------------------------- 行内

function inline(ctx: Ctx, parent: SyntaxNode): string {
  return inlineRange(ctx, parent, parent.from, parent.to);
}

/**
 * 渲染 `parent` 在 `[from, to)` 这一段里的行内内容。
 *
 * 子节点之间的空当是纯文本，转义后原样输出 —— 引用块续行的 `>` 和列表续行的
 * 缩进都已经被 QuoteMark / ListMark 吃掉了，剩下的多余空白由 HTML 自己折叠。
 *
 * 跨出范围的子节点按「起点在范围内就要」处理：行内节点极少跨行，而 callout
 * 标题那种按换行切开的用法只需要这个精度。
 */
function inlineRange(ctx: Ctx, parent: SyntaxNode, from: number, to: number): string {
  let out = "";
  let pos = from;

  for (let ch = parent.firstChild; ch; ch = ch.nextSibling) {
    if (ch.from >= to) break;
    if (ch.from < from) continue;
    if (ch.from > pos) out += text(ctx, pos, ch.from);
    out += inlineNode(ctx, ch);
    pos = Math.max(pos, ch.to);
  }
  if (pos < to) out += text(ctx, pos, to);
  return out;
}

function inlineNode(ctx: Ctx, node: SyntaxNode): string {
  if (SKIP.has(node.name)) return "";

  switch (node.name) {
    case "Emphasis":
      return `<em>${inline(ctx, node)}</em>`;
    case "StrongEmphasis":
      return `<strong>${inline(ctx, node)}</strong>`;
    case "Strikethrough":
      return `<del>${inline(ctx, node)}</del>`;
    case "Highlight":
      return `<mark>${inline(ctx, node)}</mark>`;
    case "InlineCode": {
      const marks = childrenNamed(node, "CodeMark");
      const from = marks[0] ? marks[0].to : node.from;
      const to = marks[1] ? marks[1].from : node.to;
      return `<code>${text(ctx, from, to)}</code>`;
    }
    case "InlineMath":
      return renderMath(ctx, node, false);
    case "BlockMath":
      return renderMath(ctx, node, true);
    case "Hashtag":
      return `<span class="tag">${text(ctx, node.from, node.to)}</span>`;
    case "WikiLink":
      return renderWikiLink(ctx, node);
    case "Embed":
      return renderEmbed(ctx, node);
    case "Link":
      return renderLink(ctx, node);
    case "Image":
      return renderImage(ctx, node);
    case "URL": {
      const raw = ctx.src.slice(node.from, node.to).replace(/^<|>$/g, "");
      const href = safeHref(raw);
      return href ? `<a href="${esc(href)}">${esc(raw)}</a>` : esc(raw);
    }
    case "HardBreak":
      return "<br />";
    case "Escape":
      // `\*` 的源码是两个字符，要的是后面那个
      return esc(ctx.src.slice(node.from + 1, node.to));
    case "Entity":
      // 实体在文本上下文里只解出一个字符，解不出标签 —— 再转义一次会变成
      // 字面的 `&amp;nbsp;`
      return ctx.src.slice(node.from, node.to);
    case "HTMLTag":
      return sanitizeTag(ctx.src.slice(node.from, node.to));
    default:
      return node.firstChild ? inline(ctx, node) : text(ctx, node.from, node.to);
  }
}

// ------------------------------------------------------- 内部链接与图片

interface WikiParts {
  target: string;
  alias: string | null;
}

function wikiParts(ctx: Ctx, node: SyntaxNode): WikiParts {
  const target = node.getChild("WikiLinkTarget");
  const alias = node.getChild("WikiLinkAlias");
  return {
    target: target ? ctx.src.slice(target.from, target.to).trim() : "",
    alias: alias ? ctx.src.slice(alias.from, alias.to).trim() : null,
  };
}

function renderWikiLink(ctx: Ctx, node: SyntaxNode): string {
  const { target, alias } = wikiParts(ctx, node);
  const label = esc(alias || target);
  if (!target) return label;

  const href = ctx.opts.resolveLink?.(target) ?? null;
  const safe = href ? safeHref(href) : null;
  // 解析不出来 = 不在导出范围里。渲染成有样式但不可点的文本
  return safe ? `<a class="wikilink" href="${esc(safe)}">${label}</a>` : `<span class="wikilink">${label}</span>`;
}

function renderEmbed(ctx: Ctx, node: SyntaxNode): string {
  const { target, alias } = wikiParts(ctx, node);
  if (!target) return "";

  if (!looksLikeImage(target)) {
    // `![[另一篇笔记]]` 的内容要读库才拿得到，这里拿不到。降级成一条链接，
    // 至少读的人知道这里引了什么，而不是一片空白
    return renderWikiLink(ctx, node);
  }

  const src = ctx.opts.resolveImage?.(target) ?? null;
  if (!src) return `<span class="img-missing">${esc(`找不到图片：${target}`)}</span>`;

  const width = parseWidth(alias);
  return `<img src="${esc(src)}" alt="${esc(target)}"${width ? ` width="${width}"` : ""} />`;
}

/** `[文字](地址)` 的三段：标签范围、地址、标题 */
function linkParts(ctx: Ctx, node: SyntaxNode) {
  const marks = childrenNamed(node, "LinkMark");
  const url = node.getChild("URL");
  return {
    labelFrom: marks[0] ? marks[0].to : node.from,
    labelTo: marks[1] ? marks[1].from : node.to,
    url: url ? ctx.src.slice(url.from, url.to).replace(/^<|>$/g, "") : null,
  };
}

function renderLink(ctx: Ctx, node: SyntaxNode): string {
  const { labelFrom, labelTo, url } = linkParts(ctx, node);
  const label = inlineRange(ctx, node, labelFrom, labelTo);
  const href = url ? safeHref(url) : null;
  // 引用式链接（`[文字][编号]`）解析器不解引用，地址取不到 —— 显示文字即可
  return href ? `<a href="${esc(href)}">${label}</a>` : label;
}

// ------------------------------------------------- database 视图（§2.6）

/** 分组视图里没填那个属性的一组。和 `DatabaseView` 里的写法保持一致 */
const UNSET = "未设置";

/**
 * 把一次视图查询的结果印成静态表格。
 *
 * 调用方（App）先查好再传进来 —— `renderMarkdown` 是同步的纯函数，够不着索引。
 *
 * **看板一律印成分组表格。** 纸上没有拖拽，而横向看板栏在 A4 上摆不下三列
 * 以上；分组的信息（哪些属于"进行中"）用小标题表达没有任何损失。
 *
 * 第一列永远是笔记名：视图的行就是笔记，把标题降级成普通一列会让人找不到
 * 这一行说的是哪一篇。
 */
export function renderViewTable(result: ViewResult): string {
  if (!result.rows.length) return `<p class="dbview-caption">（这个视图当前没有内容）</p>`;

  const cols = result.columns;
  const head =
    `<thead><tr><th>名称</th>` +
    cols.map((c) => `<th>${esc(c)}</th>`).join("") +
    `</tr></thead>`;

  const bodyFor = (rows: ViewResult["rows"]) =>
    `<tbody>` +
    rows
      .map(
        (r) =>
          `<tr><td>${esc(r.title)}</td>` +
          cols.map((c) => `<td>${esc(r.props[c] ?? "")}</td>`).join("") +
          `</tr>`,
      )
      .join("") +
    `</tbody>`;

  if (!result.groupBy) return `<table>${head}${bodyFor(result.rows)}</table>`;

  const by = result.groupBy;
  const groups = new Map<string, ViewResult["rows"]>();
  for (const row of result.rows) {
    const key = row.props[by] || UNSET;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups]
    .map(
      ([name, rows]) =>
        `<p class="dbview-group">${esc(name)}（${rows.length}）</p>` +
        `<table>${head}${bodyFor(rows)}</table>`,
    )
    .join("");
}

function renderImage(ctx: Ctx, node: SyntaxNode): string {
  const { labelFrom, labelTo, url } = linkParts(ctx, node);
  const alt = ctx.src.slice(labelFrom, labelTo);
  if (!url) return esc(alt);

  // 库内的相对路径要过 resolveImage 才变成 webview 能加载的地址；
  // 外链（https://…）它认不出来，退回原地址
  const resolved = ctx.opts.resolveImage?.(url) ?? null;
  const src = resolved ?? safeHref(url);
  if (!src) return `<span class="img-missing">${esc(`找不到图片：${url}`)}</span>`;

  return `<img src="${esc(src)}" alt="${esc(alt)}" />`;
}
