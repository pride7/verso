/**
 * 中西文混排间距。DESIGN.md §4.3
 *
 * 边界算法在 `lib/hanspace.test.ts` 里测干净了。这一层验的是「装饰有没有
 * 真的落在正确的字上、该跳过的地方跳没跳」—— 那要真的语法树，纯 Node 里
 * 拿不到（AGENTS.md「什么时候必须写 browser 测试」）。
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

/** 带间距的那些片段 */
const spaced = (v: EditorView) =>
  [...v.contentDOM.querySelectorAll(".cm-hs")].map((e) => e.textContent);

describe("中西文混排间距", () => {
  it("挨着中文的西文两边留出空隙", async () => {
    const v = mount("用SVD分解矩阵");
    await settle();
    expect(spaced(v)).toEqual(["SVD"]);

    const el = v.contentDOM.querySelector<HTMLElement>(".cm-hs")!;
    const style = getComputedStyle(el);
    // 0.125em，按正文字号算约 2px。**量的是计算值** —— 类名对了而 CSS
    // 没生效的话，看起来和没做一模一样
    expect(parseFloat(style.marginLeft)).toBeGreaterThan(1);
    expect(parseFloat(style.marginRight)).toBeGreaterThan(1);
  });

  it("本来就有空格的地方不再加", async () => {
    const v = mount("用 SVD 分解矩阵");
    await settle();
    expect(spaced(v)).toEqual([]);
  });

  it("纯英文段落一个装饰都没有", async () => {
    const v = mount("The quick brown fox jumps over the lazy dog.");
    await settle();
    expect(spaced(v)).toEqual([]);
  });

  it("行内代码里的字面量不动 —— 那里的相邻是内容", async () => {
    const v = mount("变量叫 `变量name` 而不是别的");
    await settle();
    expect(spaced(v)).toEqual([]);
  });

  it("代码块里也不动", async () => {
    const v = mount("正文\n\n```js\nconst 变量name = 1\n```\n\n结尾");
    await settle();
    expect(spaced(v)).toEqual([]);
  });

  it("公式里不动 —— $A$ 旁边的中文不该被撑开", async () => {
    const v = mount("矩阵$A$的分解");
    await settle();
    expect(spaced(v)).toEqual([]);
  });

  it("链接目标不动，显示出来的文字照常", async () => {
    const v = mount("见[[数学/线性代数]]一节");
    await settle();
    // 目标里的 `数学/线性代数` 没有中英边界，这里主要验它不报错、不误伤
    expect(spaced(v)).toEqual([]);
  });

  it("**不往文件里写空格** —— 文档一个字节都没变", async () => {
    const doc = "用SVD分解矩阵";
    const v = mount(doc);
    await settle();
    expect(v.state.doc.toString()).toBe(doc);
  });
});
