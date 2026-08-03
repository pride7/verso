/**
 * 有序列表重排在真实 EditorView 里的集成验证。
 *
 * 单测直接在 EditorState 上跑，语法树是 create 时同步解析出来的；真实视图里
 * 解析是异步推进的，transactionFilter 读到的树取决于时序 —— 这正是
 * 「单测全绿、应用里坏了」的高危形态（AGENTS.md），所以这里用完整的
 * createExtensions 走一遍键盘删除。
 */
import { userEvent } from "vitest/browser";
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

function mount(doc: string, anchor = doc.length) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  parent.style.cssText = "position:fixed;inset:0;width:720px";
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    selection: { anchor },
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
    }),
  });
  view.focus();
  views.push(view);
  return view;
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

describe("有序列表自动重排", () => {
  it("选中中间一行删掉，后面的编号跟着变", async () => {
    const doc = "1. 甲\n2. 乙\n3. 丙";
    const from = doc.indexOf("2. 乙");
    const view = mount(doc);
    await settle();

    view.dispatch({
      selection: { anchor: from, head: from + "2. 乙\n".length },
    });
    await userEvent.keyboard("{Backspace}");
    await settle();

    expect(view.state.doc.toString()).toBe("1. 甲\n2. 丙");
  });

  it("行中间回车拆出新项，Enter 续号和重排不打架", async () => {
    const doc = "1. 甲\n2. 乙乙\n3. 丙";
    const view = mount(doc, doc.indexOf("乙乙") + 1);
    await settle();

    await userEvent.keyboard("{Enter}");
    await settle();

    expect(view.state.doc.toString()).toBe("1. 甲\n2. 乙\n3. 乙\n4. 丙");
  });
});
