/**
 * 跳转点状态。DESIGN.md §5.1
 *
 * snippet 展开后，光标落在 `$0`，按 Tab 依次前进到 `$1` `$2`…
 * 位置要跟着后续编辑一起移动 —— 用户会在跳转点里打字，那正是它存在的意义。
 */
import { StateEffect, StateField, type EditorState } from "@codemirror/state";

export interface TabstopState {
  /** 还没走到的跳转点，文档绝对位置，已按顺序排列 */
  positions: number[];
  /** 整个 snippet 的范围，光标离开它就放弃这组跳转点 */
  from: number;
  to: number;
}

export const setTabstops = StateEffect.define<TabstopState | null>();

export const tabstopField = StateField.define<TabstopState | null>({
  create: () => null,

  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setTabstops)) return e.value;
    }
    if (!value) return null;

    if (tr.docChanged) {
      // assoc = 1：在跳转点位置打字时，跳转点应当留在插入内容的**右侧**，
      // 否则打第一个字符就把跳转点甩到身后了
      value = {
        positions: value.positions.map((p) => tr.changes.mapPos(p, 1)),
        from: tr.changes.mapPos(value.from, -1),
        to: tr.changes.mapPos(value.to, 1),
      };
    }

    // 光标移出这段 snippet 就放弃 —— 用户已经去写别的了，
    // 再按 Tab 却跳回旧位置是很惊悚的
    const head = tr.state.selection.main.head;
    if (head < value.from || head > value.to) return null;

    return value.positions.length ? value : null;
  },
});

export function activeTabstops(state: EditorState): TabstopState | null {
  return state.field(tabstopField, false) ?? null;
}
