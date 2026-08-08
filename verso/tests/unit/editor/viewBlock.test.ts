/**
 * database 视图的 decoration 生成。
 *
 * 这个功能反复出问题（打开笔记不渲染、点一下才出来），而截图分不清
 * 「没匹配上」和「没触发重算」。直接在 EditorState 上验。
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { markdownExtended } from "../../../src/editor/markdownExtended";
import { viewBlockCount } from "../../../src/editor/viewBlock";

const DOC = `# 论文清单

一段说明文字。

\`\`\`verso-view
from: "论文/*"
view: table
columns: [title, 作者]
\`\`\`

## 另一个

\`\`\`verso-view
from: "论文/*"
view: board
group-by: status
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

describe("verso-view 代码块识别", () => {
  it("能在新建的 state 上找到全部视图块", () => {
    expect(viewBlockCount(stateOf(DOC))).toBe(2);
  });

  it("光标在块内时不渲染（露出源码好编辑）", () => {
    const inside = DOC.indexOf('from: "论文/*"') + 3;
    expect(viewBlockCount(stateOf(DOC, inside))).toBe(1);
  });

  it("普通代码块不受影响", () => {
    const doc = "```python\nprint(1)\n```\n";
    expect(viewBlockCount(stateOf(doc))).toBe(0);
  });

  it("文档末尾的块也算", () => {
    const doc = '正文\n\n```verso-view\nfrom: "a/*"\n```';
    expect(viewBlockCount(stateOf(doc))).toBe(1);
  });
});

describe("只认 verso-view 这一种围栏标记", () => {
  // 开头都留一行 —— stateOf 把光标放在 0，代码块紧贴文档开头的话光标就在
  // 块里，那时露出源码是设计如此，不是匹配没生效
  it("别的语言标记不当成视图", () => {
    expect(viewBlockCount(stateOf('开头\n\n```verso\nfrom: "*"\n```'))).toBe(0);
    expect(viewBlockCount(stateOf('开头\n\n```other-view\nfrom: "*"\n```'))).toBe(0);
    expect(viewBlockCount(stateOf('开头\n\n```folio-view\nfrom: "*"\n```'))).toBe(0);
  });
});
