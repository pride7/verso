/**
 * 有序列表自动重排。核心场景：1,2,3 删掉中间的 2，剩下的 3 要变成 2。
 *
 * 语法树来自 EditorState.create 时的即时解析（小文档一次解析完，
 * 和 viewBlock.test.ts 是同一个前提）。
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { listRenumber } from "../../../src/editor/listRenumber";
import { markdownExtended } from "../../../src/editor/markdownExtended";

function stateOf(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      markdown({ base: markdownLanguage, extensions: [GFM, markdownExtended], codeLanguages: [] }),
      listRenumber,
    ],
  });
}

/** 删掉 `doc` 中第一次出现的 `text`（含随后的换行符，如果 `line` 为真） */
function deleteText(doc: string, text: string, line = true) {
  const state = stateOf(doc);
  const from = doc.indexOf(text);
  expect(from).toBeGreaterThanOrEqual(0);
  let to = from + text.length;
  if (line && doc.charAt(to) === "\n") to++;
  return state.update({ changes: { from, to }, userEvent: "delete.selection" });
}

describe("删除后重排", () => {
  it("1,2,3 删掉中间的 2 → 3 变成 2", () => {
    const tr = deleteText("1. 甲\n2. 乙\n3. 丙", "2. 乙");
    expect(tr.state.doc.toString()).toBe("1. 甲\n3. 丙".replace("3.", "2."));
  });

  it("删掉第一项 → 剩下的从原起始号重新数", () => {
    const tr = deleteText("1. 甲\n2. 乙\n3. 丙", "1. 甲");
    expect(tr.state.doc.toString()).toBe("1. 乙\n2. 丙");
  });

  it("起始号不是 1 的列表保持自己的起点", () => {
    const tr = deleteText("5. 甲\n6. 乙\n7. 丙", "6. 乙");
    expect(tr.state.doc.toString()).toBe("5. 甲\n6. 丙");
  });

  it("删子列表的项只影响子列表，外层不动", () => {
    const doc = "1. 甲\n   1. 子甲\n   2. 子乙\n   3. 子丙\n2. 乙";
    const tr = deleteText(doc, "   2. 子乙");
    expect(tr.state.doc.toString()).toBe("1. 甲\n   1. 子甲\n   2. 子丙\n2. 乙");
  });

  it("`)` 分隔符照样重排，且保留各行自己的分隔符", () => {
    const tr = deleteText("1) 甲\n2) 乙\n3) 丙", "2) 乙");
    expect(tr.state.doc.toString()).toBe("1) 甲\n2) 丙");
  });

  it("空项（`3.` 后面没内容）也跟着重排", () => {
    const tr = deleteText("1. 甲\n2. 乙\n3.", "2. 乙");
    expect(tr.state.doc.toString()).toBe("1. 甲\n2.");
  });

  it("撤销一步回到删除前 —— 重排挂在同一个事务上", () => {
    const doc = "1. 甲\n2. 乙\n3. 丙";
    const tr = deleteText(doc, "2. 乙");
    const target = {
      state: tr.state,
      dispatch(t: Transaction) {
        target.state = t.state;
      },
    };
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(doc);
  });
});

describe("不该动的地方", () => {
  it("代码块里的 1. 2. 3. 不是列表，不动", () => {
    const doc = "```\n1. 甲\n2. 乙\n3. 丙\n```\n";
    const tr = deleteText(doc, "2. 乙");
    expect(tr.state.doc.toString()).toBe("```\n1. 甲\n3. 丙\n```\n");
  });

  it("列表项里缩进的代码块内容不被当成编号", () => {
    const doc = "1. 甲\n2. 乙\n3. 丙\n\n       1. 这行在 3 的代码块里\n4. 丁";
    const tr = deleteText(doc, "2. 乙");
    const lines = tr.state.doc.toString().split("\n");
    expect(lines[0]).toBe("1. 甲");
    expect(lines[1]).toBe("2. 丙");
    // 深缩进那行原样保留
    expect(lines[3]).toBe("       1. 这行在 3 的代码块里");
  });

  it("无序列表没有编号可排", () => {
    const doc = "- 甲\n- 乙\n- 丙";
    const tr = deleteText(doc, "- 乙");
    expect(tr.state.doc.toString()).toBe("- 甲\n- 丙");
  });

  it("程序性替换（无 userEvent）不触发 —— 外部同步不该被改写", () => {
    const state = stateOf("1. 甲\n2. 乙\n3. 丙");
    const tr = state.update({ changes: { from: 5, to: 10 } }); // 删掉 "2. 乙\n"
    expect(tr.state.doc.toString()).toBe("1. 甲\n3. 丙");
  });

  it("在列表下方敲年份，`2025.` 不被改写成序号", () => {
    const doc = "1. 甲\n2. 乙\n2025";
    const state = stateOf(doc);
    const tr = state.update({
      changes: { from: doc.length, insert: "." },
      userEvent: "input.type",
    });
    expect(tr.state.doc.toString()).toBe("1. 甲\n2. 乙\n2025.");
  });
});

describe("插入与手改编号", () => {
  it("粘贴一项进列表中间 → 整个列表顺过来", () => {
    const doc = "1. 甲\n2. 乙\n3. 丙\n";
    const state = stateOf(doc);
    const at = doc.indexOf("2. 乙");
    const tr = state.update({
      changes: { from: at, insert: "9. 新\n" },
      userEvent: "input.paste",
    });
    expect(tr.state.doc.toString()).toBe("1. 甲\n2. 新\n3. 乙\n4. 丙\n");
  });

  it("手改第一项的编号，后面全体顺延", () => {
    const doc = "1. 甲\n2. 乙\n3. 丙";
    const state = stateOf(doc);
    const tr = state.update({
      changes: { from: 0, to: 1, insert: "4" },
      userEvent: "input.type",
    });
    expect(tr.state.doc.toString()).toBe("4. 甲\n5. 乙\n6. 丙");
  });
});
