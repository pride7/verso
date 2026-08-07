import { useEffect, useMemo, useState, type FormEvent } from "react";

import { api } from "../api";
import {
  captureProjectEntry,
  loadProjectOverview,
  PROJECT_KIND_LABEL,
  updateProjectSnapshot,
  type ProjectKind,
  type ProjectOverview,
} from "../lib/project";
import type { NoteContent, NoteRef } from "../types";
import { Icon } from "./Icon";

interface Props {
  project: NoteContent;
  notes: NoteRef[];
  revision: number;
  onOpen: (path: string) => void;
  onEdit: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

const KINDS: ProjectKind[] = ["progress", "experiment", "question", "decision", "resource"];
const ITEM_KIND_LABEL = { experiment: "实验", question: "问题", decision: "决策", resource: "资料" };
const CLOSED = /^(已完成|完成|已关闭|关闭|已解决|已归档)$/;

export function ProjectDashboard({ project, notes, revision, onOpen, onEdit, onChanged, onError }: Props) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState(false);
  const [expandedProgress, setExpandedProgress] = useState(false);

  const reload = () => {
    void loadProjectOverview(api, project, notes).then(setOverview).catch((error) => onError((error as Error).message));
  };
  useEffect(reload, [project, notes, revision]);

  const active = useMemo(
    () => overview?.items.filter((item) => (item.kind === "experiment" || item.kind === "question") && !CLOSED.test(item.status)) ?? [],
    [overview],
  );
  const visibleItems = expandedItems ? active : active.slice(0, 3);

  return (
    <section className="project-dashboard" aria-label={`${project.title} 项目工作台`}>
      <header className="project-head">
        <div>
          <span className="project-kicker">科研项目</span>
          <h1>{project.title}</h1>
        </div>
        <div className="project-actions">
          <button className="project-btn primary" onClick={() => setCaptureOpen(true)}><Icon name="plus" size={14} />记录</button>
          <button className="project-btn" onClick={() => setSnapshotOpen(true)}>更新状态</button>
          <button className="project-icon-btn" onClick={onEdit} title="编辑项目正文" aria-label="编辑项目正文"><Icon name="code" size={15} /></button>
        </div>
      </header>

      {overview ? (
        <div className="project-scroll">
          <section className="project-snapshot">
            <div className="project-status"><span className="project-dot" />{overview.status}</div>
            <p className={overview.summary ? "" : "is-empty"}>{overview.summary || "写一句当前结论，让下次打开时立刻接上思路。"}</p>
            <div className="project-now-grid">
              <div><strong>接下来</strong><p className={overview.next ? "" : "is-empty"}>{overview.next || "还没有明确下一步"}</p></div>
              <div><strong>阻碍</strong><p className={overview.blocker ? "" : "is-empty"}>{overview.blocker || "目前没有记录阻碍"}</p></div>
            </div>
          </section>

          <div className="project-columns">
            <section className="project-section">
              <div className="project-section-head"><h2>正在推进</h2><span>{active.length}</span></div>
              {visibleItems.length ? visibleItems.map((item) => (
                <button className="project-item" key={item.path} onClick={() => onOpen(item.path)}>
                  <span className={`project-kind kind-${item.kind}`}>{ITEM_KIND_LABEL[item.kind]}</span>
                  <span className="project-item-copy"><strong>{item.title}</strong><small>{item.summary || item.status}</small></span>
                  <Icon name="chevron" size={13} />
                </button>
              )) : <p className="project-empty">还没有进行中的实验或问题。</p>}
              {active.length > 3 && <button className="project-more" onClick={() => setExpandedItems((value) => !value)}>{expandedItems ? "收起" : `查看全部 ${active.length} 条`}</button>}
            </section>

            <section className="project-section">
              <div className="project-section-head"><h2>最近进展</h2><span>{overview.progress.length}</span></div>
              {overview.progress.slice(0, expandedProgress ? undefined : 3).map((entry) => (
                <article className="project-progress" key={`${entry.at}-${entry.text}`}><time>{entry.at}</time><p>{entry.text}</p></article>
              ))}
              {!overview.progress.length && <p className="project-empty">记录第一条进展，不用整理，写下刚发生的事就好。</p>}
              {overview.progress.length > 3 && <button className="project-more" onClick={() => setExpandedProgress((value) => !value)}>{expandedProgress ? "收起" : `查看全部 ${overview.progress.length} 条`}</button>}
            </section>
          </div>
        </div>
      ) : <div className="project-loading">正在整理项目…</div>}

      {captureOpen && <CaptureDialog projectPath={project.path} onClose={() => setCaptureOpen(false)} onDone={() => { setCaptureOpen(false); reload(); onChanged(); }} onError={onError} />}
      {snapshotOpen && overview && <SnapshotDialog path={project.path} value={overview} onClose={() => setSnapshotOpen(false)} onDone={() => { setSnapshotOpen(false); reload(); onChanged(); }} onError={onError} />}
    </section>
  );
}

function CaptureDialog({ projectPath, onClose, onDone, onError }: { projectPath: string; onClose: () => void; onDone: () => void; onError: (message: string) => void }) {
  const [kind, setKind] = useState<ProjectKind>("progress");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { await captureProjectEntry(api, projectPath, { kind, title, content }); onDone(); }
    catch (error) { onError((error as Error).message); setBusy(false); }
  };
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="project-dialog" onSubmit={(event) => void submit(event)}>
      <header><div><h2>记录到项目</h2><p>先记下来，归档和层级由 Verso 处理。</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="project-dialog-body">
        <div className="project-kind-tabs">{KINDS.map((value) => <button type="button" className={kind === value ? "is-on" : ""} key={value} onClick={() => setKind(value)}>{PROJECT_KIND_LABEL[value]}</button>)}</div>
        {kind !== "progress" && <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="不填则取正文第一行" /></label>}
        <label>{kind === "progress" ? "刚刚发生了什么" : "内容"}<textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} rows={6} placeholder="一句话也可以，之后随时补充" /></label>
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy || !content.trim()}>{busy ? "保存中…" : "保存记录"}</button></footer>
    </form>
  </div>;
}

function SnapshotDialog({ path, value, onClose, onDone, onError }: { path: string; value: ProjectOverview; onClose: () => void; onDone: () => void; onError: (message: string) => void }) {
  const [form, setForm] = useState({ status: value.status, summary: value.summary, next: value.next, blocker: value.blocker });
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form, next: string) => setForm((current) => ({ ...current, [key]: next }));
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await updateProjectSnapshot(api, path, form); onDone(); } catch (error) { onError((error as Error).message); setBusy(false); } };
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="project-dialog" onSubmit={(event) => void submit(event)}>
      <header><div><h2>更新当前状态</h2><p>这里只保留现在仍然有用的信息。</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="project-dialog-body">
        <label>状态<input value={form.status} onChange={(event) => field("status", event.target.value)} placeholder="进行中" /></label>
        <label>当前结论<textarea autoFocus value={form.summary} onChange={(event) => field("summary", event.target.value)} rows={3} /></label>
        <label>接下来<textarea value={form.next} onChange={(event) => field("next", event.target.value)} rows={3} placeholder="最多三件事" /></label>
        <label>阻碍<textarea value={form.blocker} onChange={(event) => field("blocker", event.target.value)} rows={2} /></label>
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? "保存中…" : "保存状态"}</button></footer>
    </form>
  </div>;
}
