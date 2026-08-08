/**
 * 段落设置的判定与改写（§4.10）。
 *
 * 这一层全是纯函数，能在 Node 里穷举 —— 而它要处理的正是「行首那截标记」
 * 的各种写法：`*` 和 `-` 都是无序列表、`1)` 和 `1.` 都是有序、待办同时长得
 * 像无序列表。认错一种的后果是删标记时删掉半截，留下 `[ ] 正文` 这种东西。
 */
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { applyBlock, blockKindOf, stripBlock, toggleBlockSpec } from "../../../src/editor/paragraph";

describe("认出这一行是哪种块", () => {
  it("标题只认一到三级，四级往上当正文", () => {
    expect(blockKindOf("# 标题")).toBe("h1");
    expect(blockKindOf("## 标题")).toBe("h2");
    expect(blockKindOf("### 标题")).toBe("h3");
    // 四到六级没有对应的菜单项，认成正文；但 stripBlock 仍然要能剥掉它
    expect(blockKindOf("#### 标题")).toBe("text");
    // 井号后面没空格的不是标题（`#标签` 是标签）
    expect(blockKindOf("#标签")).toBe("text");
  });

  it("待办排在无序列表前面 —— 它俩都以 `- ` 开头", () => {
    expect(blockKindOf("- [ ] 待办")).toBe("task");
    expect(blockKindOf("- [x] 做完了")).toBe("task");
    expect(blockKindOf("- 普通一条")).toBe("bullet");
    expect(blockKindOf("* 星号也算")).toBe("bullet");
  });

  it("有序列表认 `1.` 和 `1)`", () => {
    expect(blockKindOf("1. 一")).toBe("number");
    expect(blockKindOf("12) 十二")).toBe("number");
  });

  it("引用和正文", () => {
    expect(blockKindOf("> 引用")).toBe("quote");
    expect(blockKindOf(">引用")).toBe("quote");
    expect(blockKindOf("就是一段话")).toBe("text");
    expect(blockKindOf("")).toBe("text");
  });

  it("缩进不影响判定，剥的时候要留着", () => {
    expect(blockKindOf("    - 缩进的一条")).toBe("bullet");
    expect(stripBlock("    - 缩进的一条")).toEqual({ indent: "    ", text: "缩进的一条" });
    expect(stripBlock("#### 四级")).toEqual({ indent: "", text: "四级" });
  });
});

describe("改写一行", () => {
  it("换种类是替换，不是叠加", () => {
    expect(applyBlock("- 一条", "quote")).toBe("> 一条");
    expect(applyBlock("> 引用", "h2")).toBe("## 引用");
    expect(applyBlock("### 标题", "text")).toBe("标题");
    expect(applyBlock("- [x] 做完了", "bullet")).toBe("- 做完了");
  });

  it("缩进原样留着", () => {
    expect(applyBlock("  普通", "task")).toBe("  - [ ] 普通");
  });

  it("有序列表按第几行编号，不是五个 1", () => {
    expect(applyBlock("甲", "number", 0)).toBe("1. 甲");
    expect(applyBlock("乙", "number", 1)).toBe("2. 乙");
    expect(applyBlock("丙", "number", 2)).toBe("3. 丙");
  });
});

/** 造一个选中了某几行的 state */
function state(doc: string, from: number, to = from) {
  return EditorState.create({ doc, selection: { anchor: from, head: to } });
}

describe("整段切换", () => {
  const apply = (doc: string, from: number, to: number, kind: Parameters<typeof toggleBlockSpec>[1]) => {
    const s = state(doc, from, to);
    return s.update(toggleBlockSpec(s, kind)).state.doc.toString();
  };

  it("选中几行一起变", () => {
    const doc = "甲\n乙\n丙";
    expect(apply(doc, 0, doc.length, "bullet")).toBe("- 甲\n- 乙\n- 丙");
    expect(apply(doc, 0, doc.length, "number")).toBe("1. 甲\n2. 乙\n3. 丙");
  });

  it("已经全是这一种，再点一次变回正文", () => {
    const doc = "> 甲\n> 乙";
    expect(apply(doc, 0, doc.length, "quote")).toBe("甲\n乙");
  });

  it("只有一部分是这一种时，全都变成它", () => {
    const doc = "> 甲\n乙";
    expect(apply(doc, 0, doc.length, "quote")).toBe("> 甲\n> 乙");
  });

  it("没选东西时只动光标那一行", () => {
    const doc = "甲\n乙\n丙";
    expect(apply(doc, 2, 2, "h1")).toBe("甲\n# 乙\n丙");
  });

  /** 空行上加标题之后，光标要停在井号后面等着打字，不是行首 */
  it("光标落在正文位置上", () => {
    const s = state("", 0);
    const next = s.update(toggleBlockSpec(s, "h1")).state;
    expect(next.doc.toString()).toBe("# ");
    expect(next.selection.main.head).toBe(2);
  });
});
