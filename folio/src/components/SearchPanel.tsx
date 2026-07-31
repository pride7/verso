import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { SearchHit } from "../types";

interface Props {
  onPick: (path: string) => void;
  onClose: () => void;
}

/** 搜索防抖。中文输入法组合期间会连发多次 change，不防抖会打满 IPC */
const DEBOUNCE_MS = 120;

/**
 * 后端返回的 snippet 里带 `<mark>`，需要按标记切开渲染。
 *
 * **不用 `dangerouslySetInnerHTML`** —— snippet 里含笔记正文，
 * 而笔记可能来自分享或 AI 生成（§2.9、§7.5）。直接塞进 DOM 等于把
 * 「打开一篇笔记」变成「执行一段陌生 HTML」。
 */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(<mark>|<\/mark>)/);
  let on = false;
  return (
    <>
      {parts.map((p, i) => {
        if (p === "<mark>") {
          on = true;
          return null;
        }
        if (p === "</mark>") {
          on = false;
          return null;
        }
        return on ? (
          <mark key={i}>{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

/** 全文搜索面板。DESIGN.md §2.2 导航的第 3 条 */
export function SearchPanel({ onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .search(query, 50)
        .then((h) => {
          setHits(h);
          setActive(0);
          setError(null);
        })
        .catch((e) => setError((e as Error).message));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) onPick(hits[active].path);
    }
  };

  return (
    <div className="qs-backdrop" onMouseDown={onClose}>
      <div className="qs search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qs-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="全文搜索…"
          spellCheck={false}
        />

        {error ? (
          <div className="qs-empty error">{error}</div>
        ) : !query.trim() ? (
          <div className="qs-empty">输入关键词开始搜索</div>
        ) : hits.length === 0 ? (
          <div className="qs-empty">没有匹配的内容</div>
        ) : (
          <ul className="qs-list" ref={listRef}>
            {hits.map((h, i) => (
              <li
                key={h.path}
                className={`search-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={() => onPick(h.path)}
              >
                <div className="search-title">{h.title}</div>
                <div className="search-snippet">
                  <Snippet text={h.snippet} />
                </div>
                <div className="search-path">{h.path.replace(/\.md$/, "")}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
