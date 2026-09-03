import { useEffect, useState } from "react";

import { api } from "../host/api";
import type { Backlink } from "../core/types";

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
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .backlinks(path)
      .then((l) => {
        if (!alive) return;
        setLinks(l);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setLinks([]);
        setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);

  /**
   * **查不出来和「没有反向链接」是两回事。** 这一块整个消失时，界面在说
   * 「这篇没人引用」—— 而真相是查询失败了（索引没打开时就会这样）。
   * 空结果照旧不占地方，出错则留一行说清楚。
   */
  if (error) {
    return (
      <section className="backlinks">
        <p className="side-empty">反向链接读不出来：{error}</p>
      </section>
    );
  }
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
