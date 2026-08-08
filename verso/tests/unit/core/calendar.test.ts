import { describe, expect, it } from "vitest";

import {
  dateKey,
  daysInMonth,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
  ymd,
} from "../../../src/core/calendar";

describe("dateKey", () => {
  it("认 YYYY-MM-DD 和 RFC3339", () => {
    expect(dateKey("2026-03-04")).toBe("2026-03-04");
    expect(dateKey("2026-03-04T10:00:00+08:00")).toBe("2026-03-04");
    // 一位数的月日也补齐，否则同一天会算成两个格子
    expect(dateKey("2026-3-4")).toBe("2026-03-04");
  });

  it("认不出来就返回 null，不去猜", () => {
    for (const bad of ["", "2026 年 3 月", "下周", "明天", undefined, null]) {
      expect(dateKey(bad)).toBeNull();
    }
    // 月日越界的也不认
    expect(dateKey("2026-13-01")).toBeNull();
    expect(dateKey("2026-02-32")).toBeNull();
  });
});

describe("daysInMonth", () => {
  it("闰年二月是 29 天", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    // 百年不闰、四百年再闰
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it("大小月", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("monthGrid", () => {
  it("永远 42 格，周一起始", () => {
    // 2026-08-01 是周六，所以第一行前面要垫 5 天（一~五）
    const g = monthGrid(2026, 8);
    expect(g).toHaveLength(42);
    expect(g[0].key).toBe("2026-07-27");
    expect(g[5].key).toBe("2026-08-01");
    expect(g[5].inMonth).toBe(true);
    expect(g[4].inMonth).toBe(false);
  });

  it("正好从周一开始的月份不垫前面那一行", () => {
    // 2026-06-01 是周一
    const g = monthGrid(2026, 6);
    expect(g[0].key).toBe("2026-06-01");
    expect(g[0].inMonth).toBe(true);
  });

  it("跨年边界两头都对", () => {
    const jan = monthGrid(2026, 1);
    expect(jan.some((c) => c.key.startsWith("2025-12"))).toBe(true);
    const dec = monthGrid(2026, 12);
    expect(dec.some((c) => c.key.startsWith("2027-01"))).toBe(true);
  });

  it("当月的每一天都在网格里，不重不漏", () => {
    for (const [y, m] of [
      [2024, 2],
      [2026, 2],
      [2026, 8],
      [2026, 12],
    ] as const) {
      const days = monthGrid(y, m).filter((c) => c.inMonth);
      expect(days).toHaveLength(daysInMonth(y, m));
      expect(new Set(days.map((c) => c.key)).size).toBe(days.length);
      expect(days[0].key).toBe(ymd(y, m, 1));
    }
  });
});

describe("shiftMonth", () => {
  it("跨年", () => {
    expect(shiftMonth({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    expect(shiftMonth({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
  });

  it("一次跳很多个月也对", () => {
    expect(shiftMonth({ y: 2026, m: 5 }, 12)).toEqual({ y: 2027, m: 5 });
    expect(shiftMonth({ y: 2026, m: 5 }, -17)).toEqual({ y: 2024, m: 12 });
  });
});

describe("其它", () => {
  it("monthTitle / monthOf", () => {
    expect(monthTitle({ y: 2026, m: 8 })).toBe("2026 年 8 月");
    expect(monthOf("2026-03-04")).toEqual({ y: 2026, m: 3 });
    expect(monthOf("乱写的")).toBeNull();
  });
});
