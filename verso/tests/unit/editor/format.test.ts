/**
 * 行内格式开关（§4.8）。
 *
 * 纯状态变换，不需要浏览器 —— 这正是 `toggleFormatSpec` 写成
 * 「`EditorState` → `TransactionSpec`」而不是直接操作 view 的理由。
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { toggleFormatSpec, type InlineFormat } from "../../../src/editor/format";

/** 把 `doc` 里选中 [from,to) 的那一段按 `kind` 开关一次，返回新正文和新选区 */
function apply(doc: string, from: number, to: number, kind: InlineFormat) {
  const state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  const tr = state.update(toggleFormatSpec(state, kind));
  const sel = tr.state.selection.main;
  return {
    doc: tr.state.doc.toString(),
    selected: tr.state.doc.sliceString(sel.from, sel.to),
    cursor: sel.head,
  };
}

/** `|文字|` 这种写法：竖线标出选区，省得数下标 */
function at(marked: string, kind: InlineFormat) {
  const from = marked.indexOf("|");
  const to = marked.indexOf("|", from + 1) - 1;
  return apply(marked.replace(/\|/g, ""), from, to, kind);
}

describe("加粗", () => {
  it("选中的文字套上 **，选区仍然是那几个字", () => {
    const r = at("一段|文字|在这", "bold");
    expect(r.doc).toBe("一段**文字**在这");
    // 选区跟着走，才能接着按 Ctrl+I 叠一个斜体
    expect(r.selected).toBe("文字");
  });

  it("再按一次去掉", () => {
    expect(at("一段**|文字|**在这", "bold").doc).toBe("一段文字在这");
  });

  it("选区把星号也框进来时同样能去掉", () => {
    // 双击选词很容易连标记一起选中，这时不认的话会套成 ****文字****
    expect(at("一段|**文字**|在这", "bold").doc).toBe("一段文字在这");
  });

  it("没选中东西时插一对空标记，光标停在中间", () => {
    const r = apply("一段在这", 2, 2, "bold");
    expect(r.doc).toBe("一段****在这");
    expect(r.cursor).toBe(4);
  });
});

/**
 * 粗体和斜体共用星号，这一组是整个文件里唯一真正难的地方 ——
 * 只看「旁边是不是 `*`」的实现会在这里全错
 */
describe("粗体与斜体共用星号", () => {
  it("斜体上叠粗体，不是把斜体拆掉", () => {
    expect(at("*|文字|*", "bold").doc).toBe("***文字***");
  });

  it("粗体上叠斜体，不是吃掉一个星号", () => {
    expect(at("**|文字|**", "italic").doc).toBe("***文字***");
  });

  it("又粗又斜时，取消粗体只脱两个星号", () => {
    expect(at("***|文字|***", "bold").doc).toBe("*文字*");
  });

  it("又粗又斜时，取消斜体只脱一个星号", () => {
    expect(at("***|文字|***", "italic").doc).toBe("**文字**");
  });
});

describe("其他几种", () => {
  it("行内代码", () => {
    expect(at("|print()|", "code").doc).toBe("`print()`");
    expect(at("`|print()|`", "code").doc).toBe("print()");
  });

  it("高亮沿用 Obsidian 的 ==，不自创语法（§2.4）", () => {
    expect(at("|重点|", "highlight").doc).toBe("==重点==");
    expect(at("==|重点|==", "highlight").doc).toBe("重点");
  });

  it("删除线", () => {
    expect(at("|作废|", "strike").doc).toBe("~~作废~~");
    expect(at("~~|作废|~~", "strike").doc).toBe("作废");
  });
});

describe("边界", () => {
  // 一次要在前后两处同时改，位置映射差一个字符的话标记会插到字中间去 ——
  // 文档开头和结尾是这种错最容易露出来的地方
  it("整篇就是那几个字时也对", () => {
    const r = at("|文字|", "bold");
    expect(r.doc).toBe("**文字**");
    expect(r.selected).toBe("文字");
  });

  it("跨行的选区照样套住整段", () => {
    expect(at("|第一行\n第二行|", "highlight").doc).toBe("==第一行\n第二行==");
  });

  it("选区里本来就有星号，不会被当成标记", () => {
    expect(at("|2 * 3|", "bold").doc).toBe("**2 * 3**");
  });
});
