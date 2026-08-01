/**
 * 解析推进时通知块级 decoration 重算。
 *
 * ## 要解决的问题
 *
 * 块级 decoration（跨行公式、database 视图）只能来自 StateField（§4.2 的
 * CM6 硬约束）。但 StateField 有个致命的时序问题：
 *
 * **`EditorState.create` 的那一刻，文档还没有被解析。** CM6 的解析是在
 * view 建立之后异步进行的，所以 field 的 `create()` 里 `syntaxTree(state)`
 * 拿到的是空树，算不出任何 decoration。而 field 只在 `docChanged` 或选区
 * 变化时重算 —— 于是打开一篇笔记，公式和 database 视图都是源码，
 * **要等用户点一下（产生选区变化）才突然渲染出来**。
 *
 * ## 为什么不能在 StateField 里判断
 *
 * 试过两次都失败：
 *   - 在 `update` 里比较 `syntaxTree(tr.state) !== syntaxTree(tr.startState)`
 *   - 在 `build()` 里用 `ensureSyntaxTree` 强制解析
 *
 * 两者都不可靠 —— StateField 的更新顺序不保证语言字段已经为新 state
 * 更新完，那时读到的是空树，结果是**每次都算出空的 decoration 集**，
 * 视图不是晚出现而是彻底消失。
 *
 * ## 正确的做法
 *
 * 用 ViewPlugin 监测语法树变化。ViewPlugin 的 `update` 在整个 state
 * （含语言字段）都更新完之后才跑，那里读语法树是可靠的。发现树变了就
 * 派发一个空事务带上 `parseAdvanced` effect，StateField 收到就重算。
 */
import { syntaxTree } from "@codemirror/language";
import { StateEffect, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";

/** 语法树推进了。块级 decoration 的 StateField 应当在收到它时重算。 */
export const parseAdvanced = StateEffect.define<null>();

/**
 * 在几个时间点各刷一次，覆盖「解析还没开始」到「解析早就完成」之间的
 * 所有可能。刷新本身极轻（只是让一个 StateField 重算），多刷几次无所谓。
 */
function scheduleRefresh(view: EditorView) {
  const fire = () => {
    if (view.dom.isConnected) view.dispatch({ effects: parseAdvanced.of(null) });
  };
  queueMicrotask(fire);
  requestAnimationFrame(fire);
  setTimeout(fire, 60);
  setTimeout(fire, 300);
}

export const parseRefresh: Extension = ViewPlugin.fromClass(
  class {
    tree: Tree;

    constructor(view: EditorView) {
      this.tree = syntaxTree(view.state);
      // **构造时必须主动刷新，而且要重试几次。**
      //
      // 时序是这样的：`EditorState.create` 先跑，那时 view 还不存在、
      // 文档尚未解析，StateField 的 `create()` 拿到空树、算不出任何
      // decoration。等 view 建好，CM6 才**异步**开始解析。
      //
      // 只在构造时刷一次是不够的 —— 那一刻解析可能还没开始，刷了也是空的；
      // 而如果解析恰好已经完成，树此后就不再「变化」，靠比较也永远不会触发。
      // 两头都可能落空，所以在几个时间点各补一次，直到看到树真的有内容。
      //
      // 症状正是：打开笔记看到的是源码，随便点一下（产生选区变化）
      // 才突然渲染出来。
      scheduleRefresh(view);
    }

    update(update: ViewUpdate) {
      const next = syntaxTree(update.state);
      if (next === this.tree) return;
      this.tree = next;
      // 不能在 update 里同步 dispatch —— CM6 明确禁止。放到微任务里。
      queueMicrotask(() => {
        if (!update.view.dom.isConnected) return;
        update.view.dispatch({ effects: parseAdvanced.of(null) });
      });
    }
  },
);
