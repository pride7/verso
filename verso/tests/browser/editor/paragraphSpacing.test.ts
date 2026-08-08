/**
 * 段落间距必须量真实几何：block widget 是否进入 CM6 高度图、CSS 变量是否生效，
 * 纯 Node 测试都无法回答。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { applySettings, DEFAULT_SETTINGS } from "../../../src/app/settings";
import "../../../src/ui/styles.css";
import { createExtensions } from "../../../src/editor/index";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc: string, paragraphSpacing = DEFAULT_SETTINGS.paragraphSpacing) {
  applySettings({ ...DEFAULT_SETTINGS, paragraphSpacing });
  const parent = document.createElement("div");
  parent.style.cssText = "position:fixed;inset:0;width:720px";
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

describe("正文段落间距", () => {
  it("普通 Enter 使用独立块占位，文字行盒仍保持等高", async () => {
    const view = mount("第一段\n第二段");
    await settle();

    const lines = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")];
    const spacer = view.contentDOM.querySelector<HTMLElement>(".cm-paragraph-space")!;
    expect(spacer).not.toBeNull();
    expect(spacer.getBoundingClientRect().height).toBeGreaterThan(4);
    expect(Math.abs(lines[0].getBoundingClientRect().height - lines[1].getBoundingClientRect().height)).toBeLessThan(0.5);
  });

  it("Shift+Enter 的 Markdown 硬换行不增加段落间距", async () => {
    const view = mount("第一行  \n第二行");
    await settle();
    expect(view.contentDOM.querySelector(".cm-paragraph-space")).toBeNull();
  });

  it("段落间距设置会直接改变块占位高度", async () => {
    const view = mount("第一段\n第二段", 0.7);
    await settle();
    const spacer = view.contentDOM.querySelector<HTMLElement>(".cm-paragraph-space")!;
    expect(spacer.getBoundingClientRect().height).toBeGreaterThan(10);
  });
});
