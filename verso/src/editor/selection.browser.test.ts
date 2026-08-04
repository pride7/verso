/**
 * 选区画法 —— 在真实 Chromium 里跑。
 *
 * 有意不用 CodeMirror 的 drawSelection（理由见 index.ts）：它自绘的选区把
 * 跨行选择的中间行整行铺满，在排好版的文章里是一大块悬在文字外的底色。
 * 原生 ::selection 只贴着文字画，和 Obsidian 一致。
 *
 * 这类"声明性"的东西只能钉住配置本身：铺不铺满是合成器画出来的，DOM 和
 * 几何都量不到（和 pageScroll 钉 overscroll-behavior 是同一招）。
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from ".";
import "../styles.css";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

function mount() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc: "第一段正文。\n\n第二段正文，长一些，用来跨行选择。\n",
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

describe("选区用原生 ::selection 画", () => {
  it("没有 drawSelection 的自绘图层 —— 加回去中间行会整行铺满", async () => {
    const view = mount();
    view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
    await new Promise((r) => setTimeout(r, 100));
    expect(view.dom.querySelector(".cm-selectionLayer")).toBeNull();
    expect(view.dom.querySelector(".cm-selectionBackground")).toBeNull();
  });

  it("::selection 配了主题色，原生选区不是浏览器默认的蓝", () => {
    const view = mount();
    const line = view.dom.querySelector(".cm-line")!;
    const bg = getComputedStyle(line, "::selection").backgroundColor;
    // 没配到的话这里是全透明（rgba(0, 0, 0, 0)）或者空串
    expect(bg).toBeTruthy();
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });
});
