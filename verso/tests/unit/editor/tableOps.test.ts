/**
 * 表格的结构编辑。DESIGN.md §4.9
 *
 * 全部在 Node 里跑：这一层是纯函数（文本 → 文本），起一个浏览器只会让
 * 「插一列插错位置」这类问题多绕十秒才看得见。渲染态那些把手另有一份
 * browser 测试（`tests/browser/editor/table.test.ts`），那里验的是「点了以后文件真的变了」。
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { markdownExtended } from "../../../src/editor/markdownExtended";
import {
  applyOp,
  formatTable,
  HEADER,
  parseTable,
  rewriteCell,
  rewriteTable,
  tableAt,
  tableOpSpec,
  type TableOp,
} from "../../../src/editor/tableOps";

const T = ["| 甲 | 乙 |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"].join("\n");

function stateOf(doc: string, anchor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM, markdownExtended], codeLanguages: [] }),
    ],
  });
}

/** 做一次操作，返回结果的每一行 */
function op(src: string, o: TableOp, row: number, col: number): string[] {
  const out = rewriteTable(src, o, row, col);
  return out === null ? [] : out.split("\n");
}

describe("解析", () => {
  it("读得出表头、行和对齐", () => {
    const t = parseTable("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |")!;
    expect(t.header).toEqual(["a", "b", "c"]);
    expect(t.align).toEqual(["left", "center", "right"]);
    expect(t.rows).toEqual([["1", "2", "3"]]);
  });

  it("少写一根竖线的行补空格，不让整张表错位", () => {
    const t = parseTable("| a | b |\n|---|---|\n| 1 |")!;
    expect(t.rows).toEqual([["1", ""]]);
  });

  it("多出来的单元格留着 —— 那是用户真打进去的字", () => {
    const t = parseTable("| a |\n|---|\n| 1 | 2 |")!;
    expect(t.rows).toEqual([["1", "2"]]);
  });

  it("转义的竖线不算分隔", () => {
    const t = parseTable("| a \\| b | c |\n|---|---|")!;
    expect(t.header).toEqual(["a | b", "c"]);
  });

  it("没有分隔行就不是表格", () => {
    expect(parseTable("| a | b |\n| 1 | 2 |")).toBeNull();
  });
});

describe("排版", () => {
  it("竖线按列宽对齐，分隔行带出对齐方式", () => {
    const t = parseTable("|a|bbbb|\n|---|---|\n|1|2|")!;
    t.align = ["center", "right"];
    expect(formatTable(t).split("\n")).toEqual([
      "| a   | bbbb |",
      "| :-: | ---: |",
      "| 1   | 2    |",
    ]);
  });

  it("中文按两格算宽度 —— 用 length 算的话中文表格会全歪", () => {
    // 「名字」占 4 格，正好和下面那格的 `ab` + 两个空格一样宽。
    // 按 String.length 算的话这两行的竖线会错开两格
    const t = parseTable("| 名字 | x |\n|---|---|\n| ab | y |")!;
    expect(formatTable(t).split("\n")).toEqual([
      "| 名字 | x   |",
      "| ---- | --- |",
      "| ab   | y   |",
    ]);
  });

  it("单元格里的竖线转义回去，再解析一遍还是同一张表", () => {
    const t = parseTable("| a \\| b | c |\n|---|---|")!;
    expect(parseTable(formatTable(t))!.header).toEqual(["a | b", "c"]);
  });

  it("表格嵌在列表项里时，缩进原样带回去", () => {
    expect(rewriteTable("  | a |\n  |---|\n  | 1 |", "row-below", 0, 0)!.split("\n")).toEqual([
      "  | a   |",
      "  | --- |",
      "  | 1   |",
      "  |     |",
    ]);
  });
});

describe("行", () => {
  it("在上方插入", () => {
    expect(op(T, "row-above", 1, 0)).toEqual([
      "| 甲  | 乙  |",
      "| --- | --- |",
      "| 1   | 2   |",
      "|     |     |",
      "| 3   | 4   |",
    ]);
  });

  it("在下方插入", () => {
    expect(op(T, "row-below", 0, 0)[3]).toBe("|     |     |");
  });

  it("光标在表头时，「在下方插入行」插的是第一行", () => {
    const out = op(T, "row-below", HEADER, 0);
    expect(out[2]).toBe("|     |     |");
    expect(out[3]).toBe("| 1   | 2   |");
  });

  it("删除一行", () => {
    expect(op(T, "row-delete", 0, 0)).toHaveLength(3);
  });

  it("表头删不得 —— 没有表头的 GFM 表格不成立", () => {
    expect(rewriteTable(T, "row-delete", HEADER, 0)).toBeNull();
  });

  it("上移下移，到头了就不给做", () => {
    expect(op(T, "row-down", 0, 0)[2]).toBe("| 3   | 4   |");
    expect(rewriteTable(T, "row-up", 0, 0)).toBeNull();
    expect(rewriteTable(T, "row-down", 1, 0)).toBeNull();
  });
});

