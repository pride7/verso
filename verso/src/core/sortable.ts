/**
 * 拖动排序的几何：一项被拖到别处时，其余各项该让到哪儿（`ui/sortable.ts` 用）。
 *
 * 坐标都是「内容坐标」—— 屏幕坐标加上滚动容器的 `scrollTop`。拖到边缘时容器会
 * 自己滚，用屏幕坐标的话开拖时量好的格子位置一滚就全错了。
 */

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把第 `from` 项挪到第 `to` 位之后，每一项（按原来的下标）该在的左上角。
 *
 * 多列网格里每项直接套进新位置那一格。**单列时不能这么套**：卡片高矮不一，
 * 一张矮卡挪进高卡的格子，下面就空出一截、或者和下一张叠上 —— 所以单列挨个
 * 往下摞，间距照开拖时量到的。
 */
export function sortTargets(slots: readonly Slot[], from: number, to: number): { x: number; y: number }[] {
  const order = slots.map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  const out: { x: number; y: number }[] = new Array(slots.length);
  const column = slots.every((slot) => Math.abs(slot.x - slots[0].x) < 1);
  if (!column) {
    order.forEach((item, at) => { out[item] = { x: slots[at].x, y: slots[at].y }; });
    return out;
  }
  const gap = slots.length > 1 ? slots[1].y - (slots[0].y + slots[0].h) : 0;
  let y = slots[0]?.y ?? 0;
  for (const item of order) {
    out[item] = { x: slots[item].x, y };
    y += slots[item].h + gap;
  }
  return out;
}

/** 被拖那一项的中心离哪一格的中心最近，就是要落的位置。只在 `[lo, hi]` 里找 */
export function nearestSlot(slots: readonly Slot[], at: { x: number; y: number }, lo: number, hi: number): number {
  let best = lo;
  let bestDistance = Infinity;
  for (let index = lo; index <= hi; index++) {
    const slot = slots[index];
    const distance = Math.hypot(slot.x + slot.w / 2 - at.x, slot.y + slot.h / 2 - at.y);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
