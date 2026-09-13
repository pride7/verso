/**
 * Tab 的最后一段：缩进。DESIGN.md §5.1 第 4 条。
 *
 * snippet、跳转点、tabout 都不认这个键时，它该落在缩进上 —— 而这一段一直是
 * 空的。CM6 的 defaultKeymap **有意不绑 Tab**（否则键盘用户跳不出编辑器），
 * 于是按下去走的是浏览器的默认行为：焦点跑到正文里下一个可聚焦的东西上。
 * 文档里有 database 视图时那就是它的「视图设置」按钮 —— 在代码块里按个 Tab，
 * 光标凭空消失在半页之外。
 *
 * 跳出编辑器那条路还在，CM6 自己留了两个：`Ctrl-m`（defaultKeymap 里的
 * `toggleTabFocusMode`）常开，`Esc` 之后两秒内的那一下 Tab 也放行。
 *
 * 三种上下文，三种含义：
 *
 * - **列表项** → 连同子树嵌进上一个同级项里，Shift-Tab 反向提一级。缩进量
 *   不是固定两格，而是**对齐到上一项的内容列**：`1. ` 的内容从第 3 列起，
 *   只缩两格 CommonMark 根本不认为它嵌套了，屏幕上纹丝不动。
 * - **代码块与普通正文** → 补空格到下一个制表位。
 * - **有选区** → 整段左右移。
 *
 * 列表项的判断走语法树而不是正则：代码块里的 `- foo` 长得和列表一模一样
 * （和 listRenumber 同一个理由）。
 */
import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  countColumn,
  type EditorState,
  type Extension,
  type Line,
  type TransactionSpec,
} from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** 一级缩进两格。和 scratch.ts 里卡片的缩进是同一个宽度 */
const UNIT = 2;

/** 行首的列表标记，整个匹配的宽度就是这一项的内容列 */
const MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * 这些节点里的 Tab 只是缩进，不能顺着 parent 链爬到外面那个列表项上去 ——
 * 列表里嵌一个代码块是常事，在代码块里按 Tab 却把整个列表项挪了位，
 * 比什么都不做还糟。
 */
const OPAQUE = new Set(["FencedCode", "CodeBlock", "CodeText", "BlockMath", "Table"]);

function indentOf(state: EditorState, line: Line): number {
  return countColumn(/^[ \t]*/.exec(line.text)![0], state.tabSize);
}

/** 光标所在行属于哪个列表项；代码块、公式块、表格里一律算「不属于」 */
function listItemAt(state: EditorState, line: Line): SyntaxNode | null {
  // 从这一行的**第一个非空白字符**起解析，不是从行首。`  - 乙` 的行首还在外层
  // 那一项的范围里，从行首问会拿到父项，一按 Shift-Tab 提的就是错的那一级。
  // 空行不算在任何一项里 —— 从行尾问会问到下一项头上
  const ws = /^[ \t]*/.exec(line.text)![0].length;
  if (ws === line.text.length) return null;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from + ws, 1);
    node;
    node = node.parent
  ) {
    if (OPAQUE.has(node.name)) return null;
    if (node.name === "ListItem") {
      // 树滞后于文档时（异步解析的嵌套语言刚换过树）宁可当普通正文处理
      return MARKER.test(state.doc.lineAt(node.from).text) ? node : null;
    }
  }
  return null;
}

/** 列表项连同子树占的行。ListItem 的结束位置可能正好落在下一行行首 */
function itemLines(state: EditorState, item: SyntaxNode): [Line, Line] {
  return [state.doc.lineAt(item.from), state.doc.lineAt(Math.max(item.from, item.to - 1))];
}

/** 嵌一级：对齐到上一个同级项的内容列。没有上一项就不能嵌 —— 列表的第一项没有父可认 */
function nestDelta(state: EditorState, item: SyntaxNode): number {
  const prev = item.prevSibling;
  if (!prev || prev.name !== "ListItem") return 0;
  const prevLine = state.doc.lineAt(prev.from);
  const target = countColumn(MARKER.exec(prevLine.text)?.[0] ?? "", state.tabSize);
  const here = indentOf(state, state.doc.lineAt(item.from));
  return target > here ? target - here : UNIT;
}

