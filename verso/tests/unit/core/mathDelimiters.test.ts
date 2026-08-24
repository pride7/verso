import { describe, expect, it } from "vitest";

import {
  blockMathLayoutChanges,
  convertLatexMathDelimiters,
  layoutBlockMath,
} from "../../../src/core/mathDelimiters";

describe("LaTeX 公式定界符转换", () => {
  it("行内与块公式换成 Markdown 定界符", () => {
    const source = String.raw`行内 \(x+1\)，块公式 \[y^2\]。`;
    expect(convertLatexMathDelimiters(source)).toMatchObject({
      text: "行内 $x+1$，块公式 $$y^2$$。",
      count: 2,
    });
  });

  it("跨行块公式保留原来的换行", () => {
    const source = String.raw`前文
\[
\sum_i x_i
\]
后文`;
    expect(convertLatexMathDelimiters(source).text).toBe(`前文
$$
\\sum_i x_i
$$
后文`);
  });

  it("不碰未闭合、被转义或代码范围里的字面量", () => {
    const source = String.raw`代码 \(x\)；转义 \\(y\\)；未闭合 \(z`;
    const codeEnd = source.indexOf("；");
    expect(convertLatexMathDelimiters(source, [{ from: 0, to: codeEnd }])).toMatchObject({
      text: source,
      count: 0,
    });
  });
});

describe("块公式排成独占几行", () => {
  it("挤在一行里的块公式拆开，前后文各自成行", () => {
    expect(layoutBlockMath("也就是说 $$ x^{(a)}_{17:32}. $$后文")).toBe(
      `也就是说
$$
x^{(a)}_{17:32}.
$$
后文`,
    );
  });

  it("公式体内部的换行一字不动", () => {
    const source = `前文 $$
\\sum_i x_i
 + 1
$$`;
    expect(layoutBlockMath(source)).toBe(`前文
$$
\\sum_i x_i
 + 1
$$`);
  });

  it("已经排好的公式不产生改动", () => {
    const source = `前文
$$
x^2
$$
后文`;
    expect(blockMathLayoutChanges(source)).toEqual([]);
    expect(layoutBlockMath(source)).toBe(source);
  });

  it("列表、引用、表格和标题行里的公式保持原样", () => {
    for (const source of [
      "- 一项 $$x^2$$",
      "1. 一项 $$x^2$$",
      "> 引用 $$x^2$$",
      "| 名称 | $$x^2$$ |",
      "## 标题 $$x^2$$",
    ]) {
      expect(layoutBlockMath(source)).toBe(source);
    }
  });

  it("代码范围里的 `$$` 和空公式都不碰", () => {
    const source = "`$$x$$`";
    expect(layoutBlockMath(source, [{ from: 0, to: source.length }])).toBe(source);
    expect(layoutBlockMath("前文 $$$$ 后文")).toBe("前文 $$$$ 后文");
  });
});
