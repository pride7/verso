/**
 * 标题折叠。DESIGN.md §4
 *
 * 长文档里这是刚需 —— 写到几十节之后，不能折叠就只能靠滚动条大海捞针。
 *
 * ## 范围怎么算
 *
 * 折叠一个标题 = 收起**它管辖的整节**：从标题行末尾，到下一个「同级或更高级」
 * 标题之前。所以折叠 `##` 会把它下面的 `###`、`####` 一起收走，但碰到下一个
 * `##` 或 `#` 就停。只找「下一个标题」是不够的 —— 那样折叠 `##` 只会收到
 * 它的第一个子标题为止。
 *
 * ## 为什么要查语法树而不是只用正则
 *
 * `# 标题` 这种形状会出现在代码块里（一段 shell 注释、一段 Markdown 示例）。
 * 只按行首的 `#` 匹配的话，一篇讲 Markdown 语法的笔记会到处冒出折叠箭头，
 * 折叠范围还会横跨代码块边界。语法树能区分真标题和代码内容。
 */
import {
  codeFolding,
  foldedRanges,
  foldEffect,
  foldKeymap,
  foldService,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSetBuilder,
} from "@codemirror/state";
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/**
 * 这一行是不是标题？是就返回层级（1..6）。
 *
 * 用 `resolveInner(pos, 1)` 往里解析：标题节点从行首开始，
 * 而 `resolve` 在边界上可能给到父节点。
 */
function headingAt(
  state: EditorState,
  lineFrom: number,
): { level: number; to: number } | null {
  let node = syntaxTree(state).resolveInner(lineFrom, 1);
  for (;;) {
    const m = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
    // 返回节点的 `to` 而不是行末：setext 标题（`标题` + 下一行 `===`）
    // 占两行，按行末算会把下划线那行折进去，标题就散了
    if (m) return { level: Number(m[1]), to: node.to };
    // 进了代码块就不可能是标题 —— 代码里的 `# xxx` 不是标题
    if (node.name === "FencedCode" || node.name === "CodeBlock") return null;
    if (!node.parent) return null;
    node = node.parent;
  }
}

function headingLevel(state: EditorState, lineFrom: number): number | null {
  return headingAt(state, lineFrom)?.level ?? null;
}

/**
 * 标题的折叠范围。
 *
 * `from` 落在**标题行末尾** —— 标题本身要一直看得见，否则折叠完就不知道
 * 收起来的是什么了。
 */
export function headingFoldRange(
  state: EditorState,
  lineStart: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const head = headingAt(state, line.from);
  if (!head) return null;
  const { level } = head;
  // 标题节点自己占了几行（setext 是两行），从它之后开始数
  const headEndLine = state.doc.lineAt(head.to).number;

  const last = state.doc.lines;
  let end = last;
  for (let n = headEndLine + 1; n <= last; n++) {
    const l = headingLevel(state, state.doc.line(n).from);
    // 同级或更高级的标题 = 本节到此为止
    if (l !== null && l <= level) {
      end = n - 1;
      break;
    }
  }

  // 末尾的空行留在折叠范围外，展开/折叠时段落间距才不会跳
  while (end > headEndLine && !state.doc.line(end).text.trim()) end--;
  if (end <= headEndLine) return null;

  return { from: head.to, to: state.doc.line(end).to };
}

/** 某个位置是否已被折叠 */
function foldedAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;
  foldedRanges(state).between(pos, pos, (from, to) => {
    hit = { from, to };
    return false;
  });
  return hit;
}

/** 折叠占位符。显示收起了多少行，比一个光秃秃的 `⋯` 有用得多 */
function placeholderDOM(_view: EditorView, onclick: (e: Event) => void) {
  const el = document.createElement("span");
  el.className = "cm-fold-placeholder";
  el.textContent = "⋯";
  el.title = "点击展开";
  el.setAttribute("aria-label", "展开这一节");
  el.onclick = onclick;
  return el;
}

