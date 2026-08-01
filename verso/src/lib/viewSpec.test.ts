import { describe, expect, it } from "vitest";

import { newNoteParent, nextSort, readSort, writeSort } from "./viewSpec";

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
