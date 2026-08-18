/**
 * mermaid 图的渲染时序 —— 在真实浏览器里跑。
 *
 * 这里要验的是**别处验不了的那部分**：mermaid 是动态 import 进来的，渲染是
 * 异步的，还要靠真实布局引擎量文字宽高。decoration 生成本身在
 * `tests/unit/editor/mermaidBlock.test.ts` 里已经钉死了。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor/index";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

function mount(doc: string, anchor = 0) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    selection: { anchor },
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

const boxes = (v: EditorView) => v.dom.querySelectorAll(".cm-mermaid").length;
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

/** 等到图真的画出来。第一次要把 mermaid 那个 chunk 拉进来，给足时间 */
async function drawn(v: EditorView, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const svg = v.dom.querySelector(".cm-mermaid svg");
    if (svg) return svg;
    await settle(100);
  }
  return null;
}

const GRAPH = "```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```";

describe("mermaid 图", () => {
  it("打开笔记就渲染成图，不需要先点一下", async () => {
    const v = mount(`# 标题\n\n说明文字\n\n${GRAPH}\n`);
    await settle();
    expect(boxes(v)).toBe(1);
    expect(await drawn(v)).toBeTruthy();
  });

  // 每个用例都让光标待在块**外面** —— 光标在里面时露出源码是设计如此
  it("光标移进去露出源码，移开又画回来", async () => {
    const doc = `开头\n\n${GRAPH}\n`;
    const v = mount(doc);
    await settle();
    expect(boxes(v)).toBe(1);

    v.dispatch({ selection: { anchor: doc.indexOf("graph TD") + 2 } });
    expect(boxes(v)).toBe(0);
    // 露出源码时它就是个普通代码块，底色和行号该照常有
    expect(v.dom.querySelectorAll(".cm-code").length).toBeGreaterThan(0);

    v.dispatch({ selection: { anchor: 0 } });
    expect(boxes(v)).toBe(1);
  });

  it("停在块的边界上不算「进去了」", async () => {
    const doc = `开头\n\n${GRAPH}\n\n结尾\n`;
    const v = mount(doc);
    await settle();

    const from = doc.indexOf("```mermaid");
    for (const anchor of [from, from + GRAPH.length]) {
      v.dispatch({ selection: { anchor } });
      expect(boxes(v), `光标停在 ${anchor} 就退回了源码`).toBe(1);
    }
  });

  it("画不出来的图给出错误信息和源码，而不是一片空白", async () => {
    const v = mount("开头\n\n```mermaid\n这不是一张图\n```\n");
    await settle();
    const box = v.dom.querySelector(".cm-mermaid");
    expect(box).toBeTruthy();

    const until = Date.now() + 15000;
    while (Date.now() < until && !box!.classList.contains("is-error")) await settle(100);
    expect(box!.classList.contains("is-error")).toBe(true);
    expect(box!.textContent).toContain("这不是一张图");
  });

  it("「编辑」按钮把光标送进源码 —— 整块是 atomic range，方向键进不去", async () => {
    const doc = `开头\n\n${GRAPH}\n`;
    const v = mount(doc);
    await settle();

    const button = v.dom.querySelector<HTMLButtonElement>(".cm-mermaid-edit");
    expect(button).toBeTruthy();
    button!.click();

    const head = v.state.selection.main.head;
    expect(head).toBeGreaterThan(doc.indexOf("graph TD") - 1);
    expect(head).toBeLessThan(doc.indexOf("```", doc.indexOf("graph TD")));
    // 光标进去了，于是这一块退回源码
    expect(boxes(v)).toBe(0);
  });

  it("光标在源码里时，代码块下面接一张随输入重画的预览", async () => {
    const doc = `开头\n\n${GRAPH}\n`;
    const v = mount(doc, doc.indexOf("graph TD") + 2);
    await settle();

    const until = Date.now() + 15000;
    let preview: Element | null = null;
    while (Date.now() < until) {
      preview = v.dom.querySelector(".cm-mermaid-preview svg");
      if (preview) break;
      await settle(100);
    }
    expect(preview).toBeTruthy();

    // 光标离开这个块，预览就该收起来
    v.dispatch({ selection: { anchor: 0 } });
    await settle(100);
    expect(v.dom.querySelector(".cm-mermaid-preview")).toBeNull();
  });

  /**
   * 一度是 tooltip，于是上方装不下时 CM6 把它翻到下面 —— 正好盖住整块源码，
   * 用户在图后面看不见自己写的字。改成块级 widget 之后它占文档的位置，
   * 页面自己往下让。
   */
  it("预览不许盖住源码：它在代码块**下面**，不是浮在上面", async () => {
    const doc = `开头\n\n${GRAPH}\n`;
    const v = mount(doc, doc.indexOf("graph TD") + 2);

    const until = Date.now() + 15000;
    let preview: HTMLElement | null = null;
    while (Date.now() < until) {
      preview = v.dom.querySelector<HTMLElement>(".cm-mermaid-preview");
      if (preview?.querySelector("svg")) break;
      await settle(100);
    }
    expect(preview?.querySelector("svg")).toBeTruthy();

    // 源码那几行的最低点，必须都在预览的上边界之上
    const top = preview!.getBoundingClientRect().top;
    const lines = [...v.dom.querySelectorAll(".cm-code")];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const rect = line.getBoundingClientRect();
      expect(rect.bottom, `「${line.textContent}」被预览压住了`).toBeLessThanOrEqual(top + 1);
    }
  });
});
