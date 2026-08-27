import { useEffect, useMemo, useState } from "react";

import { api } from "../host/api";
import {
  isSettledStatus,
  PROJECT_CARD_COLUMNS,
  PROJECT_CARD_SORT_LABELS,
  PROJECT_STATUSES,
  projectCard,
  readProjectCardSort,
  setProjectPinned,
  sortProjectCards,
  statusTone,
  type ProjectCard,
  type ProjectCardSort,
} from "../core/project";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { useLongPress } from "./longPress";

interface Props {
  revision: number;
  promotableNote: string | null;
  onOpen: (path: string, opts?: { newTab?: boolean }) => void;
  onNew: () => void;
  onPromote: () => void;
  onClose: () => void;
  /** 置顶写的是项目笔记的 frontmatter，上层要跟着刷新文档树和打开中的那一篇 */
  onChanged: () => void;
  onError: (message: string) => void;
}

const SOURCE = [
  'where: type = "project"',
  "sort: updated desc",
  `columns: [${PROJECT_CARD_COLUMNS.join(", ")}]`,
  "limit: 500",
].join("\n");

/** 排序方式是界面偏好，不是内容 —— 记在本机就够了（同侧栏宽度） */
const SORT_KEY = "verso.projectCenter.sort";
const SORTS = Object.keys(PROJECT_CARD_SORT_LABELS) as ProjectCardSort[];
const STATUS_ORDER = PROJECT_STATUSES;

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

function loadSort(): ProjectCardSort {
  try {
    return readProjectCardSort(localStorage.getItem(SORT_KEY));
  } catch {
    return "updated";
  }
}

function saveSort(sort: ProjectCardSort) {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    // 隐私模式下存不了，下次打开回默认 —— 不值得为此报错
  }
}

/**
 * 一张项目卡片。整张是打开项目的按钮；右键（手机上长按）弹菜单 ——
 * 置顶、开新标签。和总览里的记录行同一套入口（§2.10）。
 */
function Card({
  card,
  onOpen,
  onMenu,
}: {
  card: ProjectCard;
  onOpen: Props["onOpen"];
  onMenu: (card: ProjectCard, at: { x: number; y: number }) => void;
}) {
  const hold = useLongPress((at) => onMenu(card, at));
  const updated = card.updated.slice(0, 10);
  return (
    <button
      className={`project-center-card${card.pinned ? " is-pinned" : ""}`}
      onClick={(event) => (event.ctrlKey || event.metaKey ? onOpen(card.path, { newTab: true }) : onOpen(card.path))}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(card, { x: event.clientX, y: event.clientY });
      }}
      {...hold}
    >
      <div className="project-center-card-meta">
        <span className="project-center-card-status tone" data-tone={statusTone(card.status)}><i />{card.status}</span>
        <span className="project-center-card-side">
          {card.pinned && <span className="project-center-card-pin" title="已置顶" aria-label="已置顶"><Icon name="pin" size={11} /></span>}
          {updated && <time>{updated}</time>}
        </span>
      </div>
      <h2>{card.title}</h2>
      {card.summary && <p>{card.summary}</p>}
      <div className="project-center-card-now">
        <span><small>接下来</small>{card.next || "尚未记录"}</span>
        {card.blocker && <span className="has-blocker"><small>阻碍</small>{card.blocker}</span>}
      </div>
    </button>
  );
}

