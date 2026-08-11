/**
 * 导出渲染器。DESIGN.md §4.3 之外的一条新链路：Markdown → HTML → 打印 → PDF。
 *
 * 这里测的重点有两类：
 *   1. **安全**（§7.5）—— 导出的 HTML 会在应用自己的 webview 里打开，那里
 *      够得着 IPC。所以「一段陌生笔记能不能造出可执行的东西」必须钉死
 *   2. **不吞内容** —— 排版差一点可以慢慢调，但导出少一段字是不可接受的：
 *      用户拿到 PDF 的时候，原文往往已经不在眼前了
 */
import { describe, expect, it } from "vitest";

import { renderMarkdown, renderViewTable, viewSources } from "../../../src/editor/exportHtml";
import type { ViewResult } from "../../../src/core/types";

describe("段落与标题", () => {
  it("段落包成 <p>", () => {
    expect(renderMarkdown("一段话")).toBe("<p>一段话</p>");
  });

  it("标题按级数出 h1–h6，并带锚点 id", () => {
    const html = renderMarkdown("## 方法");
    expect(html).toContain("<h2");
    expect(html).toContain("方法");
    expect(html).toContain('id="方法"');
  });

  it("headingOffset 让子文档整体降一级", () => {
    expect(renderMarkdown("# 标题", { headingOffset: 1 })).toContain("<h2");
  });

  it("降级不会掉到 h6 以下", () => {
    expect(renderMarkdown("###### 标题", { headingOffset: 3 })).toContain("<h6");
  });

  it("同名标题的 id 自动去重 —— 一篇里两个「小结」很常见", () => {
    const html = renderMarkdown("## 小结\n\n甲\n\n## 小结\n");
    expect(html).toContain('id="小结"');
    expect(html).toContain('id="小结-2"');
  });

  it("强调、加粗、删除线、高亮", () => {
    expect(renderMarkdown("*斜* **粗** ~~删~~ ==高==")).toContain("<em>斜</em>");
    expect(renderMarkdown("**粗**")).toContain("<strong>粗</strong>");
    expect(renderMarkdown("~~删~~")).toContain("<del>删</del>");
    expect(renderMarkdown("==高==")).toContain("<mark>高</mark>");
  });

  it("行内代码按字面输出，不再解析里面的标记", () => {
    expect(renderMarkdown("`**不是粗体**`")).toContain("<code>**不是粗体**</code>");
  });
});

describe("公式", () => {
  it("行内公式交给 KaTeX", () => {
    const html = renderMarkdown("设 $a^2+b^2=c^2$ 成立");
    expect(html).toContain("katex");
    expect(html).not.toContain("$a^2");
  });

  it("独占多行的块级公式渲染成 display 模式", () => {
    const html = renderMarkdown("上文\n\n$$\nA = U \\Sigma V^{\\mathsf{T}}\n$$\n\n下文\n");
    expect(html).toContain("math-block");
    expect(html).toContain("katex");
    // 定界符不该漏进正文
    expect(html).not.toContain("$$");
  });

  it("写坏的公式退回源码，不把整篇导出弄空（§5.3）", () => {
    // KaTeX 的 throwOnError: false 会自己渲染出错误态；无论走哪条路，
    // 关键是上下文还在
    const html = renderMarkdown("前 $\\frac{$ 后");
    expect(html).toContain("前");
    expect(html).toContain("后");
  });
});

describe("列表", () => {
  it("无序与有序", () => {
    expect(renderMarkdown("- 甲\n- 乙\n")).toContain("<ul>");
    expect(renderMarkdown("1. 甲\n2. 乙\n")).toContain("<ol>");
  });

  it("有序列表从写着的编号开始数，不强行从 1 开始", () => {
    expect(renderMarkdown("3. 丙\n4. 丁\n")).toContain('start="3"');
  });

  it("任务项带 checkbox，勾选状态跟着源码走", () => {
    const html = renderMarkdown("- [x] 已办\n- [ ] 待办\n");
    expect(html).toContain("checked");
    expect(html).toContain("is-done");
    expect(html).toContain("已办");
    expect(html).toContain("待办");
  });

  it("嵌套列表不丢层级", () => {
    const html = renderMarkdown("- 甲\n  - 甲一\n");
    expect(html).toContain("甲一");
    // 外层一个 ul，里层还有一个
    expect(html.match(/<ul>/g)?.length).toBe(2);
  });
});

describe("引用与 callout", () => {
  it("普通引用出 blockquote", () => {
    const html = renderMarkdown("> 引用一句\n");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("引用一句");
  });

  it("`> [!note] 标题` 出 callout，色族跟着类型走", () => {
    const html = renderMarkdown("> [!warning] 小心\n");
    expect(html).toContain("callout-warning");
    expect(html).toContain("小心");
    // 类型标记本身不该作为正文露出来
    expect(html).not.toContain("[!warning]");
  });

  it("没写标题时用类型的中文名", () => {
    expect(renderMarkdown("> [!tip]\n")).toContain("提示");
  });

  it("标题只到行末，后面的行是正文", () => {
    const html = renderMarkdown("> [!note] 标题\n> 正文一句\n");
    expect(html).toContain("标题");
    expect(html).toContain("正文一句");
    // 正文没有被并进标题那一行
    expect(html).toMatch(/callout-title[^]*标题[^]*<\/p>[^]*正文一句/);
  });

  it("不认识的类型仍然是 callout，退回「说明」色", () => {
    expect(renderMarkdown("> [!随便什么] 甲\n")).toContain("callout-info");
  });
});

