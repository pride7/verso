import { describe, expect, it } from "vitest";

import { nearestSlot, sortTargets, type Slot } from "../../../src/core/sortable";

describe("拖动排序的几何", () => {
  it("多列网格：每项套进新位置那一格", () => {
    const grid: Slot[] = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 110, y: 0, w: 100, h: 50 },
      { x: 0, y: 60, w: 100, h: 80 },
    ];
    // 第 0 项挪到最后：1 → 第 0 格，2 → 第 1 格，0 → 第 2 格
    expect(sortTargets(grid, 0, 2)).toEqual([{ x: 0, y: 60 }, { x: 0, y: 0 }, { x: 110, y: 0 }]);
  });

  it("单列：高矮不一的卡片挨个往下摞，间距不变", () => {
    const column: Slot[] = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 0, y: 110, w: 100, h: 30 },
      { x: 0, y: 150, w: 100, h: 60 },
    ];
    // 高的那张挪到最后：矮的两张往上补，高的接在它们后面 —— 不是套进 150 那一格
    expect(sortTargets(column, 0, 2)).toEqual([{ x: 0, y: 110 }, { x: 0, y: 0 }, { x: 0, y: 40 }]);
    expect(sortTargets(column, 1, 1)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 110 }, { x: 0, y: 150 }]);
  });

  it("落点取最近的那一格，且只在允许的范围里找", () => {
    const row: Slot[] = [0, 1, 2, 3].map((i) => ({ x: i * 100, y: 0, w: 90, h: 40 }));
    expect(nearestSlot(row, { x: 250, y: 20 }, 0, 3)).toBe(2);
    expect(nearestSlot(row, { x: 0, y: 20 }, 1, 3)).toBe(1);
    expect(nearestSlot(row, { x: 999, y: 20 }, 0, 1)).toBe(1);
  });
});
