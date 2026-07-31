import { useState } from "react";

/** frontmatter 里不值得占视觉空间的内部字段 */
const INTERNAL = new Set(["id", "title", "created", "updated"]);

function render(value: unknown): string {
  if (Array.isArray(value)) return value.map(render).join("、");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * frontmatter 属性条 —— DESIGN.md §2.3「默认折叠成一行属性条，不占视觉空间」。
 *
 * 这里不做成 CM6 里的可折叠 YAML：Rust 侧已经把 frontmatter 和正文拆开了
 * （`read_note` 返回的 body 不含 frontmatter），编辑器只管正文。这样用户
 * 永远不用手写 YAML，也不会误删 `id` 把链接搞断。
 *
 * M1 只读。可编辑的属性表单要等 M3 —— 那时 database 视图需要回写 frontmatter，
 * 两者共用同一套控件才不会做两遍。
 */
export function Properties({ frontmatter }: { frontmatter: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);

  const entries = Object.entries(frontmatter ?? {}).filter(([k]) => !INTERNAL.has(k));
  const tags = frontmatter?.tags;

  if (entries.length === 0) return null;

  return (
    <div className={`props${open ? " is-open" : ""}`}>
      <button className="props-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="props-caret">{open ? "▾" : "▸"}</span>
        {open ? (
          <span className="props-label">属性</span>
        ) : (
          <span className="props-summary">
            {Array.isArray(tags) && tags.length > 0
              ? tags.map((t) => (
                  <span key={String(t)} className="props-tag">
                    #{String(t)}
                  </span>
                ))
              : null}
            <span className="props-count">{entries.length} 个属性</span>
          </span>
        )}
      </button>

      {open && (
        <dl className="props-list">
          {entries.map(([k, v]) => (
            <div className="props-row" key={k}>
              <dt>{k}</dt>
              <dd>{render(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
