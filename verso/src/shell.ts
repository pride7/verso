/**
 * 应用外壳的兜底：**页面本身永远回到 0**。
 *
 * `.app` 是 `height:100% + overflow:hidden`，html/body 也关掉了滚动 —— 但
 * `overflow:hidden` 只挡得住用户滚，**挡不住程序滚**。`scrollIntoView`、
 * 焦点移动（浏览器会自动把获得焦点的元素滚进视野）都能把整个文档顶上去，
 * 而且顶上去之后不会自己回来：状态栏跑到视口外，顶上的侧栏被切掉一截，
 * 下面露出一块白。CodeMirror 光标滚动和我们自己那些 `.focus()` 都会触发它。
 *
 * 所以除了 CSS，还得有这一层：文档一旦被滚走就立刻拉回去。
 */
export function lockPageScroll(target: Window = window): () => void {
  const snapBack = () => {
    const de = target.document.documentElement;
    if (de.scrollTop !== 0) de.scrollTop = 0;
    if (de.scrollLeft !== 0) de.scrollLeft = 0;
    // Safari / 某些情况下滚的是 body 而不是 documentElement
    const body = target.document.body;
    if (body.scrollTop !== 0) body.scrollTop = 0;
    if (body.scrollLeft !== 0) body.scrollLeft = 0;
  };

  target.addEventListener("scroll", snapBack, { passive: true });
  // focus 会在浏览器滚动之前触发，所以还要在冒泡阶段之后再收一次
  target.addEventListener("focusin", snapBack, { passive: true });
  snapBack();

  return () => {
    target.removeEventListener("scroll", snapBack);
    target.removeEventListener("focusin", snapBack);
  };
}
