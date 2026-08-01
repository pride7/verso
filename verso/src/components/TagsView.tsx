import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import type { NoteRef } from "../types";

interface Props {
  onPick: (path: string) => void;
  activePath: string | null;
  /** vault 内容变化时递增，标签清单要跟着重查 */
  revision: number;
}

interface TagNode {
  /** 完整标签，如 `项目/写作` */
  full: string;
  /** 这一层的名字，如 `写作` */
  name: string;
  count: number;
  children: TagNode[];
}

/**
 * 把扁平的标签清单还原成树。
 *
 * `#嵌套/标签`（§2.4）在索引里是一条条完整字符串，父标签**不一定真的存在**
 * —— 只写了 `#项目/写作` 的话，索引里没有 `项目` 这条。所以中间层要按需
 * 补出来，计数记 0，表示「它自己没有笔记，但下面有」。
 */
export function buildTagTree(tags: [string, number][]): TagNode[] {
  const roots: TagNode[] = [];
  const byFull = new Map<string, TagNode>();

  const ensure = (full: string): TagNode => {
    const hit = byFull.get(full);
    if (hit) return hit;

    const cut = full.lastIndexOf("/");
    const node: TagNode = {
      full,
      name: cut < 0 ? full : full.slice(cut + 1),
      count: 0,
      children: [],
    };
    byFull.set(full, node);
    if (cut < 0) roots.push(node);
    else ensure(full.slice(0, cut)).children.push(node);
    return node;
  };

  for (const [full, count] of tags) ensure(full).count = count;

  const sort = (list: TagNode[]) => {
    // 先按笔记数、再按名字。数量优先是因为标签面板的用途是「看看我都在写什么」，
    // 用得多的应当在上面
    list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

function TagRow({
  node,
  depth,
  expanded,
  onToggle,
  selected,
  onSelect,
}: {
  node: TagNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (full: string) => void;
  selected: string | null;
  onSelect: (full: string) => void;
}) {
  const open = expanded.has(node.full);
  return (
    <li>
      <div
        className={`tag-row${selected === node.full ? " is-active" : ""}`}
        style={{ paddingLeft: 6 + depth * 13 }}
      >
        <button
          className={`tree-twisty${node.children.length ? "" : " is-empty"}`}
          onClick={() => node.children.length && onToggle(node.full)}
          tabIndex={node.children.length ? 0 : -1}
          aria-hidden={!node.children.length}
        >
          {node.children.length ? (open ? "▾" : "▸") : ""}
        </button>
        <button className="tag-label" onClick={() => onSelect(node.full)} title={`#${node.full}`}>
          {node.name}
        </button>
        {/* 计数为 0 表示这一层是为了嵌套补出来的，它自己没有笔记 */}
        {node.count > 0 && <span className="tag-count">{node.count}</span>}
      </div>
      {open && node.children.length > 0 && (
        <ul className="tag-children">
          {node.children.map((c) => (
            <TagRow
              key={c.full}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * 标签面板。DESIGN.md §6.3 里侧栏的第三个视图。
 *
 * 点一个标签，下半部分列出带这个标签的笔记 —— 包括嵌套的子标签，
 * 否则点父标签永远是空的、嵌套就白分了（那条前缀匹配在 Rust 侧）。
 */
export function TagsView({ onPick, activePath, revision }: Props) {
  const [tags, setTags] = useState<[string, number][]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .allTags()
      .then((t) => {
        setTags(t);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [revision]);

  useEffect(() => {
    if (!selected) {
      setNotes([]);
      return;
    }
    api
      .notesByTag(selected)
      .then(setNotes)
      .catch((e) => setError((e as Error).message));
  }, [selected, revision]);

  const tree = useMemo(() => buildTagTree(tags), [tags]);

  const toggle = (full: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(full)) next.add(full);
      return next;
    });

  return (
    <div className="side-view">
      {error && <p className="side-empty error">{error}</p>}

      {tags.length === 0 && !error ? (
        <p className="side-empty">
          还没有标签。在正文里写 <code>#标签</code>，或在 frontmatter 里加 <code>tags</code>
        </p>
      ) : (
        <ul className="tag-tree">
          {tree.map((n) => (
            <TagRow
              key={n.full}
              node={n}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              selected={selected}
              onSelect={(full) => setSelected((cur) => (cur === full ? null : full))}
            />
          ))}
        </ul>
      )}

      {selected && (
        <div className="tag-notes">
          <p className="side-count">
            #{selected} · {notes.length} 篇
          </p>
          <ul className="side-list">
            {notes.map((n) => (
              <li key={n.path}>
                <button
                  className={`tag-note${n.path === activePath ? " is-active" : ""}`}
                  onClick={() => onPick(n.path)}
                  title={n.path.replace(/\.md$/, "")}
                >
                  {n.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
