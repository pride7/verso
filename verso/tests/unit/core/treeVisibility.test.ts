import { describe, expect, it } from "vitest";

import type { TreeNode } from "../../../src/core/types";
import { hideTemplateSubtree } from "../../../src/core/treeVisibility";

function document(path: string, children: TreeNode[] = []): TreeNode {
  const name = path.split("/").pop()!;
  return {
    name: name.replace(/\.md$/, ""),
    path,
    kind: "document",
    childDir: children.length ? path.replace(/\.md$/, "") : null,
    order: null,
    created: null,
    updated: null,
    children,
  };
}

function folder(path: string, children: TreeNode[] = []): TreeNode {
  const name = path.split("/").pop()!;
  return {
    name,
    path,
    kind: "folder",
    childDir: null,
    order: null,
    created: null,
    updated: null,
    children,
  };
}

describe("hideTemplateSubtree", () => {
  it("隐藏模板目录及其子文档，但不误伤同名前缀目录", () => {
    const tree = [
      folder("templates", [document("templates/日记.md")]),
      document("templates-旧.md"),
      document("正文.md"),
    ];

    const visible = hideTemplateSubtree(tree, "templates");
    expect(visible.map((node) => node.path)).toEqual(["templates-旧.md", "正文.md"]);
  });

  it("支持嵌套模板目录，并保留父目录下的普通文档", () => {
    const tree = [
      document("资料.md", [
        document("资料/模板/会议.md"),
        document("资料/普通.md"),
      ]),
    ];

    const visible = hideTemplateSubtree(tree, "/资料/模板/");
    expect(visible[0].children.map((node) => node.path)).toEqual(["资料/普通.md"]);
  });

  it("同名文档与模板目录合并时保留文档本身", () => {
    const tree = [document("templates.md", [document("templates/日记.md")])];

    const visible = hideTemplateSubtree(tree, "templates");
    expect(visible).toHaveLength(1);
    expect(visible[0].path).toBe("templates.md");
    expect(visible[0].childDir).toBeNull();
    expect(visible[0].children).toEqual([]);
  });

  it("模板目录为空时保留原树引用", () => {
    const tree = [document("正文.md")];
    expect(hideTemplateSubtree(tree, " ")).toBe(tree);
  });
});
