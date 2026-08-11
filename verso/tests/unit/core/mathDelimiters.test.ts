import { describe, expect, it } from "vitest";

import { convertLatexMathDelimiters } from "../../../src/core/mathDelimiters";

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
