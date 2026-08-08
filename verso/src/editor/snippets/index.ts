/**
 * Snippet 引擎的 CodeMirror 接线。DESIGN.md §5
 *
 * 这是 M2 的核心，也是整个项目的成败点：「抄一页教材公式，比在 Obsidian 里快」。
 */
import {
  EditorState,
  type EditorState as State,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { mathContextAt } from "../mathContext";
import { DEFAULT_SNIPPETS } from "../../core/snippets/defaults";
import { expand, findTrigger, taboutTarget } from "../../core/snippets/match";
import { activeTabstops, setTabstops, tabstopField } from "./tabstops";
import { compileAll, type Snippet, type SnippetSpec } from "../../core/snippets/types";

/** 往前看多少个字符找触发词。最长的触发词也就十来个字符，64 绰绰有余 */
const LOOKBEHIND = 64;

export interface SnippetOptions {
  /** 用户自定义 snippet，与内置库合并；同触发词时优先级高者胜 */
  custom?: SnippetSpec[];
}

/** 这次事务是不是「在一个位置插入了一段文本」——只有这种才考虑展开 */
function singleInsert(tr: Transaction): { at: number; text: string } | null {
  let result: { at: number; text: string } | null = null;
  let n = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    n++;
    if (toA !== fromA) n = 99; // 有删除，不是纯插入
    result = { at: fromA, text: inserted.toString() };
  });
  return n === 1 && result && (result as { text: string }).text ? result : null;
}

/**
 * 算出这次输入该不该触发展开。
 *
 * 返回的 spec **取代**原来那次输入事务，而不是追加在它后面。原因是
 * `transactionFilter` 返回的多个 spec **全都相对起始状态解析**，不是依次
 * 叠加 —— 按「插入之后」的坐标去算位置一定越界。
 *
 * 而且取代也更对：触发词里本来就包含刚敲下的那个字符，一次替换就完成
 * 「吃掉触发词 + 插入展开结果」，撤销时也天然是一步。
 */
export function expansionFor(snippets: Snippet[], tr: Transaction): TransactionSpec | null {
  const ins = singleInsert(tr);
  if (!ins) return null;

  const state = tr.startState;
  const line = state.doc.lineAt(ins.at);
  const from0 = Math.max(line.from, ins.at - LOOKBEHIND);
  // 「已在文档里的部分」+「正要插入的部分」，就是插入完成后光标前的文本
  const textBefore = state.doc.sliceString(from0, ins.at) + ins.text;

  const inMath = mathContextAt(state, ins.at) !== null;
  const match = findTrigger(snippets, textBefore, inMath);
  // 非自动展开的 snippet 留给 Tab 触发（M2 暂时全是自动的）
  if (!match || !match.snippet.auto) return null;

  const { text, tabstops } = expand(match.snippet.replacement, match.groups, match.snippet.build);

  const triggerStart = from0 + match.start;
  if (triggerStart > ins.at) {
    // 触发词整体落在这次插入的文本里（粘贴之类）
    const prefix = ins.text.slice(0, triggerStart - ins.at);
    return buildSpec(ins.at, ins.at, prefix + text, tabstops, ins.at + prefix.length);
  }
  return buildSpec(triggerStart, ins.at, text, tabstops, triggerStart);
}

/**
 * 非自动展开（没有 `A` 标志）的 snippet 由 Tab 触发。
 *
 * 这条路径的存在是有具体原因的：`pmat` 和 `pmat3x3` 是前缀关系，两个都自动
 * 展开的话，打到第 5 个字符 `pmat` 就先炸了，带尺寸的那条永远轮不到。
 * 让 `pmat` 改由 Tab 触发，两者就能共存。
 */
export function tabExpansion(snippets: Snippet[], state: State): TransactionSpec | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;

  const line = state.doc.lineAt(sel.head);
  const from0 = Math.max(line.from, sel.head - LOOKBEHIND);
  const textBefore = state.doc.sliceString(from0, sel.head);

  const inMath = mathContextAt(state, sel.head) !== null;
  const match = findTrigger(
    snippets.filter((s) => !s.auto),
    textBefore,
    inMath,
  );
  if (!match) return null;

  const { text, tabstops } = expand(match.snippet.replacement, match.groups, match.snippet.build);
  const from = from0 + match.start;
  return buildSpec(from, sel.head, text, tabstops, from);
}

