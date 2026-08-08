import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { headingFoldRange } from "../../../src/editor/fold";
import { markdownExtended } from "../../../src/editor/markdownExtended";

function stateOf(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM, markdownExtended], codeLanguages: [] }),
    ],
  });
}

/** 折叠第 `n` 行开头的那个标题，返回被收起来的文本 */
function foldedText(doc: string, n: number): string | null {
  const state = stateOf(doc);
  const range = headingFoldRange(state, state.doc.line(n).from);
  return range ? state.doc.sliceString(range.from, range.to) : null;
}

describe("标题折叠范围", () => {
  const DOC = [
    "# 一级", // 1
    "", // 2
    "一级的正文", // 3
    "", // 4
    "## 二级甲", // 5
    "", // 6
    "二级甲的正文", // 7
    "", // 8
    "### 三级", // 9
    "", // 10
    "三级的正文", // 11
    "", // 12
    "## 二级乙", // 13
    "", // 14
    "二级乙的正文", // 15
  ].join("\n");

  it("折叠标题时标题本身仍然可见", () => {
    const state = stateOf(DOC);
    const range = headingFoldRange(state, state.doc.line(5).from)!;
    // from 落在标题行末尾，标题文字不在被收起的范围里
    expect(range.from).toBe(state.doc.line(5).to);
  });

  // 这是这个功能的核心：折叠 `##` 要连它下面的 `###` 一起收走，
  // 只找"下一个标题"的话只能收到第一个子标题为止
  it("折叠二级标题会连子标题一起收走", () => {
    const text = foldedText(DOC, 5)!;
    expect(text).toContain("二级甲的正文");
    expect(text).toContain("### 三级");
    expect(text).toContain("三级的正文");
    // 但不能越过下一个同级标题
    expect(text).not.toContain("二级乙");
  });

  it("折叠一级标题收走整篇", () => {
    const text = foldedText(DOC, 1)!;
    expect(text).toContain("## 二级甲");
    expect(text).toContain("## 二级乙");
    expect(text).toContain("二级乙的正文");
  });

  it("折叠三级标题只收到下一个二级之前", () => {
    const text = foldedText(DOC, 9)!;
    expect(text).toContain("三级的正文");
    expect(text).not.toContain("二级乙");
  });

  it("最后一个标题收到文末", () => {
    const text = foldedText(DOC, 13)!;
    expect(text).toContain("二级乙的正文");
  });

  it("末尾的空行留在折叠范围外 —— 否则展开折叠时段落间距会跳", () => {
    // 用**同级**标题收尾。`## 乙` 是 `# 甲` 的子节，本来就该被一起收进去
    const text = foldedText("# 甲\n\n正文\n\n\n\n# 乙\n", 1)!;
    expect(text.endsWith("正文")).toBe(true);
  });

  it("普通行不可折叠", () => {
    expect(foldedText(DOC, 3)).toBeNull();
    expect(foldedText(DOC, 2)).toBeNull();
  });

  it("空标题（下面什么都没有）不可折叠", () => {
    expect(foldedText("# 甲\n## 乙\n", 1)).not.toBeNull(); // 甲 下面有 乙
    expect(foldedText("正文\n\n# 末尾标题", 3)).toBeNull();
  });

  // 一篇讲 Markdown 语法的笔记会在代码块里写 `# 标题`。
  // 只按行首 `#` 匹配的话，那里会冒出折叠箭头，范围还会横跨代码块边界
  it("代码块里的 # 不是标题", () => {
    const doc = ["# 真标题", "", "```md", "# 这是示例，不是标题", "## 也不是", "```", "", "正文"].join(
      "\n",
    );
    expect(foldedText(doc, 4)).toBeNull();
    expect(foldedText(doc, 5)).toBeNull();
    // 真标题要能把整个代码块收走
    expect(foldedText(doc, 1)).toContain("# 这是示例");
  });

  it("setext 形式的标题也认", () => {
    const doc = ["标题\n===", "", "正文", "", "# 下一节"].join("\n");
    const text = foldedText(doc, 1);
    expect(text).toContain("正文");
  });
});
