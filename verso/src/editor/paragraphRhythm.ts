/**
 * 正文段落节奏。DESIGN.md §6.1。
 *
 * CodeMirror 的一条 `.cm-line` 对应文档中的一行；浏览器自动折行仍留在同一个
 * 元素里。因此可以只给用户显式回车产生的正文行增加下方留白，而不把长句内部
 * 的自动折行一并拉开。
 *
 * Markdown 把单次换行视为同一 Paragraph 内的软换行，但在笔记编辑器里，用户
 * 按下回车通常就是在开始下一段。这里仅改变显示，不向 `.md` 写入额外空行。
 */
import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const paragraphBreak = Decoration.line({ class: "cm-paragraph-break" });
const paragraphGap = Decoration.line({ class: "cm-paragraph-gap" });

/** 这些块内部的空行属于内容本身，不能收成正文段间距。 */
const VERBATIM_BLOCKS = new Set([
  "FencedCode",
  "CodeBlock",
  "BlockMath",
  "HTMLBlock",
  "CommentBlock",
]);

function ancestor(node: SyntaxNode | null, name: string): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === name) return current;
  }
  return null;
}

function insideVerbatimBlock(node: SyntaxNode | null): boolean {
  for (let current = node; current; current = current.parent) {
    if (VERBATIM_BLOCKS.has(current.name)) return true;
  }
  return false;
}

/**
 * 只收紧夹在内容之间的空行。文首、文末的空行仍保留正常高度，否则光标会落在
 * 一条过窄的点击区域里；连续空行则逐条保留，用户刻意留下的额外间隔不会丢失。
 */
function boundedBlankLine(view: EditorView, lineNumber: number): boolean {
  const { doc } = view.state;
  if (lineNumber <= 1 || lineNumber >= doc.lines) return false;

  let before = lineNumber - 1;
  while (before >= 1 && !doc.line(before).text.trim()) before--;
  let after = lineNumber + 1;
  while (after <= doc.lines && !doc.line(after).text.trim()) after++;
  return before >= 1 && after <= doc.lines;
}

function build(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const seen = new Set<string>();
  const { state } = view;
  const tree = syntaxTree(state);

  for (const range of view.visibleRanges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;

    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      const node = tree.resolveInner(line.from, 1);

      if (!line.text.trim()) {
        if (!insideVerbatimBlock(node) && boundedBlankLine(view, n)) {
          const key = `gap:${line.from}`;
          if (!seen.has(key)) {
            seen.add(key);
            marks.push(paragraphGap.range(line.from));
          }
        }
        continue;
      }

      // 只处理文档顶层正文。列表、引用和脚注里的 Paragraph 有自己的紧凑节奏。
      const paragraph = ancestor(node, "Paragraph");
      if (!paragraph || paragraph.parent?.name !== "Document") continue;

      // 同一个 Paragraph 中的下一条源码行来自用户显式回车；自动折行不会增加
      // 文档行，因此不会走到这里。
      const paragraphLastLine = state.doc.lineAt(paragraph.to).number;
      if (n >= paragraphLastLine) continue;

      const key = `break:${line.from}`;
      if (!seen.has(key)) {
        seen.add(key);
        marks.push(paragraphBreak.range(line.from));
      }
    }
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(marks, true);
}

class ParagraphRhythm implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = build(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
  }
}

export const paragraphRhythm: Extension = ViewPlugin.fromClass(ParagraphRhythm, {
  decorations: (value) => value.decorations,
});
