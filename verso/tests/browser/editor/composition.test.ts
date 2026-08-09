/**
 * 输入法组词与 live preview 的冲突 —— 必须在真实 Chromium 里跑。
 *
 * 中文输入法在 contentDOM 里**就地**组词，CM 靠读回那段 DOM 才知道用户输入了
 * 什么。这期间只要我们动了 decoration，读回的就是一段被我们改过的 DOM。
 *
 * 用英文键盘打字**永远复现不了**（没有组词这一步），所以这条只能靠模拟
 * composition 事件来守。
 */
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import "../../../src/ui/styles.css";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc: string) {
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

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

describe("组词期间不动 decoration", () => {
  it("在行内公式后面用输入法打字，公式不会被顶掉", async () => {
    const view = mount("行内 $x$");
    await settle(250);
    view.focus();

    // 光标停在公式末尾：这时按 §4.2 显示的是源码
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    await settle();
    // 只看正文：公式输入预览那个 tooltip 里也有一份 KaTeX（§5.3）
    expect(view.contentDOM.querySelector(".katex")).toBeNull();

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(view.compositionStarted).toBe(true);
    // 输入法把组词中的字送进来：CM 读回 DOM 之后就是这样一次事务
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "啊" },
      selection: EditorSelection.cursor(view.state.doc.length + 1),
    });
    await settle(400);

    // **组词还没结束，公式必须仍然是源码。** 这里要是切成了渲染态，CM 读回的
    // 就是一段被我们换掉的 DOM —— 用户看到的是整条公式被那个字顶掉，
    // `$x$` 变成 `$啊`
    expect(view.contentDOM.querySelector(".katex"), "组词期间公式被切成了渲染态").toBeNull();

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "啊" }),
    );
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    await settle(300);

    // 组词结束之后照常渲染，而且一个字都没丢
    expect(view.state.doc.toString()).toBe("行内 $x$啊");
    expect(view.contentDOM.querySelector(".katex")).not.toBeNull();
  });
});
