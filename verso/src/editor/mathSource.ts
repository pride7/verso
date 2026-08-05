import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** 公式所在的引用层数；用语法树判断，避免误删公式里合法的 `>` 关系符。 */
function blockquoteDepthAt(state: EditorState, pos: number): number {
  let depth = 0;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === "Blockquote") depth++;
  }
  return depth;
}

function stripBlockquoteMarkers(state: EditorState, from: number, raw: string): string {
  const depth = blockquoteDepthAt(state, from);
  if (!depth || !raw.includes("\n")) return raw;

  const lines = raw.split("\n");
  // 首行从 `$$` 本身开始，前面的 `>` 不在节点范围内；后续行则仍带物理标记。
  for (let i = 1; i < lines.length; i++) {
    for (let level = 0; level < depth; level++) {
      const marker = /^[\t ]*>[\t ]?/.exec(lines[i]);
      if (!marker) break; // Markdown 允许 lazy continuation，这种行没有可剥的标记
      lines[i] = lines[i].slice(marker[0].length);
    }
  }
  return lines.join("\n");
}

/** 从 Markdown 节点范围中取出真正交给 KaTeX 的源码。 */
export function mathSource(
  state: EditorState,
  from: number,
  to: number,
  display: boolean,
): string {
  const delim = display ? "$$" : "$";
  let raw = state.doc.sliceString(from, to);
  if (display) raw = stripBlockquoteMarkers(state, from, raw);
  if (raw.startsWith(delim)) raw = raw.slice(delim.length);
  // 正在输入的块公式可以没有闭合符，不能把正文末尾两个字符当成 `$$` 删掉。
  if (raw.endsWith(delim)) raw = raw.slice(0, -delim.length);
  return raw.trim();
}
