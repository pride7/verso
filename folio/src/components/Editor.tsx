import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSaveNow: () => void;
  breadcrumb: string[];
}

/**
 * M0 的编辑器就是一个 textarea —— 故意的。
 *
 * 真正的编辑器是 M1 的 CodeMirror 6（DESIGN.md §4）。M0 的目标是把
 * 「打开 → 编辑 → 保存不丢数据」这条链路跑通，在这里花时间是浪费。
 */
export function Editor({ value, onChange, onSaveNow, breadcrumb }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSaveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSaveNow]);

  return (
    <div className="editor">
      {/* 面包屑。§2.2：深层嵌套不迷路的前提。M1 会让每一级可点击。 */}
      <nav className="breadcrumb">
        {breadcrumb.map((seg, i) => (
          <span key={i}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            {seg}
          </span>
        ))}
      </nav>

      <textarea
        ref={ref}
        className="editor-area"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder="开始写…"
      />
    </div>
  );
}
