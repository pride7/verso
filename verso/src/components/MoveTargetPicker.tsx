/**
 * 「移动到…」的目标选择器。§2.1 / M6 移动端。
 *
 * 拖拽移动在触摸屏上完全不可用（HTML5 拖放不响应手指），这个选择器是
 * 等价的可点击入口 —— 也顺手服务了桌面上「树很深、拖起来要一路悬停展开」
 * 的场景。交互抄快速切换器：模糊搜索 + 键盘上下 + 回车，「顶层」固定在
 * 第一条。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { rankNotes } from "../lib/fuzzy";
import type { NoteRef } from "../types";

interface Props {
  notes: NoteRef[];
  icons?: Record<string, string>;
  /** 被移动的节点。自己和自己的子树不能当目标（移进自身是循环） */
  moving: { path: string; childDir: string | null; name: string };
  /** target 为 null = 移到顶层 */
  onPick: (targetDoc: string | null) => void;
  onClose: () => void;
}

export function MoveTargetPicker({ notes, icons, moving, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const candidates = useMemo(
    () =>
      notes.filter((n) => {
        if (n.path === moving.path) return false;
        // 自己的子树：childDir 是同名文件夹（`X.md` 对应 `X/`）
        if (moving.childDir && n.path.startsWith(`${moving.childDir}/`)) return false;
        return true;
      }),
    [notes, moving],
  );
  const ranked = useMemo(() => rankNotes(candidates, query), [candidates, query]);
  // 第 0 条永远是「顶层」，其余顺延 —— 它是最常见的目标，不该要人搜
  const total = ranked.length + 1;

  useEffect(() => setActive(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (i: number) => {
    if (i === 0) onPick(null);
    else if (ranked[i - 1]) onPick(ranked[i - 1].item.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    }
  };

  return (
    <div className="overlay overlay-top" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} aria-label="选择移动目标">
        <input
          ref={inputRef}
          className="modal-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`把「${moving.name}」移动到…`}
          spellCheck={false}
        />

        <ul className="modal-list" ref={listRef}>
          <li
            className={`qs-item${active === 0 ? " is-active" : ""}`}
            onMouseEnter={() => setActive(0)}
            onMouseDown={() => pick(0)}
          >
            <span className="qs-name">顶层</span>
            <span className="qs-path">仓库根目录</span>
          </li>
          {ranked.map((r, i) => (
            <li
              key={r.item.path}
              className={`qs-item${i + 1 === active ? " is-active" : ""}`}
              onMouseEnter={() => setActive(i + 1)}
              onMouseDown={() => pick(i + 1)}
            >
              {icons?.[r.item.path] && (
                <span className="qs-icon emoji" aria-hidden>
                  {icons[r.item.path]}
                </span>
              )}
              <span className="qs-name">{r.item.name}</span>
              <span className="qs-path">{r.item.path.replace(/\.md$/, "")}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
