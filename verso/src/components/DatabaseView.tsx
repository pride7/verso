import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api";
import { CalendarView, canMoveDates, GalleryView, ListView } from "./DbViews";
import { Icon } from "./Icon";
import {
  ColumnPicker,
  OptionPicker,
  OptionsEditor,
  propIcon,
  TYPES,
  ViewSettings,
} from "./ViewSettings";
import {
  formatDate,
  isBuiltin,
  newNoteParent,
  nextSort,
  readColumns,
  readKey,
  readSort,
  toDateInput,
  writeColumns,
  writeSort,
} from "../lib/viewSpec";
import type { PropDef, PropSchema, ViewResult, ViewRow } from "../types";

interface Props {
  /** `verso-view` 代码块里的原文（YAML） */
  source: string;
  onOpen: (path: string) => void;
  /** 属性被改写后通知外层重查 */
  onChanged: () => void;
  revision: number;
  /** 画廊的封面要把 vault 相对路径解析成能给 `<img>` 的 URL */
  imageSrc?: (target: string) => string | null;
  /**
   * 把改过的 YAML 写回代码块。排序这些**是用户内容不是界面状态**：
   * 它写在笔记里，跟着 `.md` 走，换个编辑器打开也还在（§0 第 1 条）。
   */
  onPatch?: (yaml: string) => void;
}

/**
 * database 视图 —— DESIGN.md §2.6。
 *
 * 「不引入新的存储形态，全部建立在 frontmatter 之上。」数据来源是索引里的
 * `props` 表，而 `props` 是 frontmatter 摊平的结果。改一个单元格就是改
 * 对应笔记的 frontmatter，文件立刻落盘 —— 设计文档说这是「它好不好用的
 * 分水岭：只能看不能改的表格，价值和一个静态列表差不多」。
 */
/** 列头菜单开在哪一列上。面板有好几种，这里把类型收窄一下 */
type Panel = null | "settings" | "columns" | { col: string } | { options: string };
const colMenu = (p: Panel) => (p && typeof p === "object" && "col" in p ? p.col : null);

