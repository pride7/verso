/**
 * database 的另外三种视图：列表 / 画廊 / 日历。DESIGN.md §2.6
 *
 * ## 为什么和表格、看板分开放
 *
 * `DatabaseView.tsx` 里那两种是**可写**的：单元格进编辑态、看板拖卡片改属性，
 * 它们和 `commitValue` / `editing` 这套状态缠得很紧。这三种是**读的视图** ——
 * 列表和画廊只负责把一批笔记摆好看，日历多一件事（拖到别的日子 = 改那个
 * 日期属性），走的还是同一个 `onSet`。分开之后两边都短，也不必为了共用
 * 而把编辑状态传进只读视图。
 *
 * ## 共同的规矩
 *
 * - **点标题永远是打开那篇笔记**，不是就地编辑。这三种视图的信息密度低，
 *   来这里是为了浏览；要改值回表格
 * - 属性一律显示成小标签，空值直接不画 —— 摆一排「—」只是噪音
 */
import { useMemo, useState } from "react";

import { Icon } from "./Icon";
import { formatDate, isBuiltin } from "../lib/viewSpec";
import {
  dateKey,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
  WEEKDAYS,
  type YearMonth,
} from "../lib/calendar";
import type { ViewRow } from "../types";

interface Common {
  rows: ViewRow[];
  /** 卡片上要显示的属性，调用方已经去掉 title 和视图自用的那些键 */
  cols: string[];
  typeOf: (key: string) => string;
  onOpen: (path: string) => void;
}

/** 一个属性的显示值。日期缩成年月日，别的原样 */
function shown(value: string, type: string): string {
  return type === "date" ? formatDate(value) : value;
}

