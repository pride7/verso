/**
 * `/` 菜单可自定义。DESIGN.md §4.3
 *
 * 条目表和解析在 `lib/slash.test.ts` 里测干净了。这一层验的是它接进编辑器
 * 之后还成不成立：隐藏的真的不出现、自定义的真的能插进去、`$0` 落点对。
 * 补全面板要真实布局才活得起来（AGENTS.md「什么时候必须写 browser 测试」）。
 */
import { startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./editor";
import { setSlashConfig } from "./editor/completion";
import { parseSlashCustom } from "./lib/slash";
import { applySettings, DEFAULT_SETTINGS } from "./settings";
import "./styles.css";

const views: EditorView[] = [];
afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
  setSlashConfig([], []);
});

function mount(doc = "") {
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
  view.focus();
  return view;
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/** 打一个 `/` 并把菜单叫出来，返回里面的条目名 */
async function slashOptions(view: EditorView): Promise<string[]> {
  view.dispatch({ changes: { from: 0, insert: "/" }, selection: { anchor: 1 } });
  await settle();
  startCompletion(view);
  await settle();
  return [...document.querySelectorAll(".cm-completionLabel")].map((e) => e.textContent ?? "");
}

describe("/ 菜单可自定义", () => {
  it("默认列出内置那一份", async () => {
    const view = mount();
    const labels = await slashOptions(view);
    expect(labels).toContain("三级标题");
    expect(labels).toContain("表格");
    expect(labels).toContain("插入模板");
  });

  it("隐藏掉的不出现", async () => {
    setSlashConfig(["表格", "高亮"], []);
    const view = mount();
    const labels = await slashOptions(view);
    expect(labels).not.toContain("表格");
    expect(labels).not.toContain("高亮");
    // 没关的照旧
    expect(labels).toContain("三级标题");
  });

  it("自己加的排在最后，选中就插进去", async () => {
    const { items } = parseSlashCustom(
      JSON.stringify([{ label: "定理", detail: "callout", template: "> [!note] 定理\n> $0" }]),
    );
    setSlashConfig([], items);
    const view = mount();

    const labels = await slashOptions(view);
    expect(labels).toContain("定理");
    expect(labels[labels.length - 1]).toBe("定理");

    const hit = [...document.querySelectorAll<HTMLElement>(".cm-completionLabel")].find(
      (e) => e.textContent === "定理",
    )!;
    hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();

    // `/` 那个字符要被吃掉，模板整段插进来
    expect(view.state.doc.toString()).toBe("> [!note] 定理\n> ");
    // `$0` 是光标位，自己不留下字符
    expect(view.state.doc.toString()).not.toContain("$0");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("$0 决定光标停在哪，不是永远在末尾", async () => {
    const { items } = parseSlashCustom(
      JSON.stringify([{ label: "强调", template: "**$0**" }]),
    );
    setSlashConfig([], items);
    const view = mount();
    await slashOptions(view);

    const hit = [...document.querySelectorAll<HTMLElement>(".cm-completionLabel")].find(
      (e) => e.textContent === "强调",
    )!;
    hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();

    expect(view.state.doc.toString()).toBe("****");
    expect(view.state.selection.main.head).toBe(2);
  });

  /**
   * 表格模板原来用 `|` 标光标位，而它自己全是竖线 —— 插出来少一根竖线、
   * 光标还停在行首。换成 `$0` 之后这条钉住它。
   */
  it("表格插出来是完整的三行，一根竖线都不少", async () => {
    const view = mount();
    await slashOptions(view);
    const hit = [...document.querySelectorAll<HTMLElement>(".cm-completionLabel")].find(
      (e) => e.textContent === "表格",
    )!;
    hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();

    const lines = view.state.doc.toString().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith("|")).toBe(true);
    expect(lines[1]).toBe("|---|---|");
  });
});
