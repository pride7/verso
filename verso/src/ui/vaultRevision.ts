/**
 * 「vault 的内容变了」这个信号。DESIGN.md §2.6
 *
 * ## 为什么不能靠 prop 传
 *
 * database 视图长在 CodeMirror 的 widget 里，是 `createRoot` 单独挂起来的
 * **另一棵 React 树**。它够不到 App 的 context，也不会跟着 App 重渲染 ——
 * 那棵树只在 widget 建出来的那一刻渲染一次。
 *
 * 所以把版本号当 prop 传进去，在那里是一条**断掉的线**，而且断得很安静：
 * 类型是对的，第一次拿到的值也是对的，只是从此再不变。表现是改名或新建
 * 之后视图不更新，切走再切回来「好了」—— 那不是刷新，是整棵树被重建。
 *
 * 询问框（`useAsk`）当初因为同一堵墙做成了 hook 而不是全局 context。那边是
 * 「往上要东西」，这边是「往下推通知」，同一个问题的两半。
 *
 * ## 谁写谁读
 *
 * **只有 App 写**（它持有那个版本号，侧栏那些视图仍然照常拿 prop）。
 * widget 里的树用 `useVaultRevision()` 订阅。
 */
import { useSyncExternalStore } from "react";

let revision = 0;
const listeners = new Set<() => void>();

/**
 * App 在版本号变化时推一次。**唯一的写入口。**
 *
 * 传值而不是自增：这里是 App 那个版本号的镜子，不是第二个计数器 ——
 * 两个各自加一的计数器迟早会对不上，而对不上的那一刻没有任何征兆。
 */
export function publishVaultRevision(next: number): void {
  if (next === revision) return;
  revision = next;
  // 复制一份再遍历：监听器在回调里退订是正常操作（组件卸载），
  // 直接遍历原集合会漏掉后面的人
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const snapshot = () => revision;

/** 订阅「内容变了」。widget 里那棵树用它代替 prop */
export function useVaultRevision(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
