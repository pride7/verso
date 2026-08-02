import { describe, expect, it } from "vitest";

import {
  newNoteParent,
  nextSort,
  readColumns,
  readKey,
  readSort,
  readWhere,
  writeColumns,
  writeKey,
  writeSort,
  writeWhere,
  formatDate,
  toDateInput,
  isBuiltin,
  clampColW,
  MAX_COL_W,
  MIN_COL_W,
  readWidths,
  writeWidths,
} from "./viewSpec";

const SPEC = ['from: "论文/**"', "# 只看没读完的", 'where: status != "已读"', "view: table"].join("\n");

describe("readSort", () => {
  it("认 `键 desc`，缺方向时按升序", () => {
    expect(readSort("sort: 难度 desc")).toEqual({ key: "难度", dir: "desc" });
    expect(readSort("sort: created")).toEqual({ key: "created", dir: "asc" });
    expect(readSort('sort: "更新时间 desc"')).toEqual({ key: "更新时间", dir: "desc" });
  });

  it("没有 sort 行就是 null", () => {
    expect(readSort(SPEC)).toBeNull();
  });
});

describe("writeSort", () => {
  it("原地替换，别的行一个字节都不动 —— 那些是用户排的顺序和注释", () => {
    const before = `${SPEC}\nsort: created desc`;
    const after = writeSort(before, { key: "难度", dir: "asc" });
    expect(after).toBe(`${SPEC}\nsort: 难度`);
    // 注释还在原位
    expect(after.split("\n")[1]).toBe("# 只看没读完的");
  });

  it("原来没有就加在末尾", () => {
    expect(writeSort(SPEC, { key: "难度", dir: "desc" })).toBe(`${SPEC}\nsort: 难度 desc`);
  });

  it("传 null 是把这一行删掉，回到默认顺序", () => {
    expect(writeSort(`${SPEC}\nsort: 难度 desc`, null)).toBe(SPEC);
    expect(writeSort(SPEC, null)).toBe(SPEC);
  });

  it("跟着原来那一行的缩进", () => {
    expect(writeSort("  sort: a", { key: "b", dir: "desc" })).toBe("  sort: b desc");
  });

  it("末尾的空行不会越加越多", () => {
    expect(writeSort("view: table\n\n", { key: "a", dir: "asc" })).toBe("view: table\nsort: a");
  });
});

describe("nextSort", () => {
  it("点同一列：升 → 降 → 无序", () => {
    expect(nextSort(null, "难度")).toEqual({ key: "难度", dir: "asc" });
    expect(nextSort({ key: "难度", dir: "asc" }, "难度")).toEqual({ key: "难度", dir: "desc" });
    expect(nextSort({ key: "难度", dir: "desc" }, "难度")).toBeNull();
  });

  it("点另一列直接从升序开始", () => {
    expect(nextSort({ key: "难度", dir: "desc" }, "status")).toEqual({ key: "status", dir: "asc" });
  });
});

describe("newNoteParent", () => {
  it("新建的那篇要落进视图收得到的范围里，否则建完不在表里", () => {
    expect(newNoteParent('from: "论文/**"')).toBe("论文.md");
    expect(newNoteParent('from: "数学/线性代数/*"')).toBe("数学/线性代数.md");
  });

  it("`from` 是全库或者没写，就建在 vault 根", () => {
    expect(newNoteParent('from: "**"')).toBeNull();
    expect(newNoteParent("view: table")).toBeNull();
  });
});

describe("readKey / writeKey", () => {
  it("读写任意键，缺了就追加", () => {
    expect(readKey(SPEC, "view")).toBe("table");
    expect(readKey(SPEC, "limit")).toBeNull();
    expect(writeKey(SPEC, "limit", "20")).toBe(`${SPEC}\nlimit: 20`);
  });

  it("原地替换，注释和键序不动", () => {
    const out = writeKey(SPEC, "view", "board");
    expect(out.split("\n")[1]).toBe("# 只看没读完的");
    expect(out).toContain("view: board");
    expect(out).not.toContain("view: table");
  });

  it("null 是删掉这一行", () => {
    expect(writeKey(SPEC, "view", null).split("\n")).toHaveLength(3);
  });
});

