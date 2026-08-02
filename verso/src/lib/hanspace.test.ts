import { describe, expect, it } from "vitest";

import { latinRuns } from "./hanspace";

/** 把结果画成 `中文‹Latin›中文` 的样子，断言读起来才像人话 */
function mark(text: string): string {
  let out = "";
  let at = 0;
  for (const g of latinRuns(text)) {
    out += text.slice(at, g.from) + (g.left ? "‹" : "") + text.slice(g.from, g.to) + (g.right ? "›" : "");
    at = g.to;
  }
  return out + text.slice(at);
}

describe("中西文边界", () => {
  it("两边都挨着中文", () => {
    expect(mark("用 Golub 双对角化")).toBe("用 Golub 双对角化"); // 本来就有空格，不算边界
    expect(mark("用Golub双对角化")).toBe("用‹Golub›双对角化");
  });

  it("只挨一边", () => {
    expect(mark("Golub双对角化")).toBe("Golub›双对角化");
    expect(mark("双对角化Golub")).toBe("双对角化‹Golub");
  });

  it("数字也算西文", () => {
    expect(mark("第3章")).toBe("第‹3›章");
    expect(mark("难度4分")).toBe("难度‹4›分");
  });

  it("纯英文段落一个装饰都不产生", () => {
    expect(latinRuns("The quick brown fox jumps.")).toEqual([]);
  });

  it("纯中文也是", () => {
    expect(latinRuns("这是一段纯中文。")).toEqual([]);
  });

  it("中文标点旁边不加 —— 它自己就带着留白", () => {
    // `（Golub）` 再撑开会豁出一个大口子
    expect(latinRuns("（Golub）")).toEqual([]);
    expect(latinRuns("见「SVD」一节")).toEqual([]);
    expect(mark("这是SVD。")).toBe("这是‹SVD。");
  });

  it("假名和谚文同样算中文侧", () => {
    expect(mark("これはSVDです")).toBe("これは‹SVD›です");
  });

  it("一行里的多段各算各的", () => {
    const gaps = latinRuns("用SVD分解A矩阵");
    expect(gaps).toHaveLength(2);
    expect(gaps.map((g) => [g.left, g.right])).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it("范围是相对这一行的偏移", () => {
    const [g] = latinRuns("第3章");
    expect([g.from, g.to]).toEqual([1, 2]);
  });
});
