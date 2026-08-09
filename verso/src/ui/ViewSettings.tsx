import { useEffect, useState } from "react";

import { Icon, type IconName } from "./Icon";
import {
  isBuiltin,
  BUILTIN_COLUMNS,
  OPS,
  readColumns,
  readKey,
  readSourceScope,
  describeRelative,
  readWhere,
  sourceWithScope,
  writeColumns,
  writeKey,
  writeWhere,
  type Condition,
} from "../core/viewSpec";
import { propLabel } from "../core/propLabel";
import type { PropDef, PropMeta, PropType } from "../core/types";

interface Props {
  /** 代码块里的 YAML 原文 */
  source: string;
  /** 这批笔记身上有哪些属性，筛选和加列都从这里挑 */
  properties: PropMeta[];
  onPatch: (yaml: string) => void;
  onClose: () => void;
}

const VIEWS: { id: string; label: string }[] = [
  { id: "table", label: "表格" },
  { id: "board", label: "看板" },
  { id: "list", label: "列表" },
  { id: "gallery", label: "画廊" },
  { id: "calendar", label: "日历" },
];

const OP_LABELS: Record<(typeof OPS)[number], string> = {
  "=": "等于",
  "!=": "不等于",
  ">": "大于",
  ">=": "大于等于",
  "<": "小于",
  "<=": "小于等于",
  contains: "包含",
};

/**
 * 视图设置。DESIGN.md §2.6
 *
 * 面板里改的每一项都**写回代码块**，不是界面状态 —— 视图定义就写在笔记里
 * （§0 第 1 条）。所以这个面板本质上是「那段 YAML 的一个表单」。
 *
 * 手写的筛选表达式**不接管**：`readWhere` 看不懂时（用了 `or`、括号这些
 * Rust 侧不支持的写法）就只显示原文并让人去代码块里改。在界面上把它
 * 规范化成一个语义不同的东西，比不做还糟。
 */
