import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { renderInline } from "../editor/inline";
import { parseCustomSnippets } from "../core/snippets/custom";
import { buildSnippets } from "../editor/snippets";
import { expand } from "../core/snippets/match";
import { rankNotes } from "../core/fuzzy";

interface Props {
  /** 插入原始 snippet，保留 `$0` `$1` 跳转点 */
  onInsert: (replacement: string) => void;
  onClose: () => void;
  /** 与编辑器使用同一份自定义配置，搜索结果才不会和实际输入能力分叉 */
  customSnippets?: string;
}

/** 最近用过的符号存本地 —— 实测命中率极高，第一格永远是刚用过的那个 */
const RECENT_KEY = "verso.recentSymbols";
const RECENT_MAX = 12;

interface Entry {
  /** 供模糊匹配的名字：中文描述 + 触发词 */
  name: string;
  path: string;
  trigger: string;
  /** 原始 snippet，交给编辑器展开并建立 tabstop */
  replacement: string;
  /** 去掉 tabstop 后供 KaTeX 预览的源码 */
  latex: string;
  description: string;
}

function entriesFor(customText: string): Entry[] {
  const custom = parseCustomSnippets(customText).specs;
  const byTrigger = new Map<string, Entry>();
  for (const snippet of buildSnippets({ custom })) {
    // 正则需要真实捕获组、build 需要匹配尺寸，面板里没有上下文可正确实例化。
    if (!snippet.mathOnly || snippet.regex || snippet.build) continue;
    const latex = expand(snippet.replacement).text;
    if (!latex.trim()) continue;
    byTrigger.set(snippet.trigger, {
      // 名字里同时放中文描述和触发词，两种都能搜到
      name: `${snippet.description ?? ""} ${snippet.trigger}`,
      path: snippet.trigger,
      trigger: snippet.trigger,
      replacement: snippet.replacement,
      latex,
      description: snippet.description ?? "",
    });
  }
  // 同 trigger 的自定义项排在内置项后面，因此 Map.set 会让面板显示用户那份。
  return [...byTrigger.values()];
}

function FormulaPreview({ latex }: { latex: string }) {
  const mount = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) node.replaceChildren(renderInline(`$${latex}$`));
    },
    [latex],
  );
  return <span ref={mount} className="sym-preview" aria-hidden="true" />;
}

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
export function SymbolPanel({ onInsert, onClose, customSnippets = "" }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent] = useState(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const entries = useMemo(() => entriesFor(customSnippets), [customSnippets]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // 没有查询词时先给最近用过的，再补上全部
      const byTrigger = new Map(entries.map((e) => [e.trigger, e]));
      const head = recent.map((t) => byTrigger.get(t)).filter((e): e is Entry => !!e);
      const seen = new Set(head.map((e) => e.trigger));
      return [...head, ...entries.filter((e) => !seen.has(e.trigger))].slice(0, 60);
    }
    return rankNotes(entries, query, 60).map((r) => r.item);
  }, [entries, query, recent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (e: Entry) => {
    const next = [e.trigger, ...recent.filter((t) => t !== e.trigger)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    onInsert(e.replacement);
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
    <div className="overlay overlay-top" onMouseDown={onClose}>
      <div className="modal sym" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索符号，如「积分」「叉乘」「属于」…"
          spellCheck={false}
        />
        {results.length === 0 ? (
          <div className="modal-empty">没有匹配的符号</div>
        ) : (
          <ul className="modal-list sym-list" ref={listRef}>
            {results.map((e, i) => (
              <li
                key={e.trigger}
                className={`sym-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={() => pick(e)}
              >
                <FormulaPreview latex={e.latex} />
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
