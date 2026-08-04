import { describe, expect, it } from "vitest";

import type { DiffHunk, DiffLine } from "../types";
import { mergeChoices } from "./conflictMerge";

/** 按 git 的口径手搓一行 */
const ctx = (text: string, o: number, n: number): DiffLine => ({
  kind: "context",
  oldLine: o,
  newLine: n,
  text,
});
const del = (text: string, o: number): DiffLine => ({
  kind: "deleted",
  oldLine: o,
  newLine: null,
  text,
});
const add = (text: string, n: number): DiffLine => ({
  kind: "added",
  oldLine: null,
  newLine: n,
  text,
});

const hunk = (oldStart: number, oldLines: number, newStart: number, newLines: number, lines: DiffLine[]): DiffHunk => ({
  oldStart,
  oldLines,
  newStart,
  newLines,
  lines,
});

/** 本地 a..i 九行，远端把 b 改成 B、h 改成 H —— 两个互不相邻的 hunk */
const LOCAL = "a\nb\nc\nd\ne\nf\ng\nh\ni";
const TWO_HUNKS: DiffHunk[] = [
  hunk(1, 3, 1, 3, [ctx("a", 1, 1), del("b", 2), add("B", 2), ctx("c", 3, 3)]),
  hunk(7, 3, 7, 3, [ctx("g", 7, 7), del("h", 8), add("H", 8), ctx("i", 9, 9)]),
];

describe("mergeChoices", () => {
  it("全选本地 = 原文一字不动", () => {
    expect(mergeChoices(LOCAL, TWO_HUNKS, ["local", "local"])).toBe(LOCAL);
  });

  it("全选远端 = 远端的样子", () => {
    expect(mergeChoices(LOCAL, TWO_HUNKS, ["remote", "remote"])).toBe(
      "a\nB\nc\nd\ne\nf\ng\nH\ni",
    );
  });

  it("逐段混选：每个 hunk 独立生效，行号不互相踩", () => {
    expect(mergeChoices(LOCAL, TWO_HUNKS, ["remote", "local"])).toBe(
      "a\nB\nc\nd\ne\nf\ng\nh\ni",
    );
    expect(mergeChoices(LOCAL, TWO_HUNKS, ["local", "remote"])).toBe(
      "a\nb\nc\nd\ne\nf\ng\nH\ni",
    );
  });

  it("远端多加了几行：整段替换后行数变化，前面的 hunk 仍然对得上", () => {
    // 远端把 h 改成 H1+H2（一行变两行），同时 b→B。
    const hunks: DiffHunk[] = [
      hunk(1, 3, 1, 3, [ctx("a", 1, 1), del("b", 2), add("B", 2), ctx("c", 3, 3)]),
      hunk(7, 3, 7, 4, [ctx("g", 7, 7), del("h", 8), add("H1", 8), add("H2", 9), ctx("i", 10, 10)]),
    ];
    expect(mergeChoices(LOCAL, hunks, ["remote", "remote"])).toBe(
      "a\nB\nc\nd\ne\nf\ng\nH1\nH2\ni",
    );
  });

  it("纯插入：oldLines 为 0 时插在 oldStart 行之后", () => {
    // 本地 a,b；远端在中间插了 x。git 报 @@ -1,0 +2 @@
    const hunks = [hunk(1, 0, 2, 1, [add("x", 2)])];
    expect(mergeChoices("a\nb", hunks, ["remote"])).toBe("a\nx\nb");
    expect(mergeChoices("a\nb", hunks, ["local"])).toBe("a\nb");
  });

  it("纯删除：选远端后那几行消失", () => {
    const hunks = [hunk(2, 1, 1, 0, [del("b", 2)])];
    expect(mergeChoices("a\nb\nc", hunks, ["remote"])).toBe("a\nc");
  });

  it("文件末尾的换行原样保留", () => {
    const hunks = [hunk(1, 1, 1, 1, [del("a", 1), add("A", 1)])];
    expect(mergeChoices("a\nb\n", hunks, ["remote"])).toBe("A\nb\n");
  });
});
