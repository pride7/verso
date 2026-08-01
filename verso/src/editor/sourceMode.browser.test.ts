/**
 * 源码模式 —— 在真实 Chromium 里跑。
 *
 * 纯 Node 验不了：live preview 的装饰要等语法树解析完才出现（AGENTS.md
 * 「database 视图的解析时序」），而没有布局引擎时 KaTeX、表格、widget
 * 一个都不会真的挂上 DOM —— 那种环境里「渲染没了」和「本来就没渲染过」
 * 长得一模一样，测试只会给假阳性。
 */
import { undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { applySourceMode, createExtensions } from ".";
import "../styles.css";

const DOC = [
  "# 标题",
  "",
  "一段**加粗**的正文，还有 $E = mc^2$。",
  "",
  "$$",
  "A = U \\Sigma V^{\\mathsf{T}}",
  "$$",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "> [!note] 提示",
  "> callout 正文",
  "",
].join("\n");

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

function mount(sourceMode = false) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc: DOC,
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
      sourceMode,
    }),
  });
  views.push(view);
  return view;
}

/** 等语法树解析 + decoration 落地 */
const settle = () => new Promise((r) => setTimeout(r, 400));

/** 渲染出来的成品有哪些 */
function rendered(view: EditorView) {
  const dom = view.dom;
  return {
    math: dom.querySelectorAll(".katex").length,
    table: dom.querySelectorAll(".cm-table").length,
    callout: dom.querySelectorAll(".cm-callout").length,
  };
}

describe("源码模式", () => {
  it("默认是预览：公式、表格、callout 都渲染成成品", async () => {
    const view = mount();
    await settle();
    const r = rendered(view);
    expect(r.math).toBeGreaterThan(0);
    expect(r.table).toBeGreaterThan(0);
    expect(r.callout).toBeGreaterThan(0);
  });

  it("切进源码模式后成品全部消失，源码原样露出来", async () => {
    const view = mount();
    await settle();

    applySourceMode(view, true);
    await settle();

    expect(rendered(view)).toEqual({ math: 0, table: 0, callout: 0 });
    // 光看"没有 .katex"不够 —— 装饰被换掉和整块内容消失长得一样。
    // 源码本身必须在页面上看得见
    expect(view.dom.textContent).toContain("$$");
    expect(view.dom.textContent).toContain("| a | b |");
    expect(view.dom.textContent).toContain("**加粗**");
    expect(view.dom.textContent).toContain("# 标题");
  });

  it("切回来能恢复", async () => {
    const view = mount(true);
    await settle();
    expect(rendered(view).math).toBe(0);

    applySourceMode(view, false);
    await settle();
    expect(rendered(view).math).toBeGreaterThan(0);
  });

  it("切模式不动光标、不清撤销历史 —— compartment 存在的全部理由", async () => {
    const view = mount();
    await settle();

    const original = view.state.doc.toString();
    // 敲点东西，制造一段撤销历史
    view.dispatch({ changes: { from: 0, insert: "前言\n\n" }, userEvent: "input.type" });
    const typed = view.state.doc.toString();
    const anchor = 5;
    view.dispatch({ selection: EditorSelection.single(anchor) });

    applySourceMode(view, true);
    await settle();

    expect(view.state.selection.main.anchor).toBe(anchor);
    expect(view.state.doc.toString()).toBe(typed);

    // 撤销必须还能用。重建 EditorView 的话历史会跟着没，这条就会挂
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
  });

  it("源码模式下高亮还在 —— 要的是源码，不是纯文本", async () => {
    const view = mount(true);
    await settle();

    // 标题那一行的字号仍然来自 versoHighlighting（1.85em），
    // 只是 `#` 不再被藏起来。摘掉高亮的话这里会退回正文字号
    const line = [...view.dom.querySelectorAll<HTMLElement>(".cm-line")].find((l) =>
      l.textContent?.startsWith("# 标题"),
    )!;
    const span = line.querySelector("span") ?? line;
    const body = parseFloat(getComputedStyle(view.contentDOM).fontSize);
    expect(parseFloat(getComputedStyle(span).fontSize)).toBeGreaterThan(body * 1.5);
  });
});
