/**
 * `/` 命令菜单与 `[[` 链接补全 —— 在真实浏览器里跑。
 *
 * `slashSource` 自己的单元测试全过，应用里却弹不出菜单。这类「隔离测试
 * 通过、真编辑器里失效」的问题，只有真实布局引擎能复现。
 */
import { completionStatus, currentCompletions } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./index";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

function mount(doc = "", anchor = doc.length) {
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
      getNotes: () => [
        { id: "1", path: "线性代数.md", name: "线性代数" },
        { id: "2", path: "论文/注意力机制.md", name: "注意力机制" },
      ],
    }),
  });
  views.push(view);
  view.focus();
  return view;
}

/** 像真人一样一个字符一个字符地敲 */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const at = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at, insert: ch },
      selection: { anchor: at + ch.length },
      userEvent: "input.type",
    });
  }
}

const settle = () => new Promise((r) => setTimeout(r, 250));

/** 补全面板真的画在 DOM 里了吗 —— 光看 state 不够，面板可能被裁掉 */
function panel() {
  return document.querySelector(".cm-tooltip-autocomplete");
}

describe("/ 命令菜单", () => {
  it("空行打 / 弹出菜单", async () => {
    const v = mount("");
    type(v, "/");
    await settle();
    expect(completionStatus(v.state)).toBe("active");
    expect(currentCompletions(v.state).length).toBeGreaterThan(0);
  });

  it("段落中间打 / 也弹（Notion 手感）", async () => {
    const v = mount("写了一段话 ");
    type(v, "/");
    await settle();
    expect(completionStatus(v.state)).toBe("active");
  });

  it("继续打字能筛选", async () => {
    const v = mount("");
    type(v, "/标题");
    await settle();
    const labels = currentCompletions(v.state).map((c) => c.label);
    expect(labels).toContain("一级标题");
    expect(labels).not.toContain("待办");
  });

  it("面板要真的渲染出来，不能被容器裁掉", async () => {
    const v = mount("");
    type(v, "/");
    await settle();
    const el = panel();
    expect(el).not.toBeNull();
    const box = (el as HTMLElement).getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("公式里的 / 是除号，绝不能弹菜单", async () => {
    const v = mount("$a ");
    type(v, "/");
    await settle();
    expect(completionStatus(v.state)).toBeNull();
  });

  it("URL 里的 / 不弹", async () => {
    const v = mount("https:/");
    type(v, "/");
    await settle();
    expect(completionStatus(v.state)).toBeNull();
  });
});

describe("[[ 链接补全", () => {
  it("打 [[ 弹出笔记清单", async () => {
    const v = mount("");
    type(v, "[[");
    await settle();
    expect(completionStatus(v.state)).toBe("active");
    expect(currentCompletions(v.state).map((c) => c.label)).toContain("线性代数");
  });
});
