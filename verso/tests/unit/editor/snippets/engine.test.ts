/**
 * 在真实的 CodeMirror state 上模拟逐字输入。
 *
 * 这是本项目最重要的一组测试：M2 的验收标准是「抄一页教材公式比 Obsidian 快」，
 * 而那取决于这里每一条是否成立。纯逻辑测试（match.test.ts）保证算得对，
 * 这组保证接到编辑器里之后**真的会发生**。
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { markdownExtended } from "../../../../src/editor/markdownExtended";
import { buildSnippets, shiftTabSpec, snippetEngine, tabSpec } from "../../../../src/editor/snippets/index";

function fresh(doc = "", anchor = doc.length) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM, markdownExtended], codeLanguages: [] }),
      snippetEngine(),
    ],
  });
}

/** 逐字符输入，每个字符都是一次独立的 `input.type` 事务 —— 与真实打字一致 */
function type(state: EditorState, text: string): EditorState {
  for (const ch of text) {
    const pos = state.selection.main.head;
    state = state.update({
      changes: { from: pos, insert: ch },
      selection: { anchor: pos + 1 },
      userEvent: "input.type",
      scrollIntoView: true,
    }).state;
  }
  return state;
}

const SNIPPETS = buildSnippets();

function tab(state: EditorState): EditorState {
  const spec = tabSpec(state, SNIPPETS);
  return spec ? state.update(spec).state : state;
}

/** 用 `|` 标出光标位置，断言起来一目了然 */
function render(state: EditorState): string {
  const p = state.selection.main.head;
  return state.doc.sliceString(0, p) + "|" + state.doc.sliceString(p);
}

describe("自动展开", () => {
  it("公式里打 // 得到分式，光标落在分子", () => {
    const s = type(fresh(), "$//");
    expect(render(s)).toBe("$\\frac{|}{}");
  });

  it("正文里打 // 什么都不发生", () => {
    expect(render(type(fresh(), "//"))).toBe("//|");
  });

  it("mk 从正文进入数学模式，光标落在两个 $ 中间", () => {
    expect(render(type(fresh(), "mk"))).toBe("$|$");
  });

  it("希腊字母", () => {
    expect(render(type(fresh(), "$@a"))).toBe("$\\alpha|");
  });

  it("上标紧贴前一个符号：xsr → x^{2}", () => {
    expect(render(type(fresh(), "$xsr"))).toBe("$x^{2}|");
  });

  it("函数名自动加反斜杠", () => {
    expect(render(type(fresh(), "$sin"))).toBe("$\\sin|");
  });

  /** 最关键的一条：在公式里写变量名不能被吃掉 */
  it("公式里的普通标识符不被误触", () => {
    expect(render(type(fresh(), "$point"))).toBe("$point|");
    expect(render(type(fresh(), "$print"))).toBe("$print|");
  });

  it("行内代码里不展开", () => {
    expect(render(type(fresh(), "`//"))).toBe("`//|");
  });

  it("代码块里不展开", () => {
    const s = type(fresh("```py\n\n```", 6), "//");
    expect(s.doc.toString()).toContain("//");
    expect(s.doc.toString()).not.toContain("\\frac");
  });
});

describe("跳转点与 Tab", () => {
  it("Tab 依次走过每个跳转点", () => {
    let s = type(fresh(), "$//");
    expect(render(s)).toBe("$\\frac{|}{}"); // $0 分子
    s = tab(s);
    expect(render(s)).toBe("$\\frac{}{|}"); // $1 分母
    s = tab(s);
    expect(render(s)).toBe("$\\frac{}{}|"); // $2 整体之后
  });

  it("跳转点里打的字会留在原地，后续跳转点跟着移动", () => {
    let s = type(fresh(), "$//");
    s = type(s, "a");
    expect(render(s)).toBe("$\\frac{a|}{}");
    s = tab(s);
    s = type(s, "b");
    expect(render(s)).toBe("$\\frac{a}{b|}");
  });

  it("跳转点用完之后 Tab 走 tabout", () => {
    let s = type(fresh(), "$//");
    s = tab(s);
    s = tab(s);
    // 已在末尾，后面还有 `$`？没有 —— 这里 doc 是 `$\frac{}{}`，无闭合符号
    expect(tabSpec(s)).toBeNull();
  });

  it("tabout 跳出括号", () => {
    // 光标在 \frac{a|}{b} 的分子里，Tab 应跳到 } 之后
    const s = fresh("$\\sqrt{ab}$", 9);
    const after = tab(s);
    expect(render(after)).toBe("$\\sqrt{ab}|$");
  });

  it("正文里的 Tab 不做 tabout，交给默认行为", () => {
    expect(tabSpec(fresh("一段话（括号）", 3))).toBeNull();
  });

  it("Shift-Tab 退回 snippet 起点", () => {
    let s = type(fresh(), "$//");
    s = tab(s);
    const back = shiftTabSpec(s);
    expect(back).not.toBeNull();
    s = s.update(back!).state;
    expect(render(s)).toBe("$|\\frac{}{}");
  });

  it("光标移出 snippet 范围后放弃跳转点", () => {
    let s = type(fresh(), "$//");
    // 跳到文档开头 —— 已经离开这段 snippet
    s = s.update({ selection: { anchor: 0 } }).state;
    expect(tabSpec(s)).toBeNull();
  });
});

describe("矩阵骨架（§5.3）", () => {
  /**
   * `pmat` 与 `pmat3x3` 是前缀关系。两个都自动展开的话，打到第 5 个字符
   * `pmat` 就先炸了，带尺寸的那条永远轮不到 —— 所以 `pmat` 改成 Tab 触发。
   */
  it("pmat 不自动展开，给带尺寸的形式让路", () => {
    expect(type(fresh(), "$pmat").doc.toString()).toBe("$pmat");
  });

  it("pmat 按 Tab 展开成普通矩阵", () => {
    const s = tab(type(fresh(), "$pmat"));
    expect(s.doc.toString()).toBe("$\\begin{pmatrix}  \\end{pmatrix}");
  });

  it("pmat2x2 生成骨架，Tab 在单元格间跳", () => {
    let s = type(fresh(), "$pmat2x2");
    expect(s.doc.toString()).toBe("$\\begin{pmatrix}  &  \\\\  &  \\end{pmatrix}");
    s = type(s, "1");
    s = tab(s);
    s = type(s, "2");
    s = tab(s);
    s = type(s, "3");
    s = tab(s);
    s = type(s, "4");
    expect(s.doc.toString()).toBe("$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}");
  });
});

describe("撤销", () => {
  it("展开与触发它的输入是同一步撤销", () => {
    // transactionFilter 返回 [tr, expansion]，两者作为一组事务应用。
    // 这里只验证展开确实发生在同一次 update 里 —— 真正的撤销行为
    // 由 history 扩展负责，在应用里手测。
    const before = fresh("$");
    const after = before.update({
      changes: { from: 1, insert: "/" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    // 先打一个 `/` 还不够触发
    expect(after.state.doc.toString()).toBe("$/");

    const s2 = after.state.update({
      changes: { from: 2, insert: "/" },
      selection: { anchor: 3 },
      userEvent: "input.type",
    });
    // 第二个 `/` 一次性完成「插入 + 展开」
    expect(s2.state.doc.toString()).toBe("$\\frac{}{}");
  });
});
