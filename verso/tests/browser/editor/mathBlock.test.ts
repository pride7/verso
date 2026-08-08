/** 块公式解析与 live preview 的真实布局回归。 */
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import "katex/dist/katex.min.css";
import "../../../src/ui/styles.css";

const SCREENSHOT_DOC = String.raw`目前主要看的是TV (total variation distance)
对于每一行，decode之后对应一个
$$
s_k \in \{1,\ldots,M\}.
$$
然后再估计生成的状态概率
$$
\widehat p_{k,m}
=
\frac{1}{N}\sum_{n=1}^{N}
\mathbf{1}[s_k^{(n)}=m].
$$
然后就可以计算`;

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc = "") {
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

const settle = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

function blockMathNodes(view: EditorView): string[] {
  const found: string[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === "BlockMath") {
        found.push(view.state.doc.sliceString(node.from, node.to));
      }
    },
  });
  return found;
}

function renderedBlocks(view: EditorView): HTMLElement[] {
  return [...view.dom.querySelectorAll<HTMLElement>(".cm-math-block")];
}

async function expectScreenshotFormulaStructure(view: EditorView) {
  await settle(800);
  expect(blockMathNodes(view)).toEqual([
    expect.stringContaining("ldots"),
    expect.stringContaining("widehat"),
  ]);
  expect(syntaxTree(view.state).toString()).not.toContain("SetextHeading");
  const blocks = renderedBlocks(view);
  expect(blocks).toHaveLength(2);
  expect(blocks.every((block) => !block.classList.contains("cm-math-error"))).toBe(true);
}

describe("块公式", () => {
  it("直接打开截图中的无空行、多行等号公式", async () => {
    await expectScreenshotFormulaStructure(mount(SCREENSHOT_DOC));
  });

  it("逐字符输入截图中的公式也保持正确结构", async () => {
    const view = mount();
    for (const character of SCREENSHOT_DOC) {
      const at = view.state.doc.length;
      view.dispatch({
        changes: { from: at, insert: character },
        selection: EditorSelection.single(at + character.length),
        userEvent: "input.type",
      });
    }
    view.dispatch({ selection: EditorSelection.single(0) });
    await expectScreenshotFormulaStructure(view);
  });

  it("未闭合块公式不会丢掉末尾字符", async () => {
    const view = mount("正文\n\n$$\nabc");
    await settle();
    const block = renderedBlocks(view)[0];
    expect(block).toBeDefined();
    expect(block.classList.contains("cm-math-error")).toBe(false);
    expect(block.textContent).toContain("abc");
  });

  it("引用块公式不会把引用标记交给 KaTeX", async () => {
    const doc = "> 正文\n> $$\n> a=1\n> $$";
    const view = mount(doc);
    await settle();

    const block = renderedBlocks(view)[0];
    expect(block).toBeDefined();
    expect(block.classList.contains("cm-math-error")).toBe(false);
    expect(block.textContent).toContain("a=1");
    expect(block.textContent).not.toContain(">");

    view.dispatch({ selection: EditorSelection.single(doc.indexOf("a=1") + 1) });
    await settle();
    const preview = view.dom.querySelector<HTMLElement>(".cm-math-preview");
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain("a=1");
    expect(preview!.textContent).not.toContain(">");
  });

  it("跨行公式只按渲染结果占高，不保留源码行盒或 KaTeX 默认外边距", async () => {
    const doc = String.raw`训练可以采用：

$$
\mathcal L
=
\lambda_{edit}+\lambda_{budget}\sum_i r_i
$$

后文`;
    const view = mount(doc);
    await settle();
    const block = renderedBlocks(view)[0];
    const display = block.querySelector<HTMLElement>(".katex-display")!;

    // 没有 block:true 时 widget 会落进 .cm-line，上下凭空各多一个正文行盒。
    expect(block.closest(".cm-line")).toBeNull();
    expect(getComputedStyle(display).marginTop).toBe("0px");
    expect(getComputedStyle(display).marginBottom).toBe("0px");
    expect(parseFloat(getComputedStyle(block).paddingTop)).toBeLessThan(8);
    expect(block.getBoundingClientRect().height).toBeLessThan(105);
  });
});
