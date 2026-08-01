/**
 * 源码模式下 frontmatter 也要退回源码。
 *
 * 放浏览器测试而不是纯 Node：这一条要验的是**编辑器整体在两种模式下渲染出
 * 什么**，得把真的 `Editor` 挂起来（它内部有 CodeMirror、有 widget 里的
 * React root），happy-dom 里那些都不会真的建起来。
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    backlinks: vi.fn(async () => []),
    propSet: vi.fn(async () => {}),
    viewQuery: vi.fn(async () => ({ rows: [], columns: [], view: "table", groupBy: null })),
  },
}));

import { Editor } from "./Editor";
import type { NoteContent } from "../types";
import "../styles.css";

/** 原文里 status 在 tags 前面，还带一行注释 —— 解析后的映射拼不回这个样子 */
const FM_TEXT = "# 这行注释解析完就没了\nstatus: 整理中\ntags:\n  - 索引页\n";

const NOTE: NoteContent = {
  path: "论文.md",
  id: "01J8XKQ2M4N7P9R3T5V8W1Y2Z0",
  title: "论文",
  frontmatter: { tags: ["索引页"], status: "整理中" },
  frontmatterText: FM_TEXT,
  body: "# 标题\n\n正文\n",
  mtimeMs: 0,
};

const roots: Root[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) r.unmount();
  document.body.innerHTML = "";
});

function mount(note: NoteContent) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (sourceMode: boolean) =>
    root.render(
      React.createElement(Editor, {
        note,
        onChange: () => {},
        onSaveNow: () => {},
        onFollowLink: () => {},
        getNotes: () => [],
        breadcrumb: [],
        onNavigate: () => {},
        revision: 0,
        onNoteChanged: () => {},
        customSnippets: "",
        sourceMode,
      }),
    );
  return { host, render };
}

const settle = () => new Promise((r) => setTimeout(r, 400));

describe("源码模式下的 frontmatter", () => {
  it("预览模式给属性条，源码模式给两道 --- 之间的原文", async () => {
    const { host, render } = mount(NOTE);

    render(false);
    await settle();
    expect(host.querySelector(".props")).not.toBeNull();
    expect(host.querySelector(".fm-source")).toBeNull();

    render(true);
    await settle();
    expect(host.querySelector(".props")).toBeNull();
    // 一字不差地照抄文件里的那几行 —— 键序和注释都在
    expect(host.querySelector(".fm-source")?.textContent).toBe(`---\n${FM_TEXT}---`);
  });

  it("没有 frontmatter 的笔记，源码模式下不凭空造一个空的出来", async () => {
    const { host, render } = mount({ ...NOTE, frontmatter: {}, frontmatterText: null });
    render(true);
    await settle();
    expect(host.querySelector(".fm-source")).toBeNull();
  });
});
