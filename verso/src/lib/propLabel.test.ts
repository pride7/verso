import { describe, expect, it } from "vitest";

import { hasLabel, propLabel } from "./propLabel";

describe("属性的显示名", () => {
  it("内置列和约定俗成的键有中文名", () => {
    expect(propLabel("created")).toBe("创建时间");
    expect(propLabel("updated")).toBe("更新时间");
    expect(propLabel("tags")).toBe("标签");
    expect(propLabel("title")).toBe("标题");
  });

  it("**用户自己起的名一个字都不能动**", () => {
    for (const k of ["status", "作者", "难度", "读于", "封面", "Created", "TAGS"]) {
      expect(propLabel(k)).toBe(k);
    }
  });

  it("大小写敏感 —— `Created` 是用户自己写的另一个键", () => {
    expect(hasLabel("created")).toBe(true);
    expect(hasLabel("Created")).toBe(false);
  });

  it("空串和奇怪的键原样返回，不抛", () => {
    expect(propLabel("")).toBe("");
    expect(propLabel("__proto__")).toBe("__proto__");
  });
});
