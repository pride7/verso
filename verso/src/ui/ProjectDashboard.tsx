import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";

import { api } from "../host/api";
import {
  captureProjectEntry,
  ensureProjectStatusSchema,
  loadProjectOverview,
  matchesProjectItem,
  matchesProjectProgress,
  prepareItemMove,
  PROGRESS_SECTION,
  PROJECT_STATUSES,
  projectSections,
  projectStatusOptions,
  removeProjectStatus,
  isSettledStatus,
  sectionKind,
  sectionNameError,
  setProjectPinned,
  setProjectSections,
  sortProjectItems,
  statusTone,
  STATUS_TONE_LABEL,
  updateProjectSnapshot,
  type ProjectItem,
  type ProjectItemKind,
  type ProjectOverview,
} from "../core/project";
import type { NoteContent, NoteRef } from "../core/types";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { useLongPress } from "./longPress";
import { RenameInput } from "./Tree";

interface Props {
  project: NoteContent;
  notes: NoteRef[];
  revision: number;
  onOpen: (path: string, opts?: { newTab?: boolean }) => void;
  onEdit: () => void;
  /** 改名走上层那一条：还要跟着改标签页的路径、刷新文档树（§2.1） */
  onRename: (path: string, title: string) => void;
  /** 换分类 = 真的移动文件，同样要上层去修标签页路径和手排顺序 */
  onMove: (path: string, newParentDoc: string) => void;
  /** 删除复用文档树的确认与标签清理流程；测试或只读嵌入可不提供 */
  onDelete?: (path: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** 各分类新建文档时的标题示例；自定义分类没有，用通用提示。 */
const TITLE_HINT: Record<ProjectItemKind, string> = {
  experiment: "温度消融实验",
  question: "为什么验证集误差反而上升",
  decision: "采用哪套评测指标",
  resource: "ParallelBench 论文",
};

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

function StatusSelect({ value, options, onChange, onDelete, label }: { value: string; options: string[]; onChange: (value: string, custom: boolean) => void; onDelete: (option: string) => void; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const [dropping, setDropping] = useState<string | null>(null);
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
      className="project-status-trigger tone tone-chip"
      data-tone={statusTone(value)}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => { setAdding(false); setOpen((current) => !current); }}
    >
      <span>{value}</span><Icon name="chevron" size={11} />
    </button>
    {open && <div className="project-status-menu" role="listbox" aria-label={`${label}选项`}>
      {choices.map((option) => dropping === option
        ? <div className="project-status-confirm" key={option}>
          <p>删除「{option}」？已有记录不受影响。</p>
          <div>
            <button type="button" className="danger" onClick={() => { setDropping(null); onDelete(option); }}>删除</button>
            <button type="button" onClick={() => setDropping(null)}>取消</button>
          </div>
        </div>
        : <div className={`project-status-option${option === value ? " is-selected" : ""}`} key={option}>
          <button
            type="button"
            role="option"
            aria-selected={option === value}
            className={option === value ? "is-selected" : ""}
            onClick={() => { setOpen(false); if (option !== value) onChange(option, false); }}
          ><span><i className="tone tone-dot" data-tone={statusTone(option)} />{option}</span></button>
          {/* 勾和叉共用行尾这一格，所以两者在同一条竖线上。勾画在按钮里面的话，
              它会贴着按钮的右内边，而叉是格子里居中 —— 两行一比就看得出没对齐。
              正在用的那个不给删：删了它还得留在菜单里（这一条仍写着它），
              看着像没删掉。先换成别的，再回来删 */}
          {option === value
            ? <span className="project-status-mark" aria-hidden="true"><Icon name="check" size={12} /></span>
            : <button
              type="button"
              className="project-status-mark project-status-drop"
              aria-label={`删掉状态${option}`}
              title={`从词表里去掉「${option}」`}
              onClick={() => setDropping(option)}
            ><Icon name="close" size={11} /></button>}
        </div>)}
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
      {/* 新状态不会分到一个新颜色，而是落进已有的某一档。这句预览让人在按下
          「添加」之前就看得见落在哪 —— 分档是按词形猜的，猜错了得看得见 */}
      <p className="project-status-hint">
        <i className="tone tone-dot" data-tone={statusTone(custom)} />
        {custom.trim()
          ? <>归入<strong className="tone" data-tone={statusTone(custom)}>{STATUS_TONE_LABEL[statusTone(custom)]}</strong></>
          : <>颜色按状态词自动归类</>}
      </p>
    </form>}
  </div>;
}

interface RowProps {
  item: ProjectItem;
  options: string[];
  showKind?: boolean;
  /**
   * 这一行属于哪张清单。同一条记录会同时出现在「正在推进」和它自己的分类卡片里
   * —— 只按路径认的话，改一个名字会同时长出两个输入框，两个都 autofocus，
   * 后长出来的把先长出来的挤掉，于是刚点开的改名框当场消失。
   */
  slot: string;
  renaming: boolean;
  onOpen: (path: string, opts?: { newTab?: boolean }) => void;
  onMenu: (item: ProjectItem, slot: string, at: { x: number; y: number }) => void;
  onRename: (path: string, title: string) => void;
  onRenameCancel: () => void;
  onStatus: (item: ProjectItem, value: string, custom: boolean) => void;
  onDropStatus: (option: string) => void;
}

function ProjectItemRow({ item, options, showKind = true, slot, renaming, onOpen, onMenu, onRename, onRenameCancel, onStatus, onDropStatus }: RowProps) {
  const fallback = PROJECT_STATUSES[0];
  // 手指没有右键。菜单里那两条（开新标签、改名）在手机上只能靠长按（§1.2）
  const hold = useLongPress((at) => onMenu(item, slot, at));
  return <div
    className="project-item"
    onContextMenu={(event) => { event.preventDefault(); onMenu(item, slot, { x: event.clientX, y: event.clientY }); }}
    {...(renaming ? {} : hold)}
  >
    {renaming
      // 改名时图标照样占着位 —— 少了它整行会横向跳一下
      ? <span className="project-item-open">
        <span className="project-item-icon"><Icon name="doc" size={14} /></span>
        <RenameInput className="project-item-rename" name={item.title} onSubmit={(value) => onRename(item.path, value)} onCancel={onRenameCancel} />
      </span>
      : <button className="project-item-open" onClick={(event) => onOpen(item.path, event.ctrlKey || event.metaKey ? { newTab: true } : undefined)}>
        <span className="project-item-icon"><Icon name="doc" size={14} /></span>
        <span className="project-item-copy"><strong>{item.title}</strong>{item.summary && <small>{item.summary}</small>}</span>
      </button>}
    {item.pinned && <span className="project-item-pin" title="已置顶" aria-label="已置顶"><Icon name="pin" size={12} /></span>}
    {showKind && <span className="project-kind">{item.section}</span>}
    <StatusSelect value={item.status || fallback} options={options} label={`${item.title}的状态`} onChange={(value, custom) => onStatus(item, value, custom)} onDelete={onDropStatus} />
  </div>;
}

export function ProjectDashboard({ project, notes, revision, onOpen, onEdit, onRename, onMove, onDelete, onChanged, onError }: Props) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  /** 右键/长按弹出来的那条记录 */
  const [menu, setMenu] = useState<{ item: ProjectItem; slot: string; at: { x: number; y: number } } | null>(null);
  const [renaming, setRenaming] = useState<{ slot: string; path: string } | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState(false);
  const [expandedProgress, setExpandedProgress] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [customStatuses, setCustomStatuses] = useState<string[]>([]);
  const [sections, setSections] = useState(() => projectSections(project));
  const [managing, setManaging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  /** 拖动中的分类，`at` 是它当前会插到第几个之前（指示线画在那里）。 */
  const [drag, setDrag] = useState<{ name: string; at: number } | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());

  // 只在文件里那一份真的变了才回灌。写完分类表后父组件会先 +1 revision、再把
  // 笔记读回来，中间那一拍不该把刚改好的列表闪回旧值。
  const declared = projectSections(project).join("\0");
  useEffect(() => { setSections(declared ? declared.split("\0") : []); }, [declared]);
  useEffect(() => { setQuery(""); }, [project.path]);

  const reload = () => {
    void loadProjectOverview(api, project, notes).then(setOverview).catch((error) => onError((error as Error).message));
  };
  useEffect(reload, [project, notes, revision]);
  useEffect(() => {
    void ensureProjectStatusSchema(api)
      .then(setCustomStatuses)
      .catch(() => {});
  }, [project, revision]);

  /**
   * 「正在推进」只看状态，不看分类（v0.7.40）。
   *
   * 以前「决策」「资料」整类被排除在外，理由是它们的默认状态（已决定 / 已收录）
   * 本来就不是推进态。三档统一之后这条不成立了：一条还在定的决策就是**正在
   * 定**，那正是要推进的事 —— 该由状态说了算，不该由它属于哪一类说了算。
   */
  const searching = Boolean(query.trim());
  const filteredItems = useMemo(
    () => overview?.items.filter((item) => matchesProjectItem(item, query)) ?? [],
    [overview, query],
  );
  const filteredProgress = useMemo(
    () => overview?.progress.filter((entry) => matchesProjectProgress(entry, query)) ?? [],
    [overview, query],
  );
  const active = useMemo(
    () => filteredItems.filter((item) => !isSettledStatus(item.status)),
    [filteredItems],
  );
  const visibleItems = searching || expandedItems ? active : active.slice(0, 3);
  // 分类不再影响状态：三档全局统一，自定义分类和内置四类走同一条
  const optionsFor = (kind: ProjectItem["kind"] | "project") =>
    projectStatusOptions(kind ?? "project", customStatuses);
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
  /**
   * 改名交回上层。乐观地把新标题写进总览 —— 后端要改文件名、重建索引、
   * 再把文档树推回来，中间那几十毫秒里让刚改完的行还顶着旧名字，看着像没生效。
   */
  const submitRename = (path: string, title: string) => {
    setRenaming(null);
    const next = title.trim();
    const old = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    if (!next || next === old) return;
    const renamed = `${path.slice(0, path.lastIndexOf("/") + 1)}${next}.md`;
    setOverview((current) => current ? {
      ...current,
      items: current.items.map((item) => item.path === path ? { ...item, path: renamed, title: next } : item),
    } : current);
    onRename(path, next);
  };
  /**
   * 从这个 vault 的状态词表里去掉一个。**不改任何笔记** —— 还写着这个词的
   * 记录照常显示它，只是菜单里不再列出来（§2.10）。
   */
  const dropStatus = async (option: string) => {
    try {
      setCustomStatuses(await removeProjectStatus(api, option));
      onChanged();
    } catch (error) {
      onError((error as Error).message);
    }
  };

  /**
   * 置顶／取消置顶。**不动那条三行的上限**（§2.10）—— 置顶只是排到前面，
   * 不是额外多露一条；钉五条就把上限废掉了，总览又会变回长文档。
   */
  const togglePin = async (item: ProjectItem) => {
    const pinned = !item.pinned;
    setOverview((current) => current ? {
      ...current,
      items: sortProjectItems(current.items.map((row) => row.path === item.path ? { ...row, pinned } : row)),
    } : current);
    try {
      await setProjectPinned(api, item.path, pinned);
      onChanged();
    } catch (error) {
      onError((error as Error).message);
    }
  };

  /**
   * 换一个分类。分类就是目录，所以这是真的把文件搬过去 —— 移动本身交给上层，
   * 它还要修标签页路径（和改名同一条路）。
   */
  const moveToSection = async (item: ProjectItem, section: string) => {
    try {
      const target = await prepareItemMove(api, project.path, item.path, section);
      const moved = `${target.replace(/\.md$/i, "")}/${item.path.slice(item.path.lastIndexOf("/") + 1)}`;
      // 乐观地先搬过去：等文档树推回来要几十毫秒，那期间它还留在原来那张卡片上
      setOverview((current) => current ? {
        ...current,
        items: current.items.map((row) => row.path === item.path
          ? { ...row, path: moved, section, kind: sectionKind(section) }
          : row),
      } : current);
      onMove(item.path, target);
    } catch (error) {
      onError((error as Error).message);
    }
  };

  /** 两处记录列表（「正在推进」和分类卡片）共用同一套行为 */
  const rowProps = {
    onOpen,
    onMenu: (item: ProjectItem, slot: string, at: { x: number; y: number }) => setMenu({ item, slot, at }),
    onRename: submitRename,
    onRenameCancel: () => setRenaming(null),
    onStatus: (target: ProjectItem, value: string, custom: boolean) => void setStatus(target.path, value, custom),
    onDropStatus: (option: string) => void dropStatus(option),
  };
  const groups = sections.map((name) => ({
    name,
    kind: sectionKind(name),
    items: filteredItems.filter((item) => item.section === name),
  })).filter(({ items }) => !searching || items.length > 0);
  const progressPath = `${project.path.replace(/\.md$/i, "")}/${PROGRESS_SECTION}.md`;

  // 分类表的唯一真源在项目笔记的 frontmatter 里，先乐观更新，写失败再退回去。
  const writeSections = async (next: string[]) => {
    const before = sections;
    setSections(next);
    setPendingDelete(null);
    try {
      setSections(await setProjectSections(api, project.path, next));
      onChanged();
    } catch (error) {
      setSections(before);
      onError((error as Error).message);
    }
  };
  const moveSection = (name: string, to: number) => {
    const from = sections.indexOf(name);
    if (from < 0 || to < 0 || to >= sections.length || to === from) return;
    const next = [...sections];
    next.splice(to, 0, ...next.splice(from, 1));
    void writeSections(next);
  };

  /**
   * 指针落在这里时该插到第几个之前。**按「已经越过几张卡片」数**，而不是找
   * 指针正压着哪一张 —— 卡片高矮不一，指针完全可能停在两张之间的空档上。
   */
  const dropIndex = (x: number, y: number) => {
    const rects = sections.map((name) => cards.current.get(name)?.getBoundingClientRect());
    // 两列时前后关系主要看左右，一列（窄屏）时看上下。轴判错的话插入点会
    // 跟着另外半边屏幕跑，而这在截图里完全看不出来
    const columns = rects.some((rect, index) => index > 0 && rect && rects[index - 1] && Math.abs(rect.top - rects[index - 1]!.top) < 4);
    const passed = (rect: DOMRect) => columns
      ? y > rect.bottom || (y >= rect.top && x > rect.left + rect.width / 2)
      : y > rect.top + rect.height / 2;
    return rects.filter((rect) => rect && passed(rect)).length;
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, name: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const id = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== id) return;
      // 按下总会抖一两个像素。没越过阈值就还是一次点击，不该让卡片先动起来
      if (!active && Math.hypot(moved.clientX - origin.x, moved.clientY - origin.y) < 5) return;
      active = true;
      setDrag({ name, at: dropIndex(moved.clientX, moved.clientY) });
    };
    const finish = (ended: PointerEvent, commit: boolean) => {
      if (ended.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (!active || !commit) return;
      const at = dropIndex(ended.clientX, ended.clientY);
      const from = sections.indexOf(name);
      moveSection(name, at > from ? at - 1 : at);
    };
    const up = (ended: PointerEvent) => finish(ended, true);
    const cancel = (ended: PointerEvent) => finish(ended, false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };
  const addSection = () => {
    const name = draft.trim();
    const message = sectionNameError(name, sections);
    if (message) { setDraftError(message); return; }
    setDraft("");
    setDraftError(null);
    setAdding(false);
    void writeSections([...sections, name]);
  };
  // 落回原位是无操作，那时不画指示线 —— 一条什么都不会发生的线最容易骗人
  const dragFrom = drag ? sections.indexOf(drag.name) : -1;
  const dropMarker = drag && drag.at !== dragFrom && drag.at !== dragFrom + 1 ? drag.at : null;

  const stopManaging = () => {
    setManaging(false);
    setDrag(null);
    setPendingDelete(null);
    setAdding(false);
    setDraft("");
    setDraftError(null);
  };

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
            <div className="project-status"><span className="tone tone-dot" data-tone={statusTone(overview.status)} /><StatusSelect value={overview.status} options={optionsFor("project")} label="项目状态" onChange={(value, custom) => void setStatus(project.path, value, custom)} onDelete={(option) => void dropStatus(option)} /></div>
            <p className={overview.summary ? "" : "is-empty"}>{overview.summary || "还没有项目摘要"}</p>
            <div className="project-now-grid">
              <div><strong>接下来</strong><p className={overview.next ? "" : "is-empty"}>{overview.next || "还没有明确下一步"}</p></div>
              <div><strong>阻碍</strong><p className={overview.blocker ? "" : "is-empty"}>{overview.blocker || "暂无阻碍"}</p></div>
            </div>
          </section>

          <div className="project-dashboard-tools">
            <div className="project-dashboard-search">
              <Icon name="search" size={14} />
              <input
                value={query}
                onChange={(event) => { if (managing) stopManaging(); setQuery(event.target.value); }}
                placeholder="搜索记录与进展"
                aria-label="搜索项目记录与进展"
              />
              {query && <button type="button" aria-label="清空搜索" title="清空搜索" onPointerDown={(event) => event.preventDefault()} onClick={() => setQuery("")}><Icon name="close" size={12} /></button>}
            </div>
            {searching && <span className="project-search-count" aria-live="polite">{filteredItems.length} 条记录 · {filteredProgress.length} 条进展</span>}
          </div>

          <div className="project-columns">
            <section className="project-section">
              <div className="project-section-head"><h2>正在推进</h2><span>{active.length}</span></div>
              {visibleItems.length ? visibleItems.map((item) => (
                <ProjectItemRow key={item.path} item={item} options={optionsFor(item.kind)} slot="active" renaming={renaming?.slot === "active" && renaming.path === item.path} {...rowProps} />
              )) : <p className="project-empty">{searching ? "没有匹配的进行中记录。" : "还没有进行中的记录。"}</p>}
              {!searching && active.length > 3 && <button className="project-more" onClick={() => setExpandedItems((value) => !value)}>{expandedItems ? "收起" : `查看全部 ${active.length} 条`}</button>}
            </section>

            <section className="project-section">
              <div className="project-section-head"><h2>最近进展</h2><span>{filteredProgress.length}</span>{overview.progress.length > 0 && <button className="project-section-link" onClick={() => onOpen(progressPath)}>打开日志</button>}</div>
              {filteredProgress.slice(0, searching || expandedProgress ? undefined : 3).map((entry) => (
                <article className="project-progress" key={`${entry.at}-${entry.text}`}><time>{entry.at}</time><p>{entry.text}</p></article>
              ))}
              {!filteredProgress.length && <p className="project-empty">{searching ? "没有匹配的进展。" : "还没有进展记录。"}</p>}
              {!searching && overview.progress.length > 3 && <button className="project-more" onClick={() => setExpandedProgress((value) => !value)}>{expandedProgress ? "收起" : `查看全部 ${overview.progress.length} 条`}</button>}
            </section>
          </div>
          <section className="project-records">
            <div className="project-records-head">
              <h2>项目内容</h2>
              <button className="project-section-link" onClick={() => managing ? stopManaging() : setManaging(true)}>{managing ? "完成" : "管理分类"}</button>
            </div>
            <div className={`project-record-grid${drag ? " is-sorting" : ""}`}>
              {groups.map(({ name, kind, items }, index) => {
                const expanded = expandedSections.has(name);
                const marker = dropMarker === index ? " is-drop-before" : dropMarker === index + 1 && index === groups.length - 1 ? " is-drop-after" : "";
                return <section
                  className={`project-record-group${managing ? " is-managing" : ""}${drag?.name === name ? " is-dragging" : ""}${marker}`}
                  key={name}
                  ref={(element) => { if (element) cards.current.set(name, element); else cards.current.delete(name); }}
                >
                  <div className="project-section-head">
                    {managing && <button
                      className="project-section-grip"
                      aria-label={`调整${name}的顺序`}
                      title="拖动排序，也可以按上下方向键"
                      onPointerDown={(event) => startDrag(event, name)}
                      onKeyDown={(event) => {
                        const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
                        if (!delta) return;
                        event.preventDefault();
                        moveSection(name, index + delta);
                      }}
                    ><Icon name="grip" size={13} /></button>}
                    <h3>{name}</h3><span>{items.length}</span>
                    {managing && <span className="project-section-tools">
                      <button className="remove" aria-label={`删除分类${name}`} onClick={() => setPendingDelete(name)}><Icon name="trash" size={12} /></button>
                    </span>}
                  </div>
                  {pendingDelete === name
                    ? <div className="project-section-confirm">
                      <p>{items.length
                        ? `删除「${name}」？分类会从总览移除，文档不会删除。`
                        : `删除「${name}」？`}</p>
                      <div>
                        <button className="danger" onClick={() => void writeSections(sections.filter((item) => item !== name))}>删除</button>
                        <button onClick={() => setPendingDelete(null)}>取消</button>
                      </div>
                    </div>
                    : <>
                      {items.slice(0, searching || expanded ? undefined : 3).map((item) => <ProjectItemRow key={item.path} item={item} options={optionsFor(kind)} showKind={false} slot={name} renaming={renaming?.slot === name && renaming.path === item.path} {...rowProps} />)}
                      {!items.length && <p className="project-empty">还没有{name}记录。</p>}
                      {!searching && items.length > 3 && <button className="project-more" onClick={() => setExpandedSections((current) => {
                        const next = new Set(current);
                        if (expanded) next.delete(name); else next.add(name);
                        return next;
                      })}>{expanded ? "收起" : `查看全部 ${items.length} 条`}</button>}
                    </>}
                </section>;
              })}
              {managing && <section className="project-record-group is-add">
                {adding
                  ? <form className="project-section-add" onSubmit={(event) => { event.preventDefault(); addSection(); }}>
                    <input autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); setDraftError(null); }} placeholder="例如：复现、会议、待读" aria-label="新分类名" />
                    <div>
                      <button className="primary" disabled={!draft.trim()}>添加</button>
                      <button type="button" onClick={() => { setAdding(false); setDraft(""); setDraftError(null); }}>取消</button>
                    </div>
                    {draftError && <p className="project-section-error">{draftError}</p>}
                  </form>
                  : <button className="project-section-new" onClick={() => setAdding(true)}><Icon name="plus" size={12} />添加分类</button>}
              </section>}
            </div>
            {!groups.length && !managing && <p className="project-empty">{searching ? "项目内容中没有匹配记录。" : "还没有分类。"}</p>}
          </section>
        </div>
      ) : <div className="project-loading">正在整理项目…</div>}

      {menu && <ContextMenu
        at={menu.at}
        groups={[
          [{ label: "在新标签页打开", icon: "doc", run: () => onOpen(menu.item.path, { newTab: true }) }],
          [
            { label: menu.item.pinned ? "取消置顶" : "置顶", icon: "pin", run: () => void togglePin(menu.item) },
            // 只有一个分类时没有「别的分类」可去，那条就不该摆在那里点不动
            ...sections.some((name) => name !== menu.item.section) ? [{
              label: "移到",
              icon: "move" as const,
              run: () => {},
              items: sections.filter((name) => name !== menu.item.section).map((name) => ({
                label: name,
                icon: "doc" as const,
                run: () => void moveToSection(menu.item, name),
              })),
            }] : [],
          ],
          [{ label: "重命名", icon: "pencil", run: () => setRenaming({ slot: menu.slot, path: menu.item.path }) }],
          onDelete ? [{ label: "删除", icon: "trash", danger: true, run: () => onDelete(menu.item.path) }] : [],
        ]}
        onClose={() => setMenu(null)}
      />}

      {captureOpen && <CaptureDialog projectPath={project.path} sections={sections} onClose={() => setCaptureOpen(false)} onDone={(path, open) => { setCaptureOpen(false); reload(); onChanged(); if (open) onOpen(path); }} onError={onError} />}
      {snapshotOpen && overview && <SnapshotDialog path={project.path} value={overview} onClose={() => setSnapshotOpen(false)} onDone={() => { setSnapshotOpen(false); reload(); onChanged(); }} onError={onError} />}
    </section>
  );
}

