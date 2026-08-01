import { describe, expect, it } from "vitest";

import { parseCustomSnippets } from "./custom";

describe("自定义 snippet 解析", () => {
  it("空文本不是错误", () => {
    expect(parseCustomSnippets("   ")).toEqual({ specs: [], errors: [] });
  });

  it("正常的一条能解析出来", () => {
    const r = parseCustomSnippets('[{"trigger":"@a","replacement":"\\\\alpha","options":"mA"}]');
    expect(r.errors).toEqual([]);
    expect(r.specs).toEqual([
      { trigger: "@a", replacement: "\\alpha", options: "mA", priority: undefined, description: undefined },
    ]);
  });

  it("options 可以省略", () => {
    const r = parseCustomSnippets('[{"trigger":"@a","replacement":"x"}]');
    expect(r.errors).toEqual([]);
    expect(r.specs[0].options).toBe("");
  });

  // 这条是整个模块存在的理由：一条写坏了不能连累其他。
  // 用户的 snippet 表会有几百条，为第 87 条的拼写错误让前 86 条失效
  // 等于让人在最熟的输入法上突然失去手感，还完全不知道为什么
  it("坏的那条被跳过，好的照常生效", () => {
    const r = parseCustomSnippets(
      '[{"trigger":"@a","replacement":"x"},{"replacement":"没有 trigger"},{"trigger":"@b","replacement":"y"}]',
    );
    expect(r.specs.map((s) => s.trigger)).toEqual(["@a", "@b"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("第 2 条");
  });

  it("错误信息要说清是第几条 —— 按人数的方式从 1 开始", () => {
    const r = parseCustomSnippets('[{"trigger":"@a","replacement":"x"},"这不是对象"]');
    expect(r.errors[0]).toContain("第 2 条");
  });

  it("JSON 本身坏了要说是 JSON 的问题", () => {
    const r = parseCustomSnippets("[{trigger: '@a'}]");
    expect(r.specs).toEqual([]);
    expect(r.errors[0]).toContain("JSON");
  });

  it("最外层不是数组时点明实际是什么", () => {
    expect(parseCustomSnippets('{"trigger":"@a"}').errors[0]).toContain("数组");
  });

  it("不认识的 options 字母要列出可用的有哪些", () => {
    const r = parseCustomSnippets('[{"trigger":"@a","replacement":"x","options":"mZ"}]');
    expect(r.specs).toEqual([]);
    expect(r.errors[0]).toContain("Z");
    expect(r.errors[0]).toContain("词边界");
  });

  it("正则写坏了在这里就要拦住，不要等到运行时才炸", () => {
    const r = parseCustomSnippets('[{"trigger":"([a-z","replacement":"x","options":"rA"}]');
    expect(r.specs).toEqual([]);
    expect(r.errors[0]).toContain("正则无效");
  });

  it("非正则的 snippet 里写括号不算错", () => {
    const r = parseCustomSnippets('[{"trigger":"([a-z","replacement":"x","options":"A"}]');
    expect(r.errors).toEqual([]);
  });

  // 重复触发词多半是改到一半忘了删旧的。不拦，但一定要说 ——
  // 「改了没反应」是最难自己诊断的一种状况
  it("触发词重复要提醒，但两条都保留", () => {
    const r = parseCustomSnippets(
      '[{"trigger":"@a","replacement":"x"},{"trigger":"@a","replacement":"y"}]',
    );
    expect(r.specs).toHaveLength(2);
    expect(r.errors[0]).toContain("重复");
  });

  it("null 不能被当成对象混进去", () => {
    const r = parseCustomSnippets('[null,{"trigger":"@a","replacement":"x"}]');
    expect(r.specs).toHaveLength(1);
    expect(r.errors[0]).toContain("null");
  });

  it("priority 和 description 类型不对要单独报", () => {
    const r = parseCustomSnippets('[{"trigger":"@a","replacement":"x","priority":"高"}]');
    expect(r.errors[0]).toContain("priority");
  });
});
