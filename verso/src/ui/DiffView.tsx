import { useEffect, useMemo, useState } from "react";

import { api } from "../host/api";
import type { DiffHunk, DiffLine, FileDiff } from "../core/types";
import { Icon } from "./Icon";
import type { DiffSelection } from "./HistoryView";

interface Props {
  selection: DiffSelection;
  revision: number;
  onClose: () => void;
}

interface SplitRow {
  old: DiffLine | null;
  next: DiffLine | null;
}

/**
 * Git 的 patch 是「删掉若干行，再加上若干行」。左右对照要把这一组按位置
 * 配成行；不然左边删 3 行、右边加 1 行时，后面的上下文会从此错开。
 */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let deleted: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    const count = Math.max(deleted.length, added.length);
    for (let i = 0; i < count; i += 1) {
      rows.push({ old: deleted[i] ?? null, next: added[i] ?? null });
    }
    deleted = [];
    added = [];
  };

  for (const line of lines) {
    if (line.kind === "deleted") deleted.push(line);
    else if (line.kind === "added") added.push(line);
    else {
      flush();
      rows.push({ old: line, next: line });
    }
  }
  flush();
  return rows;
}

function range(hunk: DiffHunk) {
  return `@@ −${hunk.oldStart},${hunk.oldLines}  +${hunk.newStart},${hunk.newLines} @@`;
}

function Cell({ line, side }: { line: DiffLine | null; side: "old" | "new" }) {
  const number = line ? (side === "old" ? line.oldLine : line.newLine) : null;
  const kind = line?.kind ?? "empty";
  return (
    <div className={`diff-cell is-${kind}`}>
      <span className="diff-line-no">{number}</span>
      <pre>{line?.text ?? ""}</pre>
    </div>
  );
}

export function SplitDiff({ diff }: { diff: FileDiff }) {
  return (
    <div className="diff-split" aria-label="左右差异对照">
      <div className="diff-pane-head">之前</div>
      <div className="diff-pane-head">之后</div>
      {diff.hunks.map((hunk, hunkIndex) => (
        <div className="diff-hunk-group" key={`${hunk.oldStart}:${hunk.newStart}:${hunkIndex}`}>
          <div className="diff-hunk-label">{range(hunk)}</div>
          {splitRows(hunk.lines).map((row, rowIndex) => (
            <div className="diff-split-row" key={rowIndex}>
              <Cell line={row.old} side="old" />
              <Cell line={row.next} side="new" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function UnifiedDiff({ diff }: { diff: FileDiff }) {
  return (
    <div className="diff-unified" aria-label="单列差异">
      {diff.hunks.map((hunk, hunkIndex) => (
        <div className="diff-hunk-group" key={`${hunk.oldStart}:${hunk.newStart}:${hunkIndex}`}>
          <div className="diff-hunk-label">{range(hunk)}</div>
          {hunk.lines.map((line, lineIndex) => (
            <div className={`diff-unified-row is-${line.kind}`} key={lineIndex}>
              <span className="diff-line-no">{line.oldLine}</span>
              <span className="diff-line-no">{line.newLine}</span>
              <span className="diff-mark">
                {{ added: "+", deleted: "−", context: " " }[line.kind]}
              </span>
              <pre>{line.text}</pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** §2.8 只读差异页。它不是标签：关闭之后原笔记的光标与撤销栈仍在。 */
export function DiffView({ selection, revision, onClose }: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDiff(null);
    setError(null);
    try {
      void api
        .gitDiffFile(selection.path, selection.commit ?? undefined)
        .then((result) => alive && setDiff(result))
        .catch((e) => alive && setError((e as Error).message));
    } catch (e) {
      setError((e as Error).message);
    }
    return () => {
      alive = false;
    };
  }, [selection.path, selection.commit, revision]);

  const name = useMemo(() => selection.path.replace(/\.md$/, ""), [selection.path]);
  return (
    <article className="diff-view">
      <header className="diff-head">
        <div className="diff-title-wrap">
          <span className="diff-context">{selection.label}</span>
          <h2 title={selection.path}>{name}</h2>
        </div>
        {diff && !diff.binary && (
          <span
            className="diff-stats"
            aria-label={`${diff.additions} 行新增，${diff.deletions} 行删除`}
          >
            <span className="is-added">+{diff.additions}</span>
            <span className="is-deleted">−{diff.deletions}</span>
          </span>
        )}
        <button className="diff-close" onClick={onClose} title="关闭对比" aria-label="关闭对比">
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="diff-body">
        {error ? (
          <p className="diff-message is-error">无法读取差异：{error}</p>
        ) : !diff ? (
          <p className="diff-message">正在比较…</p>
        ) : diff.binary ? (
          <p className="diff-message">这个文件的内容有变化，但它不是可逐行比较的文本。</p>
        ) : diff.hunks.length === 0 ? (
          <p className="diff-message">没有可显示的文字差异。</p>
        ) : (
          <>
            <SplitDiff diff={diff} />
            <UnifiedDiff diff={diff} />
          </>
        )}
      </div>
    </article>
  );
}
