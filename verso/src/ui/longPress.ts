/**
 * 长按当右键（DESIGN.md §0 第 1 条：不能假设有键盘，也不能假设有精细指针）。
 *
 * 右键菜单在触摸屏上根本不存在 —— 手指没有第二个键。凡是「只有右键能到」的
 * 操作，在手机上就等于没有；这个 hook 给它补上等价入口。
 *
 * 两个坑，都是这类实现最常翻的：
 *
 * 1. **手一动就要取消。** 触摸屏上按住不动 500ms 是长按，按住往上划是滚页面。
 *    不判位移的话，滚一屏就会莫名其妙弹出一个菜单。
 * 2. **松手时那一串合成鼠标事件必须吃掉。** 触摸结束后 WebView 还会补发
 *    `mousedown / mouseup / click`（为了兼容只写了鼠标的老页面）。菜单是在手指
 *    还按着的时候弹出来的，于是那串补发的事件正好落在菜单刚开的瞬间 ——
 *    结果是菜单一闪就没，而且这一下还会被当成点击，把文档打开。
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

/** 按住多久算长按。和公式条的变体键取同一个值（§5.5），移动端的通行值 */
const HOLD_MS = 500;
/** 手指移动超过这么多像素就当成在滚页面 */
const MOVE_PX = 8;

/**
 * 吃掉这一次触摸松手后补发的那串鼠标事件。
 *
 * 用捕获阶段 + `stopPropagation`：window 的捕获是整条传播链的第一站，
 * 拦在这里，React 的根监听器和菜单自己的关闭监听器都收不到。
 */
function swallowSyntheticTap() {
  const types = ["mousedown", "mouseup", "click"] as const;
  let fuse = 0;
  const stop = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    // 合成序列以 click 收尾，收到就撤 —— 不能一直挂着，那会吃掉用户下一次真的点
    if (event.type === "click") done();
  };
  const done = () => {
    types.forEach((type) => window.removeEventListener(type, stop, true));
    window.clearTimeout(fuse);
  };
  types.forEach((type) => window.addEventListener(type, stop, true));
  // 有的内核不补发 click（比如手指按下和松开差了几个像素），得有个保险丝
  fuse = window.setTimeout(done, 700);
}

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

/**
 * `at` 是手指按下的位置 —— 菜单要弹在那儿，而不是松手的地方（松手时手指
 * 可能已经挪开了几像素，菜单跟着跳看着像没对准）。
 */
export function useLongPress(onTrigger: (at: { x: number; y: number }) => void): LongPressHandlers {
  const timer = useRef(0);
  const from = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    from.current = null;
  };
  useEffect(() => clear, []);

  return {
    onPointerDown: (event) => {
      // 鼠标有右键，不需要长按；在鼠标上叠一层长按只会让「按住选中」变得诡异
      if (event.pointerType === "mouse") return;
      clear();
      const at = { x: event.clientX, y: event.clientY };
      from.current = at;
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        from.current = null;
        swallowSyntheticTap();
        onTrigger(at);
      }, HOLD_MS);
    },
    onPointerMove: (event) => {
      const origin = from.current;
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  };
}
