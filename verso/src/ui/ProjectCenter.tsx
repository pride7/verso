import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../host/api";
import {
  isSettledStatus,
  moveProjectCard,
  PROJECT_CARD_COLUMNS,
  PROJECT_CARD_SORT_LABELS,
  PROJECT_ORDER_GROUP,
  PROJECT_STATUSES,
  projectCard,
  projectStatusOptions,
  readProjectCardSort,
  pinnedPatch,
  setProjectPinned,
  sortProjectCards,
  statusTone,
  type ProjectCard,
  type ProjectCardSort,
} from "../core/project";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { useLongPress } from "./longPress";
import { useSortable, type Sortable } from "./sortable";

interface Props {
  revision: number;
  promotableNote: string | null;
  onOpen: (path: string, opts?: { newTab?: boolean }) => void;
  onNew: () => void;
  onPromote: () => void;
  onClose: () => void;
  /** 置顶、改状态写的是项目笔记的 frontmatter，上层要跟着刷新文档树和打开中的那一篇 */
  onChanged: () => void;
  /** 删除复用文档树的确认与标签清理流程（同项目总览里的记录行）；测试可不提供 */
  onDelete?: (path: string) => void;
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
/** 打开中心时先显示哪一档状态。也是界面偏好，记在本机 */
const FILTER_KEY = "verso.projectCenter.filter";
const ALL = "全部";
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

function loadFilter(): string {
  try {
    return localStorage.getItem(FILTER_KEY) || ALL;
  } catch {
    return ALL;
  }
}

function saveFilter(status: string) {
  try {
    // 「全部」就是出厂默认，不留一条多余的记录
    if (status === ALL) localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, status);
  } catch {
    // 同 `saveSort`
  }
}

/** 一枚状态筛选。点一下切过去；右键（手机上长按）可以把它设为打开时的默认 */
function FilterChip({
  status,
  on,
  isDefault,
  onPick,
  onMenu,
}: {
  status: string;
  on: boolean;
  isDefault: boolean;
  onPick: (status: string) => void;
  onMenu: (status: string, at: { x: number; y: number }) => void;
}) {
  const hold = useLongPress((at) => onMenu(status, at));
  return (
    <button
      className={on ? "is-on" : ""}
      title={isDefault ? "打开项目中心时默认显示这一档" : undefined}
      onClick={() => onPick(status)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(status, { x: event.clientX, y: event.clientY });
      }}
      {...hold}
    >
      {status}
    </button>
  );
}

/**
 * 一张项目卡片。整张是打开项目的按钮；右键（手机上长按）弹菜单 ——
 * 开新标签、改状态、置顶、删除。和总览里的记录行同一套入口（§2.10）。
 *
 * 按住拖动可以重排（手机上长按出菜单之后接着挪），见 `ui/sortable.ts`。
 */
