import { describe, expect, it } from "vitest";

import { countChars } from "../../../src/app/App";

describe("字数统计", () => {
  it("中文按字符数", () => {
    expect(countChars("今天写了三行字")).toBe(7);
  });

  it("西文按词数 —— 按字符数对英文没有意义", () => {
    expect(countChars("the quick brown fox")).toBe(4);
  });

  it("中英混排各按各的习惯数", () => {
    // 用 写 编 辑 器 = 5 个汉字，CodeMirror = 1 个词
    expect(countChars("用 CodeMirror 写编辑器")).toBe(5 + 1);
  });

  it("标点不计入", () => {
    expect(countChars("你好，世界！")).toBe(4);
  });

  // 码元数会把 emoji 和生僻字算成两个
  it("不按 UTF-16 码元数", () => {
    expect(countChars("𠮷")).toBe(0); // 生僻字不在常用 CJK 区间，但绝不该是 2
    expect(countChars("🎉")).toBe(0);
  });

  it("代码块不算正文 —— 贴一段代码不该让字数暴涨", () => {
    expect(countChars("正文四个字\n```js\nconst a = 1\n```")).toBe(5);
  });

  it("块级公式同理", () => {
    expect(countChars("推导如下\n$$\n\\int_0^1 x dx\n$$")).toBe(4);
  });

  it("链接只占它的位置，不数目标名", () => {
    expect(countChars("参见[[线性代数]]")).toBe(2);
  });

  it("空文档是 0", () => {
    expect(countChars("")).toBe(0);
    expect(countChars("\n\n  \n")).toBe(0);
  });

  it("带撇号的英文算一个词", () => {
    expect(countChars("it's a test")).toBe(3);
  });
});
