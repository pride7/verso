import { useEffect, useMemo, useState } from "react";

import { api } from "../host/api";
import type { DiffHunk, DiffLine, FileDiff } from "../core/types";
import { Icon } from "./Icon";
import type { DiffSelection } from "./HistoryView";

interface Props {
  selection: DiffSelection;
  revision: number;
  onClose: () => void;
  /**
   * 把某一处改动撤回去（§2.8）。参数是那一处涉及的行在这份 diff 里的坐标。
   *
   * **只有「当前改动」才给这个回调** —— 历史里的某一版是已经记下来的事实，
   * 在那上面挑几处「不要」没有意义（要退整篇有「回退到这一版」）。给了它
   * 才会在两栏中间长出那个撤销按钮。
   */
  onRevertLines?: (lines: LineId[]) => Promise<void>;
}

/** 一行在 diff 里的坐标：第几个 hunk、这个 hunk 里的第几行 */
type LineId = [hunk: number, line: number];

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

/**
 * 把连着的改动行归成**一处**，返回「这一处从第几项开始 → 它包含哪些行」。
 *
 * 按处给按钮，不是按行：中间隔着上下文的两段是两件事，一个按钮管两段等于
 * 逼人把不想撤的那段一起撤掉。VSCode 的差异编辑器也是这个粒度。
 */
export function blockHeads<T>(
  items: T[],
  idsOf: (item: T, index: number) => LineId[],
): Map<number, LineId[]> {
  const heads = new Map<number, LineId[]>();
  let head: number | null = null;
  for (let i = 0; i < items.length; i += 1) {
    const ids = idsOf(items[i], i);
    if (ids.length === 0) {
      head = null;
      continue;
    }
    if (head === null) {
      head = i;
      heads.set(i, [...ids]);
    } else {
      heads.get(head)!.push(...ids);
    }
  }
  return heads;
}

interface Reverting {
  busy: boolean;
  run: (ids: LineId[]) => void;
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

/**
 * 「把这一处改回去」。画在两栏中间的那条缝上，和 VSCode 的差异编辑器一样 ——
 * 那个位置本身就在说「从右边退回左边」，不需要再配一句说明。
 */
function RevertHere({ ids, reverting }: { ids: LineId[]; reverting: Reverting }) {
  return (
    <button
      className="diff-revert-here"
      disabled={reverting.busy}
      onClick={() => reverting.run(ids)}
      title="把这一处改回上一个版本"
      aria-label="把这一处改回上一个版本"
    >
      <Icon name="chevron" size={12} className="dbv-flip" />
    </button>
  );
}

export function SplitDiff({
  diff,
  reverting = null,
}: {
  diff: FileDiff;
  reverting?: Reverting | null;
}) {
  return (
    <div className="diff-split" aria-label="左右差异对照">
      <div className="diff-pane-head">之前</div>
      <div className="diff-pane-head">之后</div>
      {diff.hunks.map((hunk, hunkIndex) => {
        // 对象身份就是它在 `lines` 里的位置 —— 左右对照重新排过版，
        // 但每一项仍是同一个对象
        const at = new Map(hunk.lines.map((line, i) => [line, i]));
        const rows = splitRows(hunk.lines);
        const heads = blockHeads(rows, (row) =>
          [row.old, row.next]
            .filter((l): l is DiffLine => !!l && l.kind !== "context")
            .map((l) => [hunkIndex, at.get(l)!] as LineId),
        );
        return (
          <div className="diff-hunk-group" key={`${hunk.oldStart}:${hunk.newStart}:${hunkIndex}`}>
            <div className="diff-hunk-label">{range(hunk)}</div>
            {rows.map((row, rowIndex) => (
              <div className="diff-split-row" key={rowIndex}>
                <Cell line={row.old} side="old" />
                <Cell line={row.next} side="new" />
                {reverting && heads.has(rowIndex) && (
                  <RevertHere ids={heads.get(rowIndex)!} reverting={reverting} />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function UnifiedDiff({
  diff,
  reverting = null,
}: {
  diff: FileDiff;
  reverting?: Reverting | null;
}) {
  return (
    <div className="diff-unified" aria-label="单列差异">
      {diff.hunks.map((hunk, hunkIndex) => {
        const heads = blockHeads(hunk.lines, (line, i) =>
          line.kind === "context" ? [] : [[hunkIndex, i] as LineId],
        );
        return (
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
                {reverting && heads.has(lineIndex) && (
                  <RevertHere ids={heads.get(lineIndex)!} reverting={reverting} />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** §2.8 差异页。它不是标签：关闭之后原笔记的光标与撤销栈仍在。 */
export function DiffView({ selection, revision, onClose, onRevertLines }: Props) {
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const reverting: Reverting | null =
    onRevertLines && diff && !diff.binary && diff.hunks.length > 0
      ? {
          busy,
          run: (ids) => {
            setBusy(true);
            void onRevertLines(ids).finally(() => setBusy(false));
          },
        }
      : null;

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
            <SplitDiff diff={diff} reverting={reverting} />
            <UnifiedDiff diff={diff} reverting={reverting} />
          </>
        )}
      </div>
    </article>
  );
}
