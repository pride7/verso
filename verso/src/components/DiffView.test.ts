import { describe, expect, it } from "vitest";

import type { DiffLine } from "../types";
import { splitRows } from "./DiffView";

const line = (
  kind: DiffLine["kind"],
  text: string,
  oldLine: number | null,
  newLine: number | null,
): DiffLine => ({ kind, text, oldLine, newLine });

describe("左右差异行配对", () => {
  it("删三行、加一行之后，上下文仍回到同一排", () => {
    const rows = splitRows([
      line("context", "上文", 1, 1),
      line("deleted", "旧一", 2, null),
      line("deleted", "旧二", 3, null),
      line("deleted", "旧三", 4, null),
      line("added", "新一", null, 2),
      line("context", "下文", 5, 3),
    ]);

    expect(rows.map((row) => [row.old?.text ?? null, row.next?.text ?? null])).toEqual([
      ["上文", "上文"],
      ["旧一", "新一"],
      ["旧二", null],
      ["旧三", null],
      ["下文", "下文"],
    ]);
  });

  it("纯新增只占右侧，不伪造旧行号", () => {
    const rows = splitRows([line("added", "新内容", null, 7)]);
    expect(rows).toEqual([{ old: null, next: line("added", "新内容", null, 7) }]);
  });
});
