import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import { calculateCurrent } from "../../../src/editor/calculation";
import "../../../src/ui/styles.css";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc: string, cursor = doc.length) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    selection: EditorSelection.cursor(cursor),
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

const settle = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));
const suggestion = (view: EditorView) =>
  view.contentDOM.querySelector<HTMLElement>(".cm-calculation-suggestion");

describe("正文计算建议", () => {
  it("纯数字算式只预览，按 Tab 后才写入正文", async () => {
    const view = mount("64 * 512 =");
    await settle();
    expect(suggestion(view)?.textContent).toContain("32768");
    expect(view.state.doc.toString()).toBe("64 * 512 =");

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    expect(view.contentDOM.dispatchEvent(event)).toBe(false);
    await settle();
    expect(view.state.doc.toString()).toBe("64 * 512 = 32768");
    expect(suggestion(view)).toBeNull();
  });

  it("变量等式不猜值，纯数字建议也可以直接忽略", async () => {
    const variable = mount("x * y =");
    await settle();
    expect(suggestion(variable)).toBeNull();

    const numeric = mount("64 * 512 =");
    await settle();
    expect(suggestion(numeric)).not.toBeNull();
    numeric.dispatch({
      changes: { from: numeric.state.doc.length, insert: " 暂不计算" },
      selection: { anchor: numeric.state.doc.length + 5 },
      userEvent: "input.type",
    });
    await settle();
    expect(numeric.state.doc.toString()).toBe("64 * 512 = 暂不计算");
    expect(suggestion(numeric)).toBeNull();
  });

  it("按 Escape 只收起建议，不改正文，之后的 Tab 恢复原本行为", async () => {
    const view = mount("64 * 512 =");
    await settle();
    expect(suggestion(view)).not.toBeNull();
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }));
    await settle();
    expect(suggestion(view)).toBeNull();
    expect(view.state.doc.toString()).toBe("64 * 512 =");
  });

  it("公式里的常见 LaTeX 乘号同样能算，代码块里不触发", async () => {
    const formula = "$64 \\times 512 =$";
    const math = mount(formula, formula.length - 1);
    await settle(350);
    expect(suggestion(math)?.textContent).toContain("32768");

    const codeText = "```text\n64 * 512 =\n```";
    const code = mount(codeText, codeText.indexOf("=") + 1);
    await settle(350);
    expect(suggestion(code)).toBeNull();
  });

  it("命令入口计算选区，并把算式和结果一起保留", () => {
    const view = mount("总价：64 * 512 元", 5);
    const from = view.state.doc.toString().indexOf("64");
    const to = from + "64 * 512".length;
    view.dispatch({ selection: { anchor: from, head: to } });
    expect(calculateCurrent(view)).toBe("32768");
    expect(view.state.doc.toString()).toBe("总价：64 * 512 = 32768 元");
  });
});
