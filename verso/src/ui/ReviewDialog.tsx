import { useEffect, useMemo, useState } from "react";

import { api } from "../host/api";
import { relTime } from "../core/relTime";
import type { FileDiff, Suggestion } from "../core/types";
import { SplitDiff, UnifiedDiff } from "./DiffView";
import { Icon } from "./Icon";

type Decision = "accept" | "reject" | null;

interface Props {
  suggestion: Suggestion;
  busy: boolean;
  onClose: () => void;
  onSubmit: (accepted: string[]) => void;
}

const KIND: Record<string, string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "改名",
};

export function ReviewDialog({ suggestion, busy, onClose, onSubmit }: Props) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(suggestion.files.map((file) => [file.path, null])),
  );
  const [selected, setSelected] = useState(suggestion.files[0]?.path ?? null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setDiff(null);
    setError(null);
    void api
      .reviewSuggestionDiff(suggestion.id, selected)
      .then((value) => alive && setDiff(value))
      .catch((reason) => alive && setError((reason as Error).message));
    return () => {
      alive = false;
    };
  }, [selected, suggestion.id]);

  const ready = useMemo(
    () => suggestion.files.length > 0 && suggestion.files.every((file) => decisions[file.path] !== null),
    [decisions, suggestion.files],
  );
  const accepted = suggestion.files.filter((file) => decisions[file.path] === "accept").map((file) => file.path);

  const decide = (path: string, decision: Exclude<Decision, null>) => {
    setDecisions((current) => ({ ...current, [path]: decision }));
  };

  return (
    <div className="overlay review-overlay" role="dialog" aria-label={`审阅修改建议：${suggestion.title}`}>
      <div className="modal review-modal">
        <header className="review-head">
          <div>
            <span className="review-eyebrow">修改建议</span>
            <h2>{suggestion.title}</h2>
            <p>
              {suggestion.authorName} · {relTime(suggestion.at, new Date())} · {suggestion.files.length} 个文件
            </p>
          </div>
          <span className="review-stats">
            <span className="is-added">+{suggestion.additions}</span>
            <span className="is-deleted">−{suggestion.deletions}</span>
          </span>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭审阅">
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="review-body">
          <aside className="review-files" aria-label="建议文件">
            {suggestion.files.map((file) => (
              <div className={`review-file${selected === file.path ? " is-selected" : ""}`} key={file.path}>
                <button className="review-file-open" onClick={() => setSelected(file.path)}>
                  <span className={`hist-kind is-${file.kind}`}>{KIND[file.kind] ?? file.kind}</span>
                  <span title={file.path}>
                    {file.previousPath ? `${file.previousPath.replace(/\.md$/, "")} → ` : ""}
                    {file.path.replace(/\.md$/, "")}
                  </span>
                </button>
                <div className="review-file-decision" role="group" aria-label={`${file.path} 的审阅决定`}>
                  <button
                    className={decisions[file.path] === "accept" ? "is-on" : undefined}
                    onClick={() => decide(file.path, "accept")}
                    disabled={busy}
                  >
                    接受
                  </button>
                  <button
                    className={decisions[file.path] === "reject" ? "is-reject" : undefined}
                    onClick={() => decide(file.path, "reject")}
                    disabled={busy}
                  >
                    退回
                  </button>
                </div>
              </div>
            ))}
          </aside>

          <main className="review-diff">
            {error ? (
              <p className="diff-message is-error">无法读取差异：{error}</p>
            ) : !diff ? (
              <p className="diff-message">正在比较…</p>
            ) : diff.binary ? (
              <p className="diff-message">这个文件有变化，但不是可逐行比较的文本。</p>
            ) : diff.hunks.length === 0 ? (
              <p className="diff-message">没有可显示的文字差异。</p>
            ) : (
              <>
                <SplitDiff diff={diff} />
                <UnifiedDiff diff={diff} />
              </>
            )}
          </main>
        </div>

        <footer className="review-foot">
          <p>
            {ready
              ? `将接受 ${accepted.length} 个，退回 ${suggestion.files.length - accepted.length} 个。`
              : "每个文件都要明确选择接受或退回。"}
          </p>
          <button onClick={onClose} disabled={busy}>先不处理</button>
          <button
            className="review-submit"
            onClick={() => onSubmit(accepted)}
            disabled={!ready || busy}
          >
            {busy ? "正在写入正式版本…" : "完成审阅"}
          </button>
        </footer>
      </div>
    </div>
  );
}
