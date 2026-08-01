import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { SearchHit } from "../types";

interface Props {
  onPick: (path: string) => void;
  /** vault 内容变化时递增，用来重跑当前这次搜索 */
  revision: number;
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
        return on ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

/**
 * 全文搜索。DESIGN.md §2.2 导航的第 3 条。
 *
 * 从弹窗改成了侧栏面板。弹窗有个实际问题：**它会挡住正文**，而搜索结果
 * 恰恰是要一条条点开看的 —— 每点一次就得重新打开弹窗、重新输入。
 * 放在侧栏之后，结果留在原地，点着看过去就行。
 *
 * 代价是搜索框不再自动抢焦点（侧栏是常驻的，抢焦点会把正在打字的人踢出去），
 * 所以 `Ctrl+Shift+F` 要显式聚焦到它 —— 见 `focusSignal`。
 */
export function SearchView({ onPick, revision }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setError(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api
        .search(query, 100)
        .then((h) => {
          setHits(h);
          setActive(-1);
          setError(null);
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, revision]);

  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      onPick(hits[active].path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
    }
  };

  return (
    <div className="side-view">
      <div className="side-head">
        <input
          id="verso-search-input"
          className="side-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="全文搜索…"
          spellCheck={false}
        />
      </div>

      {error ? (
        <p className="side-empty error">{error}</p>
      ) : !query.trim() ? (
        <p className="side-empty">输入关键词开始搜索</p>
      ) : hits.length === 0 ? (
        <p className="side-empty">{searching ? "搜索中…" : "没有匹配的内容"}</p>
      ) : (
        <>
          <p className="side-count">{hits.length} 个结果</p>
          <ul className="side-list" ref={listRef}>
            {hits.map((h, i) => (
              <li key={h.path}>
                <button
                  className={`search-item${i === active ? " is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => onPick(h.path)}
                >
                  <span className="search-title">{h.title}</span>
                  <span className="search-snippet">
                    <Snippet text={h.snippet} />
                  </span>
                  <span className="search-path">{h.path.replace(/\.md$/, "")}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
