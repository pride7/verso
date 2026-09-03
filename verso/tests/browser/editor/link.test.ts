/**
 * 标准 Markdown 链接的 live preview 与点击。DESIGN.md §4.2
 *
 * 在真实浏览器里跑：标记有没有真的从屏幕上消失（`textContent` 才看得出
 * 来），以及 mousedown 能不能既开链接又不把光标挪走 —— 这两件纯 Node 里
 * 一条都验不了。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExtensions } from "../../../src/editor/index";
import { applySettings, DEFAULT_SETTINGS } from "../../../src/app/settings";
import "../../../src/ui/styles.css";

// 点击要打开的是系统浏览器，这里只看它被叫到时拿到了什么地址
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
const { openUrl } = await import("@tauri-apps/plugin-opener");

const views: EditorView[] = [];
const errors: string[] = [];

beforeEach(() => {
  vi.mocked(openUrl).mockClear();
  errors.length = 0;
});

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
    // 光标放开头，别碰到链接 —— 碰到就退回源码了
    selection: { anchor: 0 },
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
      onError: (m) => errors.push(m),
    }),
  });
  views.push(view);
  return view;
}

const settle = () => new Promise((r) => setTimeout(r, 300));
const text = (v: EditorView) => v.contentDOM.textContent ?? "";

function press(el: HTMLElement, button = 0) {
  const box = el.getBoundingClientRect();
  const ev = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  });
  el.dispatchEvent(ev);
  return ev;
}

describe("外部链接的渲染", () => {
  it("`[文字](地址)` 只显示文字，方括号圆括号和地址都藏起来", async () => {
    const v = mount("前 [Verso 主页](https://example.com) 后");
    await settle();
    expect(text(v)).toContain("Verso 主页");
    expect(text(v)).not.toContain("https://example.com");
    expect(text(v)).not.toContain("[");
    expect(text(v)).not.toContain("](");
    const link = v.contentDOM.querySelector<HTMLElement>(".cm-link");
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe("Verso 主页");
    // 类名对了而尺寸为零等于没画
    expect(link!.getBoundingClientRect().width).toBeGreaterThan(10);
  });

  it("光标走进去退回源码，移开再渲染", async () => {
    const doc = "前 [主页](https://example.com) 后";
    const v = mount(doc);
    await settle();
    v.dispatch({ selection: { anchor: doc.indexOf("主页") } });
    await settle();
    expect(text(v)).toContain("https://example.com");
    expect(v.contentDOM.querySelector(".cm-link")).toBeNull();
    v.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(text(v)).not.toContain("https://example.com");
    expect(v.contentDOM.querySelector(".cm-link")).not.toBeNull();
  });

  it("链接文字里的粗体照常渲染", async () => {
    const v = mount("前 [**很重要**的页](https://example.com) 后");
    await settle();
    expect(text(v)).toContain("很重要");
    expect(text(v)).not.toContain("**");
  });

  it("`<地址>` 藏掉尖括号，地址本身留着", async () => {
    const v = mount("看 <https://example.com> 吧");
    await settle();
    expect(text(v)).toContain("https://example.com");
    expect(text(v)).not.toContain("<");
    expect(v.contentDOM.querySelector(".cm-link")).not.toBeNull();
  });

  it("裸地址不碰 —— 正在打的网址还要能用鼠标点进去改", async () => {
    const v = mount("看 https://example.com 吧");
    await settle();
    expect(text(v)).toContain("https://example.com");
    expect(v.contentDOM.querySelector(".cm-link")).toBeNull();
  });
});

describe("点不开的一律保持源码", () => {
  it("相对路径", async () => {
    const v = mount("前 [另一篇](./笔记.md) 后");
    await settle();
    expect(text(v)).toContain("[另一篇](./笔记.md)");
    expect(v.contentDOM.querySelector(".cm-link")).toBeNull();
  });

  it("`javascript:`", async () => {
    const v = mount("前 [点我](javascript:alert(1)) 后");
    await settle();
    expect(text(v)).toContain("javascript:");
    expect(v.contentDOM.querySelector(".cm-link")).toBeNull();
  });

  it("引用式链接", async () => {
    const v = mount("前 [文字][ref] 后\n\n[ref]: https://example.com");
    await settle();
    expect(text(v)).toContain("[文字][ref]");
    expect(v.contentDOM.querySelector(".cm-link")).toBeNull();
  });

  it("文字为空的 `[](地址)` —— 藏完屏幕上什么都不剩", async () => {
    const v = mount("前 [](https://example.com) 后");
    await settle();
    expect(text(v)).toContain("https://example.com");
    expect(v.contentDOM.querySelector(".cm-link")).toBeNull();
  });

  it("图片不受影响 —— `![图](a.png)` 的 `!` 不该被当成链接的一部分", async () => {
    const v = mount("前 ![图](a.png) 后");
    await settle();
    expect(v.contentDOM.querySelector(".cm-link")).toBeNull();
    expect(text(v)).toContain("![图](a.png)");
  });
});

describe("点开", () => {
  it("左键点一下交给系统浏览器，光标不动", async () => {
    const v = mount("前 [主页](https://example.com) 后");
    await settle();
    const head = v.state.selection.main.head;
    const ev = press(v.contentDOM.querySelector<HTMLElement>(".cm-link")!);
    await settle();
    expect(vi.mocked(openUrl).mock.calls).toEqual([["https://example.com"]]);
    expect(ev.defaultPrevented).toBe(true);
    expect(v.state.selection.main.head).toBe(head);
    expect(errors).toEqual([]);
  });

  it("`<地址>` 也能点", async () => {
    const v = mount("看 <https://example.com> 吧");
    await settle();
    press(v.contentDOM.querySelector<HTMLElement>(".cm-link")!);
    await settle();
    expect(vi.mocked(openUrl).mock.calls).toEqual([["https://example.com"]]);
  });

  it("右键不跳转 —— 那是正文右键菜单的（§4.10）", async () => {
    const v = mount("前 [主页](https://example.com) 后");
    await settle();
    const ev = press(v.contentDOM.querySelector<HTMLElement>(".cm-link")!, 2);
    await settle();
    expect(vi.mocked(openUrl)).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("打不开时说一句，不静默", async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("没有可用的程序"));
    const v = mount("前 [主页](https://example.com) 后");
    await settle();
    press(v.contentDOM.querySelector<HTMLElement>(".cm-link")!);
    await settle();
    expect(errors).toEqual(["打不开链接：没有可用的程序"]);
  });
});
