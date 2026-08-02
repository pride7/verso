import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "./Icon";
import {
  editAddChild,
  editAddSibling,
  editRemove,
  editText,
  editToggleTask,
  layout,
  NODE_H,
  NODE_W,
  parseMindmap,
  parentOf,
  subtreeSize,
  type Edit,
  type MindNode,
  type Placed,
} from "../lib/mindmap";

interface Props {
  /** 笔记标题 —— 它就是导图的根节点 */
  title: string;
  /** 正文原文。改完由外面写回编辑器，再作为新的 `body` 传下来 */
  body: string;
  onEdit: (edit: Edit) => void;
  /** 跳到正文的某一行（并关掉导图） */
  onGoto: (line: number) => void;
  onClose: () => void;
}

/**
 * 思维导图。DESIGN.md §4.7
 *
 * **一个节点就是正文里的一行**，布局每次算出来，一个字节都不额外存。在图上
 * 改一下 = 改那一行 Markdown，走的是编辑器自己的 dispatch —— 所以撤销、
 * 自动保存、外部改动检测全都免费正确，导图不需要自己那一套。
 *
 * 键盘按 XMind 的习惯：Enter 加兄弟、Tab 加子节点、F2 改字、Delete 删子树。
 * 全部有等价的鼠标操作（§0：不能假设有键盘）。
 */
