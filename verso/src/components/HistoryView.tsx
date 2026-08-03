import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import { api } from "../api";
import { Icon } from "./Icon";
import { relTime } from "../lib/relTime";
import type { FileChange, HistoryEntry } from "../types";

export interface DiffSelection {
  path: string;
  /** null = 当前工作区；有值 = 这次记录与它的上一版 */
  commit: string | null;
  label: string;
}

interface Props {
  /** vault、外部文件或版本记录变了就重查 */
  revision: number;
  selected: DiffSelection | null;
  onDiff: (selection: DiffSelection) => void;
  /** 把某篇笔记回退到某一版 */
  onRestore: (commit: string, path: string) => void;
  /** 撤销工作区里某个文件尚未记录的改动 */
  onDiscard: (file: FileChange) => void;
}

const KIND: Record<string, string> = {
  added: "新增",
  modified: "更新",
  deleted: "删除",
  renamed: "改名",
};

const keyOf = (commit: string | null, path: string) => `${commit ?? "working"}:${path}`;

const fullTime = (seconds: number) => {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface HoverCardState {
  entry: HistoryEntry;
  left: number;
  top: number;
  width: number;
}

function HistoryCard({
  state,
  now,
  onEnter,
  onLeave,
}: {
  state: HoverCardState;
  now: Date;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { entry } = state;
  const initial = Array.from(entry.authorName.trim())[0] ?? "?";
  return createPortal(
    <aside
      id="hist-version-detail"
      className="hist-popover"
      style={{ left: state.left, top: state.top, width: state.width }}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <header className="hist-pop-meta">
        <span className="hist-pop-avatar" aria-hidden="true">
          {initial.toUpperCase()}
        </span>
        <div>
          <div>
            <strong>{entry.authorName}</strong>
            <span> · {relTime(entry.at, now)}（{fullTime(entry.at)}）</span>
          </div>
          {entry.authorEmail && <span className="hist-pop-email">{entry.authorEmail}</span>}
        </div>
      </header>
      <h4>{entry.message}</h4>
      {entry.detail && <pre>{entry.detail}</pre>}
      <footer className="hist-pop-foot">
        <span>已更改 {entry.files.length} 个文件</span>
        <span className="is-added">{entry.additions} 行插入（+）</span>
        <span className="is-deleted">{entry.deletions} 行删除（−）</span>
        <code title={entry.id}>{entry.id.slice(0, 7)}</code>
      </footer>
    </aside>,
    document.body,
  );
}

function FileRows({
  files,
  commit,
  label,
  selected,
  onDiff,
  onRestore,
  onDiscard,
  current = false,
}: {
  files: FileChange[];
  commit: string | null;
  label: string;
  selected: DiffSelection | null;
  onDiff: Props["onDiff"];
  onRestore?: Props["onRestore"];
  onDiscard?: Props["onDiscard"];
  current?: boolean;
}) {
  return (
    <ul className={`hist-files${current ? " hist-working" : ""}`}>
      {files.map((file) => {
        const active =
          keyOf(selected?.commit ?? null, selected?.path ?? "") === keyOf(commit, file.path);
        return (
          <li key={`${file.kind}:${file.path}`} className={active ? "is-current" : undefined}>
            <button
              className="hist-file"
              onClick={() => onDiff({ path: file.path, commit, label })}
              title={`比较 ${file.path}`}
            >
              <span className={`hist-kind is-${file.kind}`}>{KIND[file.kind] ?? file.kind}</span>
              <span className="hist-path">{file.path.replace(/\.md$/, "")}</span>
            </button>
            {current && onDiscard && (
              <button
                className="hist-restore hist-discard"
                onClick={() => onDiscard(file)}
                title="撤销这项未记录的改动"
                aria-label={`撤销 ${file.path} 的改动`}
              >
                <Icon name="history" size={12} />
              </button>
            )}
            {/* 回退只给历史里的笔记：附件不是文本，覆盖回去会坏 */}
            {commit && onRestore && file.path.endsWith(".md") && file.kind !== "deleted" && (
              <button
                className="hist-restore"
                onClick={() => onRestore(commit, file.path)}
                title="把这篇恢复成这一版的内容"
                aria-label={`恢复 ${file.path}`}
              >
                <Icon name="history" size={12} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 侧栏里的当前改动与版本历史。DESIGN.md §2.8
 *
 * 这不是一套 Git 客户端：没有 stage、branch 或 rebase。它只回答两件事——
 * AI 刚才改了什么，以及某一次自动记录具体改了什么。
 */
export function HistoryView({ revision, selected, onDiff, onRestore, onDiscard }: Props) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [working, setWorking] = useState<FileChange[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<HoverCardState | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const workingRef = useRef<HTMLElement | null>(null);
  const [workingHeight, setWorkingHeight] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem("verso.historyWorkingHeight"));
    return Number.isFinite(saved) && saved >= 64 ? saved : null;
  });

  const resizeWorking = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !rootRef.current || !workingRef.current) return;
    event.preventDefault();
    resizeCleanup.current?.();
    const startY = event.clientY;
    const startHeight = workingRef.current.getBoundingClientRect().height;
    const rootHeight = rootRef.current.getBoundingClientRect().height;
    const min = 64;
    const max = Math.max(min, rootHeight - 96);
    const move = (e: PointerEvent) => {
      const next = Math.round(Math.min(max, Math.max(min, startHeight + e.clientY - startY)));
      setWorkingHeight(next);
      localStorage.setItem("verso.historyWorkingHeight", String(next));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-row-resizing");
      resizeCleanup.current = null;
    };
    resizeCleanup.current = up;
    document.body.classList.add("is-row-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const resetWorkingHeight = () => {
    setWorkingHeight(null);
    localStorage.removeItem("verso.historyWorkingHeight");
  };

  const nudgeWorkingHeight = (delta: number) => {
    if (!rootRef.current || !workingRef.current) return;
    const rootHeight = rootRef.current.getBoundingClientRect().height;
    const current = workingRef.current.getBoundingClientRect().height;
    const next = Math.round(Math.min(Math.max(64, rootHeight - 96), Math.max(64, current + delta)));
    setWorkingHeight(next);
    localStorage.setItem("verso.historyWorkingHeight", String(next));
  };

  const leaveEntry = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hoverTimer.current = null;
    hideTimer.current = null;
    setHoverCard(null);
  };

  const scheduleLeave = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hoverTimer.current = null;
    // 卡片和侧栏之间留了 10px，给鼠标一点跨过去的时间。
    hideTimer.current = window.setTimeout(() => {
      setHoverCard(null);
      hideTimer.current = null;
    }, 140);
  };

  const keepCard = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const enterEntry = (entry: HistoryEntry, button: HTMLButtonElement) => {
    leaveEntry();
    const rect = button.getBoundingClientRect();
    const width = Math.min(520, window.innerWidth - 16);
    let left = rect.right + 10;
    if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 10);
    const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - 420));
    // 扫过历史时不要一排卡片连闪；停住片刻才说明用户真的想看详情。
    hoverTimer.current = window.setTimeout(() => {
      setHoverCard({ entry, left, top, width });
      hoverTimer.current = null;
    }, 220);
  };

  useEffect(() => {
    let alive = true;
    // 老后端没有新命令时 invoke 可能同步抛。两项分开兜底，当前改动读不到
    // 也不能把原本能用的版本历史一起带崩。
    const loadWorking = () => {
      try {
        return api.gitWorkingChanges().catch(() => [] as FileChange[]);
      } catch {
        return Promise.resolve([] as FileChange[]);
      }
    };
    const loadHistory = () => {
      try {
        return api.gitHistory(50).catch(() => [] as HistoryEntry[]);
      } catch {
        return Promise.resolve([] as HistoryEntry[]);
      }
    };
    void Promise.all([loadWorking(), loadHistory()]).then(([changes, entries]) => {
      if (!alive) return;
      setWorking(changes);
      setHistory(entries);
    });
    return () => {
      alive = false;
      leaveEntry();
      resizeCleanup.current?.();
    };
  }, [revision]);

  if (history === null || working === null) return <p className="side-empty">读取中…</p>;

  const now = new Date();
  return (
    <div
      ref={rootRef}
      className={`history-view${workingHeight === null ? "" : " is-resized"}`}
      style={workingHeight === null ? undefined : ({ "--hist-working-height": `${workingHeight}px` } as CSSProperties)}
    >
      <section ref={workingRef} className="hist-section hist-current" aria-labelledby="working-title">
        <header className="hist-section-head">
          <h3 id="working-title">当前改动</h3>
          {working.length > 0 && <span>{working.length}</span>}
        </header>
        {working.length > 0 ? (
          <FileRows
            files={working}
            commit={null}
            label="当前改动"
            selected={selected}
            onDiff={onDiff}
            onDiscard={onDiscard}
            current
          />
        ) : (
          <p className="hist-empty">当前没有未记录的改动。</p>
        )}
      </section>

      <div
        className="hist-divider"
        role="separator"
        aria-label="调整当前改动与版本记录的高度"
        aria-orientation="horizontal"
        tabIndex={0}
        onPointerDown={resizeWorking}
        onDoubleClick={resetWorkingHeight}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            nudgeWorkingHeight(event.key === "ArrowUp" ? -16 : 16);
          } else if (event.key === "Home") {
            event.preventDefault();
            resetWorkingHeight();
          }
        }}
        title="上下拖动调整高度；双击复位"
      />

      <section className="hist-section hist-records" aria-labelledby="history-title">
        <header className="hist-section-head">
          <h3 id="history-title">版本记录</h3>
        </header>
        {history.length === 0 ? (
          <p className="hist-empty">
            还没有版本记录。修改内容并停顿片刻后，Verso 会自动记录一个版本。
          </p>
        ) : (
          <ul className="hist">
            {history.map((entry) => (
              <li key={entry.id} className={open === entry.id ? "is-open" : undefined}>
                <button
                  className="hist-head"
                  onClick={() => setOpen(open === entry.id ? null : entry.id)}
                  onMouseEnter={(event) => enterEntry(entry, event.currentTarget)}
                  onMouseLeave={scheduleLeave}
                  aria-describedby={hoverCard?.entry.id === entry.id ? "hist-version-detail" : undefined}
                >
                  <Icon name="chevron" size={11} className="hist-caret" />
                  <span className="hist-msg">{entry.message}</span>
                  <span className="hist-when">{relTime(entry.at, now)}</span>
                </button>

                {open === entry.id && (
                  <FileRows
                    files={entry.files}
                    commit={entry.id}
                    label={entry.message}
                    selected={selected}
                    onDiff={onDiff}
                    onRestore={onRestore}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {hoverCard && (
        <HistoryCard state={hoverCard} now={now} onEnter={keepCard} onLeave={leaveEntry} />
      )}
    </div>
  );
}
