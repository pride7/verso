import { describe, expect, it } from "vitest";

import {
  addScratchCard,
  indentScratchCard,
  moveScratchCard,
  outdentScratchCard,
  scratchCards,
  scratchTree,
  selectedScratchMarkdown,
} from "../../../src/core/scratch";

/** 照 EditorHandle.replaceLines 的语义把一次编辑套回文本。 */
function apply(body: string, edit: { fromLine: number; toLine: number; insert: string }): string {
  const lines = body.split("\n");
  if (edit.fromLine > edit.toLine) {
    lines.splice(edit.toLine, 0, edit.insert);
  } else if (!edit.insert) {
    lines.splice(edit.fromLine - 1, edit.toLine - edit.fromLine + 1);
  } else {
    lines.splice(edit.fromLine - 1, edit.toLine - edit.fromLine + 1, ...edit.insert.split("\n"));
  }
  return lines.join("\n");
}

describe("结构化草稿", () => {
  it("空笔记的第一张卡片不会在前面留空行", () => {
    const root = scratchTree("");
    const added = addScratchCard("", root, "第一个念头");
    expect(apply("", added.edit)).toBe("- 第一个念头");
    expect(added.line).toBe(1);
  });

  it("Tab 把当前子树一起缩进，Shift+Tab 再整支提升", () => {
    const body = "- 甲\n- 乙\n  - 乙的子项\n- 丙";
    const indented = indentScratchCard(body, scratchTree(body), 2);
    expect(indented).not.toBeNull();
    const next = apply(body, indented!);
    expect(next).toBe("- 甲\n  - 乙\n    - 乙的子项\n- 丙");

    const outdented = outdentScratchCard(next, scratchTree(next), 2);
    expect(apply(next, outdented!)).toBe(body);
  });

  it("没有前一个同级卡片时不允许缩进", () => {
    const body = "- 甲\n- 乙";
    expect(indentScratchCard(body, scratchTree(body), 1)).toBeNull();
  });

  it("上下移动保留整棵子树", () => {
    const body = "- 甲\n  - 甲一\n- 乙\n- 丙";
    const moved = moveScratchCard(body, scratchTree(body), 1, 1);
    expect(apply(body, moved!)).toBe("- 乙\n- 甲\n  - 甲一\n- 丙");
  });

  it("生成文档时去重已选子项，并把单选的深层卡片抬到顶层", () => {
    const body = "- 甲\n  - 甲一\n    - 甲一的子项\n- 乙";
    const root = scratchTree(body);
    expect(selectedScratchMarkdown(body, root, new Set([1, 2]))).toBe(
      "- 甲\n  - 甲一\n    - 甲一的子项",
    );
    expect(selectedScratchMarkdown(body, root, new Set([2]))).toBe(
      "- 甲一\n  - 甲一的子项",
    );
  });

  it("标题和列表都能成为卡片，普通段落不被偷改", () => {
    const body = "# 方向\n这是一段说明\n- 念头";
    expect(scratchCards(scratchTree(body)).map((node) => node.text)).toEqual(["方向", "念头"]);
  });
});

