import { describe, expect, it } from "vitest";

import { fuzzyMatch, rankNotes } from "../../../src/core/fuzzy";

const notes = [
  { name: "线性代数", path: "数学/线性代数.md" },
  { name: "奇异值分解", path: "数学/线性代数/奇异值分解.md" },
  { name: "特征值", path: "数学/线性代数/特征值.md" },
  { name: "泛函分析", path: "数学/泛函分析.md" },
  { name: "linear-algebra", path: "notes/linear-algebra.md" },
  { name: "日记 2026-07-31", path: "日记/2026-07-31.md" },
];

const top = (q: string) => rankNotes(notes, q)[0]?.item.name;

describe("fuzzyMatch", () => {
  it("匹配子序列并返回命中位置", () => {
    const r = fuzzyMatch("linear-algebra", "lalg");
    expect(r).not.toBeNull();
    // 贪心取每个字符的**最早**出现位置：'a' 命中的是 "line[a]r" 而不是
    // "[a]lgebra"。最优匹配（Smith-Waterman 那类）会选后者、高亮更好看，
    // 但代价是 O(n·m)。排序结果一样，所以不值得。
    expect(r!.positions).toEqual([0, 4, 8, 9]);
  });

  it("匹配不上返回 null", () => {
    expect(fuzzyMatch("线性代数", "泛函")).toBeNull();
  });

  it("空查询匹配一切", () => {
    expect(fuzzyMatch("任意", "")).toEqual({ score: 0, positions: [] });
  });

  it("大小写不敏感", () => {
    expect(fuzzyMatch("Linear Algebra", "la")).not.toBeNull();
  });

  it("连续命中比分散命中得分高", () => {
    const dense = fuzzyMatch("abcdef", "abc")!;
    const sparse = fuzzyMatch("axbxcx", "abc")!;
    expect(dense.score).toBeGreaterThan(sparse.score);
  });

  it("命中词首比命中词中得分高", () => {
    const boundary = fuzzyMatch("foo-bar", "b")!;
    const middle = fuzzyMatch("foobar", "b")!;
    expect(boundary.score).toBeGreaterThan(middle.score);
  });
});

describe("rankNotes", () => {
  it("中文两三个字直达", () => {
    expect(top("特征")).toBe("特征值");
    expect(top("奇异")).toBe("奇异值分解");
    expect(top("泛函")).toBe("泛函分析");
  });

  it("英文缩写直达", () => {
    expect(top("lalg")).toBe("linear-algebra");
  });

  /** 名字命中必须排在「只有路径命中」的前面 */
  it("名字优先于路径", () => {
    // "线性代数" 是一篇笔记的名字，同时是另外两篇的路径的一部分
    expect(top("线性代数")).toBe("线性代数");
  });

  it("支持用空格分段写路径", () => {
    expect(top("数学 特征")).toBe("特征值");
  });

  it("空查询返回全部（截断到 limit）", () => {
    expect(rankNotes(notes, "")).toHaveLength(notes.length);
    expect(rankNotes(notes, "", 2)).toHaveLength(2);
  });

  it("匹配不到返回空", () => {
    expect(rankNotes(notes, "zzzzz")).toEqual([]);
  });

  it("尊重 limit", () => {
    expect(rankNotes(notes, "数", 2).length).toBeLessThanOrEqual(2);
  });
});
