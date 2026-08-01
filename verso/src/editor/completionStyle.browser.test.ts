/**
 * 补全面板的样式到底有没有生效。
 *
 * 起因：`/` 菜单在应用里看着像没做过设计 —— 字号是正文的、滚动条是
 * Windows 原生那条带箭头的。但 `EditorView.theme` 里明明写了样式，
 * 而且 detail 那列确实是等宽右对齐的（说明部分规则生效了）。
 *
 * 猜是没用的，量。
 */
import { completionStatus } from "@codemirror/autocomplete";
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

async function openSlashMenu() {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc: "",
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
  view.dispatch({ changes: { from: 0, insert: "/" }, selection: { anchor: 1 }, userEvent: "input.type" });
  await new Promise((r) => setTimeout(r, 300));
  expect(completionStatus(view.state)).toBe("active");
  const panel = document.querySelector<HTMLElement>(".cm-tooltip-autocomplete");
  expect(panel, "补全面板没渲染出来").not.toBeNull();
  return panel!;
}

const px = (v: string) => parseFloat(v);

describe("补全面板的样式", () => {
  it("字号跟界面走，不跟正文走", async () => {
    const panel = await openSlashMenu();
    const ui = px(getComputedStyle(document.documentElement).getPropertyValue("--ui-font-size"));
    // 面板是**界面**不是内容。跟着正文字号走的话，把正文调到 24px
    // 会让这个菜单变成一块巨大的白板
    const row = panel.querySelector<HTMLElement>("li")!;
    expect(px(getComputedStyle(row).fontSize)).toBeCloseTo(ui, 0);
  });

  it("每一行要有像样的高度，不能挤成一条", async () => {
    const panel = await openSlashMenu();
    const row = panel.querySelector<HTMLElement>("li")!;
    expect(row.getBoundingClientRect().height).toBeGreaterThan(24);
  });

  it("列表可滚动区域的高度是行高的整数倍附近，不该把一行切一半", async () => {
    const panel = await openSlashMenu();
    const list = panel.querySelector<HTMLElement>("ul")!;
    const row = panel.querySelector<HTMLElement>("li")!;
    const rows = list.clientHeight / row.getBoundingClientRect().height;
    // 露出半行会让人以为列表到底了。允许 0.15 行的误差
    const frac = rows - Math.floor(rows);
    expect(frac < 0.15 || frac > 0.85, `露出了 ${frac.toFixed(2)} 行`).toBe(true);
  });

  it("面板用浮层的那套材质：圆角 + 阴影", async () => {
    const panel = await openSlashMenu();
    const s = getComputedStyle(panel);
    expect(px(s.borderTopLeftRadius)).toBeGreaterThanOrEqual(8);
    expect(s.boxShadow).not.toBe("none");
  });

  it("选中项用实心条，和其他列表一致", async () => {
    const panel = await openSlashMenu();
    const sel = panel.querySelector<HTMLElement>("li[aria-selected]");
    // selectOnOpen 是关的，所以刚打开时没有选中项 —— 按一下方向键再看
    if (!sel) {
      const first = panel.querySelector<HTMLElement>("li")!;
      first.setAttribute("aria-selected", "true");
    }
    const target = panel.querySelector<HTMLElement>("li[aria-selected]")!;
    const bg = getComputedStyle(target).backgroundColor;
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });
});
