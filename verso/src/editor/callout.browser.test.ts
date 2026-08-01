/**
 * Callout 渲染。在真实浏览器里跑 —— 它靠行装饰画底色和左侧色条，
 * 那是纯样式的东西，没有布局引擎一条都验不了。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./index";
import { applySettings, DEFAULT_SETTINGS } from "../settings";
import "../styles.css";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

/** 光标放在文档最末尾，保证不碰到被测的那个块 */
function mount(doc: string) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
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

const settle = () => new Promise((r) => setTimeout(r, 250));
const px = (v: string) => parseFloat(v);

describe("callout 渲染", () => {
  it("每一行都拿到行装饰，首尾行有开合标记", async () => {
    const v = mount("正文\n\n> [!note] 提示\n> 第二行\n> 第三行\n\n结尾");
    await settle();
    const lines = v.dom.querySelectorAll(".cm-callout");
    expect(lines).toHaveLength(3);
    expect(lines[0].classList.contains("is-open")).toBe(true);
    expect(lines[2].classList.contains("is-close")).toBe(true);
    expect(lines[1].classList.contains("is-open")).toBe(false);
  });

  it("左侧色条真的画出来了", async () => {
    const v = mount("正文\n\n> [!note] 提示\n> 内容\n\n结尾");
    await settle();
    const line = v.dom.querySelector<HTMLElement>(".cm-callout")!;
    const s = getComputedStyle(line);
    expect(px(s.borderLeftWidth)).toBeGreaterThanOrEqual(2);
    expect(s.borderLeftStyle).toBe("solid");
    // 不能是透明的 —— 那等于没画
    expect(s.borderLeftColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  // 首尾两行要圆角。中间行不能圆 —— 每一行是独立的盒子，
  // 每行都圆会变成一串分开的小方块而不是一个块
  it("首行圆上面两角，末行圆下面两角，中间行不圆", async () => {
    const v = mount("正文\n\n> [!note] 提示\n> 中间\n> 末行\n\n结尾");
    await settle();
    const lines = v.dom.querySelectorAll<HTMLElement>(".cm-callout");
    const r = (el: HTMLElement, side: string) =>
      px(getComputedStyle(el).getPropertyValue(`border-${side}-radius`));

    expect(r(lines[0], "top-left")).toBeGreaterThan(0);
    expect(r(lines[0], "top-right")).toBeGreaterThan(0);
    expect(r(lines[0], "bottom-left")).toBe(0);

    expect(r(lines[1], "top-left")).toBe(0);
    expect(r(lines[1], "bottom-left")).toBe(0);

    expect(r(lines[2], "bottom-left")).toBeGreaterThan(0);
    expect(r(lines[2], "bottom-right")).toBeGreaterThan(0);
    expect(r(lines[2], "top-left")).toBe(0);
  });

  it("代码块同理，首尾行圆角", async () => {
    const v = mount("正文\n\n```rust\nfn main() {}\n```\n\n结尾");
    await settle();
    const lines = v.dom.querySelectorAll<HTMLElement>(".cm-code");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const first = getComputedStyle(lines[0]);
    const last = getComputedStyle(lines[lines.length - 1]);
    expect(px(first.borderTopLeftRadius)).toBeGreaterThan(0);
    expect(px(last.borderBottomLeftRadius)).toBeGreaterThan(0);
  });

  it("底色和正文背景不一样", async () => {
    const v = mount("正文\n\n> [!warning] 注意\n> 内容\n\n结尾");
    await settle();
    const line = v.dom.querySelector<HTMLElement>(".cm-callout")!;
    expect(getComputedStyle(line).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("不同类型用不同颜色", async () => {
    const v = mount("> [!note] 甲\n> a\n\n> [!danger] 乙\n> b\n\n结尾");
    await settle();
    const lines = v.dom.querySelectorAll<HTMLElement>(".cm-callout.is-open");
    expect(lines).toHaveLength(2);
    const a = getComputedStyle(lines[0]).borderLeftColor;
    const b = getComputedStyle(lines[1]).borderLeftColor;
    expect(a).not.toBe(b);
  });

  it("`>` 和 `[!note]` 都藏起来了，标题换成徽标", async () => {
    const v = mount("正文\n\n> [!tip] 实践建议\n> 内容\n\n结尾");
    await settle();
    const badge = v.dom.querySelector(".cm-callout-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("实践建议");
    // 渲染出来的文本里不该再有 markdown 的标记符号
    const text = v.dom.querySelector<HTMLElement>(".cm-callout.is-open")!.innerText;
    expect(text).not.toContain("[!tip]");
    expect(text.trimStart().startsWith(">")).toBe(false);
  });

  it("没写标题时用类型的中文名", async () => {
    const v = mount("正文\n\n> [!warning]\n> 内容\n\n结尾");
    await settle();
    expect(v.dom.querySelector(".cm-callout-badge")!.textContent).toBe("注意");
  });

  it("普通引用不套用 callout 的样式", async () => {
    const v = mount("正文\n\n> 只是一句引用\n\n结尾");
    await settle();
    expect(v.dom.querySelector(".cm-callout")).toBeNull();
    expect(v.dom.querySelector(".cm-quote")).not.toBeNull();
  });

  it("光标进入时整块回到源码", async () => {
    const doc = "正文\n\n> [!note] 提示\n> 内容\n\n结尾";
    const v = mount(doc);
    await settle();
    expect(v.dom.querySelector(".cm-callout")).not.toBeNull();

    v.dispatch({ selection: { anchor: doc.indexOf("内容") } });
    await settle();
    expect(v.dom.querySelector(".cm-callout")).toBeNull();
    // 源码要完整可见，否则改不了
    expect(v.dom.textContent).toContain("[!note]");
  });
});

describe("普通引用", () => {
  it("竖线要看得见 —— 和背景的对比不能靠猜", async () => {
    const v = mount("正文\n\n> 只是一句引用\n\n结尾");
    await settle();
    const line = v.dom.querySelector<HTMLElement>(".cm-quote")!;
    const s = getComputedStyle(line);
    expect(px(s.borderLeftWidth)).toBeGreaterThanOrEqual(2);

    // 原来用 --border（89% 的灰）画在 99% 的背景上，肉眼完全看不出来。
    // 断言"不是透明色"拦不住这种 —— 得看它到底有多浅。
    //
    // 直接检查颜色本身：正文背景一定是浅色（§6.2 深色主题另有一套值，
    // 那边这条竖线用的是同一个 --muted，只是明度翻过来），所以要求
    // 竖线的明度明显低于纯白，并且不透明度够。
    const [r, g, b, a = 1] = s.borderLeftColor.match(/[\d.]+/g)!.map(Number);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(a, "竖线太透明").toBeGreaterThanOrEqual(0.3);
    expect(lum, "竖线太浅，在浅色背景上看不见").toBeLessThan(200);
  });

  it("引用没有底色 —— 那是 callout 才有的", async () => {
    const v = mount("正文\n\n> 只是一句引用\n\n结尾");
    await settle();
    const line = v.dom.querySelector<HTMLElement>(".cm-quote")!;
    expect(getComputedStyle(line).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });
});

describe("块不能撑出正文栏", () => {
  // 用负外边距外扩过一次，结果是编辑器出现横向滚动条，而左侧色条画在
  // 被推出可视区的那一段上 —— 表现是"竖线怎么调都看不见"，很难联想到
  // 是宽度问题。这条断言直接把它钉死。
  it("callout / 引用 / 代码块都不产生横向滚动", async () => {
    const v = mount(
      [
        "正文",
        "",
        "> [!note] 提示",
        "> 内容",
        "",
        "> 普通引用",
        "",
        "```rust",
        "fn main() {}",
        "```",
        "",
        "结尾",
      ].join("\n"),
    );
    await settle();
    const scroller = v.dom.querySelector<HTMLElement>(".cm-scroller")!;
    // 留 1px 容差给亚像素舍入
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
  });

  it("左侧色条落在可视区内，不会被推到左边界外", async () => {
    const v = mount("正文\n\n> [!note] 提示\n> 内容\n\n结尾");
    await settle();
    const line = v.dom.querySelector<HTMLElement>(".cm-callout")!;
    const content = v.dom.querySelector<HTMLElement>(".cm-content")!;
    // 行盒的左边缘不能在内容区左边缘的左边 —— 那一段是看不到的
    expect(line.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      content.getBoundingClientRect().left - 1,
    );
  });
});
