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

export const parseRefresh: Extension = ViewPlugin.fromClass(
  class {
    tree: Tree;

    constructor(view: EditorView) {
      this.tree = syntaxTree(view.state);
      // **构造时必须无条件刷新一次。**
      //
      // 时序是这样的：`EditorState.create` 先跑，那时 view 还不存在、
      // 文档尚未解析，StateField 的 `create()` 拿到空树、算不出任何
      // decoration；等 view 建好、解析完成，ViewPlugin 才被构造 —— 此时
      // 树已经是最终形态，之后再也不会「变化」，只靠比较就永远不会触发。
      //
      // 症状正是：打开笔记看到的是源码，随便点一下（产生选区变化）
      // 才突然渲染出来。
      queueMicrotask(() => {
        if (view.dom.isConnected) view.dispatch({ effects: parseAdvanced.of(null) });
      });
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
