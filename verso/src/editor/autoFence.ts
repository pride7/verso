/**
 * 打完三个反引号自动补上收尾的围栏。
 *
 * 手写代码块最烦的一步是**跳到下面再补一遍 ```**。补完之后光标停在开围栏
 * 之后（而不是块体里），因为下一步通常是敲语言名 `rust`、`python`；
 * 敲完回车自然就进到块体，多一步都不用。
 *
 * 实现走 `transactionFilter` 而不是 `inputHandler`：返回的 spec **取代**原来
 * 那次输入，撤销时是一步而不是两步（和 snippet 引擎同一个理由，
 * 见 `snippets/index.ts` 里的说明）。
 */
import { EditorState, type Extension, type Transaction, type TransactionSpec } from "@codemirror/state";

/** 这次事务是不是「在一个位置插入了一个反引号」 */
function typedBacktick(tr: Transaction): number | null {
  let at: number | null = null;
  let n = 0;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    n++;
    if (toA !== fromA || inserted.toString() !== "`") n = 99;
    at = fromA;
  });
  return n === 1 ? at : null;
}

/**
 * 光标所在行之前是否还有没闭合的围栏。
 *
 * 数前面所有以 ``` 开头的行：奇数说明当前正**在**一个代码块里，那这三个
 * 反引号是用来收尾的，不能再补一个 —— 否则每次收尾都会多出一对。
 */
function insideFence(state: EditorState, line: number): boolean {
  let count = 0;
  for (let n = 1; n < line; n++) {
    if (/^\s*```/.test(state.doc.line(n).text)) count++;
  }
  return count % 2 === 1;
}

export function fenceCompletion(tr: Transaction): TransactionSpec | null {
  const at = typedBacktick(tr);
  if (at === null) return null;

  const state = tr.startState;
  const line = state.doc.lineAt(at);
  const before = state.doc.sliceString(line.from, at);
  const after = state.doc.sliceString(at, line.to);

  // 只在「行首两个反引号 + 正在打第三个」时触发。
  // 行内代码 ``code`` 不该被卷进来，所以要求前面只有空白
  if (!/^\s*``$/.test(before)) return null;
  // 行尾必须是空的 —— 否则是在已有文字中间补反引号
  if (after.trim()) return null;
  if (insideFence(state, line.number)) return null;

  const indent = /^\s*/.exec(line.text)![0];
  const caret = at + 1;
  return {
    changes: { from: at, insert: "`\n" + indent + "\n" + indent + "```" },
    // 光标停在开围栏之后，好接着敲语言名
    selection: { anchor: caret },
    userEvent: "input.fence",
    scrollIntoView: true,
  };
}

export const autoFence: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.type")) return tr;
  if (!tr.startState.selection.main.empty) return tr;
  return fenceCompletion(tr) ?? tr;
});