function Card({
  card,
  index,
  sortable,
  onOpen,
  onMenu,
}: {
  card: ProjectCard;
  index: number;
  sortable: Sortable;
  onOpen: Props["onOpen"];
  onMenu: (card: ProjectCard, at: { x: number; y: number }) => void;
}) {
  const hold = useLongPress((at) => {
    onMenu(card, at);
    sortable.arm();
  });
  const drag = sortable.item(index);
  const updated = card.updated.slice(0, 10);
  return (
    <button
      ref={drag.ref}
      className={`project-center-card${card.pinned ? " is-pinned" : ""}`}
      onClick={(event) => {
        if (sortable.justDropped()) return;
        if (event.ctrlKey || event.metaKey) onOpen(card.path, { newTab: true });
        else onOpen(card.path);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(card, { x: event.clientX, y: event.clientY });
      }}
      {...hold}
      onPointerDown={(event) => {
        hold.onPointerDown(event);
        drag.onPointerDown(event);
      }}
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

export function ProjectCenter({ revision, promotableNote, onOpen, onNew, onPromote, onClose, onChanged, onDelete, onError }: Props) {
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  const [query, setQuery] = useState("");
  const [defaultFilter, setDefaultFilter] = useState(loadFilter);
  const [status, setStatus] = useState(defaultFilter);
  const [sort, setSort] = useState<ProjectCardSort>(loadSort);
  const [sortOpen, setSortOpen] = useState(false);
  /** 拖出来的顺序（`.verso-order.json` 里的那一组）。只在「自定义」下生效 */
  const [order, setOrder] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  /** 右键/长按弹出来的那张卡片 */
  const [menu, setMenu] = useState<{ card: ProjectCard; at: { x: number; y: number } } | null>(null);
  /** 右键/长按弹出来的那枚状态筛选 */
  const [filterMenu, setFilterMenu] = useState<{ status: string; at: { x: number; y: number } } | null>(null);
  /** vault 的状态词表。只读不写 —— 播种、迁移、添加新状态都留在项目总览里 */
  const [statusOptions, setStatusOptions] = useState<string[]>(() => projectStatusOptions("project", []));

  useEffect(() => {
    let active = true;
    void api.viewQuery(SOURCE).then((result) => {
      if (active) setProjects(result.rows.map(projectCard));
    }).catch((error) => onError((error as Error).message));
    // 读不出来就当没排过：顺序不该挡住项目中心打开（同文档树）
    void api.order(PROJECT_ORDER_GROUP).then((paths) => {
      if (active) setOrder(paths);
    }).catch(() => {});
    return () => { active = false; };
  }, [onError, revision]);

  useEffect(() => {
    let active = true;
    void api.propSchema().then((schema) => {
      if (active) setStatusOptions(projectStatusOptions("project", schema.status?.options ?? []));
    }).catch(() => {});
    return () => { active = false; };
  }, [revision]);

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
    // `pinnedAt` 要跟着一起改，否则刚点的这张先窜到置顶组最前（见 `pinnedPatch`）
    const patch = (next: { pinned: boolean; pinnedAt: string }) => (current: ProjectCard[] | null) =>
      current?.map((item) => (item.path === card.path ? { ...item, ...next } : item)) ?? current;
    setProjects(patch(pinnedPatch(pinned)));
    try {
      await setProjectPinned(api, card.path, pinned);
      onChanged();
    } catch (error) {
      // 退回原样：连时间戳一起还原，不能只把布尔翻回去
      setProjects(patch({ pinned: card.pinned, pinnedAt: card.pinnedAt }));
      onError((error as Error).message);
    }
  };

  /** 改状态。和置顶一样先改卡片、再等落盘，写失败退回原来那个词 */
  const changeStatus = async (card: ProjectCard, status: string) => {
    if (status === card.status) return;
    const patch = (value: string) => (current: ProjectCard[] | null) =>
      current?.map((item) => (item.path === card.path ? { ...item, status: value } : item)) ?? current;
    setProjects(patch(status));
    try {
      await api.propSet(card.path, "status", status);
      onChanged();
    } catch (error) {
      setProjects(patch(card.status));
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
  // 选中的那档眼下一个项目都没有（默认档的项目都结了，或最后一张刚被改走）时，
  // 筛选条上已经没有它的按钮 —— 落回「全部」，不留一屏说不清为什么的空白
  const current = statuses.includes(status) ? status : ALL;
  // 先排全部再筛：拖完要按「屏幕上全部项目的顺序」重写整组，筛掉的那些也在里面
  const sorted = useMemo(() => sortProjectCards(projects ?? [], sort, order), [order, projects, sort]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sorted.filter((card) => {
      if (current !== ALL && card.status !== current) return false;
      if (!needle) return true;
      return [card.title, card.summary, card.next, card.blocker]
        .some((text) => text.toLocaleLowerCase().includes(needle));
    });
  }, [current, query, sorted]);

  /**
   * 拖动排序。任何排序方式下都能拖，拖完切到「自定义」—— 拖本身就是「我要自己
   * 定顺序」的表态（同文档树，§2.1）；排序按钮上的字跟着变，不是悄悄改的。
   * 置顶的只在置顶组里挪，其余的也拖不进置顶组：「置顶永远在最前」不能被一次拖动打破。
   */
  const sortable = useSortable({
    scroller: () => scroller.current,
    range: (from) => {
      const pinned = visible.filter((card) => card.pinned).length;
      return visible[from]?.pinned ? [0, pinned - 1] : [pinned, visible.length - 1];
    },
    onStart: () => setMenu(null),
    onDrop: (from, to) => {
      const previous = order;
      const next = moveProjectCard(sorted.map((card) => card.path), visible.map((card) => card.path), from, to);
      setOrder(next);
      if (sort !== "manual") chooseSort("manual");
      void api.reorder(PROJECT_ORDER_GROUP, next).catch((error) => {
        setOrder(previous);
        onError((error as Error).message);
      });
    },
  });
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

    <div className="project-center-scroll" ref={scroller}>
      <div className="project-center-overview">
        <div><strong>{projects?.length ?? 0}</strong><span>全部项目</span></div>
        <div><strong>{activeCount}</strong><span>仍在推进</span></div>
        <div><strong>{(projects?.length ?? 0) - activeCount}</strong><span>已结束</span></div>
      </div>

      <div className="project-center-tools">
        <label className="project-center-search"><Icon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label>
        <div className="project-center-filters" aria-label="按状态筛选">
          {[ALL, ...statuses].map((candidate) => <FilterChip
            key={candidate}
            status={candidate}
            on={current === candidate}
            isDefault={defaultFilter === candidate}
            onPick={setStatus}
            onMenu={(target, at) => setFilterMenu({ status: target, at })}
          />)}
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
            title="排序方式。置顶的项目始终排在最前；按住卡片拖动可自定义顺序"
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
          {visible.map((card, index) => <Card key={card.path} card={card} index={index} sortable={sortable} onOpen={onOpen} onMenu={(target, at) => setMenu({ card: target, at })} />)}
        </div>
      ) : <div className="project-center-empty"><Icon name="project" size={22} /><strong>{projects.length ? "没有符合条件的项目" : "还没有项目"}</strong><p>{projects.length ? "换个状态或关键词试试。" : "新建项目，或将现有笔记设为项目。"}</p></div>}
    </div>

    {menu && <ContextMenu
      at={menu.at}
      groups={[
        [{ label: "在新标签页打开", icon: "doc", run: () => onOpen(menu.card.path, { newTab: true }) }],
        [{
          label: "更改状态",
          icon: "dot",
          tone: statusTone(menu.card.status),
          run: () => {},
          // 当前那一档打勾。要新加一个状态得去项目总览 —— 菜单里没有输入框的位置
          items: statusOptions.map((option) => ({
            label: option,
            icon: option === menu.card.status ? "check" : "dot",
            tone: statusTone(option),
            run: () => void changeStatus(menu.card, option),
          })),
        }, { label: menu.card.pinned ? "取消置顶" : "置顶", icon: "pin", run: () => void togglePin(menu.card) }],
        onDelete ? [{ label: "删除项目", icon: "trash", danger: true, run: () => onDelete(menu.card.path) }] : [],
      ]}
      onClose={() => setMenu(null)}
    />}

    {filterMenu && <ContextMenu
      at={filterMenu.at}
      groups={[[defaultFilter === filterMenu.status
        ? { label: "已是默认", icon: "check", disabled: true, run: () => {} }
        : {
          label: "设为默认",
          icon: "pin",
          run: () => {
            setDefaultFilter(filterMenu.status);
            setStatus(filterMenu.status);
            saveFilter(filterMenu.status);
          },
        }]]}
      onClose={() => setFilterMenu(null)}
    />}
  </section>;
}
