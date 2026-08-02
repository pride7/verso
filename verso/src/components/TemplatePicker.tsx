import { useEffect, useMemo, useRef, useState } from "react";

import type { Template } from "../lib/template";

interface Props {
  templates: Template[];
  /** 模板目录，一个都没有时要能说清「去哪儿放」 */
  dir: string;
  title: string;
  onPick: (t: Template) => void;
  onClose: () => void;
}

/**
 * 挑一个模板。DESIGN.md §4.6
 *
 * 和快速切换器长一样（同一套 `.overlay/.modal`）—— 「打开一个浮层、输入几个字、
 * 回车选中」是这个软件里已经存在的一种交互，模板不该另发明一种。
 *
 * 匹配用朴素的 `includes` 而不是 `rankNotes` 的模糊匹配：模板一般十来个，
 * 名字是自己起的、记得住，模糊匹配在这个规模上只会让顺序变得难以预料。
 */
export function TemplatePicker({ templates, dir, title, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates;
  }, [templates, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) onPick(hit);
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
          placeholder={title}
          spellCheck={false}
        />

        {results.length === 0 ? (
          // 「没有模板」和「没搜到」是两件事：前者要告诉人往哪儿放文件，
          // 否则这个功能看起来就是坏的
          <div className="modal-empty">
            {templates.length === 0
              ? dir
                ? `${dir}/ 下还没有模板。往那个目录里放一篇 .md 就是一个模板。`
                : "还没设模板目录。去设置里填一个。"
              : "没有匹配的模板"}
          </div>
        ) : (
          <ul className="modal-list" ref={listRef}>
            {results.map((t, i) => (
              <li
                key={t.path}
                className={`qs-item${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={() => onPick(t)}
              >
                <span className="qs-name">{t.name}</span>
                <span className="qs-path">{t.path.replace(/\.md$/, "")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
