import { useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_SNIPPETS } from "../editor/snippets/defaults";
import { rankNotes } from "../lib/fuzzy";

interface Props {
  /** 插入 LaTeX 片段（已去掉跳转点标记） */
  onInsert: (latex: string) => void;
  onClose: () => void;
}

/** 最近用过的符号存本地 —— 实测命中率极高，第一格永远是刚用过的那个 */
const RECENT_KEY = "folio.recentSymbols";
const RECENT_MAX = 12;

interface Entry {
  /** 供模糊匹配的名字：中文描述 + 触发词 */
  name: string;
  path: string;
  trigger: string;
  latex: string;
  description: string;
}

/** 去掉 `$0` 之类的跳转点标记，面板插入的是干净的 LaTeX */
function clean(replacement: string): string {
  return replacement.replace(/\$\d+/g, "").replace(/\[\[\d+\]\]/g, "");
}

const ENTRIES: Entry[] = DEFAULT_SNIPPETS.filter((s) => s.options.includes("m") && !s.build)
  .map((s) => ({
    // 名字里同时放中文描述和触发词，两种都能搜到
    name: `${s.description ?? ""} ${s.trigger}`,
    path: s.trigger,
    trigger: s.trigger,
    latex: clean(s.replacement),
    description: s.description ?? "",
  }))
  .filter((e) => e.latex.trim().length > 0);

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 符号面板 —— DESIGN.md §5.3。
 *
 * 「覆盖 snippet 记不住的长尾」。snippet 快是快，但只对已经记住的那几十个
 * 有用；剩下的符号需要一个能用中文搜的入口 —— 输入「积分」「叉乘」「属于」
 * 就能找到。
 */
export function SymbolPanel({ onInsert, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent] = useState(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) {
      // 没有查询词时先给最近用过的，再补上全部
      const byTrigger = new Map(ENTRIES.map((e) => [e.trigger, e]));
      const head = recent.map((t) => byTrigger.get(t)).filter((e): e is Entry => !!e);
      const seen = new Set(head.map((e) => e.trigger));
      return [...head, ...ENTRIES.filter((e) => !seen.has(e.trigger))].slice(0, 60);
    }
    return rankNotes(ENTRIES, query, 60).map((r) => r.item);
  }, [query, recent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (e: Entry) => {
    const next = [e.trigger, ...recent.filter((t) => t !== e.trigger)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    onInsert(e.latex);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const hit = results[active];
      if (hit) pick(hit);
    }
  };

  return (
    <div className="qs-backdrop" onMouseDown={onClose}>
      <div className="qs sym" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qs-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索符号，如「积分」「叉乘」「属于」…"
          spellCheck={false}
        />
        {results.length === 0 ? (
          <div className="qs-empty">没有匹配的符号</div>
        ) : (
          <ul className="qs-list sym-list" ref={listRef}>
            {results.map((e, i) => (
              <li
                key={e.trigger}
                className={`sym-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={() => pick(e)}
              >
                <code className="sym-latex">{e.latex}</code>
                <span className="sym-desc">{e.description}</span>
                <kbd className="sym-trigger">{e.trigger}</kbd>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
