import { describe, expect, it } from "vitest";

import { DEFAULT_SNIPPETS } from "../../../../src/core/snippets/defaults";
import { hintsFor } from "../../../../src/core/snippets/hint";
import { compileAll, type SnippetSpec } from "../../../../src/core/snippets/types";

const ALL = compileAll(DEFAULT_SNIPPETS);

/** 模拟「在数学模式里打到 textBefore」，返回会列出来的触发词 */
function hint(textBefore: string, inMath = true): string[] {
  return hintsFor(ALL, textBefore, inMath).map((h) => h.snippet.trigger);
}

describe("打字提示：列出还差几个字符的 snippet", () => {
  it("打前缀就列出能接下去的那几条", () => {
    // 同长度按库里的顺序，于是 `sum` 这类常用的排在前面
    expect(hint("x = su")).toEqual(["sum", "sub", "sup", "sube"]);
    expect(hint("no")).toEqual(["norm", "notex"]);
  });

  it("短的排前面 —— 它先打完，也更可能是想要的那条", () => {
    const lr = hint("lr");
    expect(lr[0]).toBe("lr(");
    expect(lr).toContain("lr|");
    expect(hint("ab")).toEqual(["abs"]);
  });

  it("只认最长的前缀，不退回去凑更短的", () => {
    // "int" 里的 "in" 已经能匹配 int/iint…，不该再退回单个 "i"
    expect(hint("x di")).toEqual(["dint"]);
  });

  /** 一吵就会被关掉，所以宁可少弹（§5.3） */
  describe("不吵", () => {
    it("单个字母不弹 —— 公式里每个变量名都会中招", () => {
      expect(hint("x = s")).toEqual([]);
      expect(hint("a")).toEqual([]);
    });

    it("单个符号只在候选够多时才弹", () => {
      // `@` 只可能是为了打希腊字母，弹出来正是它的用法
      expect(hint("@").length).toBeGreaterThan(1);
      expect(hint("@")[0]).toBe("@a");
      // `(` 只匹配到 `()` 一条，信息量抵不上打扰
      expect(hint("(")).toEqual([]);
      expect(hint("~")).toEqual([]);
    });

    it("已经能自动展开的不再提示 —— 那一刻它早就展开了", () => {
      // `sum` 打完就是 \sum，列表里只该剩还没打完的 `sum` 之外的东西
      expect(hint("sum")).toEqual([]);
      expect(hint("//")).toEqual([]);
    });

    it("要按 Tab 的反而要提示，不然会以为打完就有", () => {
      expect(hint("pmat")).toEqual(["pmat"]);
    });

    it("词边界照旧：普通英文词中间不弹", () => {
      // `su` 前面紧挨着字母，`sub` 那批本来也触发不了
      expect(hint("xsu")).toEqual([]);
    });

    it("正文里不列数学 snippet", () => {
      expect(hint("su", false)).toEqual([]);
      // 正文专用的那两条照常
      expect(hint("m", false)).toEqual([]);
    });
  });

  it("条数封顶，前缀再打一个字符自然收窄", () => {
    expect(hintsFor(ALL, "@", true).length).toBeLessThanOrEqual(8);
  });

  it("自定义 snippet 覆盖同触发词的内置项", () => {
    const custom: SnippetSpec[] = [
      { trigger: "sum", replacement: "\\Sigma", options: "mAw", description: "我的求和" },
    ];
    const merged = compileAll([...DEFAULT_SNIPPETS, ...custom]);
    const row = hintsFor(merged, "su", true).find((h) => h.snippet.trigger === "sum");
    expect(row?.snippet.replacement).toBe("\\Sigma");
  });

  it("带上已经打出来的那截，界面才能把它加重", () => {
    expect(hintsFor(ALL, "x = su", true)[0].typed).toBe("su");
  });
});
