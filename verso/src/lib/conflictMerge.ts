/**
 * 冲突定稿的拼装。§2.8 冲突 UI。
 *
 * diff 的方向固定是「old = 本地，new = 远端」。用户对每个 hunk 选边：
 * 选「本地」= 这一段维持原样；选「远端」= 用本地全文里对应的行区间换成
 * 远端那几行。**基底永远是本地全文** —— hunk 之间的未变部分不在 patch
 * 里（Git 只带 3 行上下文），只有拿全文当底才不丢内容。
 *
 * 纯函数，脱离 DOM 可测 —— 行号算错一行，拼出来的定稿就是坏文档，
 * 这里必须钉死。
 */
import type { DiffHunk } from "../types";

export type HunkChoice = "local" | "remote";

/**
 * 按选择拼出定稿。
 *
 * Git hunk 的行号规矩（1 起）：
 *   - `oldLines > 0`：从 `oldStart` 行起、共 `oldLines` 行是本地被动到的区间
 *   - `oldLines === 0`：纯插入，插在 `oldStart` 行**之后**
 *
 * 从后往前替换，前面的行号才不会被后面的改动挪动。
 */
export function mergeChoices(
  localText: string,
  hunks: DiffHunk[],
  choices: HunkChoice[],
): string {
  const lines = localText.split("\n");

  // 从后往前。hunks 本身按位置升序（git 的产出顺序）
  for (let i = hunks.length - 1; i >= 0; i -= 1) {
    if (choices[i] !== "remote") continue;
    const hunk = hunks[i];
    const remoteLines = hunk.lines.filter((l) => l.kind !== "deleted").map((l) => l.text);
    const localCovered = hunk.lines.filter((l) => l.kind !== "added").length;
    // 纯插入时 oldStart 是「插在它之后」，其余情况 oldStart 是首行行号。
    // 用 hunk 里实际的行数（context + deleted）而不是 oldLines —— 语义相同，
    // 但和 remoteLines 来自同一份数据，不会因两处口径不一致而错位
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    lines.splice(start, localCovered, ...remoteLines);
  }
  return lines.join("\n");
}
