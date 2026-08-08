/**
 * database widget 在真实 React StrictMode 下的挂载时序。
 *
 * 只验 `.cm-dbview` 不够：出 bug 时 CodeMirror 已经放好了这个空容器，
 * 真正被 StrictMode 旧 cleanup 卸载的是容器里的 React 表格。
 */
import React, { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/host/api", () => ({
  api: {
    backlinks: vi.fn(async () => []),
    viewQuery: vi.fn(async () => ({
      rows: [],
      columns: ["title", "status"],
      view: "table",
      groupBy: null,
    })),
  },
}));

import { Editor } from "../../../src/ui/Editor";

const mounted: Root[] = [];

afterEach(async () => {
  for (const root of mounted.splice(0)) root.unmount();
  await Promise.resolve();
  document.body.innerHTML = "";
});

describe("Editor 里的 database 视图", () => {
  it("StrictMode 再挂载后表格仍在，不留空白 widget", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push(root);

    root.render(
      React.createElement(
        StrictMode,
        null,
        React.createElement(Editor, {
          note: {
            path: "论文.md",
            id: "test-id",
            title: "论文",
            frontmatter: {},
            frontmatterText: null,
            body: '# 论文清单\n\n```verso-view\nfrom: "论文/*"\nview: table\n```\n',
            mtimeMs: 0,
          },
          onChange: () => {},
          onSaveNow: () => {},
          onFollowLink: () => {},
          getNotes: () => [],
          breadcrumb: [],
          onNavigate: () => {},
          revision: 0,
          onNoteChanged: () => {},
          customSnippets: "",
          sourceMode: false,
          onSaveFrontmatter: async () => {},
          onSaveImage: async () => "attachments/x.png",
          imageSrc: () => null,
          onError: () => {},
        }),
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(host.querySelectorAll(".cm-dbview")).toHaveLength(1);
    expect(host.querySelectorAll(".cm-dbview .dbview-table")).toHaveLength(1);
    expect(host.querySelector(".cm-dbview")?.textContent).toContain("没有匹配的笔记");
  });
});
