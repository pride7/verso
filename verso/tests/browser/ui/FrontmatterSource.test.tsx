/**
 * 源码模式下的 frontmatter —— 在真实 Chromium 里跑。
 *
 * 要验的是**编辑器整体在两种模式下渲染出什么**，得把真的 `Editor` 挂起来
 * （它内部有 CodeMirror、有 widget 里的 React root）；而输入、失焦这些
 * 也得有真实的焦点系统才走得通，happy-dom 里两样都没有。
 */
import { userEvent } from "vitest/browser";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/host/api", () => ({
  api: {
    backlinks: vi.fn(async () => []),
    propSet: vi.fn(async () => {}),
    viewQuery: vi.fn(async () => ({ rows: [], columns: [], view: "table", groupBy: null })),
  },
}));

import { Editor } from "../../../src/ui/Editor";
import type { NoteContent } from "../../../src/core/types";
import "../../../src/ui/styles.css";

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

function mount(note: NoteContent, onSaveFrontmatter: (yaml: string) => Promise<void> = async () => {}) {
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
        onRenameNote: () => {},
        revision: 0,
        onNoteChanged: () => {},
        customSnippets: "",
        sourceMode,
        onSaveFrontmatter,
        onSaveAttachment: async () => "attachments/x.png",
        imageSrc: () => null,
        onError: () => {},
      }),
    );
  return { host, render };
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const yamlBox = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>(".fm-yaml")!;

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
    // 一字不差地照抄文件里的那几行 —— 键序和注释都在。
    // 两道 `---` 也在框里：整块要能一次选中、一次删掉
    expect(yamlBox(host).value).toBe(`---
${FM_TEXT}---`);
  });

  it("改完失焦就落盘，交出去的是改后的全文", async () => {
    const saved: string[] = [];
    const { host, render } = mount(NOTE, async (yaml) => {
      saved.push(yaml);
    });
    render(true);
    await settle();

    const box = yamlBox(host);
    box.focus();
    // 连围栏一起改 —— 编辑框里就是整块，交出去的应当是剥掉围栏的 YAML
    await userEvent.fill(box, "---\nstatus: 读完了\n---");
    box.blur();
    await settle();

    expect(saved).toEqual(["status: 读完了\n"]);
  });

  it("整块选中删掉：交出去的是空 YAML（= 清掉全部自定义属性）", async () => {
    // 作者报的就是这个 —— 围栏放在框外面时整块选不中、删不掉
    const saved: string[] = [];
    const { host, render } = mount(NOTE, async (yaml) => {
      saved.push(yaml);
    });
    render(true);
    await settle();

    const box = yamlBox(host);
    box.focus();
    box.setSelectionRange(0, box.value.length);
    await userEvent.keyboard("{Delete}");
    box.blur();
    await settle();

    expect(saved).toEqual([""]);
  });

  it("手不离开也会存：停手 800ms 自动落盘", async () => {
    const saved: string[] = [];
    const { host, render } = mount(NOTE, async (yaml) => {
      saved.push(yaml);
    });
    render(true);
    await settle();

    const box = yamlBox(host);
    box.focus();
    await userEvent.fill(box, "status: 在读\n");
    // 一直不失焦。没有这条自动保存的话，改完直接切走的人会丢东西
    await settle(1400);

    expect(saved).toEqual(["status: 在读\n"]);
  });

  it("没改过就失焦，不写", async () => {
    const saved: string[] = [];
    const { host, render } = mount(NOTE, async (yaml) => {
      saved.push(yaml);
    });
    render(true);
    await settle();

    yamlBox(host).focus();
    yamlBox(host).blur();
    await settle();

    expect(saved).toEqual([]);
  });

  it("YAML 写错：报错挂在下面，用户敲的东西原样留着", async () => {
    // 这一条是这个功能最要紧的性质。存不进去的时候把文本回滚掉，
    // 等于替用户把他刚写的东西删了
    const { host, render } = mount(NOTE, async () => {
      throw new Error("YAML 解析失败：mapping values are not allowed here");
    });
    render(true);
    await settle();

    const box = yamlBox(host);
    box.focus();
    await userEvent.fill(box, "status: [没关上\n");
    box.blur();
    await settle();

    expect(host.querySelector(".fm-error")?.textContent).toContain("YAML 解析失败");
    expect(yamlBox(host).value).toBe("status: [没关上\n");
  });

  it("没有 frontmatter 的笔记，源码模式下不凭空造一个空的出来", async () => {
    const { host, render } = mount({ ...NOTE, frontmatter: {}, frontmatterText: null });
    render(true);
    await settle();
    expect(host.querySelector(".fm-source")).toBeNull();
  });
});
