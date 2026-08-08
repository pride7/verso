import { GFM, parser as baseParser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { markdownExtended } from "../../../src/editor/markdownExtended";

const parser = baseParser.configure([GFM, markdownExtended]);

interface Node {
  name: string;
  from: number;
  to: number;
  text: string;
}

function nodes(src: string, name?: string): Node[] {
  const out: Node[] = [];
  parser.parse(src).iterate({
    enter(n) {
      if (!name || n.name === name) {
        out.push({ name: n.name, from: n.from, to: n.to, text: src.slice(n.from, n.to) });
      }
    },
  });
  return out;
}

const texts = (src: string, name: string) => nodes(src, name).map((n) => n.text);

describe("公式", () => {
  it("识别行内公式", () => {
    expect(texts("设 $a^2 + b^2 = c^2$ 成立", "InlineMath")).toEqual(["$a^2 + b^2 = c^2$"]);
  });

  it("识别独占多行的块级公式", () => {
    const src = "上文\n\n$$\nA = U \\Sigma V^{\\mathsf{T}}\n$$\n\n下文\n";
    const found = texts(src, "BlockMath");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("\\Sigma");
  });

  it("识别同一行闭合的块级公式", () => {
    expect(texts("$$E = mc^2$$", "BlockMath")).toEqual(["$$E = mc^2$$"]);
  });

  it("紧跟正文的块公式会打断段落，不被独立等号误判成 Setext 标题", () => {
    const src = [
      "正文",
      "$$",
      "a=1",
      "$$",
      "下一段",
      "$$",
      "b",
      "=",
      "c",
      "$$",
      "结尾",
    ].join("\n");
    expect(texts(src, "BlockMath")).toHaveLength(2);
    expect(texts(src, "SetextHeading1")).toEqual([]);
  });

  it("引用块里的结束符能闭合公式，不吞掉后文", () => {
    const src = "> 正文\n> $$\n> a=1\n> $$\n\n下文";
    expect(texts(src, "BlockMath")).toEqual(["$$\n> a=1\n> $$"]);
    expect(texts(src, "Paragraph")).toContain("下文");
  });

  /**
   * 这条是行内公式最容易出的假阳性。没有这个启发式，「$5 到 $20」中间那段
   * 普通文字会被整段当成公式渲染掉。
   */
  it("不把货币金额当成公式", () => {
    expect(texts("这本书 $5 起，精装 $20 封顶。", "InlineMath")).toEqual([]);
  });

  it("转义的 \\$ 不是定界符", () => {
    expect(texts("价格是 \\$100 而不是公式", "InlineMath")).toEqual([]);
  });

  it("代码块里的 $ 不当公式", () => {
    const src = "```python\ncost = $x + $y\n```\n";
    expect(texts(src, "InlineMath")).toEqual([]);
  });

  it("行内代码里的 $ 不当公式", () => {
    expect(texts("变量 `$PATH` 是环境变量", "InlineMath")).toEqual([]);
  });

  /**
   * 公式里的下划线是下标语法，不是 Markdown 强调。若公式解析晚于强调解析，
   * `$a_1 + b_1$` 会被拆成斜体，公式就废了。
   */
  it("公式里的下标不被当成斜体", () => {
    const src = "$a_1 + b_1$";
    expect(texts(src, "InlineMath")).toEqual([src]);
    expect(texts(src, "Emphasis")).toEqual([]);
  });

  it("公式内容单独成节点，供 M2 的数学模式检测使用", () => {
    expect(texts("$x^2$", "MathContent")).toEqual(["x^2"]);
  });
});

describe("内部链接", () => {
  it("识别简单链接", () => {
    expect(texts("见 [[线性代数]]", "WikiLink")).toEqual(["[[线性代数]]"]);
    expect(texts("见 [[线性代数]]", "WikiLinkTarget")).toEqual(["线性代数"]);
  });

  it("拆分别名", () => {
    const src = "见 [[特征值|左奇异向量]]";
    expect(texts(src, "WikiLinkTarget")).toEqual(["特征值"]);
    expect(texts(src, "WikiLinkAlias")).toEqual(["左奇异向量"]);
  });

  it("识别嵌入并与普通链接区分", () => {
    const src = "![[fig-svd-1.png]]";
    expect(texts(src, "Embed")).toEqual([src]);
    expect(texts(src, "WikiLink")).toEqual([]);
  });

  it("不跨行匹配", () => {
    expect(texts("[[没有闭合\n下一行]]", "WikiLink")).toEqual([]);
  });

  it("空链接不算", () => {
    expect(texts("[[]]", "WikiLink")).toEqual([]);
  });
});

describe("标签", () => {
  it("识别中文与嵌套标签", () => {
    expect(texts("#线性代数 与 #数学/分析", "Hashtag")).toEqual(["#线性代数", "#数学/分析"]);
  });

  it("纯数字不是标签", () => {
    // `#1` 通常是编号或 issue 引用，不是标签
    expect(texts("见条目 #1 和 #2026", "Hashtag")).toEqual([]);
  });

  it("词中间的 # 不是标签", () => {
    expect(texts("语言 C# 和 F#", "Hashtag")).toEqual([]);
    expect(texts("路径 foo#bar", "Hashtag")).toEqual([]);
  });

  /**
   * 中文标点后面的标签。`标签：#线性代数` 是中文写作里极常见的写法，
   * 而全角冒号不是空白字符 —— 用「前面必须是空白」做判据会整个漏掉。
   */
  it("中文标点之后的标签能识别", () => {
    expect(texts("标签：#线性代数 #数学/矩阵分解", "Hashtag")).toEqual([
      "#线性代数",
      "#数学/矩阵分解",
    ]);
    expect(texts("（#括号里）", "Hashtag")).toEqual(["#括号里"]);
    expect(texts("句号。#标签", "Hashtag")).toEqual(["#标签"]);
  });

  /** 中文标点应当终止标签，而不是被吃进去 */
  it("标签在中文标点处结束", () => {
    expect(texts("这是 #线性代数。下一句", "Hashtag")).toEqual(["#线性代数"]);
    expect(texts("有 #甲、#乙 两个", "Hashtag")).toEqual(["#甲", "#乙"]);
  });

  it("标题不会被当成标签", () => {
    expect(texts("# 一级标题\n", "Hashtag")).toEqual([]);
  });
});

describe("高亮与 callout", () => {
  it("识别高亮", () => {
    expect(texts("这里 ==很重要== 记住", "Highlight")).toEqual(["==很重要=="]);
  });

  it("识别 callout 标记", () => {
    expect(texts("> [!note] 提示\n> 内容\n", "CalloutMarker")).toEqual(["[!note]"]);
  });
});

describe("不破坏标准 Markdown", () => {
  it("标题、粗体、列表、链接仍然正常", () => {
    const src = "## 标题\n\n**粗体** 与 *斜体*\n\n- 项目\n\n[文字](https://example.com)\n";
    const all = nodes(src).map((n) => n.name);
    expect(all).toContain("ATXHeading2");
    expect(all).toContain("StrongEmphasis");
    expect(all).toContain("Emphasis");
    expect(all).toContain("BulletList");
    expect(all).toContain("Link");
  });

  it("GFM 表格与删除线仍然正常", () => {
    const src = "| a | b |\n|---|---|\n| 1 | 2 |\n\n~~删除~~\n";
    const all = nodes(src).map((n) => n.name);
    expect(all).toContain("Table");
    expect(all).toContain("Strikethrough");
  });

  it("水平分隔线不被当成 frontmatter 或公式", () => {
    const all = nodes("上\n\n---\n\n下\n").map((n) => n.name);
    expect(all).toContain("HorizontalRule");
  });
});
