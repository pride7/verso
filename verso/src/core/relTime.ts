/**
 * 「3 分钟前」这种相对时间。历史面板用。
 *
 * ## 为什么不用 Intl.RelativeTimeFormat
 *
 * 它给的是「3分钟前」「1天前」，但**跨过一天之后人要的是日期**：三周前的
 * 那次改动，「21 天前」远不如「7月12日」有用 —— 后者能和记忆里的事对上。
 * 这条规则用现成的 API 表达不出来，而它只有十几行。
 */

/** 把时刻换成一句人话。`now` 注入而不是现取，测试才钉得住 */
export function relTime(unixSeconds: number, now: Date): string {
  const diff = Math.floor(now.getTime() / 1000) - unixSeconds;

  // 未来的时间戳：机器时钟被调过、或者别处提交时的时钟偏了。
  // 显示成「刚刚」而不是「-3 分钟前」
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;

  const d = new Date(unixSeconds * 1000);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `${Math.floor(diff / 3600)} 小时前`;

  // 「昨天 14:30」而不是「20 小时前」—— 跨了一天之后，人是按天记事的
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${hm}`;
  }

  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  // 跨年了才写年份：同一年里写出来是多余的
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md}`;
}

/**
 * 只到天的那一版。项目总览的每条记录用。
 *
 * 那里的日期是列表里最右边的一小格，`relTime` 的「8月12日 14:30」在那个位置
 * 太长，会把标题挤掉；而「一条问题是几点提的」也不是那一眼要看的东西。
 * 精确到分的时刻仍在 `title` 里，鼠标停一下就有。
 */
export function relDate(unixSeconds: number, now: Date): string {
  const d = new Date(unixSeconds * 1000);
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  // 按**日历天**算而不是「差了多少小时」：23:50 建的那条，第二天早上 8 点
  // 看该是「昨天」，而不是「8 小时前的今天」
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}
