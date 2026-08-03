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
  // §6.1 段内行高与段间距是两套尺度。padding 会被 CodeMirror 的高度图计入，
  // 不能换成 margin；空行本身则缩成同样的 0.9em，避免「段尾留白 + 空行」叠加。
  ".cm-paragraph-break": { paddingBottom: "0.9em" },
  ".cm-paragraph-gap": { lineHeight: "0.9em" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--accent) 22%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },

  // ---- 中西文混排间距（§4.3 typography）----
  //
  // 八分之一个字宽。四分之一（0.25em）是活字排版的传统值，但在屏幕上、
  // 尤其是 1.75 行高的中文里显得松 —— 0.125em 刚好让人感觉「不挤」而
  // 说不出哪里变了。**用 margin 不是 padding**：padding 会把行内代码那种
  // 带底色的段落撑出一块多余的底
  ".cm-hs-l": { marginLeft: "0.125em" },
  ".cm-hs-r": { marginRight: "0.125em" },

  // ---- 标题的留白（§6.1）----
  //
  // **上方的空白明显大于下方**：留白是「这一节从这里开始」的信号，
  // 层级靠它拉开，而不是靠字号一路涨上去。
  //
  // 只能用 padding，不能用 margin —— CodeMirror 的高度图测的是盒高，
  // margin 不计入，坐标反查会整体偏移一行（AGENTS.md 里那条）。
  //
  // 每一级把值写进 `--h-top`，是为了让折叠箭头拿同一个数：箭头在行内
  // 绝对定位、上下撑满再居中，行一旦有了上内边距，它就会浮到文字上方去。
  // 给它同样的 padding-top，居中的基准就重新落回那一行文字上
  ".cm-h1": { "--h-top": "1.15em" },
  ".cm-h2": { "--h-top": "1em" },
  ".cm-h3": { "--h-top": "0.8em" },
  ".cm-h4, .cm-h5, .cm-h6": { "--h-top": "0.6em" },
  ".cm-h": { paddingTop: "var(--h-top, 0)" },

  // ---- 公式 ----
  ".cm-math-inline": { cursor: "pointer" },
  ".cm-math-block": {
    display: "block",
    textAlign: "center",
    // **padding 不是 margin**：块级 widget 也进高度图，而高度图测的是盒高，
    // margin 不计入 —— 坐标反查会偏。表格那边早就是这么写的，这里之前漏了
    padding: "0.9em 0",
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
  //
  // **极淡的彩底 + 同色系深一档的字。** 中灰底配黑字是最廉价的一种块，
  // 而 9% 的彩底几乎不占视觉重量，却让它「成块」—— 简洁不等于褪色（§6.2）
  ".cm-hashtag": {
    color: "var(--accent-ink)",
    backgroundColor: "var(--accent-wash)",
    borderRadius: "var(--r-xs)",
    padding: "1px 5px",
    fontSize: "0.9em",
  },

  // 高亮是**用户拿马克笔划的**，这一处的颜色是内容本身，不在「只做重音」
  // 的约束里。但 40% 在中文正文里过重，压到 26% 仍然一眼可见
  ".cm-highlight": {
    backgroundColor: "color-mix(in oklch, var(--warn) 26%, transparent)",
    borderRadius: "var(--r-xs)",
    padding: "0 2px",
  },

  // ---- 分割线 ----
  // `---` 的渲染态。inline-block 撑满行宽，vertical-align 让它落在行的
  // 视觉中线附近而不是趴在基线上
  ".cm-hr": {
    display: "inline-block",
    width: "100%",
    height: "2px",
    borderRadius: "999px",
    background: "var(--hairline)",
    verticalAlign: "middle",
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
    // 把手绝对定位在单元格上，所以每一格都得是定位上下文
    position: "relative",
  },
  // 第一列左侧留给行把手；表头右侧留给列把手。把手内收进单元格，不另撑
  // 一条空白操作带。只给真正需要的边加空间，不把整张表都撑宽。
  ".cm-table th:first-child, .cm-table td:first-child": { paddingLeft: "27px" },
  ".cm-table thead th": {
    fontWeight: "600",
    background: "color-mix(in oklch, var(--muted) 8%, transparent)",
    whiteSpace: "nowrap",
    paddingRight: "42px",
  },
  ".cm-table tbody tr:last-child td": { borderBottom: "none" },
  // 点哪格改哪格（§4.9），整格都是点击面积，所以整格都给文字光标
  ".cm-table th, .cm-table td, .cm-table .cm-table-cell": { cursor: "text" },
  // 单元格内容的那层 span：渲染态/编辑态在这层切换。block 让空格子也有
  // 一整格的可点面积，minHeight 让空行不塌成一条缝
  ".cm-table .cm-table-cell": {
    display: "block",
    minHeight: "1.4em",
    outline: "none",
  },
  // 编辑态：一圈重音色细环标出「现在改的是这一格」。显示的是这一格的源码，
  // 字体不换 —— 格子里的内容多半是正文，不是代码
  ".cm-table .cm-table-cell.is-editing": {
    whiteSpace: "pre-wrap",
    borderRadius: "var(--r-xs)",
    boxShadow: "0 0 0 2px color-mix(in oklch, var(--accent) 40%, transparent)",
  },

  // ---- 表格的行/列把手（§4.9）----
  //
  // **平时一个都不显示**，鼠标进表后才淡淡浮现，经过的那一行/列再明确起来。
  // 所有把手一起高亮会把正文表格变成后台管理表；点阵只负责暗示「这里可操作」。
  ".cm-table-grip": {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "none",
    borderRadius: "var(--r-sm)",
    background: "transparent",
    color: "var(--muted)",
    opacity: 0,
    cursor: "pointer",
    boxShadow: "none",
    transition: "opacity var(--t-fast), color var(--t-fast), background var(--t-fast)",
    // 藏起来的时候不能挡住单元格 —— 点单元格是就地改字的入口
    pointerEvents: "none",
    zIndex: 1,
  },
  // 列把手放进表头右侧，行把手放进第一格左侧。两者都使用单元格已有高度，
  // 不再像上一版那样给表头上方造出一条空白工具栏。
  ".cm-table-grip.is-col": {
    top: "50%",
    // 最右边留给列宽拖杆；两个入口各有自己的命中区，拖宽不会误开列菜单。
    right: "14px",
    width: "20px",
    height: "20px",
    transform: "translateY(-50%)",
  },
  ".cm-table-grip.is-row": {
    left: "4px",
    top: "50%",
    width: "17px",
    height: "20px",
    transform: "translateY(-50%)",
  },
  // 进入整张表时所有入口只露出轮廓；指到具体行/列表头才明确高亮。
  ".cm-table:hover .cm-table-grip": { opacity: 0.16, pointerEvents: "auto" },
  ".cm-table thead th:hover > .cm-table-grip.is-col, .cm-table tr:hover .cm-table-grip.is-row": {
    opacity: 0.72,
  },
  ".cm-table .cm-table-grip:hover, .cm-table .cm-table-grip.is-open": {
    opacity: 1,
    color: "var(--accent)",
    background: "var(--hover-bg)",
  },
  // 触屏上没有 hover，一根把手都摸不出来 —— §1.2「不能假设有鼠标」。
  // 那里常显一份更淡的
  "@media (hover: none)": {
    ".cm-table .cm-table-grip": { opacity: 0.38, pointerEvents: "auto" },
    ".cm-table .cm-table-resize": { opacity: 0.42, pointerEvents: "auto" },
  },

  // ---- 列宽拖杆（§4.9）----
  // 命中区比那根 1px 线宽，但视觉上仍只是一条边界。它骑在相邻两列之间，
  // 不占内容宽度，也不会再给表头加一层工具栏。
  ".cm-table-resize": {
    position: "absolute",
    top: 0,
    right: "-5px",
    bottom: 0,
    width: "10px",
    zIndex: 3,
    opacity: 0,
    pointerEvents: "none",
    cursor: "col-resize",
    touchAction: "none",
    outline: "none",
  },
  ".cm-table-resize::after": {
    content: "''",
    position: "absolute",
    top: "4px",
    bottom: "4px",
    left: "4px",
    width: "1px",
    borderRadius: "999px",
    background: "var(--hairline)",
    transition: "background var(--t-fast), width var(--t-fast)",
  },
  ".cm-table:hover .cm-table-resize": { opacity: 0.5, pointerEvents: "auto" },
  ".cm-table th:hover > .cm-table-resize": { opacity: 0.9 },
  ".cm-table-resize:hover::after, .cm-table-resize:focus-visible::after, .cm-table.is-resizing .cm-table-resize::after": {
    width: "2px",
    background: "var(--accent)",
  },
  ".cm-table-resize:focus-visible": {
    opacity: 1,
    pointerEvents: "auto",
  },
  // 把手菜单。fixed 定位的理由见 table.ts：外面那层是 overflow-x: auto，
  // absolute 的菜单会被裁掉下半截
  ".cm-table-menu": {
    position: "fixed",
    zIndex: "20",
    minWidth: "176px",
    margin: 0,
    padding: "4px",
    listStyle: "none",
    background: "var(--raised)",
    border: "1px solid var(--hairline)",
    borderRadius: "var(--r-md)",
    boxShadow: "var(--shadow-md)",
    fontFamily: "var(--font-body)",
    fontWeight: "400",
    // 表头里的菜单不该跟着表头一起加粗、也不该被 nowrap 影响
    whiteSpace: "nowrap",
    textAlign: "left",
  },
  ".cm-table-menu li": { listStyle: "none", margin: 0, padding: 0 },
  ".cm-table-menu-title": {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "12px",
    padding: "7px 9px 6px",
    color: "var(--text)",
    fontSize: "12px",
  },
  ".cm-table-menu-title strong": { fontWeight: "650" },
  ".cm-table-menu-title span": { color: "var(--muted)", fontSize: "10.5px" },
  ".cm-table-menu-divider": {
    height: "1px",
    margin: "4px 7px",
    background: "var(--hairline)",
  },
  ".cm-table-menu button": {
    // 每一条都带图标：一列纯文字菜单要逐行读，带图标之后眼睛能直接跳到那条
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    padding: "5px 8px",
    border: "none",
    borderRadius: "var(--r-sm)",
    background: "transparent",
    fontFamily: "inherit",
    fontSize: "12.5px",
    color: "var(--text)",
    textAlign: "left",
    cursor: "pointer",
  },
  ".cm-table-menu button > svg": { flex: "none", color: "var(--muted)" },
  ".cm-table-menu button:hover": { background: "var(--hover-bg)" },
  ".cm-table-menu button:hover > svg": { color: "var(--text)" },
  ".cm-table-menu button.is-danger": { color: "var(--danger)" },
  ".cm-table-menu button.is-danger > svg": { color: "var(--danger)" },
  ".cm-table-menu button.is-danger:hover": {
    background: "color-mix(in oklch, var(--danger) 9%, transparent)",
  },
  // 对齐那一行：图标 + 标签 + 三个小按钮，同 database 视图的「类型」那一行
  ".cm-table-menu-sub": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "5px 8px",
    fontSize: "12.5px",
    color: "var(--text)",
  },
  ".cm-table-menu-sub > svg": { flex: "none", color: "var(--muted)" },
  ".cm-table-aligns": { display: "flex", gap: "2px", marginLeft: "auto" },
  ".cm-table-aligns button": {
    width: "22px",
    justifyContent: "center",
    padding: "3px",
    border: "none",
    borderRadius: "var(--r-xs)",
    background: "transparent",
    color: "var(--muted)",
    lineHeight: 0,
    cursor: "pointer",
  },
  ".cm-table-aligns button:hover": { background: "var(--hover-bg)", color: "var(--text)" },
  ".cm-table-aligns button.is-on": {
    background: "color-mix(in oklch, var(--accent) 14%, transparent)",
    color: "var(--accent)",
  },
  // 单元格里的行内代码。和正文里那套药丸保持一致
  ".cm-inline-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "color-mix(in oklch, var(--muted) 10%, transparent)",
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
    // 跟着标题行的上内边距一起下移，否则它会停在标题上方那片空白的正中
    paddingTop: "var(--h-top, 0)",
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
    // **不要底色。** 一整块底（无论彩的还是灰的）都会把 callout 变成一个
    // 「提示框控件」，而它其实是旁注。颜色收在左边那条线和图标+标题上，
    // 识别度一点没丢，正文却清爽得多
    borderLeft: "2.5px solid var(--callout, var(--accent))",
    background: "transparent",
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
  // §6.1 层级靠字重和留白区分，不靠字号暴涨。
  //
  // 字重从 600 降到 550/560：中文在 600 上显得墩实，尤其是大字号的一级标题。
  // 字号也各收一档 —— 让出来的层级差由上方留白补（见上面的 `--h-top`）
  // 字距收一点点：中文在大字号下字与字之间会显得松，-0.01em 肉眼说不出
  // 哪里变了，但整行会「紧实」起来。正文不动 —— 那个尺度上收字距会伤可读性
  { tag: t.heading1, fontSize: "1.7em", fontWeight: "550", lineHeight: "1.35", letterSpacing: "-0.012em" },
  { tag: t.heading2, fontSize: "1.38em", fontWeight: "560", lineHeight: "1.4", letterSpacing: "-0.008em" },
  { tag: t.heading3, fontSize: "1.18em", fontWeight: "580" },
  { tag: t.heading4, fontSize: "1em", fontWeight: "600" },
  { tag: t.heading5, fontWeight: "600" },
  { tag: t.heading6, fontWeight: "600", color: "var(--muted)" },

  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.quote, color: "var(--muted)" },

  // 行内代码的底色压到 10%：一段中文里的三处行内代码，14% 看起来是三块补丁
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: "color-mix(in oklch, var(--muted) 10%, transparent)",
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
