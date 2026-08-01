/**
 * database 视图的渲染时序 —— 在真实浏览器里跑。
 *
 * 用户报的症状是「打开笔记看到的是源码，点一下才渲染」。这是解析时序问题：
 * `EditorState.create` 那一刻文档还没解析，StateField 算不出 decoration，
 * 而 field 只在文档或选区变化时重算 —— 于是要等一次点击。parseRefresh
 * 就是为此存在的，但它对不对只有真实的异步解析能验。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./index";
import { setViewRenderer } from "./viewBlock";

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

const rendered = (v: EditorView) => v.dom.querySelectorAll(".cm-dbview").length;
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

const VIEW_BLOCK = '```verso-view\nfrom: "论文/*"\nview: table\n```';

describe("database 视图", () => {
  it("打开笔记就渲染，不需要先点一下", async () => {
    const v = mount(`# 标题\n\n说明文字\n\n${VIEW_BLOCK}\n`);
    await settle();
    expect(rendered(v)).toBe(1);
  });

  // 注意每个用例都要让光标待在视图块**外面** —— 光标在块内时露出源码
  // 是设计如此（live preview 的规则），不是 bug
  it("一篇笔记里的多个视图都要渲染", async () => {
    const v = mount(`开头\n\n${VIEW_BLOCK}\n\n中间一段\n\n${VIEW_BLOCK}\n`);
    await settle();
    expect(rendered(v)).toBe(2);
  });

  it("光标移进去露出源码，移开又渲染回来", async () => {
    const doc = `开头\n\n${VIEW_BLOCK}\n`;
    const v = mount(doc);
    await settle();
    expect(rendered(v)).toBe(1);

    const inside = doc.indexOf("view: table");
    v.dispatch({ selection: { anchor: inside } });
    expect(rendered(v)).toBe(0);

    v.dispatch({ selection: { anchor: 0 } });
    expect(rendered(v)).toBe(1);
  });

  it("现打出来的视图也要渲染", async () => {
    const v = mount("开头\n\n");
    v.dispatch({
      changes: { from: v.state.doc.length, insert: VIEW_BLOCK },
      selection: { anchor: 0 },
    });
    await settle();
    expect(rendered(v)).toBe(1);
  });

  /**
   * widget 的高度是**后来才变的**：`toDOM` 返回的是一行占位文字，React 把
   * 表格塞进去之后它可能高几百像素。CM6 在创建时量过一次就记进高度图，
   * 外部 DOM 后来长高它并不知道 —— 于是编辑器认为文档比实际短一大截，
   * 正文往下滚会滚不到底。
   *
   * 图片（`![[图.png]]`）也是同一类：`<img>` 加载完才有高度。
   */
  it("widget 后来长高时，高度图要跟着更新", async () => {
    setViewRenderer({
      mount: (el) => {
        el.textContent = "占位";
        // 模拟 React 异步挂载出一个很高的表格
        setTimeout(() => {
          el.textContent = "";
          const tall = document.createElement("div");
          tall.style.height = "400px";
          el.appendChild(tall);
        }, 30);
      },
      unmount: () => {},
    });
    try {
      const v = mount(`开头\n\n${VIEW_BLOCK}\n\n结尾\n`);
      await settle();

      const widget = v.dom.querySelector(".cm-dbview") as HTMLElement;
      expect(widget.getBoundingClientRect().height, "widget 自己确实长高了").toBeGreaterThan(390);

      // 高度图（contentHeight）和真实 DOM 高度必须对得上。差一大截就说明
      // CM6 还按占位那一行算，文档总高偏小
      const real = v.contentDOM.getBoundingClientRect().height;
      expect(
        Math.abs(v.contentHeight - real),
        `高度图 ${v.contentHeight} vs 真实 ${real}`,
      ).toBeLessThan(20);
    } finally {
      setViewRenderer({ mount: () => {}, unmount: () => {} });
    }
  });

  it("挂上 renderer 后 widget 会交给它渲染", async () => {
    const seen: string[] = [];
    setViewRenderer({
      mount: (el, source) => {
        seen.push(source);
        el.textContent = "渲染好了";
      },
      unmount: () => {},
    });
    try {
      const v = mount(`开头\n\n${VIEW_BLOCK}\n`);
      await settle();
      expect(seen).toEqual(['from: "论文/*"\nview: table']);
      expect(v.dom.querySelector(".cm-dbview")?.textContent).toBe("渲染好了");
    } finally {
      setViewRenderer({ mount: () => {}, unmount: () => {} });
    }
  });
});
