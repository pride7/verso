/**
 * 按住拖动重排一组卡片：被拖的那张跟着指针走，其余的实时让位，松手后滑进空位
 * 再落定。项目中心在用（§2.10）。
 *
 * **为什么不用 HTML5 的 `draggable`**（文档树、标签栏用的那套）：它拖起来的是
 * 浏览器截的一张半透明快照，别的卡片纹丝不动，要等松手才「啪」地换位；触摸屏上
 * 压根不触发。这里走 pointer 事件，鼠标、触摸、笔一套代码。
 *
 * 三件容易翻车的事：
 *
 * 1. **触摸上要先长按。** 手指一按就拖的话，整屏卡片再也滚不动了。所以触摸是
 *    「长按弹出菜单（`useLongPress`）之后再挪 → 关菜单、开始拖」—— 和手机桌面
 *    图标同一个手势。长按之后挡住滚动靠 `touchmove` 里 `preventDefault`：那时手指
 *    已经停了半秒，浏览器还没开始滚，这一下拦得住。
 * 2. **落定的那一帧不能闪。** 新次序由 React 重排 DOM，旁边的位移要在**同一帧**里
 *    清掉 —— 所以落定用 `flushSync`，紧接着同步清样式。清的时候还得先把
 *    `transition` 设成 none：卡片自己的 CSS 里有 transform 过渡，直接清掉内联
 *    样式，每张卡都会从让位的位置再滑一遍回来。
 * 3. **拖完松手那一下 click 要吃掉**，否则拖完就把项目打开了。浏览器在处理松手的
 *    同一个任务里接着派发 click，所以挡到下一个宏任务为止就够 —— 按时长挡的话，
 *    拖完紧接着真点一下也会被吞掉。触摸那边补发的鼠标事件由 `useLongPress` 吃。
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";

import { nearestSlot, sortTargets, type Slot } from "../core/sortable";

/** 鼠标挪这么多才算开始拖，小于它是一次点击 */
const MOUSE_PX = 4;
/** 同 `useLongPress` 的 MOVE_PX：长按之后再挪这么多才算拖 */
const TOUCH_PX = 8;
/** 松手后滑进空位的时长 */
const DROP_MS = 180;
/** 让位的那几张的过渡。比卡片自己的悬停过渡慢一点，看得清是谁让开了 */
const SHIFT = "transform 200ms cubic-bezier(0.2, 0, 0, 1)";
/** 离滚动容器上下边缘这么近时自动滚，越近越快 */
const EDGE_PX = 56;
const SPEED_PX = 16;

interface Options {
  /** 第 `from` 项能落的范围（含两端）。项目中心用它把置顶组和其余隔开 */
  range: (from: number) => [number, number];
  /** 落定。只在真的换了位置时调；调用时 React 已在 `flushSync` 里，同步更新 state 即可 */
  onDrop: (from: number, to: number) => void;
  /** 真正开始拖的那一刻（过了阈值），比如关掉长按弹出的菜单 */
  onStart?: () => void;
  /** 会滚的那个容器。拖到边缘时滚它；位置也按它的滚动量换算 */
  scroller: () => HTMLElement | null;
}

interface Press {
  pointerId: number;
  touch: boolean;
  from: number;
  /** 触摸要等长按之后才能拖；鼠标一直是 true */
  armed: boolean;
  dragging: boolean;
  dropping: boolean;
  /** 起点（屏幕坐标）和那时的滚动量 */
  x0: number;
  y0: number;
  scroll0: number;
  x: number;
  y: number;
  to: number;
  lo: number;
  hi: number;
  /** 开拖时这一组的元素和格子。之后 React 重渲染、下标变了也不影响这一次 */
  els: HTMLElement[];
  slots: Slot[];
  scroller: HTMLElement | null;
  frame: number;
}

export interface Sortable {
  /** 挂在每一项上：`<div {...sortable.item(i)} />` */
  item: (index: number) => {
    ref: (el: HTMLElement | null) => void;
    onPointerDown: (event: ReactPointerEvent) => void;
  };
  /** 触摸的长按到点了，允许拖。由长按的回调调 */
  arm: () => void;
  /** 这次 click 是不是拖完松手补发的 —— 是的话别当成点击 */
  justDropped: () => boolean;
}

const translate = (x: number, y: number, scale = 1) =>
  `translate3d(${x}px, ${y}px, 0)${scale === 1 ? "" : ` scale(${scale})`}`;

