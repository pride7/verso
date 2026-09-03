/**
 * 「编辑器现在有没有光标可言」。DESIGN.md §4.2
 *
 * ## 为什么需要它
 *
 * live preview 的规则是「光标碰到的节点退回源码」。但那条规则默认了一件事：
 * 有光标。而 CM6 的选区**和焦点无关** —— 新建的 EditorState 选区就在 0，
 * 编辑器有没有焦点它都在那儿。
 *
 * 于是打开一篇以标题开头的笔记，第一行永远露着 `## `：光标在 0，标题的范围
 * 是 `[0, N]`，闭区间判定下就算碰到了。用户根本没点过正文，屏幕上却先给他
 * 看了一行 Markdown 源码。公式、代码块、表格、图表在第一行时同理。
 *
 * 所以判据要加一半：**焦点不在编辑器里时，当作没有光标，一切都渲染成最终
 * 形态。** 点进正文才在光标处露出源码。这不是一个要记的模式开关，是
 * 「没在编辑就别显示编辑痕迹」。
 *
 * ## 为什么要过一次 state
 *
 * 跨行块级公式那一层是 `StateField`（§4.2 那条 CM6 硬约束），它拿不到 view，
 * 读不了 `view.hasFocus`。所以把焦点存进 state：一个 ViewPlugin 盯着
 * `focusChanged` 派发 effect，两层都从 state 里读同一个值。
 */
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * 焦点变了。
 *
 * 各层的 `StateField` 靠它知道要重算 —— 那些 field 平时只在文档、选区或解析
 * 推进时重算，而「焦点没了」和「光标移开了」是同一件事，只是信号来自别处。
 */
export const focusChanged = StateEffect.define<boolean>();
const setFocused = focusChanged;

const focusedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) return e.value;
    return value;
  },
});

/**
 * 焦点是不是在正文里。
 *
 * `false` 的默认值是有意的：view 刚建好、用户还没点过的那一刻正是要渲染成
 * 最终形态的时刻。App 随后调 `focus()` 的话，下面那个插件会把它纠正过来。
 */
export function editorFocused(state: EditorState): boolean {
  // 第二个参数是 false = 「这个 field 没装上也别抛」，那时返回 undefined。
  // 源码模式把 PREVIEW 整组摘掉，但 `focusState` 在那一组外面，正常情况下
  // 总是装着的；真没装上时按「有光标」算，退回改动之前的行为
  return state.field(focusedField, false) ?? true;
}

/**
 * 聚焦，并且**立刻**把这件事同步进 state。
 *
 * 「把光标送进某个渲染成 widget 的块」（视图的「看源码」、图表的「编辑」）
 * 必须走它。原因是一条时序：
 *
 * 1. 没有焦点时那个块是渲染态，而渲染态的块是 atomic range；
 * 2. `view.focus()` 之后，状态里那面旗要等下一个微任务才翻过来；
 * 3. 在那之前 dispatch 一个落在块里的选区，CM6 会当场把它弹到块外。
 *
 * 结果就是按钮点下去什么都不发生。先把旗翻了，块退回源码、不再 atomic，
 * 选区才落得进去。
 */
export function focusEditorNow(view: EditorView): void {
  view.focus();
  if (!editorFocused(view.state)) view.dispatch({ effects: focusChanged.of(true) });
}

/**
 * 把 `view.hasFocus` 同步进 state。
 *
 * 用 `queueMicrotask` 派发：CM6 不允许在 `update` 里直接 dispatch
 * （那是在一次更新的中途再开一次更新）。
 */
const focusTracker = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.sync(view);
    }

    update(update: ViewUpdate) {
      // 只在焦点真的变了时才动。每次更新都比一遍的话，输入时会多出一串
      // 什么都不改的空事务
      if (update.focusChanged) this.sync(update.view);
    }

    private sync(view: EditorView) {
      const now = view.hasFocus;
      if (now === editorFocused(view.state)) return;
      queueMicrotask(() => {
        // 这一拍里 view 可能已经销毁，或者焦点又变回去了
        if (view.dom.isConnected && view.hasFocus !== editorFocused(view.state)) {
          view.dispatch({ effects: setFocused.of(view.hasFocus) });
        }
      });
    }
  },
);

export const focusState: Extension = [focusedField, focusTracker];
