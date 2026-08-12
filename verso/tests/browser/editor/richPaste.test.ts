import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import { htmlToMarkdown } from "../../../src/editor/htmlToMarkdown";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

function mount(doc = "") {
  const parent = document.createElement("div");
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

function paste(view: EditorView, plain: string, html = "") {
  const data = new DataTransfer();
  data.setData("text/plain", plain);
  if (html) data.setData("text/html", html);
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("网页内容转 Markdown", () => {
  it("保留常用结构，丢掉脚本", () => {
    const markdown = htmlToMarkdown(`
      <h2>实验记录</h2>
      <p><strong>结论</strong>：见 <a href="https://example.com/paper">论文</a></p>
      <ul><li>第一项</li><li>第二项</li></ul>
      <table><tr><th>方法</th><th>得分</th></tr><tr><td>A</td><td>9</td></tr></table>
      <script>alert('no')</script>
    `);
    expect(markdown).toContain("## 实验记录");
    expect(markdown).toContain("**结论**：见 [论文](https://example.com/paper)");
    expect(markdown).toContain("- 第一项\n- 第二项");
    expect(markdown).toContain("| 方法 | 得分 |");
    expect(markdown).not.toContain("alert");
  });

  it("粘贴 HTML 后继续转换 LaTeX 公式定界符", () => {
    const view = mount("开头\n");
    const event = paste(view, String.raw`结论 \(x+1\)`, String.raw`<p>结论 \(x+1\)</p>`);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("结论 $x+1$开头\n");
  });
});

describe("选区上粘贴网址", () => {
  it("把选中文字变成 Markdown 链接", () => {
    const view = mount("阅读这篇论文");
    view.dispatch({ selection: EditorSelection.single(2, 6) });
    const event = paste(view, "https://example.com/paper");
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("阅读[这篇论文](https://example.com/paper)");
  });

  it("多个网址不是单个链接目标", () => {
    const view = mount("两处");
    view.dispatch({ selection: EditorSelection.single(0, 2) });
    const event = paste(view, "https://a.test https://b.test");
    // CodeMirror 自己会认下普通粘贴事件；关键是它没有被包成一个链接。
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("https://a.test https://b.test");
  });
});