describe("代码块", () => {
  it("围栏代码块按字面输出，语言写进 class", () => {
    const html = renderMarkdown("```rust\nlet x = 1;\n```\n");
    expect(html).toContain('class="language-rust"');
    expect(html).toContain("let x = 1;");
  });

  it("代码里的尖括号被转义，不会变成标签", () => {
    const html = renderMarkdown("```\n<script>alert(1)</script>\n```\n");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("verso-view 默认渲染成占位说明 —— 查询结果这层拿不到", () => {
    const html = renderMarkdown("```verso-view\nfrom: 论文\n```\n");
    expect(html).toContain("dbview-placeholder");
    expect(html).not.toContain("from: 论文");
  });

  it("调用方可以自己接管 verso-view 的渲染", () => {
    const html = renderMarkdown("```verso-view\nfrom: 论文\n```\n", {
      renderView: (src) => `<table data-src="${src.trim()}"></table>`,
    });
    expect(html).toContain('data-src="from: 论文"');
  });
});

describe("表格", () => {
  it("表头与正文分开，单元格里的行内标记照常渲染", () => {
    const html = renderMarkdown("| 名 | 值 |\n| --- | --- |\n| **甲** | 1 |\n");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<strong>甲</strong>");
  });

  it("对齐从分隔行读", () => {
    const html = renderMarkdown("| 左 | 中 | 右 |\n| :-- | :-: | --: |\n| a | b | c |\n");
    expect(html).toContain("text-align:center");
    expect(html).toContain("text-align:right");
  });
});

describe("内部链接与图片", () => {
  it("`[[笔记]]` 解析得到地址时是可点的链接", () => {
    const html = renderMarkdown("见 [[线性代数]]", {
      resolveLink: (t) => `#${t}`,
    });
    expect(html).toContain('href="#线性代数"');
    expect(html).toContain("线性代数");
  });

  it("解析不出地址时渲染成不可点的文本，而不是死链", () => {
    const html = renderMarkdown("见 [[库外的一篇]]");
    expect(html).toContain("库外的一篇");
    expect(html).not.toContain("<a");
  });

  it("`[[目标|别名]]` 显示别名", () => {
    const html = renderMarkdown("见 [[线性代数|线代]]", { resolveLink: () => "#x" });
    expect(html).toContain("线代");
    expect(html).not.toContain("线性代数");
  });

  it("`![[图.png]]` 走 resolveImage", () => {
    const html = renderMarkdown("![[attachments/图.png]]", {
      resolveImage: (t) => `asset://${t}`,
    });
    expect(html).toContain('src="asset://attachments/图.png"');
  });

  it("`![[图.png|300]]` 的宽度写进 width", () => {
    const html = renderMarkdown("![[图.png|300]]", { resolveImage: (t) => t });
    expect(html).toContain('width="300"');
  });

  it("找不到图片时给出文件名，而不是一个碎图标", () => {
    const html = renderMarkdown("![[缺失.png]]");
    expect(html).toContain("缺失.png");
    expect(html).toContain("img-missing");
  });

  it("非图片的嵌入降级成链接 —— 内容读不到，但不能一片空白", () => {
    const html = renderMarkdown("![[另一篇笔记]]", { resolveLink: (t) => `#${t}` });
    expect(html).toContain("另一篇笔记");
  });

  it("标准 Markdown 链接与外链图片", () => {
    expect(renderMarkdown("[站点](https://example.com)")).toContain(
      'href="https://example.com"',
    );
    expect(renderMarkdown("![说明](https://example.com/a.png)")).toContain(
      'src="https://example.com/a.png"',
    );
  });

  it("标签渲染成 span，不当成标题", () => {
    const html = renderMarkdown("记一笔 #线性代数");
    expect(html).toContain('class="tag"');
    expect(html).not.toContain("<h1");
  });
});

describe("安全边界（§7.5）", () => {
  it("整块 HTML 被转义，不会变成标签", () => {
    const html = renderMarkdown("<script>alert(1)</script>\n");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("行内的 <script> 同样转义", () => {
    const html = renderMarkdown("正文 <script>alert(1)</script> 正文");
    expect(html).not.toContain("<script>");
  });

  it("允许清单里的排版标签原样放行 —— 它们不带属性就没有攻击面", () => {
    expect(renderMarkdown("甲<br>乙")).toContain("<br>");
    expect(renderMarkdown("H<sub>2</sub>O")).toContain("<sub>");
  });

  it("同一个标签带上属性就当文本 —— 属性才是注入面", () => {
    const html = renderMarkdown('甲<br onload="alert(1)">乙');
    // 属性名还在，但它现在是一段字，不是一个标签
    expect(html).not.toContain("<br onload");
    expect(html).toContain("&lt;br");
  });

  it("javascript: 链接被丢掉，只留文字", () => {
    const html = renderMarkdown("[点我](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("点我");
  });

  it("data: 图片也不放行 —— 打开的那一刻就能执行东西", () => {
    // 地址会作为「找不到」提示里的一段**文字**出现，但绝不能进 src
    const html = renderMarkdown("![x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html).not.toContain('src="data:');
    expect(html).toContain("img-missing");
  });

  it("resolveLink 返回的地址同样要过协议检查", () => {
    const html = renderMarkdown("[[笔记]]", { resolveLink: () => "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
  });

  it("正文里的尖括号和引号被转义", () => {
    expect(renderMarkdown("a < b 且 c > d")).toContain("&lt;");
    expect(renderMarkdown('他说"好"')).toContain("&quot;");
  });
});

describe("不吞内容", () => {
  it("转义反斜杠后的字符照常出现", () => {
    expect(renderMarkdown("\\*不是斜体\\*")).toContain("*不是斜体*");
  });

  it("HTML 实体不被二次转义", () => {
    expect(renderMarkdown("甲&nbsp;乙")).toContain("&nbsp;");
    expect(renderMarkdown("甲&nbsp;乙")).not.toContain("&amp;nbsp;");
  });

  it("分隔线", () => {
    expect(renderMarkdown("---\n")).toContain("<hr />");
  });

  it("一篇混着各种块的笔记，每一段文字都还在", () => {
    const src = [
      "# 标题",
      "",
      "引言一句。",
      "",
      "## 方法",
      "",
      "- 甲",
      "- 乙",
      "",
      "> [!note] 提醒",
      "> 注意事项",
      "",
      "```py",
      "print(1)",
      "```",
      "",
      "| 名 | 值 |",
      "| --- | --- |",
      "| 丙 | 2 |",
      "",
      "结尾一句。",
      "",
    ].join("\n");

    const html = renderMarkdown(src);
    for (const piece of ["标题", "引言一句", "方法", "甲", "乙", "提醒", "注意事项", "print(1)", "丙", "结尾一句"]) {
      expect(html, `丢了「${piece}」`).toContain(piece);
    }
  });
});

describe("找出 database 视图（给调用方先跑查询）", () => {
  it("按出现顺序给出 YAML 源码", () => {
    const src = "前文\n\n```verso-view\nfrom: 甲\n```\n\n中间\n\n```verso-view\nfrom: 乙\n```\n";
    expect(viewSources(src)).toEqual(["from: 甲", "from: 乙"]);
  });

  it("别的语言的代码块不算", () => {
    expect(viewSources("```python\nfrom: 甲\n```\n")).toEqual([]);
  });

  it("正文里提到 `verso-view` 这几个字不算 —— 走语法树不是正则", () => {
    expect(viewSources("用 `verso-view` 写一个视图。")).toEqual([]);
  });

  it("空的视图块也要报出来，否则那一块会被当成查不到", () => {
    expect(viewSources("```verso-view\n```\n")).toEqual([""]);
  });
});

const RESULT: ViewResult = {
  rows: [
    { path: "a.md", title: "甲", props: { status: "进行中", 优先级: "高" } },
    { path: "b.md", title: "乙", props: { status: "已完成", 优先级: "低" } },
    { path: "c.md", title: "丙", props: { 优先级: "中" } },
  ],
  columns: ["status", "优先级"],
  view: "table",
  groupBy: null,
  properties: [],
};

describe("视图印成表格", () => {
  it("第一列永远是笔记名 —— 否则找不到这一行说的是哪一篇", () => {
    const html = renderViewTable(RESULT);
    expect(html).toContain("<th>名称</th>");
    expect(html.indexOf("名称")).toBeLessThan(html.indexOf("status"));
    expect(html).toContain("<td>甲</td>");
  });

  it("视图点名的列都在，缺的属性留空而不是掉一格", () => {
    const html = renderViewTable(RESULT);
    expect(html).toContain("进行中");
    // 丙没有 status：那一格必须是空的，不能让「中」串到 status 列去
    expect(html).toContain("<tr><td>丙</td><td></td><td>中</td></tr>");
  });

  it("看板印成分组表格 —— 纸上没有拖拽，横向栏也摆不下", () => {
    const html = renderViewTable({ ...RESULT, view: "board", groupBy: "status" });
    expect(html).toContain("进行中（1）");
    expect(html).toContain("已完成（1）");
    // 没填那个属性的归到「未设置」
    expect(html).toContain("未设置（1）");
    expect(html.match(/<table>/g)).toHaveLength(3);
  });

  it("空视图说一句，而不是留一张空表", () => {
    expect(renderViewTable({ ...RESULT, rows: [] })).toContain("没有内容");
  });

  it("行里的内容一律转义 —— 属性值是用户写的（§7.5）", () => {
    const html = renderViewTable({
      ...RESULT,
      rows: [{ path: "x.md", title: "<script>alert(1)</script>", props: {} }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
