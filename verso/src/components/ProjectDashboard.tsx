import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { api } from "../api";
import {
  captureProjectEntry,
  ensureProjectStatusSchema,
  loadProjectOverview,
  PROJECT_KIND_LABEL,
  PROJECT_STATUS_DEFAULTS,
  projectStatusOptions,
  updateProjectSnapshot,
  type ProjectItem,
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

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

function StatusSelect({ value, options, onChange, label }: { value: string; options: string[]; onChange: (value: string, custom: boolean) => void; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const choices = unique([...options, value]);
  useEffect(() => {
    if (!open && !adding) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [adding, open]);
  return <div className="project-status-control" ref={root}>
    <button
      type="button"
      className="project-status-trigger"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => { setAdding(false); setOpen((current) => !current); }}
    >
      <span>{value}</span><Icon name="chevron" size={11} />
    </button>
    {open && <div className="project-status-menu" role="listbox" aria-label={`${label}选项`}>
      {choices.map((option) => <button
        type="button"
        role="option"
        aria-selected={option === value}
        className={option === value ? "is-selected" : ""}
        key={option}
        onClick={() => { setOpen(false); if (option !== value) onChange(option, false); }}
      ><span>{option}</span>{option === value && <Icon name="check" size={12} />}</button>)}
      <button type="button" className="project-status-new" onClick={() => { setOpen(false); setAdding(true); }}><Icon name="plus" size={11} />添加状态…</button>
    </div>}
    {adding && <form className="project-status-add" onSubmit={(event) => {
      event.preventDefault();
      const next = custom.trim();
      if (!next) return;
      onChange(next, true);
      setAdding(false);
      setCustom("");
    }}>
      <input autoFocus value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="新状态" />
      <button disabled={!custom.trim()}>添加</button>
      <button type="button" onClick={() => setAdding(false)}>取消</button>
    </form>}
  </div>;
}

function ProjectItemRow({ item, options, showKind = true, onOpen, onStatus }: { item: ProjectItem; options: string[]; showKind?: boolean; onOpen: (path: string) => void; onStatus: (item: ProjectItem, value: string, custom: boolean) => void }) {
  return <div className="project-item">
    <button className="project-item-open" onClick={() => onOpen(item.path)}>
      <span className="project-item-icon"><Icon name="doc" size={14} /></span>
      <span className="project-item-copy"><strong>{item.title}</strong><small>{item.summary || "暂无摘要"}</small></span>
    </button>
    {showKind && <span className={`project-kind kind-${item.kind}`}>{ITEM_KIND_LABEL[item.kind]}</span>}
    <StatusSelect value={item.status || PROJECT_STATUS_DEFAULTS[item.kind][0]} options={options} label={`${item.title}的状态`} onChange={(value, custom) => onStatus(item, value, custom)} />
  </div>;
}

export function ProjectDashboard({ project, notes, revision, onOpen, onEdit, onChanged, onError }: Props) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState(false);
  const [expandedProgress, setExpandedProgress] = useState(false);
  const [expandedKinds, setExpandedKinds] = useState<Set<ProjectItem["kind"]>>(new Set());
  const [customStatuses, setCustomStatuses] = useState<string[]>([]);

  const reload = () => {
    void loadProjectOverview(api, project, notes).then(setOverview).catch((error) => onError((error as Error).message));
  };
  useEffect(reload, [project, notes, revision]);
  useEffect(() => {
    void ensureProjectStatusSchema(api, [String(project.frontmatter.status ?? "")])
      .then(setCustomStatuses)
      .catch(() => {});
  }, [project, revision]);

  const active = useMemo(
    () => overview?.items.filter((item) => (item.kind === "experiment" || item.kind === "question") && !CLOSED.test(item.status)) ?? [],
    [overview],
  );
  const visibleItems = expandedItems ? active : active.slice(0, 3);
  const optionsFor = (kind: ProjectItem["kind"] | "project") => projectStatusOptions(kind, customStatuses);
  const setStatus = async (path: string, value: string, custom: boolean) => {
    try {
      if (custom || !customStatuses.includes(value)) {
        setCustomStatuses(await ensureProjectStatusSchema(api, [value]));
      }
      await api.propSet(path, "status", value);
      setOverview((current) => current ? {
        ...current,
        status: path === project.path ? value : current.status,
        items: current.items.map((item) => item.path === path ? { ...item, status: value } : item),
      } : current);
      onChanged();
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const groups = (["experiment", "question", "decision", "resource"] as const).map((kind) => ({
    kind,
    label: ITEM_KIND_LABEL[kind],
    items: overview?.items.filter((item) => item.kind === kind) ?? [],
  }));
  const progressPath = `${project.path.replace(/\.md$/i, "")}/进展.md`;

  return (
    <section className="project-dashboard" aria-label={`${project.title} 项目总览`}>
      <header className="project-head">
        <div>
          <span className="project-kicker">项目总览</span>
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
            <div className="project-status"><span className="project-dot" /><StatusSelect value={overview.status} options={optionsFor("project")} label="项目状态" onChange={(value, custom) => void setStatus(project.path, value, custom)} /></div>
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
                <ProjectItemRow key={item.path} item={item} options={optionsFor(item.kind)} onOpen={onOpen} onStatus={(target, value, custom) => void setStatus(target.path, value, custom)} />
              )) : <p className="project-empty">还没有进行中的实验或问题。</p>}
              {active.length > 3 && <button className="project-more" onClick={() => setExpandedItems((value) => !value)}>{expandedItems ? "收起" : `查看全部 ${active.length} 条`}</button>}
            </section>

            <section className="project-section">
              <div className="project-section-head"><h2>最近进展</h2><span>{overview.progress.length}</span>{overview.progress.length > 0 && <button className="project-section-link" onClick={() => onOpen(progressPath)}>打开日志</button>}</div>
              {overview.progress.slice(0, expandedProgress ? undefined : 3).map((entry) => (
                <article className="project-progress" key={`${entry.at}-${entry.text}`}><time>{entry.at}</time><p>{entry.text}</p></article>
              ))}
              {!overview.progress.length && <p className="project-empty">记录第一条进展，不用整理，写下刚发生的事就好。</p>}
              {overview.progress.length > 3 && <button className="project-more" onClick={() => setExpandedProgress((value) => !value)}>{expandedProgress ? "收起" : `查看全部 ${overview.progress.length} 条`}</button>}
            </section>
          </div>
          <section className="project-records">
            <div className="project-records-head"><div><h2>项目内容</h2><p>实验、问题、决策和资料都可以直接进入完整文档。</p></div></div>
            <div className="project-record-grid">
              {groups.map(({ kind, label, items }) => {
                const expanded = expandedKinds.has(kind);
                return <section className="project-record-group" key={kind}>
                  <div className="project-section-head"><h3>{label}</h3><span>{items.length}</span></div>
                  {items.slice(0, expanded ? undefined : 3).map((item) => <ProjectItemRow key={item.path} item={item} options={optionsFor(kind)} showKind={false} onOpen={onOpen} onStatus={(target, value, custom) => void setStatus(target.path, value, custom)} />)}
                  {!items.length && <p className="project-empty">还没有{label}记录。</p>}
                  {items.length > 3 && <button className="project-more" onClick={() => setExpandedKinds((current) => {
                    const next = new Set(current);
                    if (expanded) next.delete(kind); else next.add(kind);
                    return next;
                  })}>{expanded ? "收起" : `查看全部 ${items.length} 条`}</button>}
                </section>;
              })}
            </div>
          </section>
        </div>
      ) : <div className="project-loading">正在整理项目…</div>}

      {captureOpen && <CaptureDialog projectPath={project.path} onClose={() => setCaptureOpen(false)} onDone={(path, open) => { setCaptureOpen(false); reload(); onChanged(); if (open) onOpen(path); }} onError={onError} />}
      {snapshotOpen && overview && <SnapshotDialog path={project.path} value={overview} onClose={() => setSnapshotOpen(false)} onDone={() => { setSnapshotOpen(false); reload(); onChanged(); }} onError={onError} />}
    </section>
  );
}

