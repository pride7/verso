/**
 * 文档树排序。DESIGN.md §2.1
 *
 * ## 手动顺序存在哪
 *
 * vault 根目录的 `.verso-order.json`。为什么不是 frontmatter、也不是
 * `.verso/`，见 `src-tauri/src/vault/order.rs` 的模块注释。
 *
 * 这里只需要知道：`TreeNode.order` 是 Rust 查那个文件算出来的名次（1 起），
 * 没排过的是 `null`。
 *
 * ## 排序规则
 *
 * 除「手动」外都不写文件，只是显示顺序。
 */
import type { TreeNode } from "../types";

export type TreeSort = "manual" | "name" | "name-desc" | "created" | "updated";

export const SORT_LABELS: Record<TreeSort, string> = {
  manual: "手动排序",
  name: "名称 A→Z",
  "name-desc": "名称 Z→A",
  created: "最近创建",
  updated: "最近修改",
};

/**
 * 自然序比较：`第2章` 排在 `第10章` 前面。
 *
 * 纯字典序会把 `10` 排在 `2` 前面 —— 笔记名里带编号是很常见的写法，
 * 那样排出来完全没法看。
 */
export function naturalCmp(a: string, b: string): number {
  return a.localeCompare(b, "zh", { numeric: true, sensitivity: "base" });
}

/** 时间戳倒序用。缺时间的排最后，而不是被当成 1970 年排最前 */
function byTimeDesc(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
}

function compare(mode: TreeSort, a: TreeNode, b: TreeNode): number {
  switch (mode) {
    case "name":
      return naturalCmp(a.name, b.name);
    case "name-desc":
      return naturalCmp(b.name, a.name);
    case "created":
      return byTimeDesc(a.created, b.created);
    case "updated":
      return byTimeDesc(a.updated, b.updated);
    case "manual": {
      // 没排过的沉到底部并按名字排 —— 不能让它们插在已排好的中间，
      // 那样每新建一篇笔记，手排的顺序看起来就乱一次
      const ao = a.order ?? Infinity;
      const bo = b.order ?? Infinity;
      if (ao !== bo) return ao - bo;
      return naturalCmp(a.name, b.name);
    }
  }
}

/**
 * 递归排序。返回新数组，不改原树 —— 树是从 Rust 拿来的状态，
 * 就地改会让 React 认不出变化。
 */
export function sortTree(nodes: TreeNode[], mode: TreeSort): TreeNode[] {
  return [...nodes]
    .sort((a, b) => compare(mode, a, b))
    .map((n) => (n.children.length ? { ...n, children: sortTree(n.children, mode) } : n));
}

/**
 * 把一组兄弟节点重排成「把 `moved` 放到 `target` 之前/之后」的次序。
 *
 * 返回的是**完整的兄弟路径清单**，整组交给 `notes_reorder` 落盘。
 * 只报被移动的那一个是不够的：原来这一组可能压根没排过，或者顺序文件
 * 已经陈旧（在别的软件里改过名），整组重写才能保证结果稳定。
 */
export function reorderSiblings(
  siblings: TreeNode[],
  movedPath: string,
  targetPath: string,
  place: "before" | "after",
): string[] {
  const rest = siblings.filter((n) => n.path !== movedPath);
  const moved = siblings.find((n) => n.path === movedPath);
  if (!moved || movedPath === targetPath) return siblings.map((n) => n.path);

  const at = rest.findIndex((n) => n.path === targetPath);
  if (at < 0) return siblings.map((n) => n.path);

  const insert = place === "before" ? at : at + 1;
  rest.splice(insert, 0, moved);
  return rest.map((n) => n.path);
}
