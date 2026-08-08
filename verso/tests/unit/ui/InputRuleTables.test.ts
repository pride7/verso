import { describe, expect, it } from "vitest";

import { parseCustomSnippets } from "../../../src/core/snippets/custom";
import { parseSlashCustom } from "../../../src/core/slash";
import { serializeSlashItems, serializeSnippetSpecs } from "../../../src/ui/InputRuleTables";

describe("输入规则表格的内部序列化", () => {
  it("公式规则往返时保留说明、优先级与选项", () => {
    const text = serializeSnippetSpecs([
      {
        trigger: "@a",
        replacement: "\\alpha$0",
        // 表格会按固定次序收敛标志位，避免每次点击都制造无意义的文本 diff
        options: "wAm",
        priority: 20,
        description: "alpha",
      },
    ]);

    expect(parseCustomSnippets(text)).toEqual({
      specs: [
        {
          trigger: "@a",
          replacement: "\\alpha$0",
          options: "mAw",
          priority: 20,
          description: "alpha",
        },
      ],
      errors: [],
    });
  });

  it("斜杠命令往返时保留多行模板和光标位", () => {
    const text = serializeSlashItems([
      { label: "定理", detail: "callout", template: "> [!note] 定理\n> $0" },
    ]);

    expect(parseSlashCustom(text)).toEqual({
      items: [{ label: "定理", detail: "callout", template: "> [!note] 定理\n> $0" }],
      errors: [],
    });
  });

  it("空表仍沿用空字符串，避免默认设置平白长出一段 JSON", () => {
    expect(serializeSnippetSpecs([])).toBe("");
    expect(serializeSlashItems([])).toBe("");
  });
});

