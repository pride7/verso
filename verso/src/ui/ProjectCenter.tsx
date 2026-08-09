import { useEffect, useMemo, useState } from "react";

import { api } from "../host/api";
import { statusTone } from "../core/project";
import type { ViewRow } from "../core/types";
import { Icon } from "./Icon";

interface Props {
  revision: number;
  promotableNote: string | null;
  onOpen: (path: string) => void;
  onNew: () => void;
  onPromote: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}

const SOURCE = [
  'where: type = "project"',
  "sort: updated desc",
  "columns: [status, summary, next, blocker, updated]",
  "limit: 500",
].join("\n");

const STATUS_ORDER = ["筹备中", "进行中", "已暂停", "已完成", "已归档"];
const CLOSED = /^(已完成|完成|已关闭|关闭|已归档)$/;

const value = (row: ViewRow, key: string) => row.props[key]?.trim() ?? "";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

export function ProjectCenter({ revision, promotableNote, onOpen, onNew, onPromote, onClose, onError }: Props) {
  const [projects, setProjects] = useState<ViewRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部");

  useEffect(() => {
    let active = true;
    void api.viewQuery(SOURCE).then((result) => {
      if (active) setProjects(result.rows);
    }).catch((error) => onError((error as Error).message));
    return () => { active = false; };
  }, [onError, revision]);

  const statuses = useMemo(() => {
    if (!projects) return [];
    const actual = unique(projects.map((project) => value(project, "status") || "进行中"));
    return unique([
      ...STATUS_ORDER.filter((candidate) => actual.includes(candidate)),
      ...actual.filter((candidate) => !STATUS_ORDER.includes(candidate)),
    ]);
  }, [projects]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (projects ?? []).filter((project) => {
      const projectStatus = value(project, "status") || "进行中";
      if (status !== "全部" && projectStatus !== status) return false;
      if (!needle) return true;
      return [project.title, value(project, "summary"), value(project, "next"), value(project, "blocker")]
        .some((text) => text.toLocaleLowerCase().includes(needle));
    });
  }, [projects, query, status]);
  const activeCount = projects?.filter((project) => !CLOSED.test(value(project, "status"))).length ?? 0;

  return <section className="project-center" aria-label="项目中心">
    <header className="project-center-head">
      <div>
        <span className="project-kicker">项目</span>
        <h1>项目中心</h1>
        <p>在一个地方掌握所有项目，再进入某个项目查看完整总览。</p>
      </div>
      <div className="project-actions">
        {promotableNote && <button className="project-btn" onClick={onPromote} title={`将「${promotableNote}」设为项目`}>将当前笔记设为项目</button>}
        <button className="project-btn primary" onClick={onNew}><Icon name="plus" size={14} />新建项目</button>
        <button className="project-icon-btn" onClick={onClose} aria-label="返回当前笔记" title="返回当前笔记"><Icon name="close" size={15} /></button>
      </div>
    </header>

    <div className="project-center-scroll">
      <div className="project-center-overview">
        <div><strong>{projects?.length ?? 0}</strong><span>全部项目</span></div>
        <div><strong>{activeCount}</strong><span>仍在推进</span></div>
        <div><strong>{(projects?.length ?? 0) - activeCount}</strong><span>已经结束</span></div>
      </div>

      <div className="project-center-tools">
        <label className="project-center-search"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label>
        <div className="project-center-filters" aria-label="按状态筛选">
          {["全部", ...statuses].map((candidate) => <button key={candidate} className={status === candidate ? "is-on" : ""} onClick={() => setStatus(candidate)}>{candidate}</button>)}
        </div>
      </div>

      {projects === null ? <p className="project-center-empty">正在整理项目…</p> : visible.length ? (
        <div className="project-center-grid">
          {visible.map((project) => {
            const projectStatus = value(project, "status") || "进行中";
            const summary = value(project, "summary");
            const next = value(project, "next");
            const blocker = value(project, "blocker");
            const updated = value(project, "updated").slice(0, 10);
            return <button className="project-center-card" key={project.path} onClick={() => onOpen(project.path)}>
              <div className="project-center-card-meta"><span className="project-center-card-status tone" data-tone={statusTone(projectStatus)}><i />{projectStatus}</span>{updated && <time>{updated}</time>}</div>
              <h2>{project.title}</h2>
              <p className={summary ? "" : "is-empty"}>{summary || "还没有项目摘要"}</p>
              <div className="project-center-card-now">
                <span><small>接下来</small>{next || "尚未记录"}</span>
                {blocker && <span className="has-blocker"><small>阻碍</small>{blocker}</span>}
              </div>
            </button>;
          })}
        </div>
      ) : <div className="project-center-empty"><Icon name="project" size={22} /><strong>{projects.length ? "没有符合条件的项目" : "还没有项目"}</strong><p>{projects.length ? "换个状态或关键词试试。" : "新建一个项目，或者把现有笔记设为项目。"}</p></div>}
    </div>
  </section>;
}
