import { describe, expect, it } from "vitest";

import { looksLikeImage, parseWidth } from "./image";

describe("looksLikeImage", () => {
  it("认扩展名，不区分大小写", () => {
    expect(looksLikeImage("图.png")).toBe(true);
    expect(looksLikeImage("attachments/A.JPEG")).toBe(true);
    expect(looksLikeImage("图.svg")).toBe(true);
  });

  it("别的嵌入照旧当链接 —— `![[另一篇笔记]]` 不是图片", () => {
    expect(looksLikeImage("另一篇笔记")).toBe(false);
    expect(looksLikeImage("表格.md")).toBe(false);
    expect(looksLikeImage("png")).toBe(false);
  });
});

describe("parseWidth", () => {
  it("`|300` 是宽度", () => {
    expect(parseWidth("300")).toBe(300);
    expect(parseWidth(" 300 ")).toBe(300);
  });

  it("`|300x200` 只取宽度 —— 高度让浏览器按比例算", () => {
    // 手写的高宽比几乎总是错的，压出来的图会变形
    expect(parseWidth("300x200")).toBe(300);
    expect(parseWidth("300 x 200")).toBe(300);
  });

  it("不是数字的别名当说明文字，不是尺寸", () => {
    expect(parseWidth("左奇异向量")).toBeNull();
    expect(parseWidth("300px")).toBeNull();
    expect(parseWidth("")).toBeNull();
    expect(parseWidth(null)).toBeNull();
  });

  it("0 和负数不算 —— 0 宽的图片拖不回来", () => {
    expect(parseWidth("0")).toBeNull();
    expect(parseWidth("-40")).toBeNull();
  });
});