/** 提一级：对齐到父项的标记列，父项是顶层就回到第 0 列 */
function liftDelta(state: EditorState, item: SyntaxNode): number {
  const here = indentOf(state, state.doc.lineAt(item.from));
  if (here === 0) return 0;
  const parent = item.parent?.parent;
  const target =
    parent?.name === "ListItem" ? indentOf(state, state.doc.lineAt(parent.from)) : 0;
  return target < here ? target - here : -Math.min(here, UNIT);
}

/** 把 [from, to] 这几行整体左右移 delta 列。空行不动，左移不许把任何一行压到负数 */
function reindent(state: EditorState, from: Line, to: Line, delta: number): ChangeSpec[] {
  const lines: Line[] = [];
  for (let n = from.number; n <= to.number; n++) {
    const line = state.doc.line(n);
    if (line.text.trim()) lines.push(line);
  }
  if (!lines.length) return [];
  // 左移按最浅的那一行算，行与行的相对缩进不能被压平
  const real =
    delta < 0 ? -Math.min(-delta, ...lines.map((l) => indentOf(state, l))) : delta;
  if (!real) return [];
  return lines.map((line) => ({
    from: line.from,
    to: line.from + /^[ \t]*/.exec(line.text)![0].length,
    insert: " ".repeat(indentOf(state, line) + real),
  }));
}

/**
 * 缩进那几处改动都插在**行首**，而行首很可能正是光标所在。CM6 默认把光标
 * 留在「插进来的文本左边」（`assoc = -1`），于是屏幕上是：字缩进了，光标
 * 纹丝不动，非得用鼠标点一下才回到该在的地方。所以这里统一按 `assoc = 1`
 * 映射 —— 光标跟着它原来那段文字走。CM 自己的 `indentMore` 也是这么做的。
 */
function shifted(state: EditorState, changes: ChangeSpec[]): TransactionSpec | null {
  if (!changes.length) return null;
  const set = state.changes(changes);
  return { changes: set, selection: state.selection.map(set, 1), userEvent: "input.indent" };
}

function indentSpec(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const sel = state.selection.main;
  const head = state.doc.lineAt(sel.from);

  // 有选区就整段移。单行选区也一样 —— 选中一段再按 Tab 是「把这几行推进去」，
  // 不是「用制表符把它替换掉」
  if (!sel.empty) {
    return shifted(state, reindent(state, head, state.doc.lineAt(sel.to), dir * UNIT));
  }

  const item = listItemAt(state, head);
  if (item) {
    const delta = dir > 0 ? nestDelta(state, item) : liftDelta(state, item);
    if (!delta) return null;
    const [first, last] = itemLines(state, item);
    return shifted(state, reindent(state, first, last, delta));
  }

  if (dir < 0) return shifted(state, reindent(state, head, head, -UNIT));

  // 补到下一个制表位，而不是一律插 UNIT 个空格：第 3 列按 Tab 该落在第 4 列。
  // 落点写死在空格后面 —— 同上，默认映射会把光标留在它们前面
  const col = countColumn(head.text, state.tabSize, sel.from - head.from);
  const insert = " ".repeat(UNIT - (col % UNIT));
  return {
    changes: { from: sel.from, insert },
    selection: { anchor: sel.from + insert.length },
    userEvent: "input.indent",
  };
}

export function tabIndentSpec(state: EditorState): TransactionSpec | null {
  return indentSpec(state, 1);
}

export function shiftTabIndentSpec(state: EditorState): TransactionSpec | null {
  return indentSpec(state, -1);
}

function run(dir: 1 | -1) {
  return (view: EditorView) => {
    const spec = indentSpec(view.state, dir);
    if (spec) view.dispatch({ ...spec, scrollIntoView: true });
    // 没事可做也要认下这个键（列表第一项没法再嵌、已经顶到第 0 列）。
    // 放过去就等于把焦点送出编辑器 —— 那正是这个文件要修的毛病
    return true;
  };
}

export const tabIndent: Extension = keymap.of([
  { key: "Tab", run: run(1) },
  { key: "Shift-Tab", run: run(-1) },
]);