export function DatabaseView({
  source,
  onOpen,
  onChanged,
  revision,
  onPatch,
  imageSrc,
}: Props) {
  const [result, setResult] = useState<ViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");
  /** 开着哪个浮层：设置 / 加一列 / 某个列头的菜单 */
  const [panel, setPanel] = useState<Panel>(null);
  /** 用户指定的类型和选项（`.verso-props.json`）。读不到就退回按值推断 */
  const [schema, setSchema] = useState<PropSchema>({});
  /** 正在拖的那张卡片，以及鼠标停在哪一列上 */
  const [dragging, setDragging] = useState<string | null>(null);
  /** 同一份信息再放一个 ref：`drop` 和 `dragstart` 之间可能没有重渲染，
      只读 state 的话拿到的还是 null（拖了等于没拖） */
  const draggingRef = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .viewQuery(source)
      .then((r) => {
        setResult(r);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [source]);

  useEffect(load, [load, revision]);

  // 用 try 包住而不是 .catch：命令不存在时是**同步抛**的，那会让整个视图
  // 白屏 —— schema 只是 UI 提示，缺了该退化成按值推断，不该拖垮表格
  useEffect(() => {
    void (async () => {
      try {
        setSchema(await api.propSchema());
      } catch {
        setSchema({});
      }
    })();
  }, [revision]);

  // 点别处关掉浮层。浮层自己 stopPropagation，所以点里面不会关 ——
  // 少了这一条，开过设置面板之后它会一直挂在那儿挡住表格
  useEffect(() => {
    if (!panel) return;
    const close = () => setPanel(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [panel]);

  const sort = readSort(source);

  /**
   * 隐藏一列 = 把它从 `columns:` 里去掉，**不动任何笔记的 frontmatter**。
   *
   * 这一条要说死：表格里「删除列」在 Notion 里是删属性（会改所有条目），
   * 在这里只是不显示。真要删属性，去那篇笔记的属性条上删 —— 一次误点就
   * 抹掉整个 vault 的某个字段，这种事不能藏在一个下拉菜单里。
   */
  const hideColumn = (col: string) => {
    if (!result) return;
    onPatch?.(writeColumns(source, (readColumns(source) ?? result.columns).filter((c) => c !== col)));
    setPanel(null);
  };

  /** 点表头：升 → 降 → 恢复默认。改的是代码块，不是一个 React state */
  const toggleSort = (col: string) => onPatch?.(writeSort(source, nextSort(sort, col)));

  /**
   * 加一行 = 新建一篇笔记。§2.6：「加一行 → 新建一篇笔记并写入对应属性」。
   *
   * 建在 `from:` 指的那个范围里，否则建完它不在表里，等于什么都没发生。
   */
  const addRow = async (preset?: { key: string; value: string }) => {
    const title = window.prompt("新建笔记", "未命名");
    if (!title) return;
    try {
      const meta = await api.createNote(newNoteParent(source), title);
      // 在看板某一列里新建：那一列的值直接写上，否则它建完会掉进「未设置」
      if (preset) await api.propSet(meta.path, preset.key, preset.value);
      onChanged();
      load();
      onOpen(meta.path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** 写一个格子。空值 = 删掉这个属性，不是写一个空字符串 */
  const commitValue = async (path: string, key: string, value: string) => {
    try {
      await api.propSet(path, key, value.trim() === "" ? null : value);
      onChanged();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const commit = async () => {
    if (!editing) return;
    const { path, key } = editing;
    setEditing(null);
    await commitValue(path, key, draft);
  };

  if (error) {
    return (
      <div className="dbview dbview-error">
        <strong>视图出错</strong>
        <div>{error}</div>
      </div>
    );
  }
  if (!result) return <div className="dbview dbview-loading">查询中…</div>;

  /** schema 里写死的类型优先；没写就用索引按值推断的那个 */
  const typeOf = (key: string) =>
    schema[key]?.type ?? result.properties?.find((p) => p.key === key)?.type ?? "string";

  const define = async (key: string, def: PropDef | null) => {
    try {
      await api.propDefSet(key, def);
      setSchema(await api.propSchema());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * 重命名一列 = 改**所有**带这个键的笔记。
   *
   * 属性是 vault 级的概念（类型也存在 vault 根），只改「这个视图收到的那些」
   * 会留下两个同义的键，比不改还乱。真在动用户的文件，所以改之前先数一遍
   * 并问一句 —— Notion 点一下就悄悄改掉几百个文件，这里不学。
   */
  const renameColumn = async (col: string) => {
    setPanel(null);
    const next = window.prompt(`把属性「${col}」改成什么？`, col)?.trim();
    if (!next || next === col) return;
    try {
      const n = await api.propCount(col);
      if (n > 0 && !window.confirm(`这会修改 ${n} 篇笔记的 frontmatter，继续？`)) return;
      await api.propRenameAll(col, next);
      // 视图里点名的列也要跟着改，否则这一列会变成空的
      if (onPatch) {
        const cols = readColumns(source) ?? result.columns;
        onPatch(writeColumns(source, cols.map((c) => (c === col ? next : c))));
      }
      onChanged();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cell = (row: ViewRow, col: string) => {
    const value = row.props[col] ?? "";
    const isEditing = editing?.path === row.path && editing.key === col;

    // 标题列是笔记本身，点它应当跳转而不是编辑
    if (col === "title") {
      return (
        <button className="dbview-link" onClick={() => onOpen(row.path)}>
          {/* 一行就是一篇笔记 —— 前面那个图标是在说这件事，不是装饰 */}
          <Icon name="doc" size={14} className="dbview-rowicon" />
          <span>{row.title}</span>
        </button>
      );
    }
    const type = typeOf(col);
    const options = schema[col]?.options ?? [];

    // 文件本身的创建/更新时间。它们不在 frontmatter 里（§2.3 起 Verso 不往
    // 笔记里写这两个字段了），所以**只读** —— 摆一个改不动的输入框比不给
    // 输入框更让人困惑
    if (isBuiltin(col)) {
      return (
        <span className="dbview-cell dbview-ro" title={value || undefined}>
          {value ? formatDate(value) : <span className="dbview-empty">—</span>}
        </span>
      );
    }

    // 复选框不进「编辑态」—— 点一下就是改，再要求回车太绕
    if (type === "checkbox") {
      const on = value === "true" || value === "是";
      return (
        <button
          className={`dbview-cell dbview-check${on ? " is-on" : ""}`}
          onClick={() => void commitValue(row.path, col, on ? "false" : "true")}
          role="checkbox"
          aria-checked={on}
          title={on ? "点一下取消" : "点一下勾上"}
        >
          <span className="dbview-box">{on && <Icon name="check" size={11} />}</span>
        </button>
      );
    }

    if (isEditing) {
      // 单选 / 多选都走同一个选择器 —— 它能就地新建选项，那正是填值那一刻
      // 才知道自己需要哪个选项的地方
      if (type === "select" || type === "multi") {
        return (
          <OptionPicker
            value={value}
            options={options}
            multi={type === "multi"}
            onSet={(v) => void commitValue(row.path, col, v)}
            onCreateOption={(o) =>
              void define(col, { type, options: [...options, o] })
            }
            onClose={() => setEditing(null)}
          />
        );
      }

      return (
        <input
          className="dbview-input"
          type={type === "date" ? "date" : type === "number" ? "number" : "text"}
          autoFocus
          value={type === "date" ? toDateInput(draft) : draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(null);
            }
          }}
        />
      );
    }

    // 网址显示成能点的链接。点它跳转，改它走右边那个小铅笔 ——
    // 一个既是链接又是编辑入口的东西，两件事都做不利索
    if (type === "url" && value) {
      return (
        <span className="dbview-cell dbview-url">
          <a href={value} target="_blank" rel="noreferrer">
            {value}
          </a>
          <button
            className="dbview-edit"
            onClick={() => {
              setEditing({ path: row.path, key: col });
              setDraft(value);
            }}
            aria-label="编辑"
            title="编辑"
          >
            ✎
          </button>
        </span>
      );
    }

    return (
      <button
        className={`dbview-cell${type === "select" && value ? " dbview-tagcell" : ""}`}
        onClick={() => {
          setEditing({ path: row.path, key: col });
          setDraft(value);
        }}
        title="点击编辑，改动会写回这篇笔记的 frontmatter"
      >
        {value ? (
          type === "select" ? (
            <span className="dbview-tag">{value}</span>
          ) : type === "multi" ? (
            value
              .split(/[、,]/)
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => (
                <span className="dbview-tag" key={x}>
                  {x}
                </span>
              ))
          ) : type === "date" ? (
            <span title={value}>{formatDate(value)}</span>
          ) : (
            value
          )
        ) : (
          <span className="dbview-empty">—</span>
        )}
      </button>
    );
  };

  if (result.view === "board" && result.groupBy) {
    const by = result.groupBy;
    const UNSET = "（未设置）";
    // 列的顺序：schema 里声明过选项就照那个顺序 —— 「未读/在读/已读」是有
    // 先后的，按出现次序排会让看板每次刷新都换个样子
    const declared = schema[by]?.options ?? [];
    const groups = new Map<string, ViewRow[]>();
    for (const o of declared) groups.set(o, []);
    for (const r of result.rows) {
      const g = r.props[by] || UNSET;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }

    /** 卡片上显示哪些属性：除了分组那一列（整列都一样，写出来是废话） */
    const cardCols = result.columns.filter((c) => c !== "title" && c !== by);

    const drop = async (to: string) => {
      const path = draggingRef.current;
      draggingRef.current = null;
      setDragging(null);
      setOver(null);
      if (!path) return;
      const row = result.rows.find((r) => r.path === path);
      if (!row || (row.props[by] || UNSET) === to) return;
      // 拖到另一列 = 改那篇笔记的这个属性。看板不是另一份数据，
      // 它就是 frontmatter 的一种画法（§2.6）
      await commitValue(path, by, to === UNSET ? "" : to);
    };

    return (
      <div className="dbview">
        <div className="dbview-bar">
          <span className="dbview-kind">
            <Icon name="table" size={14} />
            看板 · {by}
          </span>
          {onPatch && (
            <>
              <button
                className="dbview-tool"
                onClick={() => setPanel(panel === "settings" ? null : "settings")}
                title="视图设置"
                aria-label="视图设置"
              >
                <Icon name="settings" size={14} />
              </button>
              <button className="dbview-new" onClick={() => void addRow()}>
                新建
              </button>
            </>
          )}
          {panel === "settings" && onPatch && (
            <ViewSettings
              source={source}
              properties={result.properties ?? []}
              onPatch={(y) => onPatch(y)}
              onClose={() => setPanel(null)}
            />
          )}
        </div>

        <div className="dbview-board">
          {[...groups].map(([name, rows]) => (
            <section
              className={`dbview-col${over === name ? " is-over" : ""}`}
              key={name}
              onDragOver={(e) => {
                // 不 preventDefault 就收不到 drop —— HTML5 拖放的老坑
                e.preventDefault();
                setOver(name);
              }}
              onDragLeave={() => setOver((o) => (o === name ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                void drop(name);
              }}
            >
              <header className="dbview-col-head">
                <span className="dbview-tag">{name}</span>
                <span className="dbview-count">{rows.length}</span>
              </header>

              {rows.map((r) => (
                <article
                  key={r.path}
                  className={`dbview-card${dragging === r.path ? " is-dragging" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    draggingRef.current = r.path;
                    setDragging(r.path);
                    e.dataTransfer.effectAllowed = "move";
                    // 必须塞点东西，否则某些平台上根本不认这是一次拖拽
                    e.dataTransfer.setData("text/plain", r.path);
                  }}
                  onDragEnd={() => {
                    draggingRef.current = null;
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <button className="dbview-card-title" onClick={() => onOpen(r.path)}>
                    {r.title}
                  </button>
                  {cardCols.length > 0 && (
                    <dl className="dbview-card-props">
                      {cardCols.map((c) =>
                        r.props[c] ? (
                          <div key={c}>
                            <dt>{c}</dt>
                            <dd>{typeOf(c) === "date" ? formatDate(r.props[c]) : r.props[c]}</dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  )}
                </article>
              ))}

              {onPatch && (
                <button
                  className="dbview-col-add"
                  onClick={() => void addRow(name === UNSET ? undefined : { key: by, value: name })}
                  title={`在「${name}」里新建一篇`}
                >
                  <Icon name="plus" size={12} /> 新建
                </button>
              )}
            </section>
          ))}
        </div>
        <div className="dbview-foot">{result.rows.length} 条</div>
      </div>
    );
  }

  // ---- 只读的三种：列表 / 画廊 / 日历 ----
  //
  // 它们共用一条工具栏，但**没有**「加一列」和列头菜单 —— 那两样是表格
  // 特有的操作，摆在这里点开也无处施展
  if (result.view === "list" || result.view === "gallery" || result.view === "calendar") {
    const dateField = readKey(source, "date-field") || "created";
    const cover = readKey(source, "cover");
    // 卡片上不再重复标题，也不显示被视图自己用掉的那两个键
    // （封面已经画成图了，日期已经是它所在的格子）
    const cardCols = result.columns.filter(
      (c) => c !== "title" && c !== cover && !(result.view === "calendar" && c === dateField),
    );
    const KIND = {
      list: { icon: "list", label: "列表" },
      gallery: { icon: "gallery", label: "画廊" },
      calendar: { icon: "calendar", label: "日历" },
    } as const;
    const kind = KIND[result.view as keyof typeof KIND];

    return (
      // 这三种一律铺满正文栏。`.dbview` 默认是 `width: max-content`（表格按
      // 内容宽，用不着的地方不占位），但那对它们全是错的：画廊会塌成一列
      // 148px 的窄条，日历会被里面最长的标题撑成一个奇怪的宽度。
      // 它们是「一片区域」而不是「一张表」
      <div className="dbview is-full">
        <div className="dbview-bar">
          <span className="dbview-kind">
            <Icon name={kind.icon} size={14} />
            {kind.label}
          </span>
          {onPatch && (
            <>
              <button
                className="dbview-tool"
                onClick={() => setPanel(panel === "settings" ? null : "settings")}
                title="视图设置"
                aria-label="视图设置"
              >
                <Icon name="settings" size={14} />
              </button>
              <button className="dbview-new" onClick={() => void addRow()}>
                新建
              </button>
            </>
          )}
          {panel === "settings" && onPatch && (
            <ViewSettings
              source={source}
              properties={result.properties ?? []}
              onPatch={(y) => onPatch(y)}
              onClose={() => setPanel(null)}
            />
          )}
        </div>

        {result.rows.length === 0 ? (
          <p className="dbview-none">没有匹配的笔记</p>
        ) : result.view === "list" ? (
          <ListView rows={result.rows} cols={cardCols} typeOf={typeOf} onOpen={onOpen} />
        ) : result.view === "gallery" ? (
          <GalleryView
            rows={result.rows}
            cols={cardCols}
            typeOf={typeOf}
            onOpen={onOpen}
            cover={cover}
            imageSrc={imageSrc ?? (() => null)}
          />
        ) : (
          <CalendarView
            rows={result.rows}
            onOpen={onOpen}
            dateField={dateField}
            // 内置的 created/updated 是文件自己的时间，拖了也写不回去 ——
            // 干脆不给拖，而不是拖完弹一个错
            onSetDate={
              canMoveDates(dateField)
                ? (path, ymd) => void commitValue(path, dateField, ymd)
                : undefined
            }
          />
        )}

        <div className="dbview-foot">{result.rows.length} 条</div>
      </div>
    );
  }

  const full = readKey(source, "width") === "full";

  return (
    <div className={`dbview${full ? " is-full" : ""}`}>
      <div className="dbview-bar">
        <span className="dbview-kind">
          <Icon name="table" size={14} />
          表格
        </span>
        {onPatch && (
          <>
            <button
              className="dbview-tool"
              onClick={() => setPanel(panel === "settings" ? null : "settings")}
              title="视图设置"
              aria-label="视图设置"
            >
              <Icon name="settings" size={14} />
            </button>
            <button className="dbview-new" onClick={() => void addRow()}>
              新建
            </button>
          </>
        )}
        {panel === "settings" && onPatch && (
          <ViewSettings
            source={source}
            properties={result.properties ?? []}
            onPatch={(y) => onPatch(y)}
            onClose={() => setPanel(null)}
          />
        )}
        {panel && typeof panel === "object" && "options" in panel && (
          <OptionsEditor
            column={panel.options}
            def={schema[panel.options]}
            onDefine={(k, d) => void define(k, d)}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "columns" && onPatch && (
          <ColumnPicker
            source={source}
            shown={result.columns}
            properties={result.properties ?? []}
            onPatch={(y) => onPatch(y)}
            onDefine={(k, d) => void define(k, d)}
            onClose={() => setPanel(null)}
          />
        )}
      </div>
      <div className="dbview-scroll">
        <table className="dbview-table">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} className={sort?.key === c ? "is-sorted" : undefined}>
                {onPatch ? (
                  <span className="dbview-thwrap">
                    <button className="dbview-th" onClick={() => toggleSort(c)} title="点击排序">
                      <Icon name={c === "title" ? "doc" : isBuiltin(c) ? "clock" : propIcon(typeOf(c))} size={13} />
                      {c}
                      {/* 箭头只在这一列真的在排序时出现 —— 每列都挂一个灰箭头
                          会把表头变成一排噪点 */}
                      {sort?.key === c && (
                        <span className="dbview-arrow">{sort.dir === "desc" ? "↓" : "↑"}</span>
                      )}
                    </button>
                    <button
                      className="dbview-more"
                      onClick={() =>
                        setPanel(colMenu(panel) === c ? null : { col: c })
                      }
                      title="这一列"
                      aria-label={`${c} 这一列`}
                    >
                      ⋮
                    </button>
                    {colMenu(panel) === c && (
                      <ul className="dbview-menu" onMouseDown={(e) => e.stopPropagation()}>
                        <li>
                          <button onClick={() => { onPatch(writeSort(source, { key: c, dir: "asc" })); setPanel(null); }}>
                            升序
                          </button>
                        </li>
                        <li>
                          <button onClick={() => { onPatch(writeSort(source, { key: c, dir: "desc" })); setPanel(null); }}>
                            降序
                          </button>
                        </li>
                        {!isBuiltin(c) && (
                          <li>
                            <button onClick={() => renameColumn(c)}>重命名…</button>
                          </li>
                        )}
                        {!isBuiltin(c) &&
                          (schema[c]?.type === "select" || schema[c]?.type === "multi") && (
                          <li>
                              <button onClick={() => setPanel({ options: c })}>选项…</button>
                            </li>
                          )}
                        {!isBuiltin(c) && (
                        <li className="dbview-menu-sub">
                          <span>类型</span>
                          <span className="dbview-types">
                            {TYPES.map((t) => (
                              <button
                                key={t.id}
                                className={schema[c]?.type === t.id ? "is-on" : undefined}
                                title={t.label}
                                aria-label={t.label}
                                onClick={() => {
                                  void define(c, { type: t.id, options: schema[c]?.options });
                                  setPanel(null);
                                }}
                              >
                                <Icon name={t.icon} size={13} />
                              </button>
                            ))}
                          </span>
                        </li>
                        )}
                        <li>
                          <button onClick={() => hideColumn(c)}>隐藏这一列</button>
                        </li>
                      </ul>
                    )}
                  </span>
                ) : (
                  c
                )}
              </th>
            ))}
            {onPatch && (
              <th className="dbview-plus">
                <button
                  onClick={() => setPanel(panel === "columns" ? null : "columns")}
                  title="加一列"
                  aria-label="加一列"
                >
                  <Icon name="plus" size={13} />
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.path}>
              {result.columns.map((c) => (
                <td key={c}>{cell(r, c)}</td>
              ))}
              {onPatch && <td />}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      {onPatch && (
        <button className="dbview-add" onClick={() => void addRow()} title="新建一篇笔记并加进这个视图">
          <Icon name="plus" size={13} />
          添加条目
        </button>
      )}
      <div className="dbview-foot">
        {result.rows.length === 0 ? "没有匹配的笔记" : `${result.rows.length} 条`}
      </div>
    </div>
  );
}
