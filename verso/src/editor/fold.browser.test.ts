/**
 * 折叠的实际行为 —— 范围算得对不代表折起来是对的，
 * 隐藏、占位符、折叠槽都要真实布局才验得了。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./index";
import { foldAllHeadings, headingFoldRange, toggleHeadingFold, unfoldAllHeadings } from "./fold";
import { applySettings, DEFAULT_SETTINGS } from "../settings";
import "../styles.css";

const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

const DOC = ["# 一级", "", "甲的正文", "", "## 二级", "", "乙的正文", "", "# 另一节", "", "丙"].join(
  "\n",
);

function mount(doc = DOC) {
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
      sourceMode: false,
    }),
  });
  views.push(view);
  return view;
}

const settle = () => new Promise((r) => setTimeout(r, 250));
const shown = (v: EditorView) => v.contentDOM.innerText;

describe("标题折叠", () => {
  it("折叠后内容看不见，但标题还在", async () => {
    const v = mount();
    await settle();
    expect(shown(v)).toContain("甲的正文");

    toggleHeadingFold(v);
    await settle();
    expect(shown(v)).toContain("一级");
    expect(shown(v)).not.toContain("甲的正文");
    expect(shown(v)).not.toContain("乙的正文");
    // 折的是这一节，别的节不受影响
    expect(shown(v)).toContain("另一节");
  });

  it("再按一次展开", async () => {
    const v = mount();
    await settle();
    toggleHeadingFold(v);
    await settle();
    toggleHeadingFold(v);
    await settle();
    expect(shown(v)).toContain("甲的正文");
  });

  it("箭头平时不显示，鼠标在这一行才出现", async () => {
    const v = mount();
    await settle();
    const arrow = v.dom.querySelector<HTMLElement>(".cm-fold-arrow");
    expect(arrow, "标题行应当有箭头元素").not.toBeNull();
    // 平时透明 —— 常显的箭头列会让笔记看起来像代码编辑器
    expect(getComputedStyle(arrow!).opacity).toBe("0");
  });

  it("箭头不占位，但也不能被裁到可视区外", async () => {
    const v = mount();
    await settle();
    const arrow = v.dom.querySelector<HTMLElement>(".cm-fold-arrow")!;
    const line = arrow.closest(".cm-line") as HTMLElement;
    const scroller = v.dom.querySelector<HTMLElement>(".cm-scroller")!;
    const a = arrow.getBoundingClientRect();

    // 绝对定位：左边缘在所在行的左边缘之外，所以不推挤文字
    expect(a.left).toBeLessThan(line.getBoundingClientRect().left);
    // 但**必须还在可视区里**。落到 .cm-scroller 左边缘之外会被整个裁掉，
    // 表现是"箭头全程不显示" —— 和 callout 竖线那次是同一类问题
    // 必须还在可视区里。落到 .cm-scroller 左边缘之外会被整个裁掉，
    // 表现是"箭头全程不显示"。
    //
    // 用包围盒判断是有讲究的：`transform: rotate` 会把包围盒撑大，
    // 加在容器上就会悄悄伸到盒子外面 —— 所以旋转的是里面的 svg
    expect(a.left).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().left);
    expect(a.width).toBeGreaterThan(0);
  });

  it("编辑器不因为箭头产生横向滚动", async () => {
    const v = mount();
    await settle();
    const scroller = v.dom.querySelector<HTMLElement>(".cm-scroller")!;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
  });

  // 标题行的字号是正文的 1.85 倍、行高也更大。箭头如果按固定的 em 偏移
  // 定位，em 相对的是**正文**字号，结果必然偏上
  it("箭头在标题行里垂直居中", async () => {
    const v = mount();
    await settle();
    for (const arrow of v.dom.querySelectorAll<HTMLElement>(".cm-fold-arrow")) {
      const line = arrow.closest(".cm-line") as HTMLElement;
      const a = arrow.getBoundingClientRect();
      const l = line.getBoundingClientRect();
      const off = Math.abs((a.top + a.height / 2) - (l.top + l.height / 2));
      expect(off, `箭头偏离行中心 ${off.toFixed(1)}px`).toBeLessThan(2);
    }
  });

  it("折叠后箭头始终可见 —— 那是状态指示", async () => {
    const v = mount();
    await settle();
    toggleHeadingFold(v);
    await settle();
    const closed = v.dom.querySelector<HTMLElement>(".cm-fold-arrow.is-closed");
    expect(closed).not.toBeNull();
    expect(Number(getComputedStyle(closed!).opacity)).toBeGreaterThan(0.5);
  });

  it("折叠处有占位符，点它能展开", async () => {
    const v = mount();
    await settle();
    toggleHeadingFold(v);
    await settle();
    const ph = v.dom.querySelector<HTMLElement>(".cm-fold-placeholder");
    expect(ph).not.toBeNull();
    ph!.click();
    await settle();
    expect(shown(v)).toContain("甲的正文");
  });

  it("全部折叠 / 全部展开", async () => {
    const v = mount();
    await settle();
    foldAllHeadings(v);
    await settle();
    expect(shown(v)).not.toContain("甲的正文");
    expect(shown(v)).not.toContain("丙");

    unfoldAllHeadings(v);
    await settle();
    expect(shown(v)).toContain("甲的正文");
    expect(shown(v)).toContain("丙");
  });

  it("非标题行按折叠键什么也不做", async () => {
    const v = mount();
    await settle();
    v.dispatch({ selection: { anchor: DOC.indexOf("甲的正文") } });
    expect(toggleHeadingFold(v)).toBe(false);
  });

  // 关键是**普通行不给箭头** —— 每行都挂一个就成代码编辑器了（§4）。
  // 不去数箭头总数：`@codemirror/lang-markdown` 自带一套折叠，会额外
  // 贡献几个，那是它的行为不是我们的
  it("普通正文行不可折叠", async () => {
    const v = mount();
    await settle();
    const plain = ["甲的正文", "乙的正文", "丙"];
    for (const t of plain) {
      const line = v.state.doc.lineAt(DOC.indexOf(t));
      expect(headingFoldRange(v.state, line.from), `${t} 不该可折叠`).toBeNull();
    }
    // 标题行则都可以
    for (const t of ["# 一级", "## 二级", "# 另一节"]) {
      const line = v.state.doc.lineAt(DOC.indexOf(t));
      expect(headingFoldRange(v.state, line.from), `${t} 该可折叠`).not.toBeNull();
    }
  });
});
