import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";

import { api } from "../host/api";
import {
  captureProjectEntry,
  ensureProjectStatusSchema,
  loadProjectOverview,
  PROGRESS_SECTION,
  PROJECT_STATUS_DEFAULTS,
  projectSections,
  projectStatusOptions,
  removeProjectStatus,
  SECTION_STATUS_FALLBACK,
  sectionKind,
  sectionNameError,
  setProjectSections,
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
  onChanged: () => void;
  onError: (message: string) => void;
}

const CLOSED = /^(已完成|完成|已关闭|关闭|已解决|已归档)$/;
/** 「决策」「资料」是归档型，默认状态本来就不是推进态，不进「正在推进」。 */
const ARCHIVAL = new Set<ProjectItemKind>(["decision", "resource"]);
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
          <p>删掉「{option}」？用着它的记录一个字都不改。</p>
          <div>
            <button type="button" className="danger" onClick={() => { setDropping(null); onDelete(option); }}>删除</button>
            <button type="button" onClick={() => setDropping(null)}>取消</button>
          </div>
        </div>
        : <div className="project-status-option" key={option}>
          <button
            type="button"
            role="option"
            aria-selected={option === value}
            className={option === value ? "is-selected" : ""}
            onClick={() => { setOpen(false); if (option !== value) onChange(option, false); }}
          ><span><i className="tone tone-dot" data-tone={statusTone(option)} />{option}</span>{option === value && <Icon name="check" size={12} />}</button>
          {/* 正在用的那个不给删：删了它还得留在菜单里（这一条仍写着它），
              看着像没删掉。先换成别的，再回来删 */}
          {option !== value && <button
            type="button"
            className="project-status-drop"
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
          ? <>算作<strong className="tone" data-tone={statusTone(custom)}>{STATUS_TONE_LABEL[statusTone(custom)]}</strong>，用这一档的颜色</>
          : <>颜色按词形分档：「…中」算推进，「待…」算没开始</>}
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
  const fallback = item.kind ? PROJECT_STATUS_DEFAULTS[item.kind][0] : SECTION_STATUS_FALLBACK[0];
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
        <span className="project-item-copy"><strong>{item.title}</strong><small>{item.summary || "暂无摘要"}</small></span>
      </button>}
    {showKind && <span className="project-kind">{item.section}</span>}
    <StatusSelect value={item.status || fallback} options={options} label={`${item.title}的状态`} onChange={(value, custom) => onStatus(item, value, custom)} onDelete={onDropStatus} />
  </div>;
}

export function ProjectDashboard({ project, notes, revision, onOpen, onEdit, onRename, onChanged, onError }: Props) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  /** 右键/长按弹出来的那条记录 */
  const [menu, setMenu] = useState<{ item: ProjectItem; slot: string; at: { x: number; y: number } } | null>(null);
  const [renaming, setRenaming] = useState<{ slot: string; path: string } | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState(false);
  const [expandedProgress, setExpandedProgress] = useState(false);
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

  const reload = () => {
    void loadProjectOverview(api, project, notes).then(setOverview).catch((error) => onError((error as Error).message));
  };
  useEffect(reload, [project, notes, revision]);
  useEffect(() => {
    void ensureProjectStatusSchema(api)
      .then(setCustomStatuses)
      .catch(() => {});
  }, [project, revision]);

  const active = useMemo(
    () => overview?.items.filter((item) => !(item.kind && ARCHIVAL.has(item.kind)) && !CLOSED.test(item.status)) ?? [],
    [overview],
  );
  const visibleItems = expandedItems ? active : active.slice(0, 3);
  const optionsFor = (kind: ProjectItem["kind"] | "project") =>
    kind ? projectStatusOptions(kind, customStatuses) : unique([...SECTION_STATUS_FALLBACK, ...customStatuses]);
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
    items: overview?.items.filter((item) => item.section === name) ?? [],
  }));
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
                <ProjectItemRow key={item.path} item={item} options={optionsFor(item.kind)} slot="active" renaming={renaming?.slot === "active" && renaming.path === item.path} {...rowProps} />
              )) : <p className="project-empty">还没有进行中的记录。</p>}
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
            <div className="project-records-head">
              <div><h2>项目内容</h2><p>每一类记录都可以直接进入完整文档；分类由这个项目自己决定。</p></div>
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
                        ? `删除「${name}」？这一类不再出现在总览里，${items.length} 篇文档仍留在文档树，把分类加回来就能找回。`
                        : `删除「${name}」？之后随时可以加回来。`}</p>
                      <div>
                        <button className="danger" onClick={() => void writeSections(sections.filter((item) => item !== name))}>删除</button>
                        <button onClick={() => setPendingDelete(null)}>取消</button>
                      </div>
                    </div>
                    : <>
                      {items.slice(0, expanded ? undefined : 3).map((item) => <ProjectItemRow key={item.path} item={item} options={optionsFor(kind)} showKind={false} slot={name} renaming={renaming?.slot === name && renaming.path === item.path} {...rowProps} />)}
                      {!items.length && <p className="project-empty">还没有{name}记录。</p>}
                      {items.length > 3 && <button className="project-more" onClick={() => setExpandedSections((current) => {
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
            {!groups.length && !managing && <p className="project-empty">还没有分类。点「管理分类」加一个，比如实验、问题或资料。</p>}
          </section>
        </div>
      ) : <div className="project-loading">正在整理项目…</div>}

      {menu && <ContextMenu
        at={menu.at}
        groups={[
          [{ label: "在新标签页打开", icon: "doc", run: () => onOpen(menu.item.path, { newTab: true }) }],
          [{ label: "重命名", icon: "pencil", run: () => setRenaming({ slot: menu.slot, path: menu.item.path }) }],
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
      <header><div><h2>{section === null ? "记录一条进展" : `新建${section}文档`}</h2><p>{section === null ? "一句话记下刚刚发生的事。" : "创建后进入完整编辑器，可写公式、图片、代码和表格。"}</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="project-dialog-body">
        <div className="project-kind-tabs">
          <button type="button" className={section === null ? "is-on" : ""} onClick={() => setSection(null)}>{PROGRESS_SECTION}</button>
          {sections.map((value) => <button type="button" className={section === value ? "is-on" : ""} key={value} onClick={() => setSection(value)}>{value}</button>)}
        </div>
        {section !== null && <label>标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`例如：${kind ? TITLE_HINT[kind] : `一条${section}记录`}`} /></label>}
        <label>{section === null ? "刚刚发生了什么" : "一句摘要（可选）"}<textarea autoFocus={section === null} value={content} onChange={(event) => setContent(event.target.value)} rows={section === null ? 6 : 3} placeholder={section === null ? "一句话也可以，之后随时补充" : "这句话会显示在项目总览；详细内容进入文档后再写"} /></label>
        {kind && <label className="project-template-choice"><input type="checkbox" checked={useTemplate} onChange={(event) => setUseTemplate(event.target.checked)} /><span><strong>使用建议结构</strong><small>可选。按记录类型加入几个 Markdown 标题，进入文档后可任意删改。</small></span></label>}
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
