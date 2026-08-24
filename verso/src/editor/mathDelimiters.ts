/** LaTeX 数学定界符的编辑器接线：自动处理粘贴，并给命令面板提供转换事务。 */
import { markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Tree } from "@lezer/common";

import {
  convertLatexMathDelimiters,
  latexMathDelimiterChanges,
  layoutBlockMath,
  lineAcceptsBlockMath,
  type TextRange,
} from "../core/mathDelimiters";

const CODE_NODES = new Set(["InlineCode", "CodeText", "FencedCode", "CodeBlock"]);

function codeRanges(tree: Tree, from = 0, to = tree.length, offset = 0): TextRange[] {
  const ranges: TextRange[] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (!CODE_NODES.has(node.name)) return;
      ranges.push({ from: Math.max(node.from, from) - offset, to: Math.min(node.to, to) - offset });
      return false;
    },
  });
  return ranges;
}

export function pointInCode(state: EditorState, at: number): boolean {
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  return codeRanges(tree).some((range) => at >= range.from && at < range.to);
}

/** 右键菜单与原生粘贴共用：代码里保留原文，粘贴内容自己的代码段也不转换。 */
export function pastedMathText(state: EditorState, text: string): { text: string; count: number } {
  const selection = state.selection.main;
  if (pointInCode(state, selection.from)) return { text, count: 0 };
  const pastedTree = markdownLanguage.parser.parse(text);
  const converted = convertLatexMathDelimiters(text, codeRanges(pastedTree));
  return { text: withBlockMathLayout(state, converted.text), count: converted.count };
}

/**
 * 块公式排成独占几行 —— **落点所在的那一行也要算进来**。光标停在一段话
 * 中间时，粘贴内容开头的 `$$` 接在那段话后面就不在行首了；行尾同理。
 *
 * 光标本来就在列表项、引用或表格行里时整段不排：那些结构靠行首的标记维持，
 * 从中间断一行，公式没排好，原来的结构也散了。
 */
function withBlockMathLayout(state: EditorState, text: string): string {
  const selection = state.selection.main;
  const head = state.doc.lineAt(selection.from);
  const before = state.doc.sliceString(head.from, selection.from);
  if (!lineAcceptsBlockMath(before)) return text;

  const laid = layoutBlockMath(text, codeRanges(markdownLanguage.parser.parse(text)));
  const after = state.doc.sliceString(selection.to, state.doc.lineAt(selection.to).to);
  const open = laid.startsWith("$$\n") && before.trim() ? "\n" : "";
  const close = laid.endsWith("\n$$") && after.trim() ? "\n" : "";
  return `${open}${laid}${close}`;
}

export function mathDelimiterPaste() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return false;
      const converted = pastedMathText(view.state, text);
      // 定界符没换、块公式也不用重排时把粘贴还给默认实现，别白占一次事务。
      if (converted.text === text) return false;

      event.preventDefault();
      const selection = view.state.selection.main;
      // 光标按 `Text` 算：CRLF 存进文档只剩一个 `\n`，按原串长度会越界。
      // 理由见 richPaste.ts 的 `insert`
      const inserted = view.state.toText(converted.text);
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: inserted },
        selection: { anchor: selection.from + inserted.length },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      return true;
    },
  });
}

/** 选区优先；没有选区时处理整篇。返回 null 表示没有可转换的定界符。 */
export function mathDelimiterConversion(
  state: EditorState,
): { spec: TransactionSpec; count: number } | null {
  const selection = state.selection.main;
  const from = selection.empty ? 0 : selection.from;
  const to = selection.empty ? state.doc.length : selection.to;
  const text = state.doc.sliceString(from, to);
  const tree = ensureSyntaxTree(state, to, 50) ?? syntaxTree(state);
  const blocked = codeRanges(tree, from, to, from);
  const changes = latexMathDelimiterChanges(text, blocked);
  if (!changes.length) return null;
  return {
    spec: {
      changes: changes.map((change) => ({
        from: from + change.from,
        to: from + change.to,
        insert: change.insert,
      })),
      userEvent: "input.math-delimiters",
      scrollIntoView: true,
    },
    count: changes.length / 2,
  };
}