export function MindMap({ title, body, onEdit, onGoto, onClose }: Props) {
  const root = useMemo(() => parseMindmap(body, title), [body, title]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const view = useMemo(() => layout(root, collapsed), [root, collapsed]);

  const [selected, setSelected] = useState(0);
  /**
   * 正在改字的是哪个节点。null = 没在改。
   *
   * **草稿不进 state，输入框是非受控的**（和文档树的就地改名同一个做法）：
   * 一是每敲一个字符就重渲染整张图不值得，二是受控输入在这里没有任何好处
   * —— 提交时从 DOM 读一次就够了。
   */
  const [editing, setEditing] = useState<number | null>(null);
  const [cam, setCam] = useState({ x: 40, y: 40, k: 1 });

  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * 刚加出来的那一行。正文回来之后要立刻把它切进编辑态 ——
   * 加完一个空节点还要用户自己去图上找它在哪，这个功能就没法用了
   */
  const pending = useRef<number | null>(null);

  const placedOf = useCallback(
    (line: number) => view.nodes.find((p) => p.node.line === line) ?? null,
    [view],
  );

  /** 按 y 排好的可见节点，上下移动和「下一个」都用它 */
  const ordered = useMemo(() => [...view.nodes].sort((a, b) => a.y - b.y), [view]);

  // 新节点一出现就进编辑态
  useEffect(() => {
    const line = pending.current;
    if (line === null) return;
    if (!placedOf(line)) return;
    pending.current = null;
    setSelected(line);
    setEditing(line);
  }, [placedOf]);

  useEffect(() => {
    if (editing !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      hostRef.current?.focus();
    }
  }, [editing]);

  /** 打开时把整张图放进视口 */
  const fit = useCallback(() => {
    const box = hostRef.current?.getBoundingClientRect();
    if (!box) return;
    const pad = 48;
    const k = Math.min(
      1,
      (box.width - pad * 2) / Math.max(view.width, 1),
      (box.height - pad * 2 - 40) / Math.max(view.height, 1),
    );
    setCam({
      k: Math.max(k, 0.3),
      x: pad,
      y: Math.max(pad, (box.height - view.height * k) / 2),
    });
  }, [view.width, view.height]);

  useEffect(() => {
    fit();
    // 只在打开时铺一次：之后每加一个节点都重新 fit 的话，图会在脚下乱跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚轮缩放。**必须用非被动监听**，否则 preventDefault 无效，
  // 缩放的同时整个面板还会跟着滚
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const mx = e.clientX - box.left;
      const my = e.clientY - box.top;
      setCam((c) => {
        const k = Math.min(2.5, Math.max(0.25, c.k * Math.exp(-e.deltaY * 0.0015)));
        const r = k / c.k;
        // 以鼠标为锚点缩放：光标底下那个点保持不动
        return { k, x: mx - (mx - c.x) * r, y: my - (my - c.y) * r };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** 拖背景平移 */
  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    const move = (m: MouseEvent) =>
      setCam((c) => ({ ...c, x: start.cx + (m.clientX - start.x), y: start.cy + (m.clientY - start.y) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const toggleFold = (line: number) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (!next.delete(line)) next.add(line);
      return next;
    });

  // ---- 改文本的四个动作 ----

  const commitEdit = () => {
    if (editing === null) return;
    const node = find(root, editing);
    const text = (inputRef.current?.value ?? "").trim();
    setEditing(null);
    if (!node || node.kind === "root") return; // 根是笔记标题，改名走文档树
    // 清空一个节点等于删掉它 —— 留一行光秃秃的 `- ` 在文件里没有意义
    onEdit(text ? editText(node, text) : editRemove(node));
  };

  const addChild = (node: MindNode) => {
    const { edit, line } = editAddChild(node);
    pending.current = line;
    setCollapsed((s) => {
      const next = new Set(s);
      next.delete(node.line); // 加到折叠的分支上，得先把它展开
      return next;
    });
    onEdit(edit);
  };

  const addSibling = (node: MindNode) => {
    if (node.kind === "root") return addChild(node);
    const { edit, line } = editAddSibling(node);
    pending.current = line;
    onEdit(edit);
  };

  const remove = (node: MindNode) => {
    if (node.kind === "root") return;
    const n = subtreeSize(node);
    // 只有一个节点时不问 —— 那种误删按一次撤销就回来了；连着子树一起没了
    // 才是「刚才那一整块哪去了」的那种慌
    if (n > 1 && !window.confirm(`删掉「${node.text}」和它底下的 ${n - 1} 个节点？`)) return;
    const parent = parentOf(root, node.line);
    setSelected(parent?.line ?? 0);
    onEdit(editRemove(node));
  };

  // ---- 键盘 ----

  const onKey = (e: React.KeyboardEvent) => {
    if (editing !== null) return; // 编辑态里的键归输入框
    const node = find(root, selected) ?? root;
    const at = ordered.findIndex((p) => p.node.line === selected);

    const go = (p: Placed | undefined) => {
      if (!p) return;
      e.preventDefault();
      setSelected(p.node.line);
    };

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        return;
      case "ArrowDown":
        return go(ordered[at + 1]);
      case "ArrowUp":
        return go(ordered[at - 1]);
      case "ArrowLeft": {
        const p = parentOf(root, selected);
        return go(p ? placedOf(p.line) ?? undefined : undefined);
      }
      case "ArrowRight": {
        if (node.children.length === 0) return;
        if (collapsed.has(node.line)) {
          e.preventDefault();
          toggleFold(node.line);
          return;
        }
        return go(placedOf(node.children[0].line) ?? undefined);
      }
      case "Enter":
        e.preventDefault();
        addSibling(node);
        return;
      case "Tab":
        e.preventDefault();
        addChild(node);
        return;
      case "F2":
        e.preventDefault();
        if (node.kind !== "root") setEditing(node.line);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        remove(node);
        return;
      case " ":
        if (node.children.length > 0) {
          e.preventDefault();
          toggleFold(node.line);
        }
        return;
    }
  };

  return (
    <div className="mindmap" ref={hostRef} tabIndex={-1} onKeyDown={onKey}>
      <header className="mm-bar">
        <span className="mm-title">
          <Icon name="mindmap" size={15} />
          {title}
        </span>
        <span className="mm-tips">
          Enter 加同级 · Tab 加子级 · F2 改字 · Delete 删除 · 双击节点也能改
        </span>
        <span className="mm-tools">
          <button onClick={fit} title="适应窗口">
            适应
          </button>
          <button onClick={() => setCam((c) => ({ ...c, k: 1 }))} title="回到原始比例">
            1:1
          </button>
          <button onClick={onClose} title="回到正文（Esc）" aria-label="关闭思维导图">
            <Icon name="close" size={14} />
          </button>
        </span>
      </header>

      <div className="mm-canvas" onMouseDown={startPan}>
        <div
          className="mm-layer"
          style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}
        >
          <svg className="mm-links" width={view.width} height={view.height + NODE_H}>
            {view.links.map(({ from, to }) => (
              <path key={`${from.node.line}-${to.node.line}`} d={curve(from, to)} />
            ))}
          </svg>

          {view.nodes.map((p) => {
            const n = p.node;
            const isEditing = editing === n.line;
            return (
              <div
                key={n.line}
                className={[
                  "mm-node",
                  `is-${n.kind}`,
                  selected === n.line ? "is-selected" : "",
                  n.done ? "is-done" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ left: p.x, top: p.y, width: NODE_W }}
                // 节点上的鼠标事件不能冒泡到画布，否则点一下就开始平移
                onMouseDown={(e) => e.stopPropagation()}
              >
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="mm-input"
                    // 非受控：进编辑态时铺一次初值，提交时从 DOM 读回来。
                    // `key` 保证换一个节点时输入框重建，否则会带着上一个的字
                    key={n.line}
                    defaultValue={n.text}
                    spellCheck={false}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitEdit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditing(null);
                      }
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <button
                    className="mm-label"
                    title={`${n.text}\n（双击改字，Ctrl/⌘+点 回到正文第 ${n.line} 行）`}
                    onClick={(e) => {
                      // Ctrl/⌘+点 = 回到正文那一行。和文档树里「在新标签打开」
                      // 同一个手势习惯
                      if ((e.ctrlKey || e.metaKey) && n.kind !== "root") onGoto(n.line);
                      else setSelected(n.line);
                    }}
                    onDoubleClick={() => {
                      if (n.kind !== "root") setEditing(n.line);
                    }}
                  >
                    {n.kind === "task" && (
                      <span className="mm-check" aria-hidden>
                        {n.done ? <Icon name="check" size={10} /> : null}
                      </span>
                    )}
                    <span className="mm-text">{n.text || "（空）"}</span>
                  </button>
                )}

                {n.children.length > 0 && (
                  <button
                    className={`mm-fold${p.collapsed ? " is-closed" : ""}`}
                    onClick={() => toggleFold(n.line)}
                    title={p.collapsed ? `展开（${n.children.length}）` : "折叠"}
                    aria-label={p.collapsed ? "展开" : "折叠"}
                  >
                    {p.collapsed ? n.children.length : <Icon name="chevron" size={11} />}
                  </button>
                )}

                <span className="mm-acts">
                  <button onClick={() => addChild(n)} title="加子节点（Tab）" aria-label="加子节点">
                    <Icon name="plus" size={11} />
                  </button>
                  {n.kind === "task" && (
                    <button
                      onClick={() => {
                        const e = editToggleTask(n);
                        if (e) onEdit(e);
                      }}
                      title={n.done ? "取消勾选" : "勾上"}
                      aria-label="勾选"
                    >
                      <Icon name="check" size={11} />
                    </button>
                  )}
                  {n.kind !== "root" && (
                    <button onClick={() => onGoto(n.line)} title="回到正文这一行" aria-label="回到正文">
                      <Icon name="doc" size={11} />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function find(root: MindNode, line: number): MindNode | null {
  if (root.line === line) return root;
  for (const c of root.children) {
    const hit = find(c, line);
    if (hit) return hit;
  }
  return null;
}

/**
 * 父到子的连线。
 *
 * 用三次贝塞尔而不是折线：折线在深层级里会叠成一片直角网格，看着像电路图；
 * 曲线一眼能跟着看到哪一支是哪一支。控制点取水平中点，所以出入两端都是水平的。
 */
function curve(from: Placed, to: Placed): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}