describe("columns", () => {
  it("读成数组", () => {
    expect(readColumns("columns: [title, 作者, 难度]")).toEqual(["title", "作者", "难度"]);
    expect(readColumns('columns: ["a b", c]')).toEqual(["a b", "c"]);
    expect(readColumns(SPEC)).toBeNull();
  });

  it("写回一行", () => {
    expect(writeColumns(SPEC, ["title", "难度"])).toBe(`${SPEC}\ncolumns: [title, 难度]`);
  });

  it("一列都不留是误操作，当成回到默认", () => {
    // 空表格没有任何可点的东西，用户就再也回不来了
    expect(writeColumns("columns: [a]", [])).toBe("");
    expect(writeColumns("columns: [a]", null)).toBe("");
  });
});

describe("where", () => {
  it("解析 and 串起来的条件", () => {
    expect(readWhere('where: status != "已读" and 难度 >= 3')).toEqual([
      { key: "status", op: "!=", value: "已读" },
      { key: "难度", op: ">=", value: "3" },
    ]);
  });

  it("没有 where 就是空条件（不是「看不懂」）", () => {
    expect(readWhere(SPEC.replace('where: status != "已读"', ""))).toEqual([]);
  });

  it("看不懂的表达式返回 null —— 界面据此提示去代码块里改，绝不擅自重写", () => {
    expect(readWhere("where: status = 已读 or 难度 >= 3")).toBeNull();
    expect(readWhere("where: (a = 1)")).toBeNull();
  });

  it("值里有空格才加引号 —— Rust 侧按空格切 token", () => {
    expect(writeWhere("", [{ key: "作者", op: "=", value: "Vaswani 等" }])).toBe(
      'where: 作者 = "Vaswani 等"',
    );
    expect(writeWhere("", [{ key: "难度", op: ">=", value: "3" }])).toBe("where: 难度 >= 3");
  });

  it("清空条件就把 where 那一行删掉", () => {
    expect(writeWhere('where: a = 1\nview: table', [])).toBe("view: table");
  });
});

describe("formatDate", () => {
  it("RFC3339 只显示日期部分", () => {
    expect(formatDate("2026-06-06T21:04:11+08:00")).toBe("2026-06-06");
    expect(formatDate("2026-06-06")).toBe("2026-06-06");
  });

  it("认不出来就原样返回 —— 替用户猜一个日期比显示原文糟得多", () => {
    expect(formatDate("2026 年 6 月")).toBe("2026 年 6 月");
    expect(formatDate("下周三")).toBe("下周三");
  });
});

describe("toDateInput", () => {
  it("`<input type=date>` 只认 YYYY-MM-DD", () => {
    expect(toDateInput("2026-06-06T21:04:11+08:00")).toBe("2026-06-06");
    expect(toDateInput("下周三")).toBe("");
  });
});

describe("isBuiltin", () => {
  it("文件本身的时间是内置列，不在 frontmatter 里", () => {
    expect(isBuiltin("created")).toBe(true);
    expect(isBuiltin("updated")).toBe(true);
    expect(isBuiltin("status")).toBe(false);
  });
});

describe("列宽", () => {
  it("读写一个来回", () => {
    const y = writeWidths("view: table", { title: 320, 作者: 140 });
    expect(y).toContain("widths: title=320, 作者=140");
    expect(readWidths(y)).toEqual({ title: 320, 作者: 140 });
  });

  it("没写就是空的，不是 null", () => {
    expect(readWidths("view: table")).toEqual({});
  });

  it("清空 = 删掉那一行，回到自适应", () => {
    const y = writeWidths("view: table\nwidths: title=320", {});
    expect(y).not.toContain("widths");
    expect(readWidths(y)).toEqual({});
  });

  it("坏值跳过，不影响同一行里别的列", () => {
    expect(readWidths("widths: title=abc, 作者=140, =90, 难度=-5")).toEqual({ 作者: 140 });
  });

  it("小数取整 —— 拖出来的像素带小数，写进文件里没必要", () => {
    expect(readWidths("widths: title=320.6")).toEqual({ title: 321 });
    expect(writeWidths("", { title: 320.6 })).toContain("title=321");
  });

  it("改宽度只动那一行，别的键原样", () => {
    const src = ['from: "论文/**"', "view: table", "sort: 难度 desc", "columns: [title]"].join("\n");
    const y = writeWidths(src, { title: 200 });
    expect(y).toContain('from: "论文/**"');
    expect(y).toContain("sort: 难度 desc");
    expect(y).toContain("columns: [title]");
  });

  it("夹紧：太窄放不下一个字，太宽会把横向滚动条拉到没边", () => {
    expect(clampColW(10)).toBe(MIN_COL_W);
    expect(clampColW(9999)).toBe(MAX_COL_W);
    expect(clampColW(200.4)).toBe(200);
  });
});
