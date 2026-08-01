/**
 * 数学模式检测。DESIGN.md §5.2
 *
 * 单独成一个模块，是为了让 `editor/index.ts` 和 `editor/snippets/` 都能用它
 * 而不互相 import 成环。
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface MathContext {
  kind: "inline" | "block";
  from: number;
  to: number;
  /** 公式尚未闭合（正在输入中）。此时 `to` 只是当前光标位置 */
  open?: boolean;
}

const CODE_NODES = new Set(["InlineCode", "CodeText", "FencedCode", "CodeBlock"]);

/**
 * 判断光标是否在公式内。
 *
 * ## 为什么不能只看语法树
 *
 * §5.2 原本写的是「查语法树，不要数 `$` 的个数」，理由是数 `$` 会被行内代码、
 * 代码块、转义 `\$` 骗到。那条理由成立，但语法树有个它自己解决不了的问题：
 *
 * **正在输入中的公式是未闭合的。** 敲下 `$` 之后、敲下配对的 `$` 之前，
 * 文档里只有一个孤零零的 `$`，解析器不会（也不该）为它建出 InlineMath 节点。
 * 而 snippet 恰恰要在这个时刻工作 —— 打 `$` 然后 `//`，此刻正是最需要
 * 判断「我在公式里」的时候。
 *
 * ## 混合方案
 *
 * 1. 语法树命中已闭合的公式 → 直接返回（最可靠）
 * 2. 语法树说这里是代码 → 一定不是公式（**这一步把数 `$` 的主要错源排除掉了**）
 * 3. 都不是 → 在本行内数未转义、且不在代码里的 `$`，奇数即在公式中
 *
 * 第 2 步是关键：它让第 3 步的「数 `$`」变得安全 —— 原先反对数 `$` 的
 * 理由（代码里的 `$PATH`、代码块里的 `$x`）已经在上一步被挡掉了。
 *
 * 残留的取舍：`$5 起，精装 $20` 这类货币写法，在两个金额之间光标处会被
 * 判成「在公式里」。这只影响 snippet 要不要触发，不影响渲染（live preview
 * 仍然按语法树走，不会把那段文字渲染成公式）。Obsidian 也是这个行为。
 */
export function mathContextAt(state: EditorState, pos: number): MathContext | null {
  const tree = syntaxTree(state);

  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (node.name === "InlineMath") return { kind: "inline", from: node.from, to: node.to };
    if (node.name === "BlockMath") return { kind: "block", from: node.from, to: node.to };
    if (CODE_NODES.has(node.name)) return null;
  }

  return openInlineMathAt(state, pos);
}

/** 本行里落在代码节点内的区间 —— 数 `$` 时要跳过它们 */
function codeRanges(state: EditorState, from: number, to: number): [number, number][] {
  const ranges: [number, number][] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(n) {
      if (CODE_NODES.has(n.name)) ranges.push([n.from, n.to]);
    },
  });
  return ranges;
}

/**
 * 从行首数到光标：未转义且不在代码里的 `$` 是奇数个，就说明有一个公式
 * 还开着。
 *
 * 只在本行内数 —— 行内公式不该跨行，而块级公式（`$$`）即使未闭合也已经被
 * 解析器建成了 BlockMath 节点（§2.4 里那条「没闭合也收尾到文末」正是为此），
 * 走不到这里。
 */
function openInlineMathAt(state: EditorState, pos: number): MathContext | null {
  const line = state.doc.lineAt(pos);
  const text = state.doc.sliceString(line.from, pos);
  const code = codeRanges(state, line.from, pos);
  const inCode = (abs: number) => code.some(([a, b]) => abs >= a && abs < b);

  let count = 0;
  let lastOpen = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$") continue;
    // `\$` 是转义的美元符号。连续反斜杠按奇偶判断
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 1) continue;
    if (inCode(line.from + i)) continue;

    count++;
    if (count % 2 === 1) lastOpen = line.from + i;
  }

  if (count % 2 === 0) return null;
  return { kind: "inline", from: lastOpen, to: pos, open: true };
}