export function ViewSettings({ source, properties, onPatch, onClose }: Props) {
  const view = readKey(source, "view") ?? "table";
  const from = readKey(source, "from") ?? "";
  const limit = readKey(source, "limit") ?? "";
  const where = readWhere(source);
  const [draftFrom, setDraftFrom] = useState(from);
  const sourceScope = readSourceScope(from);
  /**
   * 内置的两个时间列现在也能筛（v0.7.37）。它们不在 props 表里，Rust 侧单独
   * 接了一条 —— 而「长期未更新」正是知识库最需要、以前无法实现的那张清单
   * （§2.6）。
   */
  const filterableProperties = [
    ...properties.filter((property) => !isBuiltin(property.key)),
    ...BUILTIN_COLUMNS.map((key) => ({ key })),
  ];

  useEffect(() => setDraftFrom(from), [from]);

  const patchWhere = (conds: Condition[]) => onPatch(writeWhere(source, conds));

  /**
   * 切视图类型。**切到看板时顺手补上分组** —— 没有那个键的看板画不出来，
   * 而在此之前它是默默退回一张表的：人点了「看板」，界面纹丝不动，
   * 只会认为这个功能坏了。
   *
   * 挑第一个**离散值**的属性：数字和日期基本上每篇一个值，拿来分列会得到
   * 一列一篇；内置的创建/更新时间同理。实在没有别的就退回第一个非内置属性。
   * 挑得不对也没关系 —— 下面「分组」那一行就摆在这儿，一眼看得见、随手能换。
   */
  const patchView = (id: string) => {
    const next = writeKey(source, "view", id);
    if (id !== "board" || readKey(source, "group-by")) return next;
    const usable = properties.filter((p) => !isBuiltin(p.key));
    const pick = (usable.find((p) => p.type !== "number" && p.type !== "date") ?? usable[0])?.key;
    return pick ? writeKey(next, "group-by", pick) : next;
  };
  const patchScope = (scope: "direct" | "recursive") => {
    const next = sourceWithScope(from, scope);
    if (!next) return;
    setDraftFrom(next);
    onPatch(writeKey(source, "from", `"${next}"`));
  };

  return (
    <div className="vset" onMouseDown={(e) => e.stopPropagation()}>
      <div className="vset-head">
        <span>视图设置</span>
        <button className="vset-x" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={13} />
        </button>
      </div>

      <label className="vset-row">
        <span className="vset-label">类型</span>
        <span className="vset-seg">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={v.id === view ? "is-on" : undefined}
              onClick={() => onPatch(patchView(v.id))}
            >
              {v.label}
            </button>
          ))}
        </span>
      </label>

      {/* 每种视图各自还差一个键才能工作：看板要分组、日历要日期、画廊要封面。
          以前这三个只能手写进代码块，选了「看板」却看不到任何提示，
          表现是「切过去还是那张表」—— 缺的键就该在切换它的地方问 */}
      {view === "board" && (
        <PropRow
          label="分组"
          k="group-by"
          hint="按哪个属性分列。单选类型的属性最合适"
          source={source}
          properties={properties}
          onPatch={onPatch}
        />
      )}
      {view === "calendar" && (
        <PropRow
          label="日期"
          k="date-field"
          hint="按哪个日期属性摆。不设就用文件的创建时间"
          fallback="created"
          extra={["created", "updated"]}
          source={source}
          properties={properties}
          onPatch={onPatch}
        />
      )}
      {view === "gallery" && (
        <PropRow
          label="封面"
          k="cover"
          hint="哪一列是图片路径（attachments/图.png）"
          source={source}
          properties={properties}
          onPatch={onPatch}
        />
      )}

      <label className="vset-row">
        <span className="vset-label">来源</span>
        {/* 失焦才写：每敲一个字符就改一次文件，撤销历史会被冲掉 */}
        <input
          className="vset-input"
          value={draftFrom}
          placeholder="论文/**"
          onChange={(e) => setDraftFrom(e.target.value)}
          onBlur={() =>
            draftFrom !== from &&
            onPatch(writeKey(source, "from", draftFrom ? `"${draftFrom}"` : null))
          }
        />
      </label>

      <div className="vset-row">
        <span className="vset-label">层级</span>
        <span className="vset-seg vset-scope" aria-label="来源层级">
          <button
            className={sourceScope.scope === "direct" ? "is-on" : undefined}
            disabled={sourceScope.scope === "custom"}
            onClick={() => patchScope("direct")}
          >
            当前层
          </button>
          <button
            className={sourceScope.scope === "recursive" ? "is-on" : undefined}
            disabled={sourceScope.scope === "custom"}
            onClick={() => patchScope("recursive")}
          >
            包含子层
          </button>
        </span>
      </div>

      <div className="vset-row vset-filters">
        <span className="vset-label">筛选</span>
        <div className="vset-conds">
          {where === null ? (
            <p className="vset-hand">
              这个筛选是手写的（用了界面表达不了的写法），去代码块里改：
              <code>{readKey(source, "where")}</code>
            </p>
          ) : (
            <>
              {where.map((c, i) => (
                <div className="vset-cond-wrap" key={i}>
                  {i > 0 && <span className="vset-join">并且</span>}
                  <div className="vset-cond">
                    <select
                      aria-label={`筛选属性 ${i + 1}`}
                      value={c.key}
                      onChange={(e) =>
                        patchWhere(where.map((x, j) => (i === j ? { ...x, key: e.target.value } : x)))
                      }
                    >
                      {[...new Set([c.key, ...filterableProperties.map((p) => p.key)])].map((k) => (
                        <option key={k} value={k}>
                          {propLabel(k)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`筛选关系 ${i + 1}`}
                      value={c.op}
                      onChange={(e) =>
                        patchWhere(where.map((x, j) => (i === j ? { ...x, op: e.target.value } : x)))
                      }
                    >
                      {OPS.map((o) => (
                        <option key={o} value={o}>
                          {OP_LABELS[o]}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`筛选值 ${i + 1}`}
                      defaultValue={c.value}
                      placeholder="值，或 90d ago"
                      onBlur={(e) =>
                        e.target.value !== c.value &&
                        patchWhere(
                          where.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)),
                        )
                      }
                    />
                    <button
                      className="vset-del"
                      onClick={() => patchWhere(where.filter((_, j) => j !== i))}
                      aria-label="删掉这个条件"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                  {/* 相对时间读作什么，当场说清楚。`90d ago` 是写进文件的 ASCII，
                      人读的是「90 天前」—— 而且它每次打开都按当天重新算，
                      这一点不说的话，用户会以为它和写死一个日期是一回事 */}
                  {describeRelative(c.value) && (
                    <p className="vset-hint">
                      读作 <strong>{describeRelative(c.value)}</strong>，每次打开都按当天重新算
                    </p>
                  )}
                </div>
              ))}
              <button
                className="vset-add"
                disabled={filterableProperties.length === 0}
                onClick={() =>
                  patchWhere([...where, { key: filterableProperties[0]?.key ?? "", op: "=", value: "" }])
                }
              >
                <Icon name="plus" size={12} /> 添加筛选条件
              </button>
            </>
          )}
        </div>
      </div>

      <label className="vset-row">
        <span className="vset-label">宽度</span>
        <span className="vset-seg">
          <button
            className={readKey(source, "width") !== "full" ? "is-on" : undefined}
            onClick={() => onPatch(writeKey(source, "width", null))}
            title="按内容宽度，用不着的地方不占位"
          >
            自适应
          </button>
          <button
            className={readKey(source, "width") === "full" ? "is-on" : undefined}
            onClick={() => onPatch(writeKey(source, "width", "full"))}
            title="铺满正文栏；内容比栏还宽时照旧横向滚动，不会把列挤扁"
          >
            全宽
          </button>
        </span>
      </label>

      <label className="vset-row">
        <span className="vset-label">上限</span>
        <input
          className="vset-input vset-num"
          defaultValue={limit}
          placeholder="500"
          inputMode="numeric"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === limit) return;
            // 填了非数字就当没填 —— 夹紧而不是报错（§6.4 那条同理）
            onPatch(writeKey(source, "limit", /^\d+$/.test(v) ? v : null));
          }}
        />
      </label>
    </div>
  );
}

