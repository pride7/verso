/**
 * `---` 分割线的 live preview。DESIGN.md §4.2
 *
 * 在真实浏览器里跑：widget 有没有真的画出一条看得见的线（宽高都要量 ——
 * 类名对了而被裁掉/零尺寸，看起来和没做一模一样，AGENTS.md 那条），
 * 以及点击/光标进出的切换，纯 Node 里一条都验不了。
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

function mount(doc: string) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  parent.style.cssText = "position:fixed;inset:0";
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    // 光标放末尾，别碰到分割线 —— 碰到就退回源码了
    selection: { anchor: doc.length },
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

const settle = () => new Promise((r) => setTimeout(r, 300));

const DOC = "上面\n\n---\n\n下面";

describe("分割线渲染", () => {
  it("`---` 渲染成一条看得见的水平线，源码藏起来", async () => {
    const v = mount(DOC);
    await settle();
    const hr = v.contentDOM.querySelector<HTMLElement>(".cm-hr")!;
    expect(hr).not.toBeNull();
    const box = hr.getBoundingClientRect();
    // 量尺寸不量类名：撑满行宽、至少 2px 高，否则等于没画
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThanOrEqual(2);
    expect(v.contentDOM.textContent).not.toContain("---");
  });

  it("`***` 和 `___` 也是分割线", async () => {
    const v = mount("上\n\n***\n\n___\n\n下");
    await settle();
    expect(v.contentDOM.querySelectorAll(".cm-hr")).toHaveLength(2);
  });

  it("光标走上去退回源码，移开再渲染", async () => {
    const v = mount(DOC);
    await settle();
    v.dispatch({ selection: { anchor: DOC.indexOf("---") + 1 } });
    await settle();
    expect(v.contentDOM.querySelector(".cm-hr")).toBeNull();
    expect(v.contentDOM.textContent).toContain("---");
    v.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(v.contentDOM.querySelector(".cm-hr")).not.toBeNull();
  });

  it("点一下线，光标进到源码里 —— 鼠标不该只能从两头绕", async () => {
    const v = mount(DOC);
    await settle();
    const hr = v.contentDOM.querySelector<HTMLElement>(".cm-hr")!;
    const box = hr.getBoundingClientRect();
    hr.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    await settle();
    expect(v.state.selection.main.head).toBe(DOC.indexOf("---"));
    expect(v.contentDOM.textContent).toContain("---");
  });

  it("紧跟在段落下面的 `---` 是 setext 标题，不是分割线", async () => {
    const v = mount("标题\n---\n\n正文");
    await settle();
    expect(v.contentDOM.querySelector(".cm-hr")).toBeNull();
  });
});
