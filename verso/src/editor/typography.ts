/**
 * 中西文混排间距。DESIGN.md §4.3 的 `typography` 扩展、§6.1 的排版尺度。
 *
 * 算法在 `lib/hanspace.ts` 里（纯函数、可在 Node 里穷举着测），这里只负责
 * 两件事：**该跳过哪些地方**，以及把结果变成 decoration。
 *
 * ## 只改显示
 *
 * 绝不往 `.md` 里写空格 —— 那是替用户改内容（§0 第 1 条）。这里给每段挨着
 * 中文的西文加一个左/右外边距，复制出去仍然是原文，一个空格都不多。
 *
 * ## 哪些地方不能加
 *
 * 代码、公式、链接目标 —— 它们里面的「中英相邻」是**字面量**，撑开一个
 * 空隙只会让人以为那里真有个空格。行内代码 `变量name` 尤其明显。
 *
 * ## 为什么是 ViewPlugin
 *
 * 只扫可视区（§4.2 的性能红线）。这里产出的全是行内 mark，不跨行，
 * ViewPlugin 里完全合法（那条硬约束只挡跨行的 replace 和块级装饰）。
 */
import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { latinRuns } from "../core/hanspace";
import { compositionActive } from "./compositionGuard";

const both = Decoration.mark({ class: "cm-hs cm-hs-l cm-hs-r" });
const left = Decoration.mark({ class: "cm-hs cm-hs-l" });
const right = Decoration.mark({ class: "cm-hs cm-hs-r" });

/**
 * 这些节点里的文字原样不动。
 *
 * `CodeText` / `InlineCode` 是代码，`URL` / `WikiLinkTarget` 是路径 ——
 * 它们里面的中英相邻是字面量。公式走 `versoTags.math`，节点名是 InlineMath /
 * BlockMath。
 */
const OPAQUE = new Set([
  "InlineCode",
  "CodeText",
  "FencedCode",
  "CodeBlock",
  "URL",
  "LinkTitle",
  "InlineMath",
  "BlockMath",
  "WikiLinkTarget",
  "Comment",
  "CommentBlock",
  "HTMLTag",
  "HTMLBlock",
]);

function build(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const { state } = view;

  for (const { from, to } of view.visibleRanges) {
    // 先收集这一段里所有「原样不动」的区间
    const skip: [number, number][] = [];
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (!OPAQUE.has(node.name)) return;
        skip.push([node.from, node.to]);
        return false;
      },
    });
    const opaque = (a: number, b: number) => skip.some(([s, e]) => a < e && b > s);

    let n = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    for (; n <= last; n++) {
      const line = state.doc.line(n);
      if (!line.text) continue;
      for (const g of latinRuns(line.text)) {
        const a = line.from + g.from;
        const b = line.from + g.to;
        if (opaque(a, b)) continue;
        marks.push((g.left && g.right ? both : g.left ? left : right).range(a, b));
      }
    }
  }

  // mark 必须按位置递增添加
  marks.sort((x, y) => x.from - y.from || x.to - y.to);
  return Decoration.set(marks, true);
}

class Typography implements PluginValue {
  decorations: DecorationSet;

  /** 上一次更新时输入法是不是正在组词 */
  private composing = false;

  constructor(view: EditorView) {
    this.decorations = build(view);
  }

  update(u: ViewUpdate) {
    // 拼音本身也是西文。这里如果照常加 `.cm-hs`，会把 WebKit 正在维护的
    // marked text 换成一层 span：拼音因此固化，候选汉字只能追加在后面。
    // 组词结束那一拍再按最终汉字重建，期间一个 DOM 节点都不换。
    if (compositionActive(u.view)) {
      this.composing = true;
      return;
    }
    const ended = this.composing;
    this.composing = false;
    // 选区变化不影响它 —— 这一层和光标在哪无关，不像别的 live preview
    if (ended || u.docChanged || u.viewportChanged) this.decorations = build(u.view);
  }
}

export const typography: Extension = ViewPlugin.fromClass(Typography, {
  decorations: (v) => v.decorations,
});