export function useSortable(options: Options): Sortable {
  const opts = useRef(options);
  opts.current = options;
  const els = useRef<(HTMLElement | null)[]>([]);
  const press = useRef<Press | null>(null);
  const swallowClick = useRef(false);
  const detach = useRef<() => void>(() => {});

  const scrollTop = (p: Press) => p.scroller?.scrollTop ?? 0;

  /** 被拖那张跟手；落点变了就让其余的挪到新位置 */
  const paint = (p: Press) => {
    const dx = p.x - p.x0;
    const dy = p.y + scrollTop(p) - (p.y0 + p.scroll0);
    const slot = p.slots[p.from];
    const to = nearestSlot(p.slots, { x: slot.x + slot.w / 2 + dx, y: slot.y + slot.h / 2 + dy }, p.lo, p.hi);
    p.els[p.from].style.transform = translate(dx, dy, 1.02);
    if (to === p.to) return;
    p.to = to;
    const targets = sortTargets(p.slots, p.from, to);
    p.els.forEach((el, index) => {
      if (index === p.from) return;
      el.style.transform = translate(targets[index].x - p.slots[index].x, targets[index].y - p.slots[index].y);
    });
  };

  const tick = () => {
    const p = press.current;
    if (!p?.dragging || p.dropping) return;
    const box = p.scroller?.getBoundingClientRect();
    if (p.scroller && box) {
      const edge = (distance: number) => SPEED_PX * Math.min(1, Math.max(0, 1 - distance / EDGE_PX));
      const velocity = edge(p.y - box.top) > 0 ? -edge(p.y - box.top) : edge(box.bottom - p.y);
      if (velocity) p.scroller.scrollTop += velocity;
    }
    paint(p);
    p.frame = requestAnimationFrame(tick);
  };

  const start = (p: Press) => {
    const scroller = opts.current.scroller();
    const top = scroller?.scrollTop ?? 0;
    const list = els.current.filter((el): el is HTMLElement => !!el);
    if (!list[p.from]) return end();
    p.dragging = true;
    p.scroller = scroller;
    // 阈值是从按下的地方量的，开拖的这一刻再把起点钉在这儿 —— 卡片不会先跳一截
    p.scroll0 = top;
    p.els = list;
    p.slots = list.map((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left, y: rect.top + top, w: rect.width, h: rect.height };
    });
    [p.lo, p.hi] = opts.current.range(p.from);
    p.to = p.from;
    list.forEach((el, index) => { el.style.transition = index === p.from ? "none" : SHIFT; });
    list[p.from].classList.add("is-dragging");
    document.body.classList.add("is-sorting");
    if (!p.touch) {
      try { list[p.from].setPointerCapture(p.pointerId); } catch { /* 元素刚被换掉时会抛，无所谓 */ }
    }
    opts.current.onStart?.();
    p.frame = requestAnimationFrame(tick);
  };

  /** 清掉这一次拖动留下的一切。先关过渡再清位移，不然每张卡都要滑一遍回来 */
  const reset = (p: Press) => {
    for (const el of p.els) {
      el.style.transition = "none";
      el.style.transform = "";
      el.classList.remove("is-dragging");
    }
    void p.els[0]?.offsetWidth;
    for (const el of p.els) el.style.transition = "";
    document.body.classList.remove("is-sorting");
  };

  const end = () => {
    const p = press.current;
    if (p) cancelAnimationFrame(p.frame);
    press.current = null;
    detach.current();
  };

  /** 松手（或取消）：被拖那张滑进空位，滑完再交给 React 落定 */
  const drop = (p: Press, cancel = false) => {
    cancelAnimationFrame(p.frame);
    p.dropping = true;
    if (cancel && p.to !== p.from) {
      p.to = p.from;
      p.els.forEach((el, index) => { if (index !== p.from) el.style.transform = ""; });
    }
    const target = sortTargets(p.slots, p.from, p.to)[p.from];
    const dragged = p.els[p.from];
    dragged.style.transition = `transform ${DROP_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
    dragged.style.transform = translate(target.x - p.slots[p.from].x, target.y - p.slots[p.from].y);
    dragged.classList.remove("is-dragging");
    swallowClick.current = true;
    window.setTimeout(() => { swallowClick.current = false; }, 0);
    detach.current();
    window.setTimeout(() => {
      if (press.current !== p) return;
      if (p.to !== p.from) flushSync(() => opts.current.onDrop(p.from, p.to));
      reset(p);
      press.current = null;
    }, DROP_MS);
  };

  const onMove = (event: PointerEvent) => {
    const p = press.current;
    if (!p || event.pointerId !== p.pointerId || p.dropping) return;
    p.x = event.clientX;
    p.y = event.clientY;
    if (p.dragging) return;
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (!p.armed) {
      // 还没长按就挪了：是在滚页面，这一次不归我们管
      if (moved > TOUCH_PX) end();
      return;
    }
    if (moved > (p.touch ? TOUCH_PX : MOUSE_PX)) start(p);
  };

  const onUp = (event: PointerEvent) => {
    const p = press.current;
    if (!p || event.pointerId !== p.pointerId || p.dropping) return;
    if (p.dragging) drop(p, event.type === "pointercancel");
    else end();
  };

  /** 长按之后（以及拖动中）挡住滚动，见文件头第 1 条 */
  const onTouchMove = (event: TouchEvent) => {
    if (press.current?.armed && event.cancelable) event.preventDefault();
  };

  const onKey = (event: KeyboardEvent) => {
    const p = press.current;
    if (event.key === "Escape" && p?.dragging && !p.dropping) drop(p, true);
  };

  const attach = (touch: boolean) => {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    if (touch) window.addEventListener("touchmove", onTouchMove, { passive: false });
    detach.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchmove", onTouchMove);
      detach.current = () => {};
    };
  };

  useEffect(() => () => {
    const p = press.current;
    if (p) {
      cancelAnimationFrame(p.frame);
      if (p.dragging) reset(p);
    }
    press.current = null;
    detach.current();
  }, []);

  return {
    item: (index) => ({
      ref: (el) => { els.current[index] = el; },
      onPointerDown: (event) => {
        if (event.button !== 0 || press.current) return;
        const touch = event.pointerType !== "mouse";
        press.current = {
          pointerId: event.pointerId,
          touch,
          from: index,
          armed: !touch,
          dragging: false,
          dropping: false,
          x0: event.clientX,
          y0: event.clientY,
          scroll0: 0,
          x: event.clientX,
          y: event.clientY,
          to: index,
          lo: index,
          hi: index,
          els: [],
          slots: [],
          scroller: null,
          frame: 0,
        };
        attach(touch);
      },
    }),
    arm: () => {
      const p = press.current;
      if (!p || p.armed) return;
      p.armed = true;
      // 从长按到点的位置起算，按住时手指的那点抖动不算
      p.x0 = p.x;
      p.y0 = p.y;
    },
    justDropped: () => swallowClick.current,
  };
}
