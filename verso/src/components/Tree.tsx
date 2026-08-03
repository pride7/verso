import { useEffect, useRef, useState } from "react";

import type { TreeNode } from "../types";
import { normalizeIcon } from "../lib/emoji";
import { Icon } from "./Icon";

interface Props {
  nodes: TreeNode[];
  activePath: string | null;
  /** `newTab` 来自 Ctrl/⌘+点 或中键 —— 那是「我要开新标签」的明确表态，
      不受设置里的默认打开方式影响 */
  onOpen: (node: TreeNode, opts?: { newTab?: boolean }) => void;
  onAddChild: (node: TreeNode) => void;
  onMenu: (node: TreeNode, x: number, y: number) => void;
  /** 拖拽移动：把 `path` 移到 `newParentDoc` 之下（null = vault 根） */
  onMove: (path: string, newParentDoc: string | null) => void;
  /**
   * 拖拽调顺序：把 `movedPath` 放到 `targetPath` 前/后。
   *
   * 任何排序模式下都接 —— 拖动本身就是「我要自己定顺序」的意思，由上层
   * 顺手切到手动排序。这里不做判断，否则用户得先找到下拉框才能拖第一下
   */
  onReorder: (movedPath: string, targetPath: string, place: "before" | "after") => void;
  /**
   * 正在就地改名的那个节点。新建文档之后立刻进这个状态 ——
   * 名字是「未命名」，光标就落在它上面（Obsidian / 思源的做法）
   */
  renamingPath?: string | null;
  /** 交回新名字。空、或和原来一样，都当作放弃 */
  onRenameSubmit: (path: string, name: string) => void;
  onRenameCancel: () => void;
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
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  depth,
}: Omit<Props, "nodes" | "depth"> & { node: TreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const renaming = renamingPath === node.path;

  // 在收起的节点底下新建子文档时，那一行根本没渲染出来，改名框也就无从谈起。
  // 所以只要被改名的那个在自己子树里，就展开
  useEffect(() => {
    if (node.childDir && renamingPath?.startsWith(`${node.childDir}/`)) setExpanded(true);
  }, [renamingPath, node.childDir]);
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
          if (r < 0.25) setDropAt("before");
          else if (r > 0.75) setDropAt("after");
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
          } else if (where === "before" || where === "after") {
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

        {renaming ? (
          <>
            {/* 改名时图标照样占着位 —— 少了它整行会横向跳一下 */}
            <NodeIcon node={node} />
            <RenameInput
              name={node.name}
              onSubmit={(v) => onRenameSubmit(node.path, v)}
              onCancel={onRenameCancel}
            />
          </>
        ) : (
          <button
            className="tree-label"
            // 没按修饰键时**不传** `newTab`，而不是传 `false`：`false` 会盖掉
            // 设置里的默认打开方式，让「开新标签」那一档永远失效
            onClick={(e) =>
              isDoc && onOpen(node, e.ctrlKey || e.metaKey ? { newTab: true } : undefined)
            }
            // 中键开新标签。用 mouseup 而不是 auxclick —— 后者在 WebView2 上
            // 不总是派发；`button === 1` 已经把它和右键分开了
            onMouseUp={(e) => {
              if (e.button === 1 && isDoc) {
                e.preventDefault();
                onOpen(node, { newTab: true });
              }
            }}
            // 纯文件夹没有对应文档，点它只能展开
            disabled={!isDoc}
            title={isDoc ? node.path : `${node.path}（纯文件夹，没有同名文档）`}
          >
            {/* 图标在按钮**里面**：点它等于点这一行的名字，都是「打开这篇」。
                改图标走右键菜单 —— 在这里再插一个可点的小目标，误触的代价
                （弹出一个面板）比它省下的一次右键大 */}
            <NodeIcon node={node} />
            <span className="tree-name">{node.name}</span>
          </button>
        )}

        {/* 纯文件夹也能建子文档（§2.1）—— 只给文档留这个入口的话，
            文件夹就成了右键菜单才能操作的二等节点 */}
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
          renamingPath={renamingPath}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

/**
 * 一行前面的图标（§2.3 的 frontmatter `icon`）。
 *
 * **没设图标的行也占这个位置**，画一个很淡的默认图标。只给设过的行加图标
 * 的话，名字会参差成两列，而参差比多一个淡图标显眼得多；留着位置，设过的
 * 那几行才真的「一眼跳出来」—— 用户要的就是这个（§6.2：颜色只做重音）。
 */
function NodeIcon({ node }: { node: TreeNode }) {
  // 收敛成一个字符：`icon:` 是用户手写的 YAML，写成一整句话时整棵树都会被
  // 撑开（见 lib/emoji 的 normalizeIcon）
  const ch = node.icon ? normalizeIcon(node.icon) : null;
  if (ch) {
    return (
      <span className="tree-icon emoji" aria-hidden>
        {ch}
      </span>
    );
  }
  return (
    <span className="tree-icon is-default" aria-hidden>
      <Icon name={node.kind === "document" ? "doc" : "vault"} size={13} />
    </span>
  );
}

/**
 * 就地改名的输入框。
 *
 * 挂载时**只选中文件名的主干**，扩展名那类后缀不在树里显示，所以这里就是
 * 全选；但仍然显式 `select()` 而不是靠 `autoFocus` —— 后者只给焦点不给选区，
 * 结果是光标停在末尾，想换个名字得先手动全选一遍。
 *
 * 失焦按「确定」处理，和 Obsidian 一致：改完名点到别处，本意显然是要这个名字，
 * 那时候丢掉刚敲的字最让人恼火。
 */
export function RenameInput({
  name,
  className = "tree-rename",
  onSubmit,
  onCancel,
}: {
  name: string;
  /** database 视图里也用它（§2.6 加一行），那边有自己的一套格子样式 */
  className?: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  /** 提交过就别再被失焦触发第二次 —— 回车之后输入框会被卸载，那也算一次 blur */
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok) onSubmit(ref.current?.value ?? "");
    else onCancel();
  };

  return (
    <input
      ref={ref}
      className={className}
      defaultValue={name}
      spellCheck={false}
      onKeyDown={(e) => {
        // 别让方向键、回车冒泡到树和全局快捷键上去
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      // 点输入框不该顺手把这一行打开
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
