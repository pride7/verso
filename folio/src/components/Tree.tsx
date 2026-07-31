import { useState } from "react";

import type { TreeNode } from "../types";

interface Props {
  nodes: TreeNode[];
  activePath: string | null;
  onOpen: (node: TreeNode) => void;
  onAddChild: (node: TreeNode) => void;
  depth?: number;
}

/**
 * 文档树。DESIGN.md §2.1 的关键点：`X.md` 和 `X/` 在这里是**一个**节点 ——
 * 点文字打开文档，点箭头展开子文档。合并逻辑在 Rust 侧完成，这里只负责画。
 */
export function Tree({ nodes, activePath, onOpen, onAddChild, depth = 0 }: Props) {
  return (
    <ul className="tree" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          activePath={activePath}
          onOpen={onOpen}
          onAddChild={onAddChild}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  activePath,
  onOpen,
  onAddChild,
  depth,
}: Omit<Props, "nodes" | "depth"> & { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const isDoc = node.kind === "document";
  const isActive = activePath === node.path;

  return (
    <li className="tree-item">
      <div
        className={`tree-row${isActive ? " is-active" : ""}${isDoc ? "" : " is-folder"}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <button
          className={`tree-twisty${hasChildren ? "" : " is-empty"}`}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "折叠" : "展开"}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : ""}
        </button>

        <button
          className="tree-label"
          onClick={() => isDoc && onOpen(node)}
          // 纯文件夹没有对应文档，点它只能展开。§2.1 说这种节点应当提供
          // 「创建为文档」把它升级 —— 那是 M1 的右键菜单。
          disabled={!isDoc}
          title={isDoc ? node.path : `${node.path}（纯文件夹，没有同名文档）`}
        >
          {node.name}
        </button>

        {isDoc && (
          <button
            className="tree-add"
            onClick={() => onAddChild(node)}
            title="新建子文档"
            aria-label="新建子文档"
          >
            ＋
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <Tree
          nodes={node.children}
          activePath={activePath}
          onOpen={onOpen}
          onAddChild={onAddChild}
          depth={depth + 1}
        />
      )}
    </li>
  );
}
