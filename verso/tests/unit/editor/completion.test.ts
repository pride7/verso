/**
 * 补全来源的行为测试。
 *
 * 这两个东西的成败全在「什么时候该弹、什么时候不该弹」上，
 * 而那用截图根本验不了 —— 必须直接喂 CompletionContext。
 */
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { slashSource, wikiLinkSource } from "../../../src/editor/completion";
import { markdownExtended } from "../../../src/editor/markdownExtended";
import type { NoteRef } from "../../../src/core/types";

const NOTES: NoteRef[] = [
  { name: "线性代数", path: "数学/线性代数.md" },
  { name: "奇异值分解", path: "数学/线性代数/奇异值分解.md" },
];

/** 用 `|` 标出光标位置 */
function ctxAt(withCaret: string) {
  const pos = withCaret.indexOf("|");
  const doc = withCaret.replace("|", "");
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [GFM, markdownExtended], codeLanguages: [] }),
    ],
  });
  return new CompletionContext(state, pos, false);
}

describe("/ 块插入菜单", () => {
  it("行首打 / 会弹", () => {
    const r = slashSource(ctxAt("/|"));
    expect(r).not.toBeNull();
    expect(r!.options.length).toBeGreaterThan(10);
  });

  /** 之前的 bug：要求整行为空，导致段落中间和行尾打 / 都不触发 */
  it("段落中间和行尾打 / 也要弹", () => {
    expect(slashSource(ctxAt("一段话 /|"))).not.toBeNull();
    expect(slashSource(ctxAt("写到这里 /|"))).not.toBeNull();
  });

  it("紧贴前一个字符时不弹 —— a/b 和 URL 不该触发", () => {
    expect(slashSource(ctxAt("a/|"))).toBeNull();
    expect(slashSource(ctxAt("https:/|"))).toBeNull();
    expect(slashSource(ctxAt("路径是 src/|"))).toBeNull();
  });

  it("按中文名过滤", () => {
    const r = slashSource(ctxAt("/表格|"));
    expect(r!.options.map((o) => o.label)).toContain("表格");
  });

  it("公式里的 / 是除号，不弹菜单", () => {
    expect(slashSource(ctxAt("$a /|"))).toBeNull();
  });
});

describe("[[ 内部链接补全", () => {
  const src = wikiLinkSource(() => NOTES);

  it("打完 [[ 就弹出候选", () => {
    const r = src(ctxAt("见 [[|"));
    expect(r).not.toBeNull();
    expect(r!.options.map((o) => o.label)).toContain("线性代数");
  });

  it("按输入模糊过滤", () => {
    const r = src(ctxAt("见 [[奇异|"));
    expect(r!.options[0].label).toBe("奇异值分解");
  });

  it("补全时把 ]] 一起补上", () => {
    const r = src(ctxAt("见 [[线性|"));
    expect(r!.options[0].apply).toBe("线性代数]]");
  });

  it("没匹配时给一条「新建」—— 链到还不存在的笔记是常态", () => {
    const r = src(ctxAt("见 [[还没写的|"));
    expect(r!.options[r!.options.length - 1].detail).toBe("新建这篇笔记");
  });

  it("只打一个 [ 不弹", () => {
    expect(src(ctxAt("见 [|"))).toBeNull();
  });
});
