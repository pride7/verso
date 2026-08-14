/**
 * 打字时的 snippet 提示 —— 在真实 Chromium 里跑。
 *
 * 理由同 `mathPreview.test.ts`：tooltip 的挂载走 CM6 的测量循环，纯 Node
 * 里 `showTooltip` 不产出 DOM，「没弹」和「不该弹」分不开。候选怎么挑由
 * `tests/unit/core/snippets/hint.test.ts` 守，这里只验接线：什么时候弹、
 * Tab / ↑↓ / Esc 走不走得通。
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import "../../../src/ui/styles.css";

const DOC = ["行内公式 $x = $ 在这里。", "", "正文一行。", ""].join("\n");

/** `$x = ` 之后、闭合 `$` 之前 —— 数学模式内 */
const IN_MATH = DOC.indexOf("$x = ") + 5;
const IN_TEXT = DOC.indexOf("正文一行") + 2;

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

function mount(doc = DOC) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
    }),
  });
  views.push(view);
  return view;
}

const settle = () => new Promise((r) => setTimeout(r, 400));

const hint = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-snippet-hint");
const rows = (view: EditorView) => [
  ...view.dom.querySelectorAll<HTMLElement>(".cm-snippet-hint-item"),
];

/** 一次一个字符地打，走的正是真实输入那条路（`input.type`） */
async function type(view: EditorView, text: string, at = view.state.selection.main.head) {
  let pos = at;
  for (const ch of text) {
    view.dispatch({
      changes: { from: pos, insert: ch },
      selection: EditorSelection.single(pos + 1),
      userEvent: "input.type",
    });
    pos = view.state.selection.main.head;
  }
  await settle();
}

function key(view: EditorView, k: string) {
  const opts: KeyboardEventInit = { key: k, bubbles: true, cancelable: true };
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", opts));
}

describe("snippet 打字提示", () => {
  it("在公式里打出前缀就列出候选，含触发词与说明", async () => {
    const view = mount();
    await settle();
    await type(view, "su", IN_MATH);

    expect(hint(view)).not.toBeNull();
    const first = rows(view)[0];
    expect(first.textContent).toContain("sum");
    expect(first.textContent).toContain("求和");
    // 已经打出来的那截单独加重，剩下的才是「还差几个字符」
    expect(first.querySelector(".cm-snippet-hint-trigger b")!.textContent).toBe("su");
    // 符号是 KaTeX 渲染出来的成品，不是把 LaTeX 源码抄一遍
    expect(first.querySelector(".katex")).not.toBeNull();
  });

  it("正文里不弹", async () => {
    const view = mount();
    await settle();
    await type(view, "su", IN_TEXT);
    expect(hint(view)).toBeNull();
  });

  it("Tab 展开当前高亮的那条", async () => {
    const view = mount();
    await settle();
    await type(view, "su", IN_MATH);

    key(view, "Tab");
    await settle();
    expect(view.state.doc.toString()).toContain("\\sum_{}^{}");
    expect(hint(view)).toBeNull();
  });

  it("↑↓ 换一条，Tab 展开的就是换过去的那条", async () => {
    const view = mount();
    await settle();
    await type(view, "su", IN_MATH);
    expect(rows(view)[0].classList).toContain("is-active");

    key(view, "ArrowDown");
    await settle();
    expect(rows(view)[1].classList).toContain("is-active");

    key(view, "Tab");
    await settle();
    // 第二条是 `sub`
    expect(view.state.doc.toString()).toContain("\\subset");
  });

  it("Esc 收起来，不动文档", async () => {
    const view = mount();
    await settle();
    await type(view, "su", IN_MATH);

    const before = view.state.doc.toString();
    key(view, "Escape");
    await settle();
    expect(hint(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(before);
  });

  it("打完整触发词自动展开后不再留着提示条", async () => {
    const view = mount();
    await settle();
    await type(view, "sum", IN_MATH);

    expect(view.state.doc.toString()).toContain("\\sum_{}^{}");
    expect(hint(view)).toBeNull();
  });

  it("移动光标就收起来 —— 提示条是给正在往下打的人看的", async () => {
    const view = mount();
    await settle();
    await type(view, "su", IN_MATH);
    expect(hint(view)).not.toBeNull();

    view.dispatch({ selection: EditorSelection.single(IN_TEXT) });
    await settle();
    expect(hint(view)).toBeNull();
  });
});
