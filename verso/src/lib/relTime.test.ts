import { describe, expect, it } from "vitest";

import { relTime } from "./relTime";

const NOW = new Date(2026, 7, 2, 14, 30, 0); // 2026-08-02 14:30
const ago = (seconds: number) => Math.floor(NOW.getTime() / 1000) - seconds;

describe("相对时间", () => {
  it("一分钟内是「刚刚」", () => {
    expect(relTime(ago(0), NOW)).toBe("刚刚");
    expect(relTime(ago(59), NOW)).toBe("刚刚");
  });

  it("一小时内按分钟", () => {
    expect(relTime(ago(60), NOW)).toBe("1 分钟前");
    expect(relTime(ago(45 * 60), NOW)).toBe("45 分钟前");
  });

  it("当天按小时", () => {
    expect(relTime(ago(3 * 3600), NOW)).toBe("3 小时前");
  });

  it("**跨过一天就给时刻**，不再说「20 小时前」", () => {
    // 昨天 20:00
    const y = new Date(2026, 7, 1, 20, 0, 0).getTime() / 1000;
    expect(relTime(y, NOW)).toBe("昨天 20:00");
  });

  it("更早的给日期 —— 「7月12日」能和记忆里的事对上，「21 天前」不能", () => {
    const d = new Date(2026, 6, 12, 9, 5, 0).getTime() / 1000;
    expect(relTime(d, NOW)).toBe("7月12日 09:05");
  });

  it("跨年了才写年份", () => {
    const d = new Date(2025, 11, 30, 9, 0, 0).getTime() / 1000;
    expect(relTime(d, NOW)).toBe("2025年12月30日");
  });

  it("时钟被调过、时间戳在未来时不显示负数", () => {
    expect(relTime(ago(-500), NOW)).toBe("刚刚");
  });
});
