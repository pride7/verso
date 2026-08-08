/**
 * 段落设置：把选中的这几行**换成**标题 / 引用 / 列表。DESIGN.md §4.10
 *
 * 和 `/` 菜单的区别是「换」与「插」：`/` 菜单在光标处插一段新文本（`# `），
 * 而这里改的是**已经写好的那几行** —— 写完一段回头想把它变成引用，是写作里
 * 最常见的动作之一，而它此前在 Verso 里只能手动删前缀再打新的。
 *
 * 纯函数写在这里、由 `toggleBlockSpec` 组装成一次 dispatch，理由和
 * `format.ts` 一样：判定规则能在 Node 里穷举着测，CM6 那层只剩组装。
 */
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

export type BlockKind = "text" | "h1" | "h2" | "h3" | "quote" | "bullet" | "number" | "task";

/**
 * 行首那截标记。
 *
 * 顺序有讲究：**待办要排在无序列表前面** —— `- [ ] x` 同时满足两条，先匹配
 * 到无序列表的话，「取消待办」会只删掉 `- ` 留下一个 `[ ] `。
 */
const MARK_RE =
  /^(\s*)(?:(#{1,6})[ \t]+|(>[ \t]?)|([-*+][ \t]+\[[ xX]\][ \t]*)|([-*+][ \t]+)|(\d+[.)][ \t]+))?/;

/** 这一行现在是哪种块。认不出来的（包括四到六级标题）一律算正文 */
export function blockKindOf(line: string): BlockKind {
  const m = MARK_RE.exec(line);
  if (!m) return "text";
  const [, , hashes, quote, task, bullet, number] = m;
  if (hashes) return hashes.length <= 3 ? (`h${hashes.length}` as BlockKind) : "text";
  if (quote) return "quote";
  if (task) return "task";
  if (bullet) return "bullet";
  if (number) return "number";
  return "text";
}

/** 去掉行首标记，留下缩进和正文 */
export function stripBlock(line: string): { indent: string; text: string } {
  const m = MARK_RE.exec(line)!;
  return { indent: m[1] ?? "", text: line.slice(m[0].length) };
}

/**
 * 把一行改成某种块。`index` 是它在这次选中的第几行 —— 有序列表要靠它编号，
 * 一段五行的文字变成有序列表时要得到 1..5，不是五个 1。
 */
export function applyBlock(line: string, kind: BlockKind, index = 0): string {
  const { indent, text } = stripBlock(line);
  const mark =
    kind === "text"
      ? ""
      : kind === "quote"
        ? "> "
        : kind === "bullet"
          ? "- "
          : kind === "task"
            ? "- [ ] "
            : kind === "number"
              ? `${index + 1}. `
              : `${"#".repeat(Number(kind.slice(1)))} `;
  return indent + mark + text;
}

/**
 * 把选中的那几行换成 `kind`。
 *
 * **已经全是这一种就再变回正文** —— 和行内格式的开关语义一致：点「引用」
 * 把一段变成引用，再点一次撤回去，不必去找一条「清除格式」。只有部分行是
 * 这一种时按「全都变成它」处理（那才是人的意图）。
 */
export function toggleBlockSpec(state: EditorState, kind: BlockKind): TransactionSpec {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;

  const lines = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n));

  const target = lines.every((l) => blockKindOf(l.text) === kind) ? "text" : kind;
  return {
    changes: lines.map((line, i) => ({
      from: line.from,
      to: line.to,
      insert: applyBlock(line.text, target, i),
    })),
    // 选区跟着改动自己映射（CM6 会做），但**光标要落在正文里**：
    // 空行上加「# 」之后光标应该在井号后面等着打字，而不是行首
    selection:
      from === to
        ? EditorSelection.cursor(
            Math.max(0, from + applyBlock(lines[0].text, target).length - lines[0].text.length),
          )
        : undefined,
    userEvent: "input.block",
    scrollIntoView: true,
  };
}
