/**
 * 同步冲突的解决界面。DESIGN.md §2.8。
 *
 * Markdown 有共同基线时先按 frontmatter 属性拆分：不同键自动合并，只有
 * 同一键被两边改过才询问。正文继续按 hunk 选择，并始终允许两边都保留。
 * 删除/修改冲突不会默认删除；无法可靠理解的文件退回普通文本对比。
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../host/api";
import {
  analyzeMarkdownConflict,
  composeMarkdownConflict,
  mergeChoices,
  propertyValue,
  type HunkChoice,
  type MarkdownConflictAnalysis,
} from "../core/conflictMerge";
import type { ConflictFile, FileDiff, SyncResolution } from "../core/types";
import { Icon } from "./Icon";

interface Props {
  conflicts: ConflictFile[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (resolutions: SyncResolution[]) => void;
}

interface FileState {
  diff: FileDiff | null;
  hunks: (HunkChoice | null)[];
  whole: HunkChoice | null;
  semantic: MarkdownConflictAnalysis | null;
  properties: Record<string, HunkChoice | null>;
}

function paneLines(hunk: FileDiff["hunks"][number], side: "local" | "remote") {
  const drop = side === "local" ? "added" : "deleted";
  return hunk.lines.filter((l) => l.kind !== drop);
}

function bodyText(c: ConflictFile, semantic: MarkdownConflictAnalysis | null, side: "local" | "remote") {
  if (semantic) return side === "local" ? semantic.localBody : semantic.remoteBody;
  return side === "local" ? c.local! : c.remote!;
}

/**
 * 两边都没有这个路径 —— 同一篇在两台机器上改成了不同名字时，git 会把**旧
 * 名字**也算进冲突。旧名字下面没有任何内容可挑，问用户等于让他在两个空白
 * 之间选。这类路径直接按「删掉旧名字」定稿，不进面板。
 */
function vanished(c: ConflictFile) {
  return c.local === null && c.remote === null;
}

function sideLabel(c: ConflictFile, side: "local" | "remote") {
  const change = side === "local" ? c.localChange : c.remoteChange;
  const place = side === "local" ? "本地" : "远端";
  if (!change) return place;
  return `${place} · ${change.author} · ${new Date(change.timestamp * 1000).toLocaleString()}`;
}

