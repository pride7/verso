import { describe, expect, it } from "vitest";

import { continuationPrefix } from "../../../src/editor/lineBreak";

describe("段内换行的续行缩进", () => {
  it("普通正文不增加缩进", () => {
    expect(continuationPrefix("正文")).toBe("");
  });

  it("列表续行与内容列对齐，但不创建新项目", () => {
    expect(continuationPrefix("- 条目")).toBe("  ");
    expect(continuationPrefix("10. 条目")).toBe("    ");
    expect(continuationPrefix("  - [ ] 任务")).toBe("        ");
  });

  it("引用续行保留引用标记", () => {
    expect(continuationPrefix("> 引用")).toBe("> ");
    expect(continuationPrefix("> - 条目")).toBe(">   ");
  });
});
