/**
 * 「现在是不是窄屏」。DESIGN.md §1.2 / §6.1
 *
 * ## 为什么用 JS 判断，而不是纯 CSS
 *
 * 布局本身用 CSS 媒体查询就够了。要 JS 的是**行为**：窄屏上侧栏是盖在正文
 * 上的抽屉，那么「点开一篇笔记之后应该自动收起来」—— 不收的话，用户点完
 * 得再手动关一次，而他刚刚表达的意思恰恰是「我要看这一篇」。这种事 CSS
 * 表达不了。
 *
 * ## 断点为什么是 640
 *
 * 常见手机竖屏宽度在 360–430 之间，横屏和小平板到 740 以上。640 落在这两
 * 群之间的空档里，两边都不擦边。
 *
 * **窄不等于手机。** 桌面上把窗口拖窄同样会命中这一条，而那时抽屉式侧栏
 * 也确实更好用。真正「这是手机」的判断（比如藏掉终端）另说，别用这个。
 */
import { useEffect, useState } from "react";

export const NARROW = "(max-width: 640px)";

/** 跟着媒体查询走的一个布尔值。SSR / 没有 matchMedia 的环境下当作 false */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    // 订阅之前先同步一次：从挂载到这里之间，视口可能已经变了
    setOn(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setOn(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return on;
}