export function ConflictView({ conflicts, busy, onCancel, onSubmit }: Props) {
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const automaticSubmitted = useRef(false);

  useEffect(() => {
    let alive = true;
    automaticSubmitted.current = false;
    setFiles({});
    for (const c of conflicts) {
      if (c.local === null || c.remote === null) {
        const whole: HunkChoice | null = vanished(c) ? "local" : null;
        setFiles((m) => ({
          ...m,
          [c.path]: { diff: null, hunks: [], whole, semantic: null, properties: {} },
        }));
        continue;
      }

      const semantic = c.path.toLowerCase().endsWith(".md")
        ? analyzeMarkdownConflict(c.base, c.local, c.remote)
        : null;
      const properties = Object.fromEntries(
        (semantic?.conflicts ?? []).map((p) => [p.key, null as HunkChoice | null]),
      );
      const localBody = bodyText(c, semantic, "local");
      const remoteBody = bodyText(c, semantic, "remote");

      void api
        .textDiff(c.path, localBody, remoteBody)
        .then((diff) => {
          if (!alive) return;
          let hunks: (HunkChoice | null)[] = new Array(diff.hunks.length).fill(null);
          let whole: HunkChoice | null = null;
          // 正文只有一边动过时无需再问；共同基线让这个判断可靠。
          if (semantic && semantic.localBody === semantic.baseBody) {
            hunks = hunks.map(() => "remote");
          } else if (semantic && semantic.remoteBody === semantic.baseBody) {
            hunks = hunks.map(() => "local");
          } else if (localBody === remoteBody) {
            hunks = hunks.map(() => "local");
          }
          setFiles((m) => ({ ...m, [c.path]: { diff, hunks, whole, semantic, properties } }));
        })
        .catch(() => {
          if (!alive) return;
          setFiles((m) => ({
            ...m,
            [c.path]: { diff: null, hunks: [], whole: null, semantic, properties },
          }));
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
      return { ...m, [path]: { ...f, hunks, whole: null } };
    });
  };

  const pickProperty = (path: string, key: string, side: HunkChoice) => {
    setFiles((m) => {
      const f = m[path];
      if (!f) return m;
      return {
        ...m,
        [path]: { ...f, properties: { ...f.properties, [key]: side }, whole: null },
      };
    });
  };

  const pickAll = (path: string, side: HunkChoice) => {
    setFiles((m) => {
      const f = m[path];
      if (!f) return m;
      const properties = Object.fromEntries(Object.keys(f.properties).map((key) => [key, side]));
      return {
        ...m,
        [path]: { ...f, hunks: f.hunks.map(() => side), properties, whole: side },
      };
    });
  };

  const ready = useMemo(
    () =>
      conflicts.every((c) => {
        const f = files[c.path];
        if (!f) return false;
        if (f.diff) {
          return f.hunks.every((h) => h !== null) && Object.values(f.properties).every(Boolean);
        }
        return f.whole !== null && Object.values(f.properties).every(Boolean);
      }),
    [conflicts, files],
  );

  const buildResolutions = () =>
    conflicts.map((c): SyncResolution => {
      const f = files[c.path]!;
      if (f.diff) {
        const localBody = bodyText(c, f.semantic, "local");
        const body = f.diff.hunks.length
          ? mergeChoices(localBody, f.diff.hunks, f.hunks as HunkChoice[])
          : localBody;
        const content = f.semantic
          ? composeMarkdownConflict(f.semantic, f.properties as Record<string, HunkChoice>, body)
          : body;
        return { path: c.path, content };
      }
      if (f.whole === "both" && c.local !== null && c.remote !== null) {
        const divider = c.local.endsWith("\n") ? "" : "\n";
        return { path: c.path, content: `${c.local}${divider}${c.remote}` };
      }
      const keep = f.whole === "local" ? c.local : c.remote;
      return { path: c.path, content: keep };
    });

  const submit = () => {
    onSubmit(buildResolutions());
  };

  // 如果每篇都只有「一边改正文 / 两边改不同属性」这类确定答案，就直接
  // 重放同步，不让用户面对一个没有任何可选项、只剩提交按钮的假冲突。
  const allAutomatic = conflicts.length > 0 && conflicts.every((c) => {
    if (vanished(c)) return true;
    const f = files[c.path];
    if (!f?.semantic || !f.diff || f.semantic.conflicts.length > 0) return false;
    return (
      f.semantic.localBody === f.semantic.remoteBody ||
      f.semantic.localBody === f.semantic.baseBody ||
      f.semantic.remoteBody === f.semantic.baseBody
    );
  });
  useEffect(() => {
    if (!busy && ready && allAutomatic && !automaticSubmitted.current) {
      automaticSubmitted.current = true;
      onSubmit(buildResolutions());
    }
  }, [allAutomatic, busy, files, ready]);

  return (
    <div className="overlay" role="dialog" aria-label="解决同步冲突">
      <div className="modal conflict-modal">
        <header className="conflict-head">
          <h2>确认重叠的修改</h2>
          <p>不同属性和未重叠正文会自动合并；这里只列必须由你决定的部分。</p>
          <button className="modal-close" onClick={onCancel} title="先不处理" aria-label="先不处理">
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="conflict-body">
          {conflicts.filter((c) => !vanished(c)).map((c) => {
            const f = files[c.path];
            const name = c.path.replace(/\.md$/, "");
            const canKeepBoth = c.local !== null && c.remote !== null;
            return (
              <section className="conflict-file" key={c.path}>
                <header className="conflict-file-head">
                  <div>
                    <h3 title={c.path}>{name}</h3>
                    <span className="conflict-kind">
                      {c.local === null || c.remote === null
                        ? "删除与修改冲突"
                        : f?.semantic
                          ? "Markdown 语义冲突"
                          : "文本冲突"}
                    </span>
                  </div>
                  <div className="conflict-quick">
                    <button
                      className={f?.whole === "local" ? "is-chosen" : ""}
                      onClick={() => pickAll(c.path, "local")}
                      disabled={busy}
                    >
                      {c.local === null ? "保持本地删除" : "冲突用本地"}
                    </button>
                    <button
                      className={f?.whole === "remote" ? "is-chosen" : ""}
                      onClick={() => pickAll(c.path, "remote")}
                      disabled={busy}
                    >
                      {c.remote === null ? "接受删除（远端）" : "冲突用远端"}
                    </button>
                    {canKeepBoth && (
                      <button
                        className={f?.whole === "both" ? "is-chosen" : ""}
                        onClick={() => pickAll(c.path, "both")}
                        disabled={busy}
                      >
                        冲突都两边保留
                      </button>
                    )}
                  </div>
                </header>

                {!f ? (
                  <p className="conflict-note">正在分析…</p>
                ) : c.local === null || c.remote === null ? (
                  <div className="conflict-delete-warning">
                    <strong>不会自动删除</strong>
                    <p>
                      {c.remote === null
                        ? "远端删除了这篇，但本地在删除后仍有修改。保留本地可恢复文档；确认远端删除才会移除。"
                        : "本地删除了这篇，但远端仍有修改。保留远端可恢复文档；保持本地删除才会移除。"}
                    </p>
                  </div>
                ) : (
                  <>
                    {f.semantic && f.semantic.conflicts.length > 0 && (
                      <div className="conflict-properties">
                        <h4>属性</h4>
                        {f.semantic.conflicts.map((property) => (
                          <div className="conflict-property" key={property.key}>
                            <strong>{property.key}</strong>
                            <div className="conflict-property-options">
                              {(["local", "remote", "both"] as const).map((side) => (
                                <button
                                  key={side}
                                  className={f.properties[property.key] === side ? "is-chosen" : ""}
                                  onClick={() => pickProperty(c.path, property.key, side)}
                                  disabled={busy}
                                >
                                  <span>
                                    {side === "both" ? "两边保留" : sideLabel(c, side)}
                                  </span>
                                  <pre>
                                    {side === "both"
                                      ? "保留本地值，并新增一个“（远端）”属性"
                                      : propertyValue(property[side])}
                                  </pre>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {f.diff ? (
                      f.diff.hunks.length === 0 ? (
                        <p className="conflict-note">正文无需确认。</p>
                      ) : (
                        <div className="conflict-text-section">
                          <h4>正文</h4>
                          {f.diff.hunks.map((hunk, i) => (
                            <div className="conflict-hunk-wrap" key={i}>
                              <div className="conflict-hunk">
                                {(["local", "remote"] as const).map((side) => (
                                  <button
                                    key={side}
                                    className={`conflict-pane${f.hunks[i] === side ? " is-chosen" : ""}`}
                                    onClick={() => pick(c.path, i, side)}
                                    disabled={busy}
                                    aria-label={`第 ${i + 1} 段用${side === "local" ? "本地" : "远端"}`}
                                  >
                                    <span className="conflict-pane-tag">{sideLabel(c, side)}</span>
                                    {paneLines(hunk, side).map((l, j) => (
                                      <pre key={j} className={`is-${l.kind}`}>{l.text || " "}</pre>
                                    ))}
                                  </button>
                                ))}
                              </div>
                              <button
                                className={`conflict-both${f.hunks[i] === "both" ? " is-chosen" : ""}`}
                                onClick={() => pick(c.path, i, "both")}
                                disabled={busy}
                              >
                                两边都保留
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <p className="conflict-note">无法生成逐段对比，请用上方整篇选择。</p>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>

        <footer className="conflict-foot">
          <button onClick={onCancel} disabled={busy}>先不处理</button>
          <button className="conflict-submit" onClick={submit} disabled={!ready || busy}>
            {busy ? "正在同步…" : "用这些选择完成同步"}
          </button>
        </footer>
      </div>
    </div>
  );
}
