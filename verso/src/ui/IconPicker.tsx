import { useEffect, useMemo, useRef, useState } from "react";

import { EMOJI_GROUPS, normalizeIcon, recentIcons, searchEmoji } from "../core/emoji";
import { Icon } from "./Icon";

interface Props {
  /** 这篇笔记现在的图标，用来在网格里标出「就是它」 */
  current?: string | null;
  /**
   * 弹在哪。给屏幕坐标 = 贴着触发它的那个东西弹；null = 居中的浮层
   * （命令面板走这条，那时没有可以贴的坐标）。
   */
  anchor: { x: number; y: number } | null;
  /** 选了一个。`null` = 去掉图标 */
  onPick: (icon: string | null) => void;
  onClose: () => void;
}

/** 面板尺寸。定位要在渲染前算，所以这两个数得先知道 */
const W = 316;
const H = 360;

/**
 * 图标选择器（§2.3 的 frontmatter `icon`）。
 *
 * **`position: fixed` 而不是绝对定位。** 它的两个入口一个在文档树里、一个
 * 在面包屑上，两处都长在滚动容器里 —— 绝对定位的浮层会被祖先的 `overflow`
 * 裁掉，而裁剪不改变 `getBoundingClientRect`，查 DOM 的测试一路全绿，屏幕
 * 上却一个像素都看不见（v0.5.38 栽过一次，见 AGENTS.md）。代价是页面一滚
 * 它会留在原地，所以滚动时直接关掉。
 */
export function IconPicker({ current, anchor, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const recent = useMemo(() => recentIcons(), []);
  const hits = useMemo(() => searchEmoji(query), [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 别让 Escape 顺着冒上去关掉别的东西（侧栏抽屉、命令面板）
        e.stopPropagation();
        onClose();
      }
    };
    // 页面滚了就关掉 —— fixed 的浮层不跟着祖先滚，留在原地会指着错的东西。
    //
    // **但面板自己的滚动不算。** 这个监听必须挂在捕获阶段（scroll 不冒泡，
    // 不挂捕获就收不到任何一个滚动容器的滚动），于是面板内部那一列图标滚
    // 一下也会被收到 —— 结果是「一往下滑它就消失」。按事件源头分开：
    // 源头在面板里，就是用户正在翻图标，什么都不做
    const onScroll = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  /**
   * 搜不到时的出路：把输入的东西**本身**当图标。
   *
   * 这张表只有一百多个，用户想用「囍」或者某个没收进来的 emoji 时，
   * 不该只能去手写 YAML。normalizeIcon 保证进去的是一个字符（§lib/emoji）
   */
  const literal = hits.length === 0 ? normalizeIcon(query) : null;

  const cell = (ch: string) => (
    <button
      key={ch}
      className={`icon-cell${ch === current ? " is-current" : ""}`}
      title={ch}
      onClick={() => onPick(ch)}
    >
      <span className="emoji">{ch}</span>
    </button>
  );

  const style: React.CSSProperties = anchor
    ? {
        // 贴着锚点弹，但不许伸出窗口 —— 树上靠底部的那几行会把它顶出去
        left: Math.max(8, Math.min(anchor.x, window.innerWidth - W - 8)),
        top: Math.max(8, Math.min(anchor.y, window.innerHeight - H - 8)),
      }
    : { left: "50%", top: "18vh", transform: "translateX(-50%)" };

  return (
    <div
      className="icon-picker"
      ref={panel}
      style={{ ...style, width: W, maxHeight: H }}
      role="dialog"
      aria-label="选择图标"
    >
      <div className="icon-picker-head">
        <input
          autoFocus
          className="icon-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜图标，或直接粘一个字符"
          spellCheck={false}
        />
        {/* 「去掉图标」常驻，不藏在别的菜单里 —— 设错了图标想撤销是最急的
            一次点击，而它此刻正盯着这个面板 */}
        <button
          className="icon-clear"
          onClick={() => onPick(null)}
          disabled={!current}
          title="去掉图标"
          aria-label="去掉图标"
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      <div className="icon-picker-body">
        {query ? (
          <>
            {hits.length > 0 && <div className="icon-grid">{hits.map((e) => cell(e.ch))}</div>}
            {literal && (
              <div className="icon-literal">
                <button className="icon-cell" onClick={() => onPick(literal)}>
                  <span className="emoji">{literal}</span>
                </button>
                <span>用「{literal}」作为图标</span>
              </div>
            )}
            {hits.length === 0 && !literal && <p className="icon-empty">没有匹配的图标</p>}
          </>
        ) : (
          <>
            {recent.length > 0 && (
              <section className="icon-section">
                <h4>最近使用</h4>
                <div className="icon-grid">{recent.map(cell)}</div>
              </section>
            )}
            {EMOJI_GROUPS.map((group) => (
              <section className="icon-section" key={group.name}>
                <h4>{group.name}</h4>
                <div className="icon-grid">{group.items.map((e) => cell(e.ch))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
