import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { autoFence } from "./autoFence";

/** 在 `doc` 的 `at` 位置逐字符模拟输入，返回结果文档与光标位置 */
function type(doc: string, at: number, text: string) {
  let state = EditorState.create({ doc, selection: { anchor: at }, extensions: [autoFence] });
  for (const ch of text) {
    const head = state.selection.main.head;
    state = state.update({
      changes: { from: head, insert: ch },
      selection: { anchor: head + 1 },
      userEvent: "input.type",
    }).state;
  }
  return { doc: state.doc.toString(), head: state.selection.main.head };
}

describe("``` 自动补收尾", () => {
  it("空行打三个反引号，补出完整的块", () => {
    const r = type("", 0, "```");
    expect(r.doc).toBe("```\n\n```");
    // 光标停在开围栏之后 —— 下一步通常是敲语言名
    expect(r.head).toBe(3);
  });

  it("敲完语言名再回车，正好进到块体", () => {
    const r = type("", 0, "```rust");
    expect(r.doc).toBe("```rust\n\n```");
    expect(r.head).toBe(7);
  });

  it("正文中间的空行也能触发", () => {
    // 位置 4 是那个空行的行首；5 就已经是「下文」那一行了
    const r = type("上文\n\n\n下文", 4, "```");
    expect(r.doc).toBe("上文\n\n```\n\n```\n下文");
  });

  // 不补的情形 —— 每一条都是补了会出错的场景
  it("行内代码不触发", () => {
    const r = type("看这个 ", 4, "``");
    expect(r.doc).toBe("看这个 ``");
  });

  it("行尾还有文字时不触发", () => {
    const r = type("xx后面有字", 0, "```");
    expect(r.doc).toBe("```xx后面有字");
  });

  it("正在收尾一个已经打开的块时不补 —— 否则每次收尾都多出一对", () => {
    const r = type("```js\nconst a = 1\n\n", 19, "```");
    expect(r.doc).toBe("```js\nconst a = 1\n\n```");
  });

  it("已经闭合的块之后再开新块，照常补", () => {
    const doc = "```js\na\n```\n\n";
    const r = type(doc, doc.length, "```");
    expect(r.doc).toBe("```js\na\n```\n\n```\n\n```");
  });

  it("缩进保持一致 —— 列表里的代码块不能顶格", () => {
    const r = type("  ", 2, "```");
    expect(r.doc).toBe("  ```\n  \n  ```");
  });

  it("只打两个反引号不触发", () => {
    expect(type("", 0, "``").doc).toBe("``");
  });
});
