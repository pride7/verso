/**
 * Tab 在**装好全部扩展的真编辑器**里的落点。§5.1
 *
 * 纯函数的部分在 tests/unit/editor/indent.test.ts。这里要钉的是另一件事：
 * Tab 必须被编辑器吃掉（`dispatchEvent` 返回 false 即 preventDefault）。
 * 漏出去的那一下会被浏览器当成「切焦点」，文档里有 database 视图时光标就
 * 跳到它的视图设置按钮上 —— 这正是这一段代码要修的毛病。
 *
 * 顺带钉住优先级：snippet 的 tabout 仍然排在缩进前面。
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

function mount(doc: string, cursor = doc.length) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    selection: EditorSelection.cursor(cursor),
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
    }),
  });
  views.push(view);
  view.focus();
  return view;
}

const settle = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

/** 返回「这一下 Tab 有没有被拦住」 */
function pressTab(view: EditorView, shift = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  return !view.contentDOM.dispatchEvent(event);
}

describe("Tab 落在缩进上", () => {
  it("代码块里缩进，键不外漏，光标跟着走", async () => {
    const view = mount("```\nif (a) {\nb();\n```", 13);
    await settle();
    expect(pressTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("```\nif (a) {\n  b();\n```");
    // 光标必须落在补出来的空格后面。留在前面的话屏幕上看着就是「按了没反应」，
    // 得用鼠标点一下它才动
    expect(view.state.selection.main.head).toBe(15);
  });

  it("列表项连同子树嵌进上一项，Shift-Tab 退回来", async () => {
    const view = mount("- 甲\n- 乙\n  - 丙", 7);
    await settle();
    expect(pressTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- 甲\n  - 乙\n    - 丙");
    expect(pressTab(view, true)).toBe(true);
    expect(view.state.doc.toString()).toBe("- 甲\n- 乙\n  - 丙");
  });

  it("没得缩进的时候也不放行 —— 放行就是把焦点送走", async () => {
    const view = mount("- 甲\n- 乙", 3);
    await settle();
    expect(pressTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- 甲\n- 乙");
  });

  it("公式里仍然先走 tabout", async () => {
    const view = mount("$\\sqrt{ab}$", 9);
    await settle();
    expect(pressTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("$\\sqrt{ab}$");
    expect(view.state.selection.main.head).toBe(10);
  });
});
