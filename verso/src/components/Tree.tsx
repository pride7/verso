import { useState } from "react";

import type { TreeNode } from "../types";
import { Icon } from "./Icon";

interface Props {
  nodes: TreeNode[];
  activePath: string | null;
  onOpen: (node: TreeNode) => void;
  onAddChild: (node: TreeNode) => void;
  onMenu: (node: TreeNode, x: number, y: number) => void;
  /** 拖拽移动：把 `path` 移到 `newParentDoc` 之下（null = vault 根） */
  onMove: (path: string, newParentDoc: string | null) => void;
  /**
   * 拖拽重排同级顺序。只在手动排序模式下传进来 —— 其他模式下记了顺序
   * 也立刻被规则盖掉，拖完看不出效果反而像是坏了
   */
  onReorder?: (movedPath: string, targetPath: string, place: "before" | "after") => void;
  depth?: number;
}

/**
 * 文档树。DESIGN.md §2.1 的关键点：`X.md` 和 `X/` 在这里是**一个**节点 ——
 * 点文字打开文档，点箭头展开子文档。合并逻辑在 Rust 侧完成，这里只管画。
 */
export function Tree({ nodes, depth = 0, ...rest }: Props) {
  return (
    <ul className="tree" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => (
        <TreeItem key={node.path} node={node} depth={depth} {...rest} />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  activePath,
  onOpen,
  onAddChild,
  onMenu,
  onMove,
  onReorder,
  depth,
}: Omit<Props, "nodes" | "depth"> & { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  /** 拖到哪里：`into` 变成子文档，`before`/`after` 只调顺序 */
  const [dropAt, setDropAt] = useState<"into" | "before" | "after" | null>(null);

  const hasChildren = node.children.length > 0;
  const isDoc = node.kind === "document";
  const isActive = activePath === node.path;

  return (
    <li className="tree-item">
      <div
        className={
          `tree-row${isActive ? " is-active" : ""}` +
          `${isDoc ? "" : " is-folder"}` +
          `${dropAt === "into" ? " is-drop-target" : ""}` +
          `${dropAt === "before" ? " is-drop-before" : ""}` +
          `${dropAt === "after" ? " is-drop-after" : ""}`
        }
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(node, e.clientX, e.clientY);
        }}
        draggable={isDoc}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/verso-path", node.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("text/verso-path")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          // 上下各四分之一是"插到前面/后面"，中间一半才是"放进去当子文档"。
          // 不分区的话，想调顺序永远会变成移动层级 —— 这两件事看着像，
          // 结果差得很远
          const box = e.currentTarget.getBoundingClientRect();
          const r = (e.clientY - box.top) / box.height;
          if (onReorder && r < 0.25) setDropAt("before");
          else if (onReorder && r > 0.75) setDropAt("after");
          else setDropAt(isDoc ? "into" : null);
        }}
        onDragLeave={() => setDropAt(null)}
        onDrop={(e) => {
          e.preventDefault();
          const where = dropAt;
          setDropAt(null);
          const src = e.dataTransfer.getData("text/verso-path");
          // 拖到自己身上是无操作；移进自身子树由 Rust 侧拒绝
          if (!src || src === node.path) return;
          if (where === "into" && isDoc) {
            onMove(src, node.path);
            setExpanded(true);
          } else if (onReorder && (where === "before" || where === "after")) {
            onReorder(src, node.path, where);
          }
        }}
      >
        <button
          className={
            `tree-twisty${hasChildren ? "" : " is-empty"}${expanded ? " is-open" : ""}`
          }
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "折叠" : "展开"}
          tabIndex={hasChildren ? 0 : -1}
        >
          {/* 折叠态靠 CSS 旋转，不换图标 —— 旋转能做过渡动画，换字符不能 */}
          {hasChildren && <Icon name="chevron" size={12} />}
        </button>

        <button
          className="tree-label"
          onClick={() => isDoc && onOpen(node)}
          // 纯文件夹没有对应文档，点它只能展开
          disabled={!isDoc}
          title={isDoc ? node.path : `${node.path}（纯文件夹，没有同名文档）`}
        >
          {node.name}
        </button>

        {isDoc && (
          <button
            className="tree-add"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild(node);
              setExpanded(true);
            }}
            title="新建子文档"
            aria-label="新建子文档"
          >
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <Tree
          nodes={node.children}
          activePath={activePath}
          onOpen={onOpen}
          onAddChild={onAddChild}
          onMenu={onMenu}
          onMove={onMove}
          onReorder={onReorder}
          depth={depth + 1}
        />
      )}
    </li>
  );
}
