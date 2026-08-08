/**
 * 把 fixed 定位的菜单收进视口。
 *
 * 必须在菜单渲染完成后的 layout effect 里调用：菜单项数量、字体和缩放都会影响
 * 实际尺寸，靠预估一个固定高度迟早会在新增菜单项后再次溢出。
 */
export function fitFloatingMenu(element: HTMLElement, x: number, y: number, margin = 8): void {
  const availableWidth = Math.max(0, window.innerWidth - margin * 2);
  const availableHeight = Math.max(0, window.innerHeight - margin * 2);
  element.style.maxWidth = `${availableWidth}px`;
  element.style.maxHeight = `${availableHeight}px`;

  const place = () => {
    const box = element.getBoundingClientRect();
    element.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - box.width - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - box.height - margin))}px`;
  };

  place();
  // **量两遍。** 定位之前它还待在自己的静态位置上（可能是一条 250px 宽的
  // 侧栏里），那里可用宽度不够，菜单里的字会折行 —— 量到的是折行后的尺寸。
  // 挪到右下角之后不折了，宽度变大，右边缘又探出屏幕。
  // 第二遍是在最终位置上量的，此后不会再变（这一条是 `.ctx` 加了图标、
  // 菜单变宽 8px 之后炸出来的）
  place();
}

/**
 * 二级菜单：贴着父菜单项**向右**展开，右边放不下就翻到左边。
 *
 * 为什么不复用 `fitFloatingMenu`：它只会把越界的浮层往回夹，而夹回来的结果是
 * 二级菜单盖在父菜单上，两层重叠着谁也读不了。子菜单要的是「换一边」。
 */
export function fitSubmenu(element: HTMLElement, anchor: DOMRect, margin = 8): void {
  element.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
  const box = element.getBoundingClientRect();

  const toRight = anchor.right + box.width + margin <= window.innerWidth;
  const left = toRight
    ? anchor.right - 2
    : Math.max(margin, anchor.left - box.width + 2);
  // 顶边和父菜单项对齐（差一点点，让两层看起来是连着的），底边不许出屏
  const top = Math.max(margin, Math.min(anchor.top - 4, window.innerHeight - box.height - margin));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}
