/**
 * 正文段落节奏。这里必须使用真实布局引擎：类名存在不代表 padding 被
 * CodeMirror 的高度图正确计入，最终要量每条可视行的实际高度。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { applySettings, DEFAULT_SETTINGS } from "../settings";
import "../styles.css";
import { createExtensions } from "./index";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc: string, width = 720) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  parent.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:800px`;
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const lines = (view: EditorView) =>
  [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")];

describe("正文段落节奏", () => {
  it("显式回车产生段间留白，自动折行仍沿用正文行高", async () => {
    const view = mount("第一段内容\n第二段内容");
    await settle();

    const [first, second] = lines(view);
    expect(first.classList.contains("cm-paragraph-break")).toBe(true);
    expect(first.getBoundingClientRect().height - second.getBoundingClientRect().height).toBeGreaterThan(10);

    const wrapped = mount("这是一段会在窄正文栏里自动折行的长文字。".repeat(8), 220);
    await settle();
    const [onlyLine] = lines(wrapped);
    expect(lines(wrapped)).toHaveLength(1);
    expect(onlyLine.classList.contains("cm-paragraph-break")).toBe(false);
    expect(onlyLine.getBoundingClientRect().height).toBeGreaterThan(second.getBoundingClientRect().height * 2);
  });

  it("Markdown 空行折算为同一份段间距，不叠加成双倍留白", async () => {
    const view = mount("第一段\n\n第二段");
    await settle();

    const [first, gap, second] = lines(view);
    const normalHeight = second.getBoundingClientRect().height;
    const gapHeight = gap.getBoundingClientRect().height;
    expect(first.classList.contains("cm-paragraph-break")).toBe(false);
    expect(gap.classList.contains("cm-paragraph-gap")).toBe(true);
    expect(gapHeight).toBeGreaterThan(10);
    expect(gapHeight).toBeLessThan(normalHeight);
  });

  it("列表与代码块保持紧凑，显示规则不改 Markdown 原文", async () => {
    const doc = "- 条目一\n- 条目二\n\n~~~txt\n代码第一行\n\n代码第二行\n~~~";
    const view = mount(doc);
    await settle();

    const listLines = lines(view).slice(0, 2);
    expect(listLines.every((line) => !line.classList.contains("cm-paragraph-break"))).toBe(true);
    const codeBlank = lines(view).find((line) => line.classList.contains("cm-code") && !line.textContent);
    expect(codeBlank?.classList.contains("cm-paragraph-gap")).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
});
