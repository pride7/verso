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

  it("HTML 里的块公式方括号不被提前转义", () => {
    expect(htmlToMarkdown(String.raw`<p>\[x_{i}+a_b\]</p>`))
      .toBe(String.raw`\[x_{i}+a_b\]`);

    const view = mount();
    const event = paste(
      view,
      String.raw`\[x_{i}+a_b\]`,
      String.raw`<p>\[x_{i}+a_b\]</p>`,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("$$x_{i}+a_b$$");
  });

  it("公式内部的 Markdown 字符与跨节点排版保持 LaTeX 原样", () => {
    const source = String.raw`\(a*b + _x_ + \left[y\right]\)`;
    expect(htmlToMarkdown(`<p>${source}</p>`)).toBe(source);

    const view = mount();
    const event = paste(
      view,
      source,
      String.raw`<p>\(<span>a*b + _x_ + \left[</span><em>y</em><span>\right]</span>\)</p>`,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(String.raw`$a*b + _x_ + \left[y\right]$`);
  });

  it("多段行内/块公式和块公式换行一起转换", () => {
    const view = mount();
    const event = paste(
      view,
      String.raw`先 \(a_b\)，再 \[c*d + \left[e\right]\]`,
      String.raw`<p>先 <span>\(a_b\)</span>，再 <span>\[</span><br><span>c*d + \left[e\right]</span><br><span>\]</span></p>`,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("先 $a_b$，再 $$\nc*d + \\left[e\\right]\n$$");
  });

  it("已经是 Markdown 定界符的公式也完整保留", () => {
    const source = "$a*b + _x_ + \\left[y\\right]$\n\n$$c*d + [e]$$";
    const view = mount();
    const event = paste(
      view,
      source,
      "<p>$a*b + _x_ + \\left[y\\right]$</p><p>$$c*d + [e]$$</p>",
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(htmlToMarkdown("<p>这本书 $5 起，精装 $20 封顶。</p>"))
      .toBe("这本书 $5 起，精装 $20 封顶。");
  });

  it("包住整条公式的网页强调留在公式外，公式内部的强调标签不写进源码", () => {
    expect(htmlToMarkdown(String.raw`<em>\(x_i\)</em>`)).toBe(String.raw`*\(x_i\)*`);
    expect(htmlToMarkdown(String.raw`<span>\(x_<em>i</em>\)</span>`)).toBe(String.raw`\(x_i\)`);
  });

  it("代码里的 LaTeX 定界符保持代码，不参与公式转换", () => {
    const view = mount();
    const event = paste(view, String.raw`\(x_i\)`, String.raw`<code>\(x_i\)</code>`);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("`\\(x_i\\)`");
  });

  it("未闭合和被再次转义的定界符不被误转换", () => {
    const source = String.raw`未闭合 \(x_i；字面量 \\(y_i\\)`;
    const view = mount();
    const event = paste(view, source, `<p>${source}</p>`);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("公式中的网页链接标签只保留 LaTeX 文字，普通链接仍转成 Markdown", () => {
    const view = mount();
    const event = paste(
      view,
      String.raw`\(x_i\) 与 论文`,
      String.raw`<p>\(<a href="https://wrong.test">x_i</a>\) 与 <a href="https://paper.test">论文</a></p>`,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(String.raw`$x_i$ 与 [论文](https://paper.test)`);
  });

  it("变量名和公式下标里的下划线保持原样", () => {
    expect(htmlToMarkdown("<p>a_b foo_bar_baz x_{i}</p>")).toBe("a_b foo_bar_baz x_{i}");
    // 真有排版标记的那一份里，字面量下划线仍要挡住：那段文字是网页上**看见**
    // 的样子，不是谁写的 Markdown 源码。
    expect(htmlToMarkdown("<p><b>结论</b>：字面量 _不是强调_</p>"))
      .toBe(String.raw`**结论**：字面量 \_不是强调\_`);

    const view = mount();
    const event = paste(
      view,
      String.raw`a_b 与 \(x_{i}\)`,
      String.raw`<span>a_b 与 \(x_{i}\)</span>`,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("a_b 与 $x_{i}$");
  });

  it("没配成强调的星号保持原样", () => {
    expect(htmlToMarkdown("<p>脚注 ** 与 2 * 3 * 4</p>")).toBe("脚注 ** 与 2 * 3 * 4");
    expect(htmlToMarkdown("<p><b>结论</b>：字面量 **不是加粗**</p>"))
      .toBe(String.raw`**结论**：字面量 \*\*不是加粗\*\*`);
    // 行首的 `*` 例外：不挡住的话，这一行会被重新读成无序列表项。
    expect(htmlToMarkdown("<p><b>结论</b></p><p>* 不是列表项</p>"))
      .toBe(String.raw`**结论**

\* 不是列表项`);

    const view = mount();
    const event = paste(view, "n ** 2", "<span>n ** 2</span>");
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("n ** 2");
  });

  it("只带样式的 HTML 按纯文本粘贴，复制来的 Markdown 源码仍然生效", () => {
    // 代码编辑器复制时附的那份高亮 HTML：只有颜色，没有结构。
    const view = mount();
    const event = paste(
      view,
      "**加粗** 与 _斜体_",
      '<div style="color:#abb2bf"><span style="color:#c678dd">**加粗**</span>'
        + " 与 <span>_斜体_</span></div>",
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("**加粗** 与 _斜体_");
  });

  it("一行一个 <div> 的多行源码保持换行与缩进", () => {
    const view = mount();
    const event = paste(
      view,
      "- 列表\n  **缩进的加粗**",
      "<div><span>- 列表</span></div><div><span>  **缩进的加粗**</span></div>",
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("- 列表\n  **缩进的加粗**");
  });

  // VS Code 的富文本复制：整段套一个带样式的 <div>，每行再一个 <div>，
  // **空行是 <br>**（读它 bundle 里的 `_getHTMLToCopy` 得来的）。
  const vscode = (...lines: string[]) =>
    '<div style="color: #d4d4d4;background-color: #1f1f1f;font-family: Consolas;font-size: 14px;'
      + 'line-height: 19px;white-space: pre;">'
      + lines.map((line) => line === "" ? "<br>" : `<div><span style="color: #ce9178;">${line}</span></div>`).join("")
      + "</div>";

  it("VS Code 复制的一行 Markdown 源码原样进来", () => {
    const view = mount();
    const event = paste(view, "**加粗** 与 [论文](https://a.test)", vscode("**加粗** 与 [论文](https://a.test)"));
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("**加粗** 与 [论文](https://a.test)");
  });

  it("VS Code 复制的多段源码（空行是 <br>）也不加反斜杠", () => {
    const view = mount();
    const event = paste(
      view,
      "**加粗**\n\n- 见 [论文](https://a.test)",
      vscode("**加粗**", "", "- 见 [论文](https://a.test)"),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("**加粗**\n\n- 见 [论文](https://a.test)");
  });

  it("VS Code 复制的整篇源码保持原来的行距，挨着的行不被拆开", () => {
    const source = "# 标题\n\n第一行\n第二行\n\n- 甲\n- 乙\n";
    const view = mount();
    const event = paste(
      view,
      source,
      vscode("# 标题", "", "第一行", "第二行", "", "- 甲", "- 乙", ""),
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("纯文本里没有的换行仍然从 HTML 里取回来", () => {
    // 网页把一条块公式拆成三行，`text/plain` 只有一行：这份换行只有 HTML 有。
    const view = mount();
    const event = paste(
      view,
      String.raw`\[c*d\]`,
      String.raw`<div><span>\[</span><br><span>c*d</span><br><span>\]</span></div>`,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("$$\nc*d\n$$");
  });

  it("HTML 里有真的格式时仍走富文本转换", () => {
    const view = mount();
    const event = paste(
      view,
      "加粗 与 **字面量**",
      "<p><strong>加粗</strong> 与 **字面量**</p>",
    );
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(String.raw`**加粗** 与 \*\*字面量\*\*`);
  });

  it("剪贴板只有 HTML 时不受纯文本回退影响", () => {
    const view = mount();
    const event = paste(view, "", "<div>**加粗**</div>");
    expect(event.defaultPrevented).toBe(true);
    // 没有 text/plain 可退，只能走 HTML 那条路；但这份 HTML 一个标记也产不出来，
    // 所以照样不加反斜杠
    expect(view.state.doc.toString()).toBe("**加粗**");
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
