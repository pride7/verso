/**
 * 同步冲突的解决界面。DESIGN.md §2.8。
 *
 * 每篇冲突笔记按 hunk（段落级）对比「本地 / 远端」，点哪边就用哪边；
 * 一边被删除的文件退化成整篇二选一。所有段落都选完才能提交 ——
 * **不做默认选择**：默认就是「自作主张合一半」，§2.8 明确否决过。
 *
 * 提交后走 `vaultSyncResolve` 重放同步。两次之间远端又动了的话会报出
 * 新一轮冲突，App 那边把新清单塞回来，这里原样再走一遍。
 */
import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { mergeChoices, type HunkChoice } from "../lib/conflictMerge";
import type { ConflictFile, FileDiff, SyncResolution } from "../types";
import { Icon } from "./Icon";

interface Props {
  conflicts: ConflictFile[];
  /** 正在重放同步 —— 提交按钮转圈、全场禁点 */
  busy: boolean;
  onCancel: () => void;
  onSubmit: (resolutions: SyncResolution[]) => void;
}

/** 一篇文件的选择状态 */
interface FileState {
  /** 两边都是文本时的逐 hunk 对比；一边没了（删除）时为 null */
  diff: FileDiff | null;
  /** 逐 hunk 的选择，长度 = hunks.length；null = 还没选 */
  hunks: (HunkChoice | null)[];
  /** 删除类冲突的整篇选择 */
  whole: HunkChoice | null;
}

function paneLines(hunk: FileDiff["hunks"][number], side: HunkChoice) {
  const drop = side === "local" ? "added" : "deleted";
  return hunk.lines.filter((l) => l.kind !== drop);
}

export function ConflictView({ conflicts, busy, onCancel, onSubmit }: Props) {
  const [files, setFiles] = useState<Record<string, FileState>>({});

  // 每篇算一份本地↔远端的 diff。冲突清单变了（新一轮）就整个重来
  useEffect(() => {
    let alive = true;
    setFiles({});
    for (const c of conflicts) {
      if (c.local === null || c.remote === null) {
        setFiles((m) => ({ ...m, [c.path]: { diff: null, hunks: [], whole: null } }));
        continue;
      }
      void api
        .textDiff(c.path, c.local, c.remote)
        .then((diff) => {
          if (!alive) return;
          setFiles((m) => ({
            ...m,
            [c.path]: { diff, hunks: new Array(diff.hunks.length).fill(null), whole: null },
          }));
        })
        .catch(() => {
          // diff 算不出来（理论上只有后端挂了）：退化成整篇二选一
          if (!alive) return;
          setFiles((m) => ({ ...m, [c.path]: { diff: null, hunks: [], whole: null } }));
        });
    }
    return () => {
      alive = false;
    };
  }, [conflicts]);

  const pick = (path: string, hunkIndex: number, side: HunkChoice) => {
    setFiles((m) => {
      const f = m[path];
      if (!f) return m;
      const hunks = [...f.hunks];
      hunks[hunkIndex] = side;
      // 单独动过某一段之后，「整篇用某边」的高亮就不再成立
      return { ...m, [path]: { ...f, hunks, whole: null } };
    });
  };

  const pickAll = (path: string, side: HunkChoice) => {
    setFiles((m) => {
      const f = m[path];
      if (!f) return m;
      return { ...m, [path]: { ...f, hunks: f.hunks.map(() => side), whole: side } };
    });
  };

  /** 每篇都选完了才能提交 */
  const ready = useMemo(
    () =>
      conflicts.every((c) => {
        const f = files[c.path];
        if (!f) return false;
        if (f.diff) return f.hunks.every((h) => h !== null);
        return f.whole !== null;
      }),
    [conflicts, files],
  );

  const submit = () => {
    const resolutions: SyncResolution[] = conflicts.map((c) => {
      const f = files[c.path]!;
      if (f.diff) {
        // hunks 为 0 = 两边其实一样（比如只差提交历史），随便哪边都行
        const content = f.diff.hunks.length
          ? mergeChoices(c.local!, f.diff.hunks, f.hunks as HunkChoice[])
          : c.local!;
        return { path: c.path, content };
      }
      const keep = f.whole === "local" ? c.local : c.remote;
      return { path: c.path, content: keep };
    });
    onSubmit(resolutions);
  };

  return (
    <div className="overlay" role="dialog" aria-label="解决同步冲突">
      <div className="modal conflict-modal">
        <header className="conflict-head">
          <h2>两边都改过的笔记</h2>
          <p>逐段选择要保留哪边，或整篇用一边。选完提交，这次同步才会真的发生。</p>
          <button className="modal-close" onClick={onCancel} title="先不处理" aria-label="先不处理">
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="conflict-body">
          {conflicts.map((c) => {
            const f = files[c.path];
            const name = c.path.replace(/\.md$/, "");
            return (
              <section className="conflict-file" key={c.path}>
                <header className="conflict-file-head">
                  <h3 title={c.path}>{name}</h3>
                  <div className="conflict-quick">
                    <button
                      className={f?.whole === "local" ? "is-chosen" : ""}
                      onClick={() => pickAll(c.path, "local")}
                      disabled={busy}
                    >
                      {c.local === null ? "本地已删，保持删除" : "整篇用本地"}
                    </button>
                    <button
                      className={f?.whole === "remote" ? "is-chosen" : ""}
                      onClick={() => pickAll(c.path, "remote")}
                      disabled={busy}
                    >
                      {c.remote === null ? "远端已删，接受删除" : "整篇用远端"}
                    </button>
                  </div>
                </header>

                {!f ? (
                  <p className="conflict-note">正在比较…</p>
                ) : f.diff ? (
                  f.diff.hunks.length === 0 ? (
                    <p className="conflict-note">两边内容一致，提交即可。</p>
                  ) : (
                    f.diff.hunks.map((hunk, i) => (
                      <div className="conflict-hunk" key={i}>
                        {(["local", "remote"] as const).map((side) => (
                          <button
                            key={side}
                            className={`conflict-pane${f.hunks[i] === side ? " is-chosen" : ""}`}
                            onClick={() => pick(c.path, i, side)}
                            disabled={busy}
                            aria-label={`第 ${i + 1} 段用${side === "local" ? "本地" : "远端"}`}
                          >
                            <span className="conflict-pane-tag">
                              {side === "local" ? "本地" : "远端"}
                            </span>
                            {paneLines(hunk, side).map((l, j) => (
                              <pre key={j} className={`is-${l.kind}`}>
                                {l.text || " "}
                              </pre>
                            ))}
                          </button>
                        ))}
                      </div>
                    ))
                  )
                ) : (
                  <p className="conflict-note">
                    {c.remote === null
                      ? "远端删除了这篇，而本地改过它。"
                      : "本地删除了这篇，而远端改过它。"}
                    用上面的按钮选一边。
                  </p>
                )}
              </section>
            );
          })}
        </div>

        <footer className="conflict-foot">
          <button onClick={onCancel} disabled={busy}>
            先不处理
          </button>
          <button className="conflict-submit" onClick={submit} disabled={!ready || busy}>
            {busy ? "正在同步…" : "用这些选择完成同步"}
          </button>
        </footer>
      </div>
    </div>
  );
}