export function ProjectCenter({ revision, promotableNote, onOpen, onNew, onPromote, onClose, onChanged, onError }: Props) {
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部");
  const [sort, setSort] = useState<ProjectCardSort>(loadSort);
  const [sortOpen, setSortOpen] = useState(false);
  /** 右键/长按弹出来的那张卡片 */
  const [menu, setMenu] = useState<{ card: ProjectCard; at: { x: number; y: number } } | null>(null);

  useEffect(() => {
    let active = true;
    void api.viewQuery(SOURCE).then((result) => {
      if (active) setProjects(result.rows.map(projectCard));
    }).catch((error) => onError((error as Error).message));
    return () => { active = false; };
  }, [onError, revision]);

  // 点别处、按 Esc 关掉排序菜单。按钮和菜单自己 stopPropagation（同侧栏那个）
  useEffect(() => {
    if (!sortOpen) return;
    const close = () => setSortOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSortOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  const chooseSort = (next: ProjectCardSort) => {
    setSort(next);
    setSortOpen(false);
    saveSort(next);
  };

  /**
   * 置顶／取消置顶。写在那篇项目笔记自己的 frontmatter 里（和记录的置顶同一条，
   * §2.10）。先把卡片挪到前面再等落盘，写失败再退回去。
   */
  const togglePin = async (card: ProjectCard) => {
    const pinned = !card.pinned;
    const flip = (value: boolean) => (current: ProjectCard[] | null) =>
      current?.map((item) => (item.path === card.path ? { ...item, pinned: value } : item)) ?? current;
    setProjects(flip(pinned));
    try {
      await setProjectPinned(api, card.path, pinned);
      onChanged();
    } catch (error) {
      setProjects(flip(card.pinned));
      onError((error as Error).message);
    }
  };

  const statuses = useMemo(() => {
    if (!projects) return [];
    const actual = unique(projects.map((card) => card.status));
    return unique([
      ...STATUS_ORDER.filter((candidate) => actual.includes(candidate)),
      ...actual.filter((candidate) => !STATUS_ORDER.includes(candidate)),
    ]);
  }, [projects]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matched = (projects ?? []).filter((card) => {
      if (status !== "全部" && card.status !== status) return false;
      if (!needle) return true;
      return [card.title, card.summary, card.next, card.blocker]
        .some((text) => text.toLocaleLowerCase().includes(needle));
    });
    return sortProjectCards(matched, sort);
  }, [projects, query, sort, status]);
  const activeCount = projects?.filter((card) => !isSettledStatus(card.status)).length ?? 0;

  return <section className="project-center" aria-label="项目中心">
    <header className="project-center-head">
      <div>
        <span className="project-kicker">项目</span>
        <h1>项目中心</h1>
      </div>
      <div className="project-actions">
        {promotableNote && <button className="project-btn" onClick={onPromote} title={`将「${promotableNote}」设为项目`}>设为项目</button>}
        <button className="project-btn primary" onClick={onNew}><Icon name="plus" size={14} />新建项目</button>
        <button className="project-icon-btn" onClick={onClose} aria-label="返回当前笔记" title="返回当前笔记"><Icon name="close" size={15} /></button>
      </div>
    </header>

    <div className="project-center-scroll">
      <div className="project-center-overview">
        <div><strong>{projects?.length ?? 0}</strong><span>全部项目</span></div>
        <div><strong>{activeCount}</strong><span>仍在推进</span></div>
        <div><strong>{(projects?.length ?? 0) - activeCount}</strong><span>已结束</span></div>
      </div>

      <div className="project-center-tools">
        <label className="project-center-search"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label>
        <div className="project-center-filters" aria-label="按状态筛选">
          {["全部", ...statuses].map((candidate) => <button key={candidate} className={status === candidate ? "is-on" : ""} onClick={() => setStatus(candidate)}>{candidate}</button>)}
        </div>
        <div className="project-center-sort side-menu-wrap">
          <button
            type="button"
            className={`project-center-sort-btn${sortOpen ? " is-on" : ""}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setSortOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            aria-label="排序方式"
            title="排序方式。置顶的项目始终排在最前"
          >
            <Icon name="sort" size={14} />
            <span>{PROJECT_CARD_SORT_LABELS[sort]}</span>
            <Icon name="chevron" size={11} className="project-center-sort-chevron" />
          </button>
          {sortOpen && <ul className="side-menu" role="menu" aria-label="排序方式" onMouseDown={(event) => event.stopPropagation()}>
            {SORTS.map((key) => <li key={key}>
              <button type="button" role="menuitemradio" aria-checked={sort === key} className={sort === key ? "is-current" : ""} onClick={() => chooseSort(key)}>
                {/* 勾始终占位，不然选中项的文字会比别的往右挪一格 */}
                <span className="side-menu-check">{sort === key && <Icon name="check" size={12} />}</span>
                {PROJECT_CARD_SORT_LABELS[key]}
              </button>
            </li>)}
          </ul>}
        </div>
      </div>

      {projects === null ? <p className="project-center-empty">正在整理项目…</p> : visible.length ? (
        <div className="project-center-grid">
          {visible.map((card) => <Card key={card.path} card={card} onOpen={onOpen} onMenu={(target, at) => setMenu({ card: target, at })} />)}
        </div>
      ) : <div className="project-center-empty"><Icon name="project" size={22} /><strong>{projects.length ? "没有符合条件的项目" : "还没有项目"}</strong><p>{projects.length ? "换个状态或关键词试试。" : "新建项目，或将现有笔记设为项目。"}</p></div>}
    </div>

    {menu && <ContextMenu
      at={menu.at}
      groups={[
        [{ label: "在新标签页打开", icon: "doc", run: () => onOpen(menu.card.path, { newTab: true }) }],
        [{ label: menu.card.pinned ? "取消置顶" : "置顶", icon: "pin", run: () => void togglePin(menu.card) }],
      ]}
      onClose={() => setMenu(null)}
    />}
  </section>;
}
