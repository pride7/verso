/**
 * 日历视图的日期算术。DESIGN.md §2.6
 *
 * 单独放一个文件、只用纯函数：跨月边界、闰年、周起始日这些恰恰是最容易
 * 写错又最难在界面上看出来的地方（差一天要盯着某个月才发现），而它们
 * 完全不需要 DOM，可以在纯 Node 里穷举着测。
 *
 * **一律用本地时间。** `new Date("2026-03-04")` 按 UTC 解析，在东八区会变成
 * 3 月 4 日 08:00，往前推几个时区就直接掉到 3 月 3 日 —— 笔记里写的日期是
 * 人写的日历日期，不带时区含义，只能按本地时间构造。
 */

export interface Cell {
  /** `YYYY-MM-DD` */
  key: string;
  /** 1–31 */
  day: number;
  /** 是不是当月的日子（网格首尾会带上邻月的几天） */
  inMonth: boolean;
}

/** 月份一律 1–12，不用 JS 那套 0–11 —— 这个偏移是日期 bug 的主要来源 */
export interface YearMonth {
  y: number;
  m: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * 从属性值里认出日期。
 *
 * 认 `YYYY-MM-DD` 开头就够了 —— frontmatter 里的日期要么是这个写法，要么是
 * RFC3339（`2026-03-04T10:00:00+08:00`），后者的前十位正好是前者。认不出来
 * 的值（`2026 年 3 月`、`下周`）返回 null，那些笔记会被摆进「没有日期」那一堆，
 * 而不是被猜到某一天上去。
 */
export function dateKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return ymd(Number(y), month, day);
}

/** 当月天数。二月靠「下个月的第 0 天」算，不用自己判闰年 */
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * 一个月的网格，**周一起始**，永远 6 行 42 格。
 *
 * 固定 42 格是有意的：行数随月份变化的话，翻月时整个面板会一跳一跳，
 * 而下面的内容跟着上下窜。多出来的格子填邻月的日子（`inMonth: false`），
 * 那也正是纸质月历的做法。
 */
export function monthGrid(y: number, m: number): Cell[] {
  // getDay(): 周日是 0。要周一起始就把它换算成 0=周一 … 6=周日
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const total = daysInMonth(y, m);
  const prev = shiftMonth({ y, m }, -1);
  const prevTotal = daysInMonth(prev.y, prev.m);
  const next = shiftMonth({ y, m }, 1);

  const out: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const n = i - firstDow + 1;
    if (n < 1) {
      const d = prevTotal + n;
      out.push({ key: ymd(prev.y, prev.m, d), day: d, inMonth: false });
    } else if (n > total) {
      const d = n - total;
      out.push({ key: ymd(next.y, next.m, d), day: d, inMonth: false });
    } else {
      out.push({ key: ymd(y, m, n), day: n, inMonth: true });
    }
  }
  return out;
}

export function shiftMonth({ y, m }: YearMonth, delta: number): YearMonth {
  // 用取模而不是循环：一次跳 12 个月的「回到今天」也要对
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (((total % 12) + 12) % 12) + 1 };
}

export function monthTitle({ y, m }: YearMonth): string {
  return `${y} 年 ${m} 月`;
}

/** 某个日期属于哪个年月。给「跳到第一条笔记所在的月份」用 */
export function monthOf(key: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
}

/** 周一起始的表头 */
export const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;
