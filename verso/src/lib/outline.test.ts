import { describe, expect, it } from "vitest";

import { activeHeading, outlineDepths, parseHeadings, stripInline } from "./outline";

describe("parseHeadings", () => {
  it("认出六级 ATX 标题，行号从 1 起", () => {
    const md = ["# 一", "正文", "## 二", "", "###### 六"].join("\n");
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "一", line: 1 },
      { level: 2, text: "二", line: 3 },
      { level: 6, text: "六", line: 5 },
    ]);
  });

  it("`#标签` 不是标题 —— §2.4 的标签语法必须活下来", () => {
    // 这是这个解析器最容易出的错：少写「# 后面必须有空格」，
    // 满篇标签就全成了一级标题
    const md = ["#写作 #项目/笔记", "", "# 真标题", "", "####### 七个井号不是标题"].join("\n");
    expect(parseHeadings(md)).toEqual([{ level: 1, text: "真标题", line: 3 }]);
  });

  it("围栏代码块里的 `#` 不算标题", () => {
    const md = ["# 真", "```bash", "# 这是注释", "```", "## 也是真"].join("\n");
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["真", "也是真"]);
  });

  it("块公式里的等号和井号不进入大纲", () => {
    const md = [
      "# 真标题",
      "$$",
      "\\mathcal L",
      "=",
      "# 公式里的参数",
      "$$",
      "## 后续标题",
    ].join("\n");
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["真标题", "后续标题"]);
  });

  it("未闭合块公式与编辑器一样收尾到文末", () => {
    const md = ["# 真标题", "$$", "\\mathcal L", "=", "伪标题", "---"].join("\n");
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["真标题"]);
  });

  it("~~~ 围栏、以及围栏里出现更短的 ``` 都不会提前收口", () => {
    const md = ["~~~~", "```", "# 藏在里面", "```", "~~~~", "# 外面"].join("\n");
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["外面"]);
  });

  it("去掉结尾的闭合井号", () => {
    expect(parseHeadings("## 小节 ##").map((h) => h.text)).toEqual(["小节"]);
    expect(parseHeadings("## C# 是语言名 ").map((h) => h.text)).toEqual(["C# 是语言名"]);
  });

  it("缩进 3 空格还是标题，4 空格是代码", () => {
    expect(parseHeadings("   # 是").map((h) => h.text)).toEqual(["是"]);
    expect(parseHeadings("    # 否")).toEqual([]);
  });

  it("认出 setext 标题，行号指向文字那一行", () => {
    const md = ["标题一", "=====", "", "标题二", "-----"].join("\n");
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "标题一", line: 1 },
      { level: 2, text: "标题二", line: 4 },
    ]);
  });

  it("空行之后的 `---` 是分隔线，不是标题", () => {
    const md = ["一段正文", "", "---", "", "另一段"].join("\n");
    expect(parseHeadings(md)).toEqual([]);
  });

  it("列表项、引用、表格的下一行画线不会变成标题", () => {
    const md = ["- 一条列表", "---", "", "> 引用", "---", "", "| a | b |", "---"].join("\n");
    expect(parseHeadings(md)).toEqual([]);
  });

  it("CRLF 的正文行号与 LF 一致", () => {
    const crlf = "# 一\r\n正文\r\n## 二\r\n";
    expect(parseHeadings(crlf)).toEqual([
      { level: 1, text: "一", line: 1 },
      { level: 2, text: "二", line: 3 },
    ]);
  });

  it("空文档不炸", () => {
    expect(parseHeadings("")).toEqual([]);
  });

  it("只有井号没有文字时留空标题，不丢这一行", () => {
    // 正在敲的标题就是这个样子，大纲不能等他写完才出现
    expect(parseHeadings("#")).toEqual([{ level: 1, text: "", line: 1 }]);
  });
});

describe("stripInline", () => {
  it("剥掉行内标记，只留人读的文字", () => {
    expect(stripInline("**粗** 与 *斜* 与 `码` 与 ~~删~~")).toBe("粗 与 斜 与 码 与 删");
  });

  it("`[[目标|别名]]` 显示别名，普通链接显示文字", () => {
    expect(stripInline("看 [[笔记/长路径|别名]] 与 [文字](https://x)")).toBe("看 别名 与 文字");
    expect(stripInline("看 [[目标]]")).toBe("看 目标");
  });

  it("公式原样留着 —— 去掉 $ 之后 \\varepsilon 更难认", () => {
    expect(stripInline("误差 $\\varepsilon$ 的界")).toBe("误差 $\\varepsilon$ 的界");
  });
});

describe("activeHeading", () => {
  const hs = parseHeadings(["# 一", "正文", "## 二", "正文", "# 三"].join("\n"));

  it("取最后一条位于视线上方的标题", () => {
    expect(activeHeading(hs, 1)).toBe(0);
    expect(activeHeading(hs, 2)).toBe(0);
    expect(activeHeading(hs, 3)).toBe(1);
    expect(activeHeading(hs, 99)).toBe(2);
  });

  it("第一条标题之前不属于任何一节", () => {
    const withLead = parseHeadings(["引言", "", "# 一"].join("\n"));
    expect(activeHeading(withLead, 1)).toBe(-1);
  });

  it("没有标题时返回 -1", () => {
    expect(activeHeading([], 5)).toBe(-1);
  });
});

describe("outlineDepths", () => {
  it("按文档里最浅的那一级归零", () => {
    // 一级标题留给笔记标题本身、正文从 ## 开始，是很常见的写法
    const hs = parseHeadings(["## 二", "### 三", "## 二", "#### 四"].join("\n"));
    expect(outlineDepths(hs)).toEqual([0, 1, 0, 2]);
  });

  it("缩进最多三层", () => {
    const hs = parseHeadings(["# 一", "###### 六"].join("\n"));
    expect(outlineDepths(hs)).toEqual([0, 3]);
  });
});
