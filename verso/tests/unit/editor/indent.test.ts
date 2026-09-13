/**
 * Tab 的第 4 段：缩进（§5.1）。这一段以前是空的，Tab 会漏给浏览器去切焦点。
 *
 * 用 `|` 标光标位置。语法树同样来自 EditorState.create 的即时解析
 * （和 listRenumber.test.ts 是同一个前提）。
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { shiftTabIndentSpec, tabIndentSpec } from "../../../src/editor/indent";
import { markdownExtended } from "../../../src/editor/markdownExtended";

function stateOf(marked: string) {
  const from = marked.indexOf("|");
  expect(from).toBeGreaterThanOrEqual(0);
  let to = marked.indexOf("|", from + 1);
  const doc = marked.replace(/\|/g, "");
  if (to > 0) to -= 1;
  else to = from;
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM, markdownExtended], codeLanguages: [] }),
    ],
  });
}

/** 跑一次 Tab / Shift-Tab，返回改完的文档；没有任何改动时返回 null */
function press(marked: string, shift = false) {
  const state = stateOf(marked);
  const spec = (shift ? shiftTabIndentSpec : tabIndentSpec)(state);
  return spec ? state.update(spec).state.doc.toString() : null;
}

describe("正文与代码块", () => {
  it("正文里补空格到下一个制表位", () => {
    expect(press("|甲乙")).toBe("  甲乙");
    expect(press("甲|乙")).toBe("甲 乙");
    expect(press("甲乙|")).toBe("甲乙  ");
  });

  it("代码块里是缩进，不是把外面的列表项挪走", () => {
    expect(press("- 项\n\n  ```js\n  if (a) {\n  |b();\n  ```")).toBe(
      "- 项\n\n  ```js\n  if (a) {\n    b();\n  ```",
    );
  });

  it("Shift-Tab 退掉一级缩进", () => {
    expect(press("    甲|乙", true)).toBe("  甲乙");
    expect(press(" 甲|乙", true)).toBe("甲乙");
    expect(press("甲|乙", true)).toBe(null);
  });
});

describe("列表项", () => {
  it("嵌进上一个同级项里", () => {
    expect(press("- 甲\n- 乙|")).toBe("- 甲\n  - 乙");
  });

  it("有序列表对齐到上一项的内容列，不是固定两格", () => {
    expect(press("1. 甲\n2. 乙|")).toBe("1. 甲\n   2. 乙");
  });

  it("子树跟着走", () => {
    expect(press("- 甲\n- 乙|\n  - 丙\n    - 丁")).toBe("- 甲\n  - 乙\n    - 丙\n      - 丁");
  });

  it("第一项没有可认的父，不动", () => {
    expect(press("- 甲|\n- 乙")).toBe(null);
  });

  it("Shift-Tab 提到父项那一列，子树跟着走", () => {
    expect(press("- 甲\n  - 乙|\n    - 丙", true)).toBe("- 甲\n- 乙\n  - 丙");
  });

  it("顶层的项已经提无可提", () => {
    expect(press("- 甲\n- 乙|", true)).toBe(null);
  });

  it("光标在行中间照样是嵌套，不是插空格", () => {
    expect(press("- 甲\n- 乙|丙")).toBe("- 甲\n  - 乙丙");
  });
});

describe("选区", () => {
  it("跨行选区整段右移", () => {
    expect(press("|甲\n乙\n丙|")).toBe("  甲\n  乙\n  丙");
  });

  it("左移按最浅的一行算，相对缩进不被压平", () => {
    expect(press("| 甲\n   乙|", true)).toBe("甲\n  乙");
  });

  it("空行不加缩进", () => {
    expect(press("|甲\n\n乙|")).toBe("  甲\n\n  乙");
  });
});
