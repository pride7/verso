/**
 * 编辑器主题。DESIGN.md §6.1 的排版尺度在这里落地。
 * 颜色全部走 styles.css 里的 CSS 变量，深浅主题自动跟随。
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

import { folioTags } from "./markdownExtended";

export const folioTheme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "transparent",
    height: "100%",
    // §6.1 中文比英文需要更大字号；1.5 的行高对中文过于拥挤
    fontSize: "16.5px",
    fontFamily: "var(--font-body)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.75",
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
    borderRadius: "4px",
    padding: "1px 5px",
    fontSize: "0.9em",
  },

  ".cm-highlight": {
    backgroundColor: "color-mix(in oklch, var(--warn) 40%, transparent)",
    borderRadius: "2px",
    padding: "0 2px",
  },

  ".cm-callout-marker": {
    color: "var(--accent)",
    fontWeight: "600",
    fontSize: "0.85em",
  },
});

/**
 * 语法高亮。
 *
 * 注意这里**没有**把标题、粗体做成变色 —— live preview 已经把标记符号
 * 藏起来了，正文应当看起来就是排好版的文章。变色反而显得像代码编辑器。
 */
export const folioHighlight = HighlightStyle.define([
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
    borderRadius: "4px",
    padding: "1px 4px",
  },

  // 公式源码（光标进入时露出的那份）用等宽字体，好数括号
  { tag: folioTags.math, fontFamily: "var(--font-mono)", fontSize: "0.92em" },
  { tag: folioTags.mathMarker, color: "var(--muted)", opacity: 0.6 },
  { tag: folioTags.wikiLinkMarker, color: "var(--muted)", opacity: 0.6 },

  { tag: t.processingInstruction, color: "var(--muted)", opacity: 0.55 },
  { tag: t.contentSeparator, color: "var(--muted)" },
]);

export const folioHighlighting = syntaxHighlighting(folioHighlight);
