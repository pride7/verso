/**
 * 焦点不在正文里时，一切渲染成最终形态。DESIGN.md §4.2
 *
 * 作者报的是这个：**打开一篇以标题开头的笔记，第一行永远露着 `## `。**
 * 他还没点过正文，屏幕上却先给他看了一行 Markdown 源码。
 *
 * 根子在 live preview 的判据只看选区、不看焦点，而 CM6 的选区和焦点无关 ——
 * 新建的 EditorState 选区就在 0，标题的范围是 `[0, N]`，闭区间下就算「碰到」。
 * 公式、代码块、表格、图表在第一行时同理。
 *
 * 必须在真实浏览器里跑：焦点是浏览器的概念，happy-dom 里 `hasFocus` 怎么写都行。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor/index";
import { applySettings, DEFAULT_SETTINGS } from "../../../src/app/settings";
import "../../../src/ui/styles.css";

const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

/** 照 App 打开一篇笔记的样子建 view：选区在 0，先不给焦点 */
function mount(doc: string) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  parent.style.cssText = "position:fixed;inset:0";
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    selection: { anchor: 0 },
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

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const text = (v: EditorView) => v.contentDOM.textContent ?? "";

describe("没有焦点就没有光标可言", () => {
  it("刚打开时，第一行的标题不露 `##`", async () => {
    const v = mount("## 标题\n\n正文\n");
    await settle();
    expect(v.hasFocus, "这条测的正是「还没点过正文」").toBe(false);
    expect(text(v)).not.toContain("##");
    expect(text(v)).toContain("标题");
  });

  it("点进正文之后，光标处照常露出源码", async () => {
    const v = mount("## 标题\n\n正文\n");
    await settle();
    v.focus();
    await settle();
    expect(v.hasFocus).toBe(true);
    expect(text(v), "有焦点时光标在 0，标题该退回源码").toContain("##");
  });

  it("焦点离开正文，立刻又渲染回去", async () => {
    const v = mount("## 标题\n\n正文\n");
    await settle();
    v.focus();
    await settle();
    expect(text(v)).toContain("##");

    const away = document.createElement("input");
    document.body.appendChild(away);
    away.focus();
    await settle();
    expect(v.hasFocus).toBe(false);
    expect(text(v), "焦点走了就不该再显示编辑痕迹").not.toContain("##");
  });

  /** 第一行是别的可渲染块时同理 —— 这不是标题专属的毛病 */
  it("第一行是分割线、公式、代码块时一样", async () => {
    const hr = mount("---\n\n正文\n");
    await settle();
    expect(hr.contentDOM.querySelector(".cm-hr"), "分割线该画出来").not.toBeNull();

    const math = mount("$$\nE = mc^2\n$$\n\n正文\n");
    await settle();
    expect(text(math)).not.toContain("$$");

    const code = mount("```js\nlet a = 1;\n```\n\n正文\n");
    await settle();
    expect(text(code), "代码块的围栏该收起来").not.toContain("```");
  });
});