function Chips({
  row,
  cols,
  typeOf,
  inline,
}: {
  row: ViewRow;
  cols: string[];
  typeOf: (k: string) => string;
  /** 摆在标题**右边**（列表视图）而不是下面（画廊瓦片） */
  inline?: boolean;
}) {
  const filled = cols.filter((c) => row.props[c]);
  if (filled.length === 0) return null;
  return (
    <dl className={`dbv-chips${inline ? " is-inline" : ""}`}>
      {filled.map((c) => (
        <div key={c}>
          <dt>{c}</dt>
          <dd>{shown(row.props[c], typeOf(c))}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- 列表

/**
 * 列表：一行一篇，**标题在左、属性在右，同一行**（Notion 的列表视图就是
 * 这个样子）。
 *
 * 属性曾经摆在标题下面，一条占两行 —— 十几条就要滚一屏，而列表存在的理由
 * 恰恰是密度。挪到右边之后一条一行，一屏能多看一倍。
 *
 * 和表格的区别不在样式而在**取舍**：表格保证每一列都对齐（好比较），列表
 * 放弃对齐换密度和更长的标题（好浏览）。所以这里不画表格线、不给每行等高。
 */
export function ListView({ rows, cols, typeOf, onOpen }: Common) {
  return (
    <ul className="dbv-list">
      {rows.map((r) => (
        <li key={r.path}>
          <button className="dbv-list-title" onClick={() => onOpen(r.path)}>
            <Icon name="doc" size={13} />
            <span>{r.title}</span>
          </button>
          <Chips row={r} cols={cols} typeOf={typeOf} inline />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- 画廊

interface GalleryProps extends Common {
  /** 拿哪一列当封面。没设就全是占位图 */
  cover: string | null;
  /** vault 相对路径 → 能给 <img> 用的 URL。解析不出来返回 null */
  imageSrc: (target: string) => string | null;
}

/**
 * 封面值可能是 `attachments/图.png`，也可能是用户顺手写的 `![[图.png]]`
 * —— 后者是 Obsidian 的嵌入写法，在 frontmatter 里其实不生效，但人就是会
 * 这么写。剥掉包装再解析，比让他自己去掉更省事。
 */
function coverTarget(raw: string): string {
  const m = /!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(raw.trim());
  return (m ? m[1] : raw).trim();
}

function Tile({
  row,
  cols,
  typeOf,
  onOpen,
  cover,
  imageSrc,
}: Omit<GalleryProps, "rows"> & { row: ViewRow }) {
  /**
   * 封面文件不在了（改名、删掉、还没同步下来）。
   *
   * 这时**不能显示碎图标** —— 一面墙上几个碎图标看起来就是软件坏了，
   * 而真实情况只是某张图没找到。退回占位块，和「本来就没设封面」长一样，
   * 和 §4.4「找不到的图不显示碎图标」是同一条。
   */
  const [broken, setBroken] = useState(false);
  const raw = cover ? row.props[cover] : undefined;
  const src = raw && !broken ? imageSrc(coverTarget(raw)) : null;

  return (
    <article className="dbv-tile">
      {/* 封面整块可点，但不进 Tab 序列也不报给读屏软件 —— 它和下面的标题
          是同一个目标，重复一遍只会让键盘和读屏用户多按一次 */}
      <button className="dbv-tile-cover" onClick={() => onOpen(row.path)} tabIndex={-1} aria-hidden>
        {src ? (
          <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <span className="dbv-tile-blank">
            <Icon name="image" size={20} />
          </span>
        )}
      </button>
      <button className="dbv-tile-title" onClick={() => onOpen(row.path)}>
        {row.title}
      </button>
      <Chips row={row} cols={cols} typeOf={typeOf} />
    </article>
  );
}

export function GalleryView({ rows, ...rest }: GalleryProps) {
  return (
    <div className="dbv-gallery">
      {rows.map((r) => (
        <Tile key={r.path} row={r} {...rest} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 日历

/**
 * 日历格子里**只放标题**，所以不收 `cols` / `typeOf`。
 *
 * 一格宽度是正文栏的七分之一，再塞属性只会挤成一团马赛克 —— 要看属性
 * 就该切到列表或表格。这一条写进类型里，免得以后又顺手传进来。
 */
interface CalendarProps extends Omit<Common, "cols" | "typeOf"> {
  /** 按哪个属性摆。`created` / `updated` 是文件自己的时间，摆得了但改不了 */
  dateField: string;
  /** 拖到别的日子。内置的时间字段不给拖，所以可能是 undefined */
  onSetDate?: (path: string, ymd: string) => void;
}

export function CalendarView({ rows, onOpen, dateField, onSetDate }: CalendarProps) {
  /** 按日期分堆。认不出日期的单独一堆，摆在月历下面 */
  const { byDay, undated } = useMemo(() => {
    const byDay = new Map<string, ViewRow[]>();
    const undated: ViewRow[] = [];
    for (const r of rows) {
      const k = dateKey(r.props[dateField]);
      if (!k) {
        undated.push(r);
        continue;
      }
      const list = byDay.get(k);
      if (list) list.push(r);
      else byDay.set(k, [r]);
    }
    return { byDay, undated };
  }, [rows, dateField]);

  /**
   * 初始停在哪个月：**有笔记的第一个月**，不是今天。
   *
   * 一个「读书记录」视图里的日期可能全在去年，开在今天等于开在一片空白上，
   * 让人以为视图坏了。没有任何日期时才回到今天。
   */
  const [at, setAt] = useState<YearMonth>(() => {
    const first = [...byDay.keys()].sort()[0];
    const now = new Date();
    return (first && monthOf(first)) || { y: now.getFullYear(), m: now.getMonth() + 1 };
  });
  const [over, setOver] = useState<string | null>(null);

  const cells = monthGrid(at.y, at.m);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  const drop = (key: string, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const path = e.dataTransfer.getData("text/plain");
    if (path && onSetDate) onSetDate(path, key);
  };

  return (
    <div className="dbv-cal">
      <div className="dbv-cal-bar">
        <button onClick={() => setAt(shiftMonth(at, -1))} aria-label="上一月" title="上一月">
          <Icon name="chevron" size={13} className="dbv-flip" />
        </button>
        <span className="dbv-cal-title">{monthTitle(at)}</span>
        <button onClick={() => setAt(shiftMonth(at, 1))} aria-label="下一月" title="下一月">
          <Icon name="chevron" size={13} />
        </button>
        <button
          className="dbv-cal-today"
          onClick={() => setAt({ y: now.getFullYear(), m: now.getMonth() + 1 })}
        >
          今天
        </button>
        <span className="dbv-cal-field">按「{dateField}」</span>
      </div>

      <div className="dbv-cal-head">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="dbv-cal-grid">
        {cells.map((c) => {
          const list = byDay.get(c.key) ?? [];
          return (
            <div
              key={c.key}
              className={[
                "dbv-cal-cell",
                c.inMonth ? "" : "is-out",
                c.key === todayKey ? "is-today" : "",
                over === c.key ? "is-over" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onDragOver={
                onSetDate
                  ? (e) => {
                      // 不 preventDefault 就收不到 drop（HTML5 拖放的老坑）
                      e.preventDefault();
                      setOver(c.key);
                    }
                  : undefined
              }
              onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
              onDrop={onSetDate ? (e) => drop(c.key, e) : undefined}
            >
              <span className="dbv-cal-day">{c.day}</span>
              {list.map((r) => (
                <button
                  key={r.path}
                  className="dbv-cal-item"
                  draggable={!!onSetDate}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", r.path);
                  }}
                  onClick={() => onOpen(r.path)}
                  title={r.title}
                >
                  {r.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* 没有日期的不能丢掉不显示 —— 那等于让人在月历里翻找一篇根本不会出现的笔记 */}
      {undated.length > 0 && (
        <div className="dbv-cal-undated">
          <span className="dbv-cal-undated-label">没有「{dateField}」</span>
          {undated.map((r) => (
            <button
              key={r.path}
              className="dbv-cal-item"
              draggable={!!onSetDate}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", r.path);
              }}
              onClick={() => onOpen(r.path)}
            >
              {r.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 内置的 created/updated 是文件自己的时间，摆得了但改不了（和表格里一致） */
export const canMoveDates = (field: string) => !isBuiltin(field);