/**
 * 「这个视图用哪个属性当 X」的一行。分组 / 日期 / 封面共用。
 *
 * 候选来自**这批笔记身上真实出现过的属性**，不是让人凭记忆敲键名 ——
 * 敲错一个字的表现是「视图空的」，而界面上没有任何地方会告诉你敲错了。
 */
function PropRow({
  label,
  k,
  hint,
  fallback,
  extra = [],
  source,
  properties,
  onPatch,
}: {
  label: string;
  /** YAML 里的键名 */
  k: string;
  hint: string;
  /** 没设时实际生效的值，显示在「不设」那一项里 */
  fallback?: string;
  /** 额外的候选（日历的 created/updated 是文件自己的时间，不在 props 表里） */
  extra?: string[];
  source: string;
  properties: PropMeta[];
  onPatch: (yaml: string) => void;
}) {
  const value = readKey(source, k) ?? "";
  const options = [...new Set([...extra, ...properties.map((p) => p.key)])].filter(
    (o) => !isBuiltin(o) || extra.includes(o),
  );
  return (
    <label className="vset-row" title={hint}>
      <span className="vset-label">{label}</span>
      <select
        className="vset-input"
        value={value}
        onChange={(e) => onPatch(writeKey(source, k, e.target.value || null))}
      >
        <option value="">{fallback ? `不设（用${propLabel(fallback)}）` : "不设"}</option>
        {/* 用户手写过一个当前不在候选里的键（笔记还没填过这个属性）时，
            也要显示出来，否则一进设置面板就被悄悄改成「不设」 */}
        {[...new Set(value ? [value, ...options] : options)].map((o) => (
          <option key={o} value={o}>
            {propLabel(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

interface ColumnPickerProps {
  source: string;
  /** 当前显示的列 */
  shown: string[];
  properties: PropMeta[];
  onPatch: (yaml: string) => void;
  /** 新列的类型写进 schema（`.verso-props.json`） */
  onDefine: (key: string, def: PropDef) => void;
  onClose: () => void;
}

/** 能选的类型。**只做 Markdown 装得下的那几种** —— 关联关系、函数、汇总
    要一套表达式引擎和跨笔记引用，那超出「纯 .md 文件」能承载的范围 */
export const TYPES: { id: PropType; label: string; icon: IconName }[] = [
  { id: "text", label: "文本", icon: "text" },
  { id: "number", label: "数字", icon: "hash" },
  { id: "select", label: "单选", icon: "chevron" },
  { id: "multi", label: "多选", icon: "tag" },
  { id: "date", label: "日期", icon: "clock" },
  { id: "checkbox", label: "复选框", icon: "check" },
  { id: "url", label: "网址", icon: "code" },
];

/** `属性`、`属性 2`、`属性 3`…… 和 Notion 一样先给个默认名，回头再改 */
function defaultName(taken: string[]): string {
  if (!taken.includes("属性")) return "属性";
  for (let i = 2; ; i++) {
    if (!taken.includes(`属性 ${i}`)) return `属性 ${i}`;
  }
}

/**
 * 「加一列」。两条路：
 *
 * - **挑一个已有属性** —— 只是把它显示出来，不动任何文件
 * - **选一个类型新建** —— 给个默认名（可以当场改），类型写进 schema。
 *   新属性此刻不会写进任何笔记：它是你往某个格子里填值那一刻才进那篇
 *   frontmatter 的（§2.6：数据来源就是 frontmatter，没有另一份 schema
 *   决定谁有哪些字段）
 */
export function ColumnPicker({
  source,
  shown,
  properties,
  onPatch,
  onDefine,
  onClose,
}: ColumnPickerProps) {
  const [picked, setPicked] = useState<PropType | null>(null);
  const [name, setName] = useState("");
  const rest = properties.filter((p) => !shown.includes(p.key));

  const addColumn = (key: string) =>
    onPatch(writeColumns(source, [...(readColumns(source) ?? shown), key]));

  const create = () => {
    const k = name.trim();
    if (!k || !picked || shown.includes(k)) return;
    onDefine(k, { type: picked });
    addColumn(k);
    onClose();
  };

  if (picked) {
    const t = TYPES.find((x) => x.id === picked)!;
    return (
      <div className="vset vset-cols" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vset-head">
          <button className="vset-back" onClick={() => setPicked(null)} aria-label="返回">
            ‹
          </button>
          <span>
            新建{t.label}列
          </span>
          <button className="vset-x" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={13} />
          </button>
        </div>
        <form
          className="vset-newcol"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="submit" disabled={!name.trim()}>
            添加
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="vset vset-cols" onMouseDown={(e) => e.stopPropagation()}>
      <div className="vset-head">
        <span>加一列</span>
        <button className="vset-x" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={13} />
        </button>
      </div>

      {rest.length > 0 && (
        <>
          <p className="vset-sub">已有的属性</p>
          <ul className="vset-list">
            {rest.map((p) => (
              <li key={p.key}>
                <button
                  onClick={() => {
                    addColumn(p.key);
                    onClose();
                  }}
                >
                  <Icon name={isBuiltin(p.key) ? "clock" : propIcon(p.type)} size={13} />
                  {/* 显示名可以是中文，但**加进 `columns:` 的仍然是原键名**。
                      内置列以前在后面缀一句「文件时间」，现在名字本身就是
                      「创建时间」，再解释一遍是废话 */}
                  {propLabel(p.key)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="vset-sub">新建</p>
      <ul className="vset-types">
        {TYPES.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => {
                setPicked(t.id);
                setName(defaultName([...shown, ...properties.map((p) => p.key)]));
              }}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 属性类型 → 图标。§2.6：UI 按类型渲染，类型来自索引里的 `props.type` */
export function propIcon(type: string): "hash" | "clock" | "check" | "tag" | "text" {
  switch (type) {
    case "number":
      return "hash";
    case "date":
      return "clock";
    case "bool":
      return "check";
    case "list":
      return "tag";
    default:
      return "text";
  }
}

interface OptionsEditorProps {
  column: string;
  def: PropDef | undefined;
  onDefine: (key: string, def: PropDef) => void;
  onClose: () => void;
}

/**
 * 单选 / 多选的候选值。
 *
 * **删掉一个选项不会去改任何笔记。** 已经写着这个值的笔记照样留着它，
 * 单元格里也照样显示 —— 选项表只是「下拉里列出哪些」，不是一份会反过来
 * 清洗数据的约束。要真去掉那个值，得一格一格改，那是用户的决定。
 */
export function OptionsEditor({ column, def, onDefine, onClose }: OptionsEditorProps) {
  const options = def?.options ?? [];
  const [name, setName] = useState("");

  const save = (next: string[]) => onDefine(column, { type: def?.type ?? "select", options: next });

  return (
    <div className="vset vset-cols" onMouseDown={(e) => e.stopPropagation()}>
      <div className="vset-head">
        <span>「{column}」的选项</span>
        <button className="vset-x" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={13} />
        </button>
      </div>

      {options.length === 0 && <p className="vset-sub">还没有选项，下面加一个</p>}
      <ul className="vset-list">
        {options.map((o) => (
          <li key={o} className="vset-opt">
            <span>{o}</span>
            <button
              className="vset-del"
              onClick={() => save(options.filter((x) => x !== o))}
              aria-label={`删掉 ${o}`}
              title="从下拉里去掉。已经写着这个值的笔记不受影响"
            >
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="vset-newcol"
        onSubmit={(e) => {
          e.preventDefault();
          const v = name.trim();
          if (!v || options.includes(v)) return;
          save([...options, v]);
          setName("");
        }}
      >
        <input value={name} placeholder="新选项" onChange={(e) => setName(e.target.value)} autoFocus />
        <button type="submit" disabled={!name.trim()}>
          添加
        </button>
      </form>
    </div>
  );
}

interface OptionPickerProps {
  /** 单元格当前的值。多选时是「甲、乙」这种 */
  value: string;
  options: string[];
  multi: boolean;
  /** 选好之后写回单元格 */
  onSet: (value: string) => void;
  /** 现建一个选项：写进 schema，然后立刻选上 */
  onCreateOption: (option: string) => void;
  onClose: () => void;
}

/**
 * 单选 / 多选的选择器。
 *
 * **在单元格里就能新建选项** —— Notion 和思源都是这样，而这正是「先去列头
 * 菜单里把选项配好、再回来填」最烦人的地方：填值的那一刻才是你知道自己
 * 需要哪个选项的时刻。
 *
 * 新建只往 schema 里加一条候选，值照常写进那篇笔记的 frontmatter；
 * 反过来，删选项也不会去动任何笔记（见 `OptionsEditor`）。
 */
export function OptionPicker({
  value,
  options,
  multi,
  onSet,
  onCreateOption,
  onClose,
}: OptionPickerProps) {
  const [q, setQ] = useState("");
  const chosen = value
    ? value
        .split(/[、,]/)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  // 当前值排在最前，且一定在列表里 —— 手改过 frontmatter、或者选项后来被
  // 删掉的值，不能因为打开这个面板就消失
  const all = [...new Set([...chosen, ...options])];
  const key = q.trim();
  const hits = key ? all.filter((o) => o.includes(key)) : all;
  const canCreate = key.length > 0 && !all.includes(key);

  const pick = (o: string) => {
    if (!multi) {
      onSet(chosen[0] === o ? "" : o);
      onClose();
      return;
    }
    const next = chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o];
    onSet(next.join("、"));
  };

  return (
    <div className="optpick" onMouseDown={(e) => e.stopPropagation()}>
      <input
        className="optpick-q"
        value={q}
        placeholder={multi ? "搜索或新建选项" : "搜索或新建"}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (canCreate) {
              onCreateOption(key);
              pick(key);
              setQ("");
            } else if (hits.length === 1) {
              pick(hits[0]);
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />

      <ul className="optpick-list">
        {hits.map((o) => (
          <li key={o}>
            <button className={chosen.includes(o) ? "is-on" : undefined} onClick={() => pick(o)}>
              <span className="dbview-tag">{o}</span>
              {chosen.includes(o) && <Icon name="check" size={12} />}
            </button>
          </li>
        ))}
        {canCreate && (
          <li>
            <button
              className="optpick-new"
              onClick={() => {
                onCreateOption(key);
                pick(key);
                setQ("");
              }}
            >
              <Icon name="plus" size={12} />
              新建「{key}」
            </button>
          </li>
        )}
        {hits.length === 0 && !canCreate && <li className="optpick-none">还没有选项</li>}
      </ul>

      <div className="optpick-foot">
        {!multi && chosen.length > 0 && (
          <button
            onClick={() => {
              onSet("");
              onClose();
            }}
          >
            清空
          </button>
        )}
        <button onClick={onClose}>完成</button>
      </div>
    </div>
  );
}
