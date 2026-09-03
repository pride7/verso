/**
 * 同 trigger 时用户配置覆盖内置。DESIGN.md §5.4
 *
 * 这条以前是坏的，而且坏得很难自己看出来：默认优先级取触发词长度，所以
 * 同 trigger 必然同优先级，匹配时先遇到的赢 —— 内置排在前面。与此同时
 * 符号面板和提示条各自按 trigger 去过重、显示用户那份，于是
 * **看到的是自己的版本，敲出来的是内置的**。
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_SNIPPETS } from "../../../../src/core/snippets/defaults";
import { findTrigger } from "../../../../src/core/snippets/match";
import { compileAll, mergeSnippets, type SnippetSpec } from "../../../../src/core/snippets/types";

const build = (custom: SnippetSpec[]) => compileAll(mergeSnippets(DEFAULT_SNIPPETS, custom));

/** 内置的 `sr` 是 `^{2}`，拿它当靶子 */
const MINE: SnippetSpec = { trigger: "sr", replacement: "^{我的}", options: "mA" };

describe("自定义 snippet 覆盖内置", () => {
  it("敲出来的是用户那一条，不是内置那一条", () => {
    const hit = findTrigger(build([MINE]), "sr", true);
    expect(hit?.snippet.replacement).toBe("^{我的}");
  });

  it("同 trigger 的内置从集合里消失，不是并排留着", () => {
    const all = build([MINE]);
    expect(all.filter((s) => s.trigger === "sr")).toHaveLength(1);
  });

  it("没被覆盖的内置一条都不少", () => {
    const before = compileAll(DEFAULT_SNIPPETS).length;
    expect(build([MINE])).toHaveLength(before);
    expect(build([{ trigger: "zzz", replacement: "x", options: "mA" }])).toHaveLength(before + 1);
  });

  it("没有自定义时原样返回内置", () => {
    expect(build([])).toHaveLength(compileAll(DEFAULT_SNIPPETS).length);
  });
});
