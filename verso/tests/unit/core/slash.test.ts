import { describe, expect, it } from "vitest";

import { applyCaret, BUILTIN_SLASH, parseSlashCustom, slashItems } from "../../../src/core/slash";

describe("光标位", () => {
  it("$0 标出落点，自身不留下字符", () => {
    expect(applyCaret("## $0")).toEqual({ text: "## ", caret: 3 });
    expect(applyCaret("==$0==")).toEqual({ text: "====", caret: 2 });
  });

  it("没写 $0 就落在末尾", () => {
    expect(applyCaret("---")).toEqual({ text: "---", caret: 3 });
  });

  /**
   * 原来的标记是 `|`，而表格模板本身全是竖线 —— `indexOf("|")` 找到的是
   * 第一根，插出来的表格少一根竖线、光标还停在行首。这条钉住它不再复发。
   */
  it("表格模板里的竖线不再被当成光标位", () => {
    const t = BUILTIN_SLASH.find((b) => b.label === "表格")!.template!;
    const { text, caret } = applyCaret(t);
    expect(text.split("\n")[0]).toBe("|  |  |");
    expect(caret).toBeGreaterThan(0);
    // 三行都在，一根竖线都没少
    expect(text.split("\n")).toHaveLength(3);
  });

  it("每一条内置模板要么有 $0，要么是动作项", () => {
    for (const b of BUILTIN_SLASH) {
      if (b.action) continue;
      expect(b.template, `「${b.label}」没有 template`).toBeTruthy();
    }
  });
});

describe("自定义条目", () => {
  it("解析一条", () => {
    // JSON 里的换行要写成 `\n` 两个字符 —— 用户在设置里也是这么写的
    const json = JSON.stringify([
      { label: "定理", detail: "callout", template: "> [!note] 定理\n> $0" },
    ]);
    const { items, errors } = parseSlashCustom(json);
    expect(errors).toEqual([]);
    expect(items[0]).toEqual({
      label: "定理",
      detail: "callout",
      template: "> [!note] 定理\n> $0",
    });
  });

  it("detail 可以不写", () => {
    const { items, errors } = parseSlashCustom('[{"label":"甲","template":"甲$0"}]');
    expect(errors).toEqual([]);
    expect(items[0].detail).toBe("");
  });

  it("空文本 = 没有自定义，不是错误", () => {
    expect(parseSlashCustom("   ")).toEqual({ items: [], errors: [] });
  });

  it("**一条坏了不连累其他**", () => {
    const { items, errors } = parseSlashCustom(
      '[{"label":"甲","template":"a$0"},{"label":""},{"template":"没名字"},{"label":"乙","template":"b"}]',
    );
    expect(items.map((i) => i.label)).toEqual(["甲", "乙"]);
    expect(errors).toHaveLength(2);
    // 报错要说清是第几条、哪一条
    expect(errors[0]).toContain("第 2 条");
  });

  it("JSON 坏了报一句人话，不抛", () => {
    const { items, errors } = parseSlashCustom("[{label: 甲}]");
    expect(items).toEqual([]);
    expect(errors[0]).toContain("JSON 解析失败");
  });

  it("最外层不是数组也要说清楚", () => {
    expect(parseSlashCustom('{"label":"甲"}').errors[0]).toContain("数组");
  });
});

describe("最终显示哪些", () => {
  it("隐藏按 label 生效", () => {
    const list = slashItems(["表格", "高亮"], []);
    expect(list.some((i) => i.label === "表格")).toBe(false);
    expect(list.some((i) => i.label === "高亮")).toBe(false);
    expect(list).toHaveLength(BUILTIN_SLASH.length - 2);
  });

  it("自定义排在内置之后 —— 内置那几条是肌肉记忆，位置不该被顶掉", () => {
    const list = slashItems([], [{ label: "定理", detail: "", template: "x" }]);
    expect(list[0].label).toBe(BUILTIN_SLASH[0].label);
    expect(list[list.length - 1].label).toBe("定理");
  });

  it("自定义用了同名，隐藏的仍然只是内置那一条", () => {
    const list = slashItems(["表格"], [{ label: "表格", detail: "我自己的", template: "x" }]);
    expect(list.filter((i) => i.label === "表格")).toHaveLength(1);
    expect(list.find((i) => i.label === "表格")!.detail).toBe("我自己的");
  });

  it("什么都不配时就是内置那一份", () => {
    expect(slashItems([], [])).toEqual(BUILTIN_SLASH);
  });
});
