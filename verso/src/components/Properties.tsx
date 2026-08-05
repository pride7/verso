import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { Icon } from "./Icon";

/** frontmatter 里不值得占视觉空间的内部字段 */
const INTERNAL = new Set(["id", "title", "created", "updated"]);

function render(value: unknown): string {
  if (Array.isArray(value)) return value.map(render).join("、");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface Props {
  frontmatter: Record<string, unknown>;
  /** 当前笔记路径，写回属性要用 */
  path: string;
  /** 改完之后重新读一遍笔记 —— 显示的必须是磁盘上真正的那份 */
  onChanged: () => void;
}

/**
 * frontmatter 属性条 —— DESIGN.md §2.3「默认折叠成一行属性条，不占视觉空间」。
 *
 * 这里不做成 CM6 里的可折叠 YAML：Rust 侧已经把 frontmatter 和正文拆开了
 * （`read_note` 返回的 body 不含 frontmatter），编辑器只管正文。这样用户
 * 永远不用手写 YAML，也不会误删 `id` 把链接搞断。
 *
 * 写回走 `prop_set`，和 database 视图**同一条路径**。§2.6 说「可写是它
 * 好不好用的分水岭」，两处共用一套写入逻辑，才不会出现「表格里改得动、
 * 属性条里改不动」这种分裂。类型保持交给 Rust 侧：`tags: [a, b]` 改完
 * 仍然是数组，数字仍然是数字，不会被压成字符串。
 *
 * `id` 和 `created` 连显示都不显示（在 INTERNAL 里），Rust 侧还会再拒一次 ——
 * 改掉 id 等于换掉这篇笔记的身份，所有指向它的链接都会断。
 */
export function Properties({ frontmatter, path, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  /** 正在编辑哪个键的**值**。null = 没在编辑 */
  const [editing, setEditing] = useState<string | null>(null);
  /** 正在改哪个键的**名字** */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = Object.entries(frontmatter ?? {}).filter(([k]) => !INTERNAL.has(k));
  const tags = frontmatter?.tags;
  const shownTags = Array.isArray(tags) ? tags.filter((t) => String(t).trim()) : [];
  /**
   * 折叠态的计数**不含 tags** —— 它们已经以标签的样子摆在旁边了。
   *
   * 之前是 `entries.length`，于是一篇只有 `tags: [测试]` 的笔记会显示
   * 「#测试　1 个属性」，同一个东西数了两遍，看着像还藏着一条没显示的属性。
   */
  const restCount = entries.filter(([k]) => k !== "tags").length;

  useEffect(() => {
    if (editing !== null) inputRef.current?.focus();
  }, [editing]);

  /**
   * 属性改名走 `prop_rename` 而不是「删旧键 + 建新键」。
   *
   * 后者会丢类型（`tags: [a, b]` 变成字符串）并把键挪到 frontmatter 末尾，
   * 在 git diff 里显示成一大片改动。Rust 侧整个重建 mapping，只换那一个键。
   */
  const rename = async (from: string, to: string) => {
    if (to.trim() === from) {
      setRenaming(null);
      return;
    }
    try {
      await api.propRename(path, from, to);
      setError(null);
      setRenaming(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async (key: string, value: string | null) => {
    const k = key.trim();
    if (!k) return;
    try {
      await api.propSet(path, k, value);
      setError(null);
      setEditing(null);
      setNewKey(null);
      onChanged();
    } catch (e) {
      // 失败时留在编辑态。把人打回只读态、改的内容还丢了，是最糟的处理
      setError((e as Error).message);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, key: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save(key, draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      setError(null);
    }
  };

  // 空白笔记也必须有创建**第一条**属性的入口。以前这里直接 return null，
  // 结果是已有 frontmatter 的人能继续加，真正从零开始的人反而无路可走，
  // 只能先去模板 / database 绕一圈。入口保持一行淡文字，别让空笔记永远
  // 顶着一张空表单。
  if (entries.length === 0 && !open) {
    return (
      <div className="props is-empty">
        <button
          className="props-new props-empty-new"
          onClick={() => {
            setOpen(true);
            setNewKey("");
            setError(null);
          }}
        >
          <Icon name="plus" size={12} />
          添加属性
        </button>
      </div>
    );
  }

  return (
    <div className={`props${open ? " is-open" : ""}`}>
      <button className="props-toggle" onClick={() => setOpen((v) => !v)}>
        <span className={`props-caret${open ? " is-open" : ""}`}>
          <Icon name="chevron" size={11} />
        </span>
        {open ? (
          <span className="props-label">属性</span>
        ) : (
          <span className="props-summary">
            {shownTags.map((t) => (
              <span key={String(t)} className="props-tag">
                #{String(t)}
              </span>
            ))}
            {/* 一条别的属性都没有时不显示「0 个属性」—— 那是句废话，
                而且会让人以为有什么东西没显示出来 */}
            {restCount > 0 && <span className="props-count">{restCount} 个属性</span>}
          </span>
        )}
      </button>

      {open && (
        <dl className="props-list">
          {entries.map(([k, v]) => (
            <div className="props-row" key={k}>
              <dt>
                {renaming === k ? (
                  <input
                    autoFocus
                    className="props-input"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void rename(k, keyDraft);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenaming(null);
                        setError(null);
                      }
                    }}
                    onBlur={() => void rename(k, keyDraft)}
                    spellCheck={false}
                  />
                ) : (
                  <button
                    className="props-key"
                    title={`重命名属性「${k}」`}
                    onClick={() => {
                      setRenaming(k);
                      setKeyDraft(k);
                      setError(null);
                    }}
                  >
                    {k}
                  </button>
                )}
              </dt>
              <dd>
                {editing === k ? (
                  <input
                    ref={inputRef}
                    className="props-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => onKeyDown(e, k)}
                    onBlur={() => void save(k, draft)}
                    spellCheck={false}
                  />
                ) : (
                  <button
                    className="props-value"
                    onClick={() => {
                      setEditing(k);
                      setDraft(render(v));
                      setError(null);
                    }}
                  >
                    {render(v) || <span className="props-empty">空</span>}
                  </button>
                )}
              </dd>
              <button
                className="props-del"
                title={`删除属性「${k}」`}
                aria-label={`删除属性 ${k}`}
                onClick={() => void save(k, null)}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}

          {/* 加属性是个偶尔才用一次的动作，不该常驻一个空输入框在这里 ——
              那个蓝框比真正的属性还抢眼。平时只是一行淡淡的文字。 */}
          {newKey === null ? (
            <button className="props-new" onClick={() => setNewKey("")}>
              <Icon name="plus" size={12} />
              添加属性
            </button>
          ) : (
            <div className="props-row">
              <dt>
                <input
                  autoFocus
                  className="props-input"
                  value={newKey}
                  placeholder="属性名，回车确定"
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newKey.trim()) {
                      e.preventDefault();
                      // 先建成空值，下一步再填内容 —— 一次只问一件事
                      void save(newKey, "");
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setNewKey(null);
                      if (entries.length === 0) setOpen(false);
                    }
                  }}
                  onBlur={() => {
                    if (!newKey.trim()) {
                      setNewKey(null);
                      if (entries.length === 0) setOpen(false);
                    }
                  }}
                  spellCheck={false}
                />
              </dt>
              <dd />
            </div>
          )}

          {error && <p className="props-error">{error}</p>}
        </dl>
      )}
    </div>
  );
}