describe("列", () => {
  it("在左侧插入 —— 每一行都要多一根竖线", () => {
    expect(op(T, "col-left", HEADER, 1)).toEqual([
      "| 甲  |     | 乙  |",
      "| --- | --- | --- |",
      "| 1   |     | 2   |",
      "| 3   |     | 4   |",
    ]);
  });

  it("在右侧插入", () => {
    expect(op(T, "col-right", HEADER, 0)[0]).toBe("| 甲  |     | 乙  |");
  });

  it("删除一列，对齐也跟着删", () => {
    const t = parseTable("| a | b | c |\n|---|:-:|--:|\n| 1 | 2 | 3 |")!;
    const next = applyOp(t, "col-delete", HEADER, 1)!;
    expect(next.header).toEqual(["a", "c"]);
    expect(next.align).toEqual(["left", "right"]);
    expect(next.rows).toEqual([["1", "3"]]);
  });

  it("只剩一列时删不掉 —— 那会剩下一堆孤零零的竖线", () => {
    expect(rewriteTable("| a |\n|---|\n| 1 |", "col-delete", 0, 0)).toBeNull();
  });

  it("左右移动，连着对齐一起搬", () => {
    const t = parseTable("| a | b |\n|:--|--:|\n| 1 | 2 |")!;
    const next = applyOp(t, "col-move-right", HEADER, 0)!;
    expect(next.header).toEqual(["b", "a"]);
    expect(next.align).toEqual(["right", "left"]);
    expect(next.rows).toEqual([["2", "1"]]);
    expect(applyOp(t, "col-move-left", HEADER, 0)).toBeNull();
  });
});

describe("改一格的文字（就地编辑走这条）", () => {
  it("写回那一格，整张表跟着重排", () => {
    expect(rewriteCell(T, 0, 1, "改")!.split("\n")).toEqual([
      "| 甲  | 乙  |",
      "| --- | --- |",
      "| 1   | 改  |",
      "| 3   | 4   |",
    ]);
  });

  it("表头也改得了", () => {
    expect(rewriteCell(T, HEADER, 0, "新")!.split("\n")[0]).toBe("| 新  | 乙  |");
  });

  it("没改动返回 null，不留空的撤销记录 —— 首尾空白不算改动", () => {
    expect(rewriteCell(T, 0, 0, "1")).toBeNull();
    expect(rewriteCell(T, 0, 0, " 1 ")).toBeNull();
  });

  it("换行折成空格 —— GFM 的一格里放不下换行", () => {
    expect(rewriteCell(T, 0, 0, "a\nb")).toContain("| a b | 2   |");
  });

  it("竖线转义回去，再解析还是同一格", () => {
    expect(parseTable(rewriteCell(T, 0, 0, "a | b")!)!.rows[0][0]).toBe("a | b");
  });

  it("位置不存在返回 null", () => {
    expect(rewriteCell(T, 9, 0, "x")).toBeNull();
    expect(rewriteCell(T, 0, 9, "x")).toBeNull();
  });
});

describe("对齐", () => {
  it("写进分隔行的冒号位置", () => {
    expect(op(T, "align-center", HEADER, 1)[1]).toBe("| --- | :-: |");
    expect(op(T, "align-right", HEADER, 0)[1]).toBe("| --: | --- |");
  });

  it("转一圈：左 → 中 → 右 → 左", () => {
    const t = parseTable(T)!;
    const a = applyOp(t, "align-cycle", HEADER, 0)!;
    expect(a.align[0]).toBe("center");
    expect(applyOp(a, "align-cycle", HEADER, 0)!.align[0]).toBe("right");
    const c = applyOp(applyOp(a, "align-cycle", HEADER, 0)!, "align-cycle", HEADER, 0)!;
    expect(c.align[0]).toBe("left");
  });

  it("已经是这个对齐就不算一次改动，不留空的撤销记录", () => {
    expect(applyOp(parseTable(T)!, "align-left", HEADER, 0)).toBeNull();
  });
});

describe("光标定位", () => {
  const DOC = `正文\n\n${T}\n\n结尾`;

  it("认得出光标在第几行第几格", () => {
    const at = DOC.indexOf("| 3 | 4 |") + 7;
    const site = tableAt(stateOf(DOC, at))!;
    expect(site.row).toBe(1);
    expect(site.col).toBe(1);
    expect(site.src.split("\n")).toHaveLength(4);
  });

  it("分隔行上的光标算在表头上", () => {
    const site = tableAt(stateOf(DOC, DOC.indexOf("|---|") + 2))!;
    expect(site.row).toBe(HEADER);
  });

  it("不在表格里就是 null", () => {
    expect(tableAt(stateOf(DOC, 1))).toBeNull();
  });

  it("改完之后光标落在新插进来的那一格里", () => {
    const state = stateOf(DOC, DOC.indexOf("| 1 | 2 |") + 3);
    const spec = tableOpSpec(state, "row-below")!;
    const next = state.update(spec).state;
    const line = next.doc.lineAt(next.selection.main.head);
    // 新行是空的，光标就停在第一格里，接着打字就行
    expect(line.text).toBe("|     |     |");
    expect(next.selection.main.head - line.from).toBe(2);
  });

  it("光标不在表格里时不产生改动", () => {
    expect(tableOpSpec(stateOf(DOC, 1), "row-below")).toBeNull();
  });

  it("只改那一张表，别的正文一个字都不动", () => {
    const state = stateOf(DOC, DOC.indexOf("| 1 | 2 |") + 3);
    const next = state.update(tableOpSpec(state, "col-right")!).state;
    const text = next.doc.toString();
    expect(text.startsWith("正文\n\n")).toBe(true);
    expect(text.endsWith("\n\n结尾")).toBe(true);
  });
});
