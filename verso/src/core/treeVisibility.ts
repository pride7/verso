import type { TreeNode } from "./types";

/** 规整设置中的 vault 相对目录，和模板选择器使用同一套边界规则。 */
function normalizeDir(dir: string): string {
  return dir.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * 从文档树的显示副本中移除模板目录及其子文档。
 *
 * 模板仍然保留在完整树和 noteList 里，因此搜索、链接、模板面板和文件系统访问
 * 都不受影响。只给树的显示副本做过滤，避免把模板文件误当成普通文档删除。
 *
 * 若模板目录与同名文档合并成一个节点（例如 `templates.md` + `templates/`），
 * 保留那篇普通文档，但隐藏它下面的模板子树。
 */
export function hideTemplateSubtree(nodes: TreeNode[], templateDir: string): TreeNode[] {
  const dir = normalizeDir(templateDir);
  if (!dir) return nodes;
  const prefix = `${dir}/`;

  return nodes.flatMap((node) => {
    // 纯模板目录节点，以及目录下的所有子节点，都不进入文档树。
    if (node.path === dir || node.path.startsWith(prefix)) return [];

    // 同名文档与模板目录合并时，保留文档本身，但不要让模板子树漏出来。
    if (node.childDir && normalizeDir(node.childDir) === dir) {
      return [{ ...node, childDir: null, children: [] }];
    }

    if (!node.children.length) return [node];
    return [{ ...node, children: hideTemplateSubtree(node.children, dir) }];
  });
}
