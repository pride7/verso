import { describe, expect, it } from "vitest";

import { RAIL_FIXED, RAIL_ITEMS } from "../../../src/ui/ActivityBar";

/**
 * 图标栏的格子表同时被两处用：条本身按它渲染，设置里那一页按它列出「显示哪些」。
 * 这几条断言看的就是「两处能对上」所依赖的前提。
 */
describe("图标栏的格子表", () => {
  // id 是存进 settings.railHidden 的东西。两组重名的话，隐藏一个会连带
  // 隐藏另一个，而且从设置界面上看不出为什么
  it("id 不重复", () => {
    const ids = RAIL_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每一格都有名字和图标 —— 设置里那一页照着它画", () => {
    for (const item of RAIL_ITEMS) {
      expect(item.label).not.toBe("");
      expect(item.icon).not.toBe("");
    }
  });

  // 「设置」是把别的格子找回来的唯一入口，它必须真的在这张表里，
  // 否则那条「始终显示」的规则谁也没匹配上
  it("不可隐藏的那一格在表里", () => {
    expect(RAIL_ITEMS.some((i) => i.id === RAIL_FIXED)).toBe(true);
  });

  it("视图组和动作组都不为空", () => {
    expect(RAIL_ITEMS.filter((i) => i.group === "view").length).toBeGreaterThan(0);
    expect(RAIL_ITEMS.filter((i) => i.group === "action").length).toBeGreaterThan(0);
  });
});
