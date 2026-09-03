/**
 * 表格单元格里的行内渲染（`editor/inline.ts`）。DESIGN.md §4.2 / §4.9
 *
 * 单元格是 widget 内部的独立 DOM，不经过 live preview，所以这一小套规则
 * 得自己验。跑在浏览器车道是因为它直接产 DOM 节点，纯 Node 里没有
 * `document`。
 */
import { describe, expect, it } from "vitest";

import { renderInline } from "../../../src/editor/inline";

/** 渲染成一段 HTML，好一次看清标签和文字 */
function html(src: string): string {
  const box = document.createElement("div");
  box.appendChild(renderInline(src));
  return box.innerHTML;
}

const textOf = (src: string) => {
  const box = document.createElement("div");
  box.appendChild(renderInline(src));
  return box.textContent ?? "";
};

describe("单元格里的链接", () => {
  it("`[文字](地址)` 只显示文字", () => {
    expect(html("[Verso](https://example.com)")).toBe(
      '<span class="cm-link">Verso</span>',
    );
  });

  it("`[[内部链接]]` 照旧", () => {
    expect(html("[[笔记名|显示]]")).toBe('<span class="cm-wikilink">显示</span>');
  });

  it("链接前后的文字留在原处", () => {
    expect(textOf("见 [主页](https://example.com) 一节")).toBe("见 主页 一节");
  });

  /** `![图](a.png)` 截出 `[图](a.png)` 的话，格子里会剩一个孤零零的 `!` */
  it("图片不当成链接", () => {
    expect(textOf("![图](a.png)")).toBe("![图](a.png)");
  });

  it("代码里的方括号按字面处理", () => {
    expect(html("`[a](b)`")).toBe('<code class="cm-inline-code">[a](b)</code>');
  });
});
