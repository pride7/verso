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
  // 左边留出一条**内边距**给折叠箭头。
  //
  // 箭头是绝对定位在 left:-1.15em 的，如果 .cm-content 没有左内边距，
  // 它就落在盒子外面、被 .cm-scroller 整个裁掉 —— 表现是"箭头全程不显示"。
  // 这和之前 callout 竖线消失是同一类问题（见 AGENTS.md 那条）。
  //
  // 正文的视觉位置不变：.editor-host 用等量的负外边距抵消回去
  // （那是普通 div，不是 .cm-line，不影响 CodeMirror 的高度图）。
  // 用 px 而不是 em：箭头是界面元素，不该跟着正文字号缩放，而且 em 在
  // 这里的基准很容易算错 —— 内边距按 .cm-content 的字号算、箭头的
  // left 按它自己的字号算，两边对不上就会把箭头挤出盒子被裁掉
  ".cm-content": { padding: "0 0 0 26px", caretColor: "var(--accent)" },
  // `position: relative` 是折叠箭头的定位基准（绝对定位要有个 positioned 祖先）。
  // 必须和 padding 写在**同一条**规则里 —— 这是 JS 对象字面量，
  // 同名键后面的会把前面的整个覆盖掉，分开写会悄悄丢掉一个
  ".cm-line": { padding: "0", position: "relative" },
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
    // 同样避开纵向 margin（见上面那条注释），块级 widget 也进高度图
    padding: "0.5em 0",
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

  // ---- 标题折叠 ----
  //
  // 箭头是**绝对定位**的，不占位、不推挤文字，所以正文左边缘保持干净。
  // 平时完全不显示，鼠标移到**那一行**才浮现 —— 常显的箭头列会让笔记
  // 看起来像代码编辑器（§4）。
  ".cm-fold-arrow": {
    position: "absolute",
    left: "-22px",
    // 撑满整行再让内容居中，**不要用固定的 top 偏移**：
    // 这个 span 是 .cm-line 的直接子元素，它的 em 相对的是正文字号，
    // 而标题行的字号是 1.85em、行高也更大 —— 固定偏移必然偏上。
    top: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    color: "var(--muted)",
    opacity: 0,
    cursor: "pointer",
    transition: "opacity 120ms ease-out, color 120ms ease-out",
  },
  // 只在这一行被悬停时出现
  ".cm-line:hover .cm-fold-arrow": { opacity: 0.5 },
  ".cm-fold-arrow:hover": { opacity: 1, color: "var(--accent)" },
  // 展开态朝下、折叠态朝右，和文档树一致。
  //
  // **旋转 svg，不要旋转容器。** 容器是 16px 宽、跟行等高的一条，旋转
  // 90° 之后它的包围盒会变成"行高那么宽"，向左多探出小十个像素 ——
  // 视觉上看不出来，但它会真的伸到内容盒外面被裁掉
  ".cm-fold-arrow:not(.is-closed) svg": { transform: "rotate(90deg)" },
  ".cm-fold-arrow svg": { transition: "transform 120ms ease-out" },
  // 已折叠的**始终可见** —— 那是状态指示，藏起来会让人找不到自己收走的内容
  ".cm-fold-arrow.is-closed": { opacity: 0.85 },

  ".cm-fold-placeholder": {
    display: "inline-block",
    margin: "0 0.35em",
    padding: "0 0.45em",
    borderRadius: "var(--r-xs)",
    background: "color-mix(in oklch, var(--muted) 16%, transparent)",
    color: "var(--muted)",
    fontSize: "0.85em",
    cursor: "pointer",
    border: "none",
  },
  ".cm-fold-placeholder:hover": {
    background: "color-mix(in oklch, var(--accent) 20%, transparent)",
    color: "var(--accent)",
  },

  // ---- 围栏代码块 ----
  ".cm-code": {
    padding: "0 14px",
    background: "color-mix(in oklch, var(--muted) 9%, transparent)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
  },
  ".cm-code.is-open": {
    paddingTop: "0.8em",
    borderTopLeftRadius: "var(--r-lg)",
    borderTopRightRadius: "var(--r-lg)",
  },
  ".cm-code.is-close": {
    paddingBottom: "0.8em",
    borderBottomLeftRadius: "var(--r-lg)",
    borderBottomRightRadius: "var(--r-lg)",
  },
  // 围栏行淡化但不隐藏 —— 藏了就改不了语言标注，
  // 而且光标停进去时会看到行数对不上
  ".cm-code.is-fence": { color: "color-mix(in oklch, var(--muted) 60%, transparent)" },

  // 行号那条左边距。整块一致（围栏行也有 is-numbered），
  // 否则光标一进来露出的 ``` 会比代码往左突出一截
  ".cm-code.is-numbered": { paddingLeft: "3.4em" },

  // 行号用生成内容画。
  //
  // **不做成 widget**：`::before` 不进选区也不进剪贴板，框选整块代码
  // 复制出去才是干净的代码。
  //
  // **也不用绝对定位**：块首/块尾那两行带着 0.8em 的纵向内边距，绝对定位
  // 就得为「文字贴上边」和「文字贴下边」分别配一次 top，配错一次就是
  // 行号和代码差半行。跟着文字流走，对齐是白来的 —— 三个外边距加起来
  // 净占位为 0，正文起点仍在 3.4em 上，换行后的续行也不会被推歪
  ".cm-code[data-ln]::before": {
    content: "attr(data-ln)",
    display: "inline-block",
    width: "2em",
    marginLeft: "-2.6em",
    marginRight: "0.6em",
    textAlign: "right",
    color: "color-mix(in oklch, var(--muted) 50%, transparent)",
    // 双保险：Chromium 的 innerText 不收生成内容，但别的引擎不保证
    userSelect: "none",
  },

  // 复制按钮。常显但很淡 —— 悬停才出现的话，触摸屏上就等于没有（§6 移动端）
  ".cm-code-copy": {
    position: "absolute",
    top: "2px",
    right: "6px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "22px",
    padding: "0",
    border: "1px solid transparent",
    borderRadius: "var(--r-xs)",
    // 代码有可能长到按钮底下，给个实底把它托住 —— 半透明会糊成一团
    background: "color-mix(in oklch, var(--muted) 9%, var(--bg))",
    color: "var(--muted)",
    opacity: "0.5",
    cursor: "pointer",
    transition: "opacity var(--t-fast), color var(--t-fast), border-color var(--t-fast)",
  },
  ".cm-code-copy svg": { width: "14px", height: "14px" },
  ".cm-code-copy:hover": {
    opacity: "1",
    color: "var(--text)",
    borderColor: "var(--hairline)",
  },
  // 复制成功那 1.4 秒里必须显眼，否则「到底复制上没有」要靠猜
  ".cm-code-copy[data-state='done']": { opacity: "1", color: "var(--accent)" },
  ".cm-code-copy[data-state='failed']": { opacity: "1", color: "var(--danger)" },

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
  // ⚠️ 行装饰**绝不能用纵向 margin**。
  //
  // CodeMirror 用高度图缓存每一行的位置，它测的是元素**盒高**，margin
  // 不计入其中 —— 于是 `posAtCoords` 整体偏移，点文字会落到下一行，
  // 表现是"点了光标不在，只有点左边空白才行"。用 padding 代替，
  // padding 算在盒高里。
  ".cm-callout.is-open": {
    paddingTop: "0.75em",
    borderTopLeftRadius: "var(--r-lg)",
    borderTopRightRadius: "var(--r-lg)",
  },
  ".cm-callout.is-close": {
    paddingBottom: "0.75em",
    borderBottomLeftRadius: "var(--r-lg)",
    borderBottomRightRadius: "var(--r-lg)",
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
  ".cm-quote.is-open": { paddingTop: "0.5em" },
  ".cm-quote.is-close": { paddingBottom: "0.5em" },

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

  // ---- 代码块内的语法高亮 ----
  //
  // 这些 tag 只有在围栏标了语言、嵌套解析生效之后才会出现（index.ts 的
  // `codeLanguages`），Markdown 自己一个都不产出 —— 所以正文不会跟着变色。
  //
  // 色值全部走 CSS 变量，深浅两套主题在 styles.css 里各配一遍。§6.2 的
  // 「颜色只做重音」在这里的落法是：**只给会改变代码语义的东西上色**
  // （关键字、字面量、注释、名字），标点和运算符仍然是正文色 —— 每个
  // token 都染一遍的配色方案，扫读时反而找不到重点
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], color: "var(--code-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--code-string)" },
  { tag: [t.escape, t.character], color: "var(--code-escape)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: "var(--code-comment)",
    fontStyle: "italic",
  },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit], color: "var(--code-number)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName],
    color: "var(--code-fn)",
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.standard(t.name), t.tagName],
    color: "var(--code-type)",
  },
  { tag: [t.propertyName, t.attributeName], color: "var(--code-prop)" },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: "var(--code-number)" },
  { tag: t.invalid, color: "var(--danger)" },
]);

export const versoHighlighting = syntaxHighlighting(versoHighlight);
