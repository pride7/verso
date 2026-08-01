import { describe, expect, it } from "vitest";

import { blockOf, stripFences } from "./FrontmatterSource";

describe("blockOf", () => {
  it("把文件里的 YAML 原文包成带围栏的整块", () => {
    expect(blockOf("title: 论文\n")).toBe("---\ntitle: 论文\n---");
  });

  it("原文末尾少个换行也补上 —— 否则 --- 会跟在值后面", () => {
    expect(blockOf("title: 论文")).toBe("---\ntitle: 论文\n---");
  });

  it("空 frontmatter 也是一块，只是中间没东西", () => {
    expect(blockOf("")).toBe("---\n---");
  });

  it("没有 frontmatter 的笔记给空串，组件据此不渲染", () => {
    expect(blockOf(null)).toBe("");
  });
});

describe("stripFences", () => {
  it("去掉首尾两道围栏", () => {
    expect(stripFences("---\ntitle: 论文\nstatus: 在读\n---")).toBe("title: 论文\nstatus: 在读\n");
  });

  it("末尾多出来的空行不影响找收尾围栏", () => {
    expect(stripFences("---\ntitle: 论文\n---\n\n")).toBe("title: 论文\n");
  });

  it("收尾写成 `...` 也认 —— YAML 允许", () => {
    expect(stripFences("---\ntitle: 论文\n...")).toBe("title: 论文\n");
  });

  it("围栏被删掉一道甚至两道，中间那段照样交出去", () => {
    // 围栏是显示时加的边界，用户不该为它的完整性负责；
    // 真写错的 YAML 反正会被 Rust 挡住，不会写进文件
    expect(stripFences("---\ntitle: 论文\n")).toBe("title: 论文\n");
    expect(stripFences("title: 论文\n")).toBe("title: 论文\n");
  });

  it("整块删光 = 空 YAML = 清掉全部自定义属性", () => {
    expect(stripFences("")).toBe("");
    expect(stripFences("---\n---")).toBe("");
    expect(stripFences("  \n\n")).toBe("");
  });

  it("正文里的 `---` 不会被误当成围栏 —— 只看首尾两行", () => {
    // 值里出现 `---` 是合法的（比如 `sep: ---`），不能顺手删掉
    expect(stripFences("---\nsep: ---\ntitle: 论文\n---")).toBe("sep: ---\ntitle: 论文\n");
  });
});
