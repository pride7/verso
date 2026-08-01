import { useEffect, useState } from "react";

import { api } from "../api";
import type { Backlink } from "../types";

interface Props {
  /** 当前笔记路径 */
  path: string;
  onOpen: (path: string) => void;
  /** vault 变化时递增，用来触发重查 */
  revision: number;
}

/**
 * 反向链接面板 —— DESIGN.md §2.2 导航的第 4 条：「从『谁引用了我』反向找回来」。
 *
 * 这是双链笔记真正有价值的地方 —— 正向链接你写的时候就知道，反向链接
 * 才会告诉你「这个概念还在哪些地方被用到」。
 */
export function Backlinks({ path, onOpen, revision }: Props) {
  const [links, setLinks] = useState<Backlink[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .backlinks(path)
      .then((l) => alive && setLinks(l))
      .catch(() => alive && setLinks([]));
    return () => {
      alive = false;
    };
  }, [path, revision]);

  if (links.length === 0) return null;

  return (
    <section className="backlinks">
      <button className="backlinks-head" onClick={() => setCollapsed((v) => !v)}>
        <span className="backlinks-caret">{collapsed ? "▸" : "▾"}</span>
        <span>{links.length} 条反向链接</span>
      </button>

      {!collapsed && (
        <ul className="backlinks-list">
          {links.map((l, i) => (
            <li key={`${l.path}:${l.line}:${i}`}>
              <button className="backlink" onClick={() => onOpen(l.path)}>
                <span className="backlink-title">{l.title}</span>
                {l.context && <span className="backlink-context">{l.context}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