function buildSpec(
  from: number,
  to: number,
  text: string,
  tabstops: number[],
  base: number,
): TransactionSpec {
  const stops = tabstops.map((t) => base + t);
  // 没有跳转点时光标落在展开内容末尾
  const caret = stops.length ? stops[0] : base + text.length;

  return {
    changes: { from, to, insert: text },
    selection: { anchor: caret },
    effects: setTabstops.of(
      stops.length > 1
        ? // 第一个跳转点就是当前光标位置，所以 Tab 该去的是后面那些
          { positions: stops.slice(1), from: base, to: base + text.length }
        : null,
    ),
    userEvent: "input.snippet",
    scrollIntoView: true,
  };
}

/**
 * Tab 的四段优先级（§5.1）：
 *   1. 光标前有非自动 snippet → 展开它
 *   2. 有跳转点 → 去下一个
 *   3. 在数学模式里 → tabout，跳出最近的闭合符号
 *   4. 其余 → 返回 null，交给默认行为（缩进、列表等）
 *
 * 写成「state → TransactionSpec」的纯函数而不是直接操作 view，
 * 是为了能脱离 DOM 测试 —— Tab 的行为正是公式手感的一半。
 */
export function tabSpec(state: State, snippets: Snippet[] = []): TransactionSpec | null {
  const manual = tabExpansion(snippets, state);
  if (manual) return manual;

  const stops = activeTabstops(state);

  if (stops && stops.positions.length) {
    const [next, ...rest] = stops.positions;
    return {
      selection: { anchor: next },
      effects: setTabstops.of(rest.length ? { ...stops, positions: rest } : null),
      scrollIntoView: true,
    };
  }

  const pos = state.selection.main.head;
  // tabout 只在公式里生效。正文里 Tab 该是缩进 —— 在散文中间莫名跳过一个
  // 括号，人会不知道光标去哪了
  if (mathContextAt(state, pos) === null) return null;

  const line = state.doc.lineAt(pos);
  const target = taboutTarget(line.text, pos - line.from);
  if (target === null) return null;

  return { selection: { anchor: line.from + target }, scrollIntoView: true };
}

/** Shift-Tab 退回 snippet 起点。抄公式时打错一格是常事 */
export function shiftTabSpec(state: State): TransactionSpec | null {
  const stops = activeTabstops(state);
  if (!stops) return null;
  if (state.selection.main.head <= stops.from) return null;
  return { selection: { anchor: stops.from }, scrollIntoView: true };
}

function dispatchSpec(fn: (s: State) => TransactionSpec | null) {
  return (view: EditorView): boolean => {
    const spec = fn(view.state);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };
}

/** 供 App 侧读取「当前生效的 snippet 集合」—— 符号面板要用 */
export function buildSnippets(options: SnippetOptions = {}): Snippet[] {
  return compileAll([...DEFAULT_SNIPPETS, ...(options.custom ?? [])]);
}

export function snippetEngine(options: SnippetOptions = {}): Extension {
  const snippets = buildSnippets(options);

  return [
    tabstopField,

    /**
     * 用 `transactionFilter` 而不是 `updateListener`：CM6 明确不建议在
     * updateListener 里派发事务，而返回 `[tr, expansion]` 能让展开紧跟着
     * 那次输入，撤销时是一步而不是两步。
     *
     * 只对 `input.type` 生效，展开自身标的是 `input.snippet` —— 这样不会递归。
     */
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged || !tr.isUserEvent("input.type")) return tr;
      // 起始状态有选区时不展开：那说明用户在替换一段文本，不是在连续打字
      if (!tr.startState.selection.main.empty) return tr;
      return expansionFor(snippets, tr) ?? tr;
    }),

    keymap.of([
      { key: "Tab", run: dispatchSpec((s) => tabSpec(s, snippets)) },
      { key: "Shift-Tab", run: dispatchSpec(shiftTabSpec) },
      {
        key: "Escape",
        run: (view) => {
          if (!activeTabstops(view.state)) return false;
          view.dispatch({ effects: setTabstops.of(null) });
          return true;
        },
      },
    ]),
  ];
}
