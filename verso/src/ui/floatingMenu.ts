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

  const box = element.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x, window.innerWidth - box.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - box.height - margin));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}