function CaptureDialog({ projectPath, sections, onClose, onDone, onError }: { projectPath: string; sections: string[]; onClose: () => void; onDone: (path: string, open: boolean) => void; onError: (message: string) => void }) {
  // null = 进展。进展是快速记录，其余每一类都通往完整编辑器（§2.10）
  const [section, setSection] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const kind = section ? sectionKind(section) : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const path = await captureProjectEntry(api, projectPath, { section, title, content, useTemplate });
      onDone(path, section !== null);
    }
    catch (error) { onError((error as Error).message); setBusy(false); }
  };
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="project-dialog" onSubmit={(event) => void submit(event)}>
      <header><div><h2>{section === null ? "记录一条进展" : `新建${section}文档`}</h2></div><button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="project-dialog-body">
        <div className="project-kind-tabs">
          <button type="button" className={section === null ? "is-on" : ""} onClick={() => setSection(null)}>{PROGRESS_SECTION}</button>
          {sections.map((value) => <button type="button" className={section === value ? "is-on" : ""} key={value} onClick={() => setSection(value)}>{value}</button>)}
        </div>
        {section !== null && <label>标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`例如：${kind ? TITLE_HINT[kind] : `一条${section}记录`}`} /></label>}
        <label>{section === null ? "刚刚发生了什么" : "一句摘要（可选）"}<textarea autoFocus={section === null} value={content} onChange={(event) => setContent(event.target.value)} rows={section === null ? 6 : 3} placeholder={section === null ? "写下刚发生的事" : "写一句摘要"} /></label>
        {kind && <label className="project-template-choice"><input type="checkbox" checked={useTemplate} onChange={(event) => setUseTemplate(event.target.checked)} /><span><strong>使用建议结构</strong><small>按类型插入可编辑的 Markdown 标题。</small></span></label>}
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy || (section === null ? !content.trim() : !title.trim())}>{busy ? "创建中…" : section === null ? "保存进展" : "创建并开始记录"}</button></footer>
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
      <header><div><h2>更新当前状态</h2></div><button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="project-dialog-body">
        <label>当前结论<textarea autoFocus value={form.summary} onChange={(event) => field("summary", event.target.value)} rows={3} /></label>
        <label>接下来<textarea value={form.next} onChange={(event) => field("next", event.target.value)} rows={3} placeholder="最多三件事" /></label>
        <label>阻碍<textarea value={form.blocker} onChange={(event) => field("blocker", event.target.value)} rows={2} /></label>
      </div>
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? "保存中…" : "保存状态"}</button></footer>
    </form>
  </div>;
}
