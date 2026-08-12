import { describe, expect, it } from "vitest";

import { calculateExpression } from "../../../src/core/calculation";

describe("正文计算器", () => {
  it.each([
    ["64 * 512", "32768"],
    ["(12 + 4) / 2", "8"],
    ["2^3^2", "512"],
    ["-2^2", "-4"],
    ["200 * 15%", "30"],
    ["0.1 + 0.2", "0.3"],
    ["64 \\times 512", "32768"],
    ["64 × 512", "32768"],
    ["8 \\div 4", "2"],
    ["（3 + 5）÷ 2", "4"],
  ])("计算 %s", (expression, result) => {
    expect(calculateExpression(expression)).toBe(result);
  });

  it.each([
    "x * y",
    "总价 64 * 512",
    "1 / 0",
    "2 +",
    "",
    "globalThis.alert(1)",
  ])("拒绝不是纯数字算式的内容：%s", (expression) => {
    expect(calculateExpression(expression)).toBeNull();
  });
});