function CaptureDialog({ projectPath, onClose, onDone, onError }: { projectPath: string; onClose: () => void; onDone: (path: string, open: boolean) => void; onError: (message: string) => void }) {
  const [kind, setKind] = useState<ProjectKind>("progress");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const path = await captureProjectEntry(api, projectPath, { kind, title, content, useTemplate });
      onDone(path, kind !== "progress");
    }
    catch (error) { onError((error as Error).message); setBusy(false); }
  };
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="project-dialog" onSubmit={(event) => void submit(event)}>
      <header><div><h2>{kind === "progress" ? "记录一条进展" : `新建${PROJECT_KIND_LABEL[kind]}文档`}</h2><p>{kind === "progress" ? "一句话记下刚刚发生的事。" : "创建后进入完整编辑器，可写公式、图片、代码和表格。"}</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="project-dialog-body">
        <div className="project-kind-tabs">{KINDS.map((value) => <button type="button" className={kind === value ? "is-on" : ""} key={value} onClick={() => setKind(value)}>{PROJECT_KIND_LABEL[value]}</button>)}</div>
        {kind !== "progress" && <label>标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`例如：${kind === "experiment" ? "温度消融实验" : kind === "question" ? "为什么验证集误差反而上升" : kind === "decision" ? "采用哪套评测指标" : "ParallelBench 论文"}`} /></label>}
        <label>{kind === "progress" ? "刚刚发生了什么" : "一句摘要（可选）"}<textarea autoFocus={kind === "progress"} value={content} onChange={(event) => setContent(event.target.value)} rows={kind === "progress" ? 6 : 3} placeholder={kind === "progress" ? "一句话也可以，之后随时补充" : "这句话会显示在项目总览；详细内容进入文档后再写"} /></label>
        {kind !== "progress" && <label className="project-template-choice"><input type="checkbox" checked={useTemplate} onChange={(event) => setUseTemplate(event.target.checked)} /><span><strong>使用建议结构</strong><small>可选。按记录类型加入几个 Markdown 标题，进入文档后可任意删改。</small></span></label>}
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy || (kind === "progress" ? !content.trim() : !title.trim())}>{busy ? "创建中…" : kind === "progress" ? "保存进展" : "创建并开始记录"}</button></footer>
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
        <label>当前结论<textarea autoFocus value={form.summary} onChange={(event) => field("summary", event.target.value)} rows={3} /></label>
        <label>接下来<textarea value={form.next} onChange={(event) => field("next", event.target.value)} rows={3} placeholder="最多三件事" /></label>
        <label>阻碍<textarea value={form.blocker} onChange={(event) => field("blocker", event.target.value)} rows={2} /></label>
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? "保存中…" : "保存状态"}</button></footer>
    </form>
  </div>;
}
