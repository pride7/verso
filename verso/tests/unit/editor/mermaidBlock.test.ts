/**
 * mermaid 代码块的识别与 decoration 生成。
 *
 * 和 viewBlock 那份同一个理由：截图分不清「没匹配上」和「没触发重算」，
 * 直接在 EditorState 上验。真正的画图（异步、要 DOM）不在这里测。
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { markdownExtended } from "../../../src/editor/markdownExtended";
import {
  isMermaidFenceLine,
  mermaidBlockCount,
  mermaidBlocks,
} from "../../../src/editor/mermaidBlock";
import { mermaidPreviewCount } from "../../../src/editor/mermaidPreview";

const DOC = `# 架构

一段说明文字。

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

## 另一张

\`\`\`mermaid
sequenceDiagram
  甲->>乙: 请求
\`\`\`
`;

function stateOf(doc: string, anchor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM, markdownExtended], codeLanguages: [] }),
    ],
  });
}

describe("mermaid 代码块识别", () => {
  it("能在新建的 state 上找到全部图表块", () => {
    expect(mermaidBlockCount(stateOf(DOC))).toBe(2);
  });

  it("光标在块内时不渲染（露出源码好编辑）", () => {
    expect(mermaidBlockCount(stateOf(DOC, DOC.indexOf("A --> B")))).toBe(1);
  });

  it("普通代码块不受影响", () => {
    expect(mermaidBlockCount(stateOf("开头\n\n```python\nprint(1)\n```\n"))).toBe(0);
    expect(mermaidBlockCount(stateOf("开头\n\n```\ngraph TD\n```\n"))).toBe(0);
  });

  it("文档末尾的块也算", () => {
    expect(mermaidBlockCount(stateOf("正文\n\n```mermaid\ngraph TD\n```"))).toBe(1);
  });

  it("拿得到块内源码本身 —— 画的是它，不是整块", () => {
    const blocks = mermaidBlocks(stateOf(DOC));
    expect(blocks.map((b) => b.source)).toEqual(["graph TD\n  A --> B", "sequenceDiagram\n  甲->>乙: 请求"]);
    // 「编辑」按钮把光标送到这里，必须落在源码那一段里
    expect(DOC.slice(blocks[0].bodyFrom, blocks[0].bodyTo)).toBe("graph TD\n  A --> B");
  });

  it("空块也是图表块 —— 不该掉回普通代码块", () => {
    const blocks = mermaidBlocks(stateOf("开头\n\n```mermaid\n```\n"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("");
  });
});

describe("只认 mermaid 这一个语言标记", () => {
  it("语言名带别的参数就不算", () => {
    expect(mermaidBlockCount(stateOf("开头\n\n```mermaidjs\ngraph TD\n```"))).toBe(0);
    expect(mermaidBlockCount(stateOf("开头\n\n```mermaid-live\ngraph TD\n```"))).toBe(0);
  });

  it("大小写不计较 —— 别的编辑器里写成 Mermaid 的不少", () => {
    expect(mermaidBlockCount(stateOf("开头\n\n```Mermaid\ngraph TD\n```"))).toBe(1);
  });
});

describe("编辑时的预览", () => {
  it("光标在块里才有，块外没有", () => {
    expect(mermaidPreviewCount(stateOf(DOC, DOC.indexOf("A --> B")))).toBe(1);
    expect(mermaidPreviewCount(stateOf(DOC, 0))).toBe(0);
  });

  it("只给光标所在的那一个块 —— 一篇里有两张图也不会同时挂两份", () => {
    expect(mermaidPreviewCount(stateOf(DOC, DOC.indexOf("sequenceDiagram")))).toBe(1);
  });
});

describe("围栏行判断（codeBlock.ts 让位时用的那份）", () => {
  it("认得开围栏，也认得缩进和波浪线围栏", () => {
    expect(isMermaidFenceLine("```mermaid")).toBe(true);
    expect(isMermaidFenceLine("  ```mermaid  ")).toBe(true);
    expect(isMermaidFenceLine("~~~mermaid")).toBe(true);
  });

  it("别的语言和正文行都不算", () => {
    expect(isMermaidFenceLine("```python")).toBe(false);
    expect(isMermaidFenceLine("```")).toBe(false);
    expect(isMermaidFenceLine("mermaid")).toBe(false);
  });
});
