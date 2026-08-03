/**
 * 普通回车与段内换行的视觉层级。DESIGN.md §6.1。
 *
 * 同一个顶层 Paragraph 中，普通源码换行来自 Enter，在两行之间放一个很薄的
 * block widget；以两个空格或反斜杠结尾的是 Markdown 硬换行（Shift+Enter），
 * 不加段落留白。浏览器自动折行不产生源码行，自然也不会命中。
 *
 * 不能再给 `.cm-line` 加 padding：文字行盒变高后，CM6 的光标层与实际字形可能
 * 使用不同的垂直基准。block widget 是高度图原生支持的独立块，既能撑开段落，
 * 又不改变光标所在的文字行。
 */
import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { parseAdvanced } from "./parseRefresh";

class ParagraphSpaceWidget extends WidgetType {
  toDOM() {
    const dom = document.createElement("div");
    dom.className = "cm-paragraph-space";
    dom.setAttribute("aria-hidden", "true");
    return dom;
  }

  ignoreEvent() {
    return true;
  }
}

const paragraphSpace = Decoration.widget({
  widget: new ParagraphSpaceWidget(),
  block: true,
  side: 1,
});

function isHardBreak(line: string): boolean {
  return /(?: {2,}|\\)$/.test(line);
}

function topLevelParagraphAt(state: EditorState, position: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1);
  for (; node; node = node.parent) {
    if (node.name === "Paragraph") return node.parent?.name === "Document";
  }
  return false;
}

function build(state: EditorState): DecorationSet {
  const marks: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Paragraph" || node.node.parent?.name !== "Document") return;

      const first = state.doc.lineAt(node.from).number;
      const last = state.doc.lineAt(node.to).number;
      for (let n = first; n < last; n++) {
        const line = state.doc.line(n);
        if (!isHardBreak(line.text)) marks.push(paragraphSpace.range(line.to));
      }
      return false;
    },
  });

  // 刚按下 Enter 时，新行还没有文字，Markdown 解析树里也就还没有第二段。
  // 如果等首字输入后才补 widget，那一行会在输入瞬间向下跳。只要光标位于
  // 紧跟顶层正文的空行，就提前预留同一份高度；文末和文中插段都走这条。
  const provisional = new Set<number>();
  for (const range of state.selection.ranges) {
    const blank = state.doc.lineAt(range.head);
    if (blank.text.trim() || blank.number <= 1) continue;
    const previous = state.doc.line(blank.number - 1);
    if (
      previous.text.trim() &&
      !isHardBreak(previous.text) &&
      topLevelParagraphAt(state, previous.from) &&
      !provisional.has(previous.to)
    ) {
      provisional.add(previous.to);
      marks.push(paragraphSpace.range(previous.to));
    }
  }

  return RangeSet.of(marks, true);
}

const paragraphSpacingField = StateField.define<DecorationSet>({
  create: build,
  update(decorations, transaction) {
    const parsed = transaction.effects.some((effect) => effect.is(parseAdvanced));
    if (!transaction.docChanged && !transaction.selection && !parsed) {
      return decorations.map(transaction.changes);
    }
    return build(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** parseRefresh 由同属 PREVIEW 的 codeBlocks 提供，解析推进后会通知本字段重算。 */
export const paragraphSpacing: Extension = paragraphSpacingField;
