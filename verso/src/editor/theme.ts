/**
 * 编辑器主题。DESIGN.md §6.1 的排版尺度在这里落地。
 * 颜色全部走 styles.css 里的 CSS 变量，深浅主题自动跟随。
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

import { versoTags } from "./markdownExtended";

export const versoTheme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "transparent",
    height: "100%",
    // §6.1 中文比英文需要更大字号；1.5 的行高对中文过于拥挤。
    // 具体数值走 CSS 变量，设置里能调 —— CM6 的主题是编译期生成的类名，
    // 改设置要重建整个编辑器才能生效，走变量就只是一次样式重算
    fontSize: "var(--body-font-size)",
    fontFamily: "var(--font-body)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "var(--body-line-height)",
    // 底部留白：写到最后一行时不用贴着窗口底
    paddingBottom: "40vh",
  },
  ".cm-content": { padding: "0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--accent) 22%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },

  // ---- 公式 ----
  ".cm-math-inline": { cursor: "pointer" },
  ".cm-math-block": {
    display: "block",
    textAlign: "center",
    margin: "0.6em 0",
    cursor: "pointer",
  },
  ".cm-math-error": {
    color: "var(--danger)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
  },
  ".cm-math-error-msg": {
    display: "block",
    fontSize: "0.78em",
    opacity: 0.85,
    marginTop: "2px",
  },

  // ---- 内部链接 ----
  ".cm-wikilink": { color: "var(--accent)", cursor: "pointer" },
  ".cm-wikilink:hover": { textDecoration: "underline" },
  ".cm-embed": { color: "var(--accent)", opacity: 0.85 },
  ".cm-embed-placeholder": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.85em",
    opacity: 0.7,
  },

  // ---- 标签 ----
  ".cm-hashtag": {
    color: "var(--accent)",
    backgroundColor: "color-mix(in oklch, var(--accent) 12%, transparent)",
    borderRadius: "var(--r-xs)",
    padding: "1px 5px",
    fontSize: "0.9em",
  },

  ".cm-highlight": {
    backgroundColor: "color-mix(in oklch, var(--warn) 40%, transparent)",
    borderRadius: "var(--r-xs)",
    padding: "0 2px",
  },

  // ---- GFM 表格 ----
  ".cm-table": {
    margin: "0.9em 0",
    overflowX: "auto",
    borderRadius: "var(--r-lg)",
    border: "1px solid var(--hairline)",
  },
  ".cm-table table": {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: "0.92em",
  },
  ".cm-table th, .cm-table td": {
    padding: "7px 12px",
    // 只画横线不画竖线 —— 竖线会把表格变成网格纸，横向扫读反而更难
    borderBottom: "1px solid var(--hairline)",
    verticalAlign: "top",
  },
  ".cm-table thead th": {
    fontWeight: "600",
    background: "color-mix(in oklch, var(--muted) 8%, transparent)",
    whiteSpace: "nowrap",
  },
  ".cm-table tbody tr:last-child td": { borderBottom: "none" },
  // 单元格里的行内代码。和正文里那套药丸保持一致
  ".cm-inline-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "color-mix(in oklch, var(--muted) 14%, transparent)",
    borderRadius: "var(--r-xs)",
    padding: "1px 5px",
  },

  // ---- 围栏代码块 ----
  ".cm-code": {
    padding: "0 14px",
    background: "color-mix(in oklch, var(--muted) 9%, transparent)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
  },
  ".cm-code.is-open": {
    paddingTop: "0.55em",
    borderTopLeftRadius: "var(--r-lg)",
    borderTopRightRadius: "var(--r-lg)",
    marginTop: "0.8em",
  },
  ".cm-code.is-close": {
    paddingBottom: "0.55em",
    borderBottomLeftRadius: "var(--r-lg)",
    borderBottomRightRadius: "var(--r-lg)",
    marginBottom: "0.8em",
  },
  // 围栏行淡化但不隐藏 —— 藏了就改不了语言标注，
  // 而且光标停进去时会看到行数对不上
  ".cm-code.is-fence": { color: "color-mix(in oklch, var(--muted) 60%, transparent)" },

  // 代码块里的文本已经由 .cm-code 统一了字体和底色，
  // 行内代码那套「小圆角药丸」不该再叠一层 —— 叠上去每一行都会
  // 变成一个独立的灰块，看着像被切碎了
  ".cm-code span": {
    background: "none",
    padding: "0",
    fontSize: "1em",
  },

  // ---- 引用块与 callout ----
  //
  // 用**行装饰**画：每一行铺一层底色 + 左侧色条，连起来就是一个块。
  // 不能用真正的块级容器 —— CM6 里那要求 replace 掉整段，而那样光标
  // 就进不去了，编辑体验会毁掉。

  // 引用和 callout 各写一份完整规则。共用一条逗号选择器也能工作
  // （量过：两边的 border/padding 计算值一致），但分开写之后各自的
  // 意图更清楚 —— callout 有底色、引用只有竖线。
  ".cm-callout": {
    // **不要用负外边距外扩。** 负边距会让行盒比 .cm-content 宽，
    // 编辑器出现横向滚动条，而左侧色条恰好画在被推出可视区的那一段上，
    // 表现就是"竖线怎么调都看不见"。块与正文栏左右对齐就够了。
    padding: "0.15em 14px 0.15em 16px",
    borderLeft: "3px solid var(--callout, var(--accent))",
    background: "color-mix(in oklch, var(--callout, var(--muted)) 7%, transparent)",
  },
  ".cm-callout.is-open": {
    paddingTop: "0.5em",
    borderTopLeftRadius: "var(--r-lg)",
    borderTopRightRadius: "var(--r-lg)",
    marginTop: "0.7em",
  },
  ".cm-callout.is-close": {
    paddingBottom: "0.5em",
    borderBottomLeftRadius: "var(--r-lg)",
    borderBottomRightRadius: "var(--r-lg)",
    marginBottom: "0.7em",
  },

  // 普通引用：只有竖线，没有底色 —— 那是它和 callout 的区别。
  // 竖线必须看得见：用 --border（89% 的灰）画在 99% 的背景上等于没画。
  ".cm-quote": {
    padding: "0.15em 14px 0.15em 16px",
    // 45% 太淡，在 99% 明度的背景上肉眼看不见。竖线是引用唯一的
    // 视觉标记，宁可重一点
    borderLeft: "3px solid color-mix(in oklch, var(--muted) 85%, transparent)",
    color: "var(--muted)",
  },
  ".cm-quote.is-open": { paddingTop: "0.4em", marginTop: "0.7em" },
  ".cm-quote.is-close": { paddingBottom: "0.4em", marginBottom: "0.7em" },

  ".cm-callout-info": { "--callout": "var(--accent)" },
  ".cm-callout-tip": { "--callout": "oklch(62% 0.15 152)" },
  ".cm-callout-warning": { "--callout": "var(--warn)" },
  ".cm-callout-danger": { "--callout": "var(--danger)" },
  ".cm-callout-question": { "--callout": "oklch(72% 0.15 85)" },
  ".cm-callout-quote": { "--callout": "var(--muted)" },

  ".cm-callout-badge": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4em",
    color: "var(--callout, var(--accent))",
    fontWeight: "600",
    // 标题比正文小一点：它是标签不是内容
    fontSize: "0.92em",
  },
  ".cm-callout-badge svg": {
    width: "1.05em",
    height: "1.05em",
    flex: "none",
  },

  // 光标进入时露出的源码里，`[!note]` 仍然要能一眼认出来
  ".cm-callout-marker": {
    color: "var(--accent)",
    fontWeight: "600",
    fontSize: "0.85em",
  },

  // ---- 任务列表 ----
  //
  // 尺寸用 em 而不是 px：正文字号在设置里能调，复选框要跟着一起变，
  // 否则调大字号之后框会显得越来越小
  ".cm-task": {
    display: "inline-block",
    width: "1.05em",
    height: "1.05em",
    verticalAlign: "-0.16em",
    marginRight: "0.35em",
    borderRadius: "0.28em",
    border: "1.5px solid color-mix(in oklch, var(--muted) 60%, transparent)",
    cursor: "pointer",
    transition: "background 120ms ease-out, border-color 120ms ease-out",
  },
  ".cm-task:hover": { borderColor: "var(--accent)" },
  ".cm-task.is-done": {
    background: "var(--accent)",
    borderColor: "var(--accent)",
    // 对勾用 SVG 背景而不是 ::after 画两条边框旋转 —— 后者在不同字号下
    // 对不齐，而 SVG 会跟着盒子等比缩放
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.4l3 3 6-6.5' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
    backgroundSize: "100% 100%",
  },
  ".cm-task-done": {
    color: "var(--muted)",
    textDecoration: "line-through",
    textDecorationColor: "color-mix(in oklch, var(--muted) 55%, transparent)",
  },

  // 无序列表的圆点。比 `-` 更接近排好版的样子
  ".cm-bullet": {
    color: "var(--muted)",
    opacity: 0.75,
  }
});

/**
 * 语法高亮。
 *
 * 注意这里**没有**把标题、粗体做成变色 —— live preview 已经把标记符号
 * 藏起来了，正文应当看起来就是排好版的文章。变色反而显得像代码编辑器。
 */
