/**
 * `Shift+Enter` 的段内换行。DESIGN.md §6.1。
 *
 * Markdown 的单个源码换行通常会被渲染器折叠为空格；行尾两个空格才是标准硬换行。
 * 因此这里写入 `  \n`，而不是只让按键看起来有反应。文件拿到 Obsidian、GitHub
 * 或其他 Markdown 渲染器中，段内换行语义仍然存在。
 */
import { syntaxTree } from "@codemirror/language";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const LITERAL_BLOCKS = new Set([
  "FencedCode",
  "CodeBlock",
  "BlockMath",
  "HTMLBlock",
  "CommentBlock",
]);

function insideLiteralBlock(node: SyntaxNode | null): boolean {
  for (let current = node; current; current = current.parent) {
    if (LITERAL_BLOCKS.has(current.name)) return true;
  }
  return false;
}

/** 新行延续引用标记；列表则以内容列对齐，但不创建新的项目符号。 */
export function continuationPrefix(beforeCursor: string): string {
  const leading = /^[ \t]*/.exec(beforeCursor)?.[0] ?? "";
  let rest = beforeCursor.slice(leading.length);
  let prefix = leading;

  const quote = /^(?:>[ \t]?)+/.exec(rest)?.[0] ?? "";
  prefix += quote;
  rest = rest.slice(quote.length);

  const list = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(rest)?.[0];
  if (list) prefix += " ".repeat(list.length);
  return prefix;
}

export const insertMarkdownLineBreak: Command = (view) => {
  const { state } = view;

  // 代码与块级公式里的空格是内容，不能为了 Markdown 换行语义擅自加两个。
  // 多光标只要有一个落在字面块中，就交回 CM6 的普通换行，避免一次输入产生
  // 两套不同的行为。
  const inLiteral = state.selection.ranges.some((range) =>
    insideLiteralBlock(syntaxTree(state).resolveInner(range.head, -1)),
  );
  if (inLiteral) return insertNewlineAndIndent(view);

  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const before = line.text.slice(0, range.from - line.from);
    // 行尾已有空格时先归一化，避免反复 Shift+Enter 留下一串不可见空白。
    const trailing = /[ \t]*$/.exec(before)?.[0].length ?? 0;
    const from = range.from - trailing;
    const insert = `  \n${continuationPrefix(before.slice(0, before.length - trailing))}`;
    return {
      changes: { from, to: range.to, insert },
      range: EditorSelection.cursor(from + insert.length),
    };
  });

  view.dispatch({ ...spec, scrollIntoView: true });
  return true;
};
