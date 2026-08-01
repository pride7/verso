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
    // 三行内容 —— 围栏行藏起来之后会和相邻行合并，只有一行内容的块
    // 会整个并成一行
    const v = mount("正文\n\n```rust\na\nb\nc\n```\n\n结尾");
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

describe("表格必须能改", () => {
  const DOC = "正文\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n\n结尾";

  it("渲染成表格", async () => {
    const v = mount(DOC);
    await settle();
    expect(v.dom.querySelector(".cm-table table")).not.toBeNull();
  });

  // 这是这个功能的底线：渲染完还能改回去。第一版注册了 atomicRanges
  // 又让 widget 吞掉事件，结果表格写完就锁死了
  it("点一下就回到源码", async () => {
    const v = mount(DOC);
    await settle();
    const cell = v.dom.querySelector<HTMLElement>(".cm-table td")!;
    // 必须带真实坐标 —— CodeMirror 靠 clientX/clientY 反查文档位置，
    // 不给的话按 (0,0) 算，落在表格外面，光标根本没进来
    const box = cell.getBoundingClientRect();
    cell.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    await settle();
    expect(v.dom.querySelector(".cm-table")).toBeNull();
    expect(v.dom.textContent).toContain("|---|---|");
  });

  it("方向键也能走进去 —— 不能只有鼠标进得去", async () => {
    const v = mount(DOC);
    await settle();
    // 把光标放到表格正中间那一行，模拟"方向键走进来"
    v.dispatch({ selection: { anchor: DOC.indexOf("|---|") + 2 } });
    await settle();
    expect(v.dom.querySelector(".cm-table")).toBeNull();
  });

  it("光标移开又渲染回去", async () => {
    const v = mount(DOC);
    await settle();
    v.dispatch({ selection: { anchor: DOC.indexOf("|---|") + 2 } });
    await settle();
    expect(v.dom.querySelector(".cm-table")).toBeNull();

    v.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(v.dom.querySelector(".cm-table table")).not.toBeNull();
  });
});

describe("点击进入源码", () => {
  /** 在元素中心派发一次带真实坐标的 mousedown */
  function clickAt(el: Element) {
    const box = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
  }

  it("点普通引用的文字，露出 `>`", async () => {
    const v = mount("正文\n\n> 只是一句引用\n\n结尾");
    await settle();
    const line = v.dom.querySelector<HTMLElement>(".cm-quote")!;
    clickAt(line);
    await settle();
    expect(v.dom.textContent).toContain("> 只是一句引用");
  });

  it("点 callout 的正文，露出 `[!note]`", async () => {
    const v = mount("正文\n\n> [!note] 提示\n> 内容\n\n结尾");
    await settle();
    const lines = v.dom.querySelectorAll<HTMLElement>(".cm-callout");
    clickAt(lines[lines.length - 1]);
    await settle();
    expect(v.dom.textContent).toContain("[!note]");
  });

  it("点代码块，光标进得去", async () => {
    const v = mount("正文\n\n```rust\na\nb\nc\n```\n\n结尾");
    await settle();
    const line = v.dom.querySelectorAll<HTMLElement>(".cm-code")[1];
    clickAt(line);
    await settle();
    // 验的是光标落进了代码块内部，而不是某个精确行号 —— 行盒有 padding，
    // 点"中心"落到相邻行是正常的，钉死行号只会让这条测试很脆
    const head = v.state.selection.main.head;
    const lineNo = v.state.doc.lineAt(head).number;
    expect(lineNo).toBeGreaterThanOrEqual(3);
    expect(lineNo).toBeLessThanOrEqual(7);
  });
});

describe("坐标反查落点", () => {
  /**
   * 直接验 `posAtCoords` —— CodeMirror 真正用来把鼠标坐标换成文档位置的入口。
   *
   * **不要用合成 MouseEvent 验点击。** 试过，它给出的是假象：合成事件走不完
   * 浏览器的默认选区流程，结果既可能假阳性也可能假阴性。真正能测的是坐标
   * 到位置的映射，那才是"点哪儿光标去哪儿"的实质。
   */
  function textRect(root: Element, text: string): DOMRect {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent?.indexOf(text) ?? -1;
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + text.length);
      return r.getBoundingClientRect();
    }
    throw new Error(`找不到文本「${text}」`);
  }

  const centerOf = (b: DOMRect) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });

  it("引用：点文字的位置反查到该行", async () => {
    const v = mount("正文\n\n> 只是一句引用\n\n结尾");
    await settle();
    const line = v.dom.querySelector<HTMLElement>(".cm-quote")!;
    const pos = v.posAtCoords(centerOf(textRect(line, "只是一句")));
    expect(pos).not.toBeNull();
    expect(v.state.doc.lineAt(pos!).number).toBe(3);
  });

  it("callout：点正文的位置反查到该行", async () => {
    const v = mount("正文\n\n> [!note] 提示\n> 内容在这里\n\n结尾");
    await settle();
    const lines = v.dom.querySelectorAll<HTMLElement>(".cm-callout");
    const last = lines[lines.length - 1];
    const pos = v.posAtCoords(centerOf(textRect(last, "内容在这里")));
    expect(pos).not.toBeNull();
    expect(v.state.doc.lineAt(pos!).number).toBe(4);
  });

  it("代码块：点代码的位置反查到该行", async () => {
    const v = mount("正文\n\n```rust\nfn main() {}\n```\n\n结尾");
    await settle();
    const host = v.dom.querySelector<HTMLElement>(".cm-content")!;
    // 只找 "main"，不找 "fn main"：代码块高亮之后 `fn` 和 `main` 落在
    // 两个不同的 span 里，跨节点的文本 walker 一个都匹配不上。
    // 而且语言包是异步加载的，同一句话在两种时序下的节点划分不一样 ——
    // 单个 token 在两种情况下都找得到
    const pos = v.posAtCoords(centerOf(textRect(host, "main")));
    expect(pos).not.toBeNull();
    expect(v.state.doc.lineAt(pos!).number).toBe(4);
  });
});