export const versoHighlight = HighlightStyle.define([
  // §6.1 层级靠字重和留白区分，不靠字号暴涨
  { tag: t.heading1, fontSize: "1.85em", fontWeight: "600", lineHeight: "1.3" },
  { tag: t.heading2, fontSize: "1.5em", fontWeight: "600", lineHeight: "1.35" },
  { tag: t.heading3, fontSize: "1.25em", fontWeight: "600" },
  { tag: t.heading4, fontSize: "1em", fontWeight: "600" },
  { tag: t.heading5, fontWeight: "600" },
  { tag: t.heading6, fontWeight: "600", color: "var(--muted)" },

  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.quote, color: "var(--muted)" },

  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in oklch, var(--muted) 14%, transparent)",
    borderRadius: "var(--r-xs)",
    padding: "1px 4px",
  },

  // 公式源码（光标进入时露出的那份）用等宽字体，好数括号
  { tag: versoTags.math, fontFamily: "var(--font-mono)", fontSize: "0.92em" },
  { tag: versoTags.mathMarker, color: "var(--muted)", opacity: 0.6 },
  { tag: versoTags.wikiLinkMarker, color: "var(--muted)", opacity: 0.6 },

  { tag: t.processingInstruction, color: "var(--muted)", opacity: 0.55 },
  { tag: t.contentSeparator, color: "var(--muted)" },
]);

export const versoHighlighting = syntaxHighlighting(versoHighlight);
