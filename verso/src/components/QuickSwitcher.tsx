import { useEffect, useMemo, useRef, useState } from "react";

import { rankNotes } from "../lib/fuzzy";
import type { NoteRef } from "../types";

interface Props {
  notes: NoteRef[];
  /**
   * 路径 → 文档图标（§2.3）。
   *
   * §2.2 说「熟练用户九成的跳转靠它」—— 图标要是只出现在文档树里，就恰好
   * 缺席了用得最多的那个地方
   */
  icons?: Record<string, string>;
  onPick: (path: string) => void;
  onClose: () => void;
}

/** 把命中的字符加粗 —— 让用户看见「为什么是这条」 */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <b key={i} className="qs-hit">
            {ch}
          </b>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

/**
 * 快速切换器 —— DESIGN.md §2.2。
 *
 * 「熟练用户九成的跳转靠它，文件树只是偶尔浏览用」，所以它的优先级
 * 高于文件树，M1 必须有。
 */
export function QuickSwitcher({ notes, icons, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => rankNotes(notes, query), [notes, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);

  // 键盘选中项滚进视野，否则按住 ↓ 会选到看不见的条目
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) onPick(hit.item.path);
    }
  };

  return (
    <div className="overlay overlay-top" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="modal-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="跳转到笔记…"
          spellCheck={false}
        />

        {results.length === 0 ? (
          <div className="modal-empty">没有匹配的笔记</div>
        ) : (
          <ul className="modal-list" ref={listRef}>
            {results.map((r, i) => (
              <li
                key={r.item.path}
                className={`qs-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={() => onPick(r.item.path)}
              >
                {icons?.[r.item.path] && (
                  <span className="qs-icon emoji" aria-hidden>
                    {icons[r.item.path]}
                  </span>
                )}
                <span className="qs-name">
                  <Highlighted text={r.item.name} positions={r.namePositions} />
                </span>
                <span className="qs-path">{r.item.path.replace(/\.md$/, "")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
