/**
 * 软键盘在不在。DESIGN.md §5.5 / §1.2
 *
 * ## 为什么不认焦点
 *
 * 原来底部三条（公式条 + 状态栏 + 导航）在打字时全都占着，加起来 168px ——
 * 390×844 的屏上，键盘弹起来之后留给正文的只剩两百出头，比底部这堆还少。
 *
 * 想让导航在打字时让位，最直觉的判据是「焦点在正文里」，而那是个陷阱：
 * **收起软键盘并不一定让正文失焦**（安卓的返回手势、iOS 的收起键都不改焦点），
 * 那时用户手上既没有键盘也没有导航，只能靠点别处碰运气。
 *
 * 所以这里认的是**视口真的缩了没有**。安卓侧 `MainActivity.fitSystemBars()`
 * 把 IME 的 inset 加成 WebView 的底部内边距（否则光标会被键盘盖住），于是
 * 键盘一上来 WebView 的可视高度就真的少一截；iOS 上 `visualViewport` 同样
 * 会缩。键盘一收，高度同帧涨回来，导航跟着回来 —— 上面那个陷阱不存在了。
 *
 * 测不出来的设备（某些定制 WebView 的 `adjustNothing`）上高度不变，
 * `up` 恒为 false，界面退回改动前的样子。**这条退路是有意的**：判据失灵
 * 时宁可挤一点，也不能把导航藏起来找不回来。
 *
 * ## 为什么要记一个基线
 *
 * 「视口有多高」这个绝对值说明不了任何事 —— 只有和「没有键盘时它有多高」
 * 比才有意义。基线取见过的最大值，而**宽度一变就重置**：转屏、桌面上拖窗口
 * 都会换一个完全不同的高度，拿旧基线去比会一直判成「键盘开着」。
 */

/**
 * 缩掉多少才算键盘。
 *
 * 主流手机的中文键盘（带候选词条）在 260–380px 之间，最矮的英文键盘也有
 * 210 上下。取 120 是为了把**不是键盘的那些缩法**挡在外面：浏览器地址栏
 * 收起来大约 56–72px，安卓的手势条 24–48px。两边留了一倍的余量。
 */
export const KEYBOARD_MIN_SHRINK = 120;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface KeyboardState {
  /** 没有键盘挡着的时候，这块视口有多高 */
  base: number;
  /** 上面那个基线是在哪个宽度上量的。宽度一变它就作废 */
  baseWidth: number;
  /** 键盘现在在不在 */
  up: boolean;
}

export function initialKeyboard(): KeyboardState {
  return { base: 0, baseWidth: -1, up: false };
}

/**
 * 量到一次新的视口尺寸，推出下一个状态。
 *
 * 纯函数是为了能在 Node 里把「转屏时不许误判」这类序列穷举着测 —— 真机上
 * 这些时序要靠手指去复现，而复现不了的 bug 只会一直在。
 */
export function stepKeyboard(prev: KeyboardState, size: ViewportSize): KeyboardState {
  const { width, height } = size;
  // 宽度换了 = 换了个布局（转屏、拖窗口）。旧基线和新高度不可比，从头来过。
  // 注意这一步**必须把 up 也清掉**：横屏的高度天然比竖屏矮几百像素，
  // 沿用旧基线的话一转屏就判成「键盘开着」，导航直接消失
  if (width !== prev.baseWidth) {
    return { base: height, baseWidth: width, up: false };
  }
  const base = Math.max(prev.base, height);
  return { base, baseWidth: width, up: base - height >= KEYBOARD_MIN_SHRINK };
}