/**
 * 折叠箭头。
 *
 * **不用 `foldGutter`。** 槽是独立的 DOM 列，CSS 的 `:hover` 从行够不到
 * 它 —— 想做到「鼠标移到这一行才显示」就只能靠 JS 追踪悬停行。而且那一列
 * 会把正文整体右推，与 §4「看起来像排好版的文章」相冲。
 *
 * 改成行内的**绝对定位**元素：不占位、不推挤文字，纯 CSS 就能按行悬停。
 */
class FoldArrow extends WidgetType {
  constructor(
    readonly folded: boolean,
    readonly line: number,
  ) {
    super();
  }

  eq(other: FoldArrow) {
    return other.folded === this.folded && other.line === this.line;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = `cm-fold-arrow${this.folded ? " is-closed" : ""}`;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", this.folded ? "展开这一节" : "折叠这一节");
    el.innerHTML =
      '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 3.5 10.5 8 6 12.5"/></svg>';
    el.addEventListener("mousedown", (e) => {
      // 不 preventDefault 的话浏览器会先把光标挪进这一行，
      // 折叠范围随即变成「光标所在的节」，点谁都折同一个
      e.preventDefault();
      e.stopPropagation();
      const from = view.state.doc.line(this.line).from;
      const range = headingFoldRange(view.state, from);
      if (!range) return;
      const existing = foldedAt(view.state, range.from);
      view.dispatch({ effects: existing ? unfoldEffect.of(existing) : foldEffect.of(range) });
    });
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

function buildArrows(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    let n = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    for (; n <= last; n++) {
      const line = state.doc.line(n);
      const range = headingFoldRange(state, line.from);
      if (!range) continue;
      marks.push(
        Decoration.widget({
          widget: new FoldArrow(!!foldedAt(state, range.from), n),
          side: -1,
        }).range(line.from),
      );
    }
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of marks) builder.add(m.from, m.to, m.value);
  return builder.finish();
}

const foldArrows = ViewPlugin.fromClass(
  class implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildArrows(view);
    }

    update(update: ViewUpdate) {
      // 折叠状态变了也要重画（箭头要转向），所以不能只看 docChanged
      const foldChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
      );
      if (update.docChanged || update.viewportChanged || foldChanged) {
        this.decorations = buildArrows(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** 折叠/展开光标所在的那一节。已折叠就展开，未折叠就折叠 */
export const toggleHeadingFold: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const range = headingFoldRange(view.state, line.from);
  if (!range) return false;
  const existing = foldedAt(view.state, range.from);
  view.dispatch({
    effects: existing ? unfoldEffect.of(existing) : foldEffect.of(range),
  });
  return true;
};

/** 折叠全部标题。写完一篇长文之后想看全貌时用 */
export const foldAllHeadings: Command = (view) => {
  const effects = [];
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const range = headingFoldRange(view.state, view.state.doc.line(n).from);
    if (range && !foldedAt(view.state, range.from)) effects.push(foldEffect.of(range));
  }
  if (!effects.length) return false;
  view.dispatch({ effects });
  return true;
};

/**
 * 折叠**指定的几行**标题，返回真正折起来的条数。项目日志的「只看最新」用它
 * （§2.10）。
 *
 * 返回条数是给调用方判断「解析好了没有」用的：折叠范围要查语法树，而 CM6
 * 的解析是建 view 之后异步进行的，太早调用会一条都折不成（见 parseRefresh.ts
 * 里同一个时序问题）。调用方看到 0 就该过一会儿再试。
 */
export function foldHeadingLines(view: EditorView, lines: number[]): number {
  const effects = [];
  for (const n of lines) {
    if (n < 1 || n > view.state.doc.lines) continue;
    const range = headingFoldRange(view.state, view.state.doc.line(n).from);
    if (range && !foldedAt(view.state, range.from)) effects.push(foldEffect.of(range));
  }
  if (!effects.length) return 0;
  view.dispatch({ effects });
  return effects.length;
}

export const unfoldAllHeadings: Command = (view) => {
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  if (!effects.length) return false;
  view.dispatch({ effects });
  return true;
};

export const headingFolding: Extension = [
  codeFolding({ placeholderDOM }),
  foldService.of((state, lineStart) => headingFoldRange(state, lineStart)),
  foldArrows,
  keymap.of(foldKeymap),
];
