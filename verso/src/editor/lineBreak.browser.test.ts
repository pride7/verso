/**
 * `Shift+Enter` 与光标几何回归。按键分发和真实行盒都依赖浏览器布局，纯 Node
 * 测试无法证明字符最终画在光标所在的位置。
 */
import { userEvent } from "vitest/browser";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { applySettings, DEFAULT_SETTINGS } from "../settings";
import "../styles.css";
import { createExtensions } from "./index";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc: string, anchor = doc.length) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  parent.style.cssText = "position:fixed;inset:0;width:720px";
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
  view.focus();
  views.push(view);
  return view;
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

function pressShiftEnter(view: EditorView) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function pressEnter(view: EditorView) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("Shift+Enter 段内换行", () => {
  it("正文写入标准 Markdown 硬换行并把光标放到下一行", async () => {
    const view = mount("第一行");
    pressShiftEnter(view);
    await settle();

    expect(view.state.doc.toString()).toBe("第一行  \n");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    await userEvent.keyboard("第二行");
    expect(view.state.doc.toString()).toBe("第一行  \n第二行");
  });

  it("列表内换行不创建新的项目符号", async () => {
    const view = mount("- 条目");
    pressShiftEnter(view);
    await settle();
    await userEvent.keyboard("续行");
    expect(view.state.doc.toString()).toBe("- 条目  \n  续行");
  });

  it("代码块内只插入普通换行，不添加 Markdown 尾随空格", async () => {
    const doc = "~~~txt\ncode\n~~~";
    const view = mount(doc, doc.indexOf("code") + 4);
    pressShiftEnter(view);
    await settle();
    expect(view.state.doc.toString()).toBe("~~~txt\ncode\n\n~~~");
  });
});

describe("光标与文字位置", () => {
  it("所有正文行保持统一行盒，不再叠加段落 padding", async () => {
    const view = mount("第一行\n第二行", "第一行\n".length);
    await settle();

    const lines = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")];
    expect(lines).toHaveLength(2);
    expect(Math.abs(lines[0].getBoundingClientRect().height - lines[1].getBoundingClientRect().height)).toBeLessThan(0.5);
    expect(view.contentDOM.querySelector(".cm-paragraph-break, .cm-paragraph-gap")).toBeNull();

    // 用 coordsAtPos 量光标：不再用 drawSelection 之后没有 .cm-cursor-primary
    // 这个 DOM 了，原生光标是合成器画的，只有这条 API 能拿到它的几何
    const caret = view.coordsAtPos(view.state.selection.main.head)!;
    await userEvent.keyboard("新");
    await settle();
    const secondLine = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")][1];
    const text = secondLine.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const typed = range.getBoundingClientRect();
    expect(Math.abs(typed.left - caret.left)).toBeLessThan(1.5);
    expect(typed.top).toBeLessThan(caret.bottom);
    expect(typed.bottom).toBeGreaterThan(caret.top);
  });

  it("按 Enter 后，空段首在输入第一个字前就预留段落间距", async () => {
    const doc = "上一段\n后文";
    // 光标在上一段行尾；Enter 插入的空段应当留在光标所在的第二行。
    const view = mount(doc, "上一段".length);
    pressEnter(view);
    await settle(350);

    expect(view.state.doc.toString()).toBe("上一段\n\n后文");
    const spacer = view.contentDOM.querySelector(".cm-paragraph-space");
    expect(spacer).not.toBeNull();
    // coordsAtPos 的理由同上一条测试
    const caret = view.coordsAtPos(view.state.selection.main.head)!;

    await userEvent.keyboard("新");
    await settle(100);
    const secondLine = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")][1];
    const text = secondLine.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const typed = range.getBoundingClientRect();
    expect(Math.abs(typed.left - caret.left)).toBeLessThan(1.5);
    expect(Math.abs(typed.top - caret.top)).toBeLessThan(1.5);
  });
});
