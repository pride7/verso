/**
 * 图标。DESIGN.md §6
 *
 * 原来用的是 Unicode 字符（▤ ⌕ # ▣ ⌘ ⚙），问题是它们来自不同的 Unicode
 * 区块，由**不同字体**渲染 —— 笔画粗细、视觉大小、基线各不相同，摆在一竖排
 * 里一眼就能看出是凑的。这是「界面看起来没做完」最主要的来源。
 *
 * 换成内联 SVG，全部遵守同一套规则：
 *
 * - **16×16 网格**，内容留 1px 边距（即实际作图区 14×14）
 * - **描边 1.5px**，`round` 的端点与连接
 * - **只用 `currentColor`**，颜色由 CSS 继承，深浅主题自动跟随
 * - 不引图标库：几十个路径而已，引一个包要多几百 KB，还多一份升级负担
 *
 * 视觉大小要**手调而不是照搬几何尺寸**：圆形看起来天生比同尺寸方形小，
 * 所以放大镜的圆比标签的方块画得大一点点。
 */

interface Props {
  name: IconName;
  /** 像素尺寸，默认 16。整体缩放，描边会跟着变细 —— 别用它做大图标 */
  size?: number;
  className?: string;
}

export type IconName = keyof typeof PATHS;

/**
 * 每个图标就是一段 `<path>`/`<g>` 内容。
 *
 * 有意不做成「一个字符串一条 path」—— 有些图标需要多个元素（终端的箭头和
 * 下划线是两段），硬塞进一条 path 会让 `d` 变得没法读也没法改。
 */
const PATHS = {
  /** 文档树：带缩进的三条线，一眼能看出是层级而不是普通列表 */
  tree: (
    <>
      <path d="M2.5 4h5" />
      <path d="M6 8h5.5" />
      <path d="M6 12h5.5" />
      <path d="M4 5.5v5A1.5 1.5 0 0 0 5.5 12" />
    </>
  ),
  /**
   * 大纲：逐级缩进的四条线。
   *
   * 和 `tree` 的区别必须一眼看出来 —— 它俩都是「缩进的线」。这里靠两点分开：
   * 没有那道折角连接线（层级用缩进表达，不用连线），并且**右端参差**
   * （标题长短不一），而 tree 的两条子项是等长的。
   */
  outline: (
    <>
      <path d="M2.5 3.4h11" />
      <path d="M6 6.6h7.5" />
      <path d="M6 9.8h5.5" />
      <path d="M9.5 13h4" />
    </>
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.3" />
      <path d="M10.4 10.4 13.5 13.5" />
    </>
  ),
  /** 标签牌。小圆点是穿绳孔 —— 没有它就成了个普通五边形 */
  tag: (
    <>
      <path d="M8.4 2.5H13a.5.5 0 0 1 .5.5v4.6a1 1 0 0 1-.3.7l-5.2 5.2a1 1 0 0 1-1.4 0L2.9 9.9a1 1 0 0 1 0-1.4l5.2-5.2a1 1 0 0 1 .3-.8Z" />
      <circle cx="10.8" cy="5.2" r=".9" />
    </>
  ),
  /** 终端：提示符的箭头 + 光标下划线 */
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M5 6.8 6.8 8.5 5 10.2" />
      <path d="M8.8 10.4h2.6" />
    </>
  ),
  /** 命令面板。Mac 的 ⌘ —— 作者喜欢 Mac 的观感，这个符号在那边是通用语 */
  command: (
    <path d="M5.9 2.6a1.7 1.7 0 1 1-1.7 1.7v7.4a1.7 1.7 0 1 1 1.7 1.7h4.2a1.7 1.7 0 1 1 1.7-1.7V4.3a1.7 1.7 0 1 1-1.7-1.7Z" />
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
    </>
  ),
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  /** 展开箭头。折叠态用 CSS 旋转，不另画一个 —— 旋转还能做动画 */
  chevron: <path d="M6 3.5 10.5 8 6 12.5" />,
  /** 换 vault */
  vault: (
    <>
      <path d="M2.5 12.5v-8a1 1 0 0 1 1-1h3l1.4 1.6h4.6a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z" />
    </>
  ),
} as const;

export function Icon({ name, size = 16, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      // 图标是纯装饰，旁边的 title/aria-label 才是给读屏软件的内容
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
