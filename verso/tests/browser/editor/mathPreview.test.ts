/**
 * 公式输入预览 —— 在真实 Chromium 里跑。
 *
 * tooltip 的挂载与定位走 CM6 的测量循环，纯 Node 里没有布局引擎，
 * `showTooltip` 根本不会产出 DOM —— 那种环境里「没弹」和「不该弹」
 * 长得一模一样，只有假阴性。
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { applySourceMode, createExtensions } from "../../../src/editor";
import "../../../src/ui/styles.css";

const DOC = [
  "一段正文，还有 $E = mc^2$。",
  "",
  "$$",
  "A = U \\Sigma V^{\\mathsf{T}}",
  "$$",
  "",
  "咖啡 $5 起，精装本 $20。",
  "",
].join("\n");

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

/** 等语法树解析 + tooltip 落地（tooltip 在测量循环里挂 DOM，要过一帧） */
const settle = () => new Promise((r) => setTimeout(r, 400));

const preview = (view: EditorView) =>
  view.dom.querySelector<HTMLElement>(".cm-math-preview");

describe("公式输入预览", () => {
  it("光标不在公式里时没有预览", async () => {
    const view = mount();
    await settle();
    view.dispatch({ selection: EditorSelection.single(2) });
    await settle();
    expect(preview(view)).toBeNull();
  });

  it("光标进入行内公式弹出渲染结果，移出后消失", async () => {
    const view = mount();
    await settle();

    // `$E = mc^2$` 内部
    const pos = DOC.indexOf("mc^2");
    view.dispatch({ selection: EditorSelection.single(pos) });
    await settle();

    const tip = preview(view)!;
    expect(tip).not.toBeNull();
    // 是 KaTeX 渲染出来的成品，不是把源码抄一遍
    expect(tip.querySelector(".katex")).not.toBeNull();
    expect(tip.textContent).not.toContain("$");

    view.dispatch({ selection: EditorSelection.single(2) });
    await settle();
    expect(preview(view)).toBeNull();
  });

  it("块级公式用 display 模式渲染", async () => {
    const view = mount();
    await settle();

    const pos = DOC.indexOf("Sigma");
    view.dispatch({ selection: EditorSelection.single(pos) });
    await settle();

    expect(preview(view)!.querySelector(".katex-display")).not.toBeNull();
  });

  it("输入时预览跟着更新", async () => {
    const view = mount();
    await settle();

    const pos = DOC.indexOf("$E = mc^2$") + 1;
    view.dispatch({ selection: EditorSelection.single(pos) });
    await settle();

    view.dispatch({
      changes: { from: pos, insert: "F=ma\\quad " },
      selection: EditorSelection.single(pos + 10),
      userEvent: "input.type",
    });
    await settle();

    expect(preview(view)!.textContent).toContain("F=ma");
  });

  it("货币写法不弹预览 —— §5.2 那个已知取舍只许影响 snippet", async () => {
    const view = mount();
    await settle();

    // `$5 起，精装本 $20` 之间：mathContextAt 会判成「未闭合的公式」
    const pos = DOC.indexOf("精装本");
    view.dispatch({ selection: EditorSelection.single(pos) });
    await settle();
    expect(preview(view)).toBeNull();
  });

  it("源码模式下不弹 —— 那个模式的本意就是只看源码", async () => {
    const view = mount();
    await settle();
    applySourceMode(view, true);

    const pos = DOC.indexOf("mc^2");
    view.dispatch({ selection: EditorSelection.single(pos) });
    await settle();
    expect(preview(view)).toBeNull();
  });
});
