import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { tabLabels } from "../core/tabs";

interface Props {
  tabs: string[];
  active: number;
  /** 前几个是固定的。固定的排在最前，见 `lib/tabs.ts` */
  pinnedCount: number;
  /** 有未保存改动的那一个（同一时刻至多一个 —— 切页会先落盘） */
  dirtyPath?: string | null;
  /**
   * 路径 → 文档图标（§2.3）。标签是等宽的，名字先被截断，
   * 图标恰好是这时候还认得出「哪一页是哪一页」的东西
   */
  icons?: Record<string, string>;
  onPick: (index: number) => void;
  onClose: (index: number) => void;
  onCloseOthers: (index: number) => void;
  onTogglePin: (index: number) => void;
  /** `to` 是移走之后的目标下标 */
  onMove: (from: number, to: number) => void;
  /** 紧跟在最后一个标签后面的 `+`：新建文档，开在新标签上 */
  onNewTab: () => void;
}

/**
 * 右键菜单的大致宽度，只用来把它从窗口右边缘往回收。
 *
 * 写死一个数而不是渲染完再量：量的话得先画出来、再挪一次，屏幕上会看到
 * 一次跳动。差个十几像素不影响这件事要解决的问题。
 */
const MENU_W = 176;

/**
 * 标签栏。
 *
 * 只画和交互，状态迁移全在 `lib/tabs.ts` 那些纯函数里 —— 「关了之后跳到谁」
 * 「拖动之后当前页是哪个」这类规则是一堆边界情况，放在组件里没法单独验。
 */
export function TabBar({
  tabs,
  active,
  pinnedCount,
  dirtyPath,
  icons,
  onPick,
  onClose,
  onCloseOthers,
  onTogglePin,
  onMove,
  onNewTab,
}: Props) {
  const labels = tabLabels(tabs);
  const strip = useRef<HTMLDivElement | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  /** 右键菜单：开在哪个标签上、以及横向落点（相对标签栏） */
  const [menu, setMenu] = useState<{ i: number; x: number } | null>(null);

  // 切到看不见的那个标签时把它滚进来 —— 快捷键切页和「点了链接跳过去」
  // 都可能落在视野外，那时候屏幕上什么都没变，看着像没生效
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(".tab.is-active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (tabs.length === 0) return null;

  return (
    <div className="tabbar" role="tablist" aria-label="打开的笔记">
      <div className="tab-strip" ref={strip}>
        {tabs.map((path, i) => (
          <div
            key={path}
            className={
              `tab${i === active ? " is-active" : ""}` +
              `${dirtyPath === path ? " is-dirty" : ""}` +
              `${dropAt === i ? " is-drop" : ""}` +
              `${i < pinnedCount ? " is-pinned" : ""}` +
              // 固定区和其余标签之间画一条竖线。没有这条线，"前几个是固定的"
              // 就只能靠一个个看图钉去数
              `${pinnedCount > 0 && i === pinnedCount - 1 ? " is-last-pinned" : ""}`
            }
            role="tab"
            aria-selected={i === active}
            title={`${path}${i < pinnedCount ? "（已固定）" : ""}\n双击${
              i < pinnedCount ? "取消固定" : "固定"
            }`}
            draggable
            onMouseDown={(e) => {
              // 中键关闭。用 mousedown 而不是 click —— 中键在 Windows 上
              // 会先触发自动滚动，等到 click 时目标元素可能已经不在了
              if (e.button === 1) {
                e.preventDefault();
                onClose(i);
              } else if (e.button === 0) {
                onPick(i);
              }
            }}
            // 双击切换固定。VS Code 的双击是"从预览变成正式打开"，我们没有
            // 预览态，这个手势正好空着 —— 而固定值得有一个不用开菜单的入口
            onDoubleClick={() => onTogglePin(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              // 菜单开在鼠标底下，不是永远钉在左上角 —— 标签栏可以很长，
              // 在第 9 个标签上右键、菜单弹在最左边会让人以为点错了。
              // 靠右边时要往回收，否则它会伸到窗口外面
              const box = e.currentTarget.closest(".tabbar")?.getBoundingClientRect();
              const x = e.clientX - (box?.left ?? 0);
              setMenu({ i, x: Math.max(0, Math.min(x, (box?.width ?? 0) - MENU_W)) });
            }}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              // 必须塞点东西，否则 Firefox 不认这次拖动
              e.dataTransfer.setData("text/verso-tab", String(i));
              setDragFrom(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropAt(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i);
              setDragFrom(null);
              setDropAt(null);
            }}
          >
            {/* 固定标记放在名字左边。放右边会和 × 抢位置，而 × 是每个标签
                都要有的 */}
            {i < pinnedCount && <Icon name="pin" size={11} className="tab-pin" />}
            {/* 图标只在设过的时候出现。标签栏一共就 168px，给每一页都留一个
                空位换不来对齐（图钉已经让左边缘参差了），只会更挤 */}
            {icons?.[path] && (
              <span className="tab-icon emoji" aria-hidden>
                {icons[path]}
              </span>
            )}
            <span className="tab-name">{labels[i]}</span>
            {/* × 常驻。标签现在等宽，右边本来就留着这块地方 —— 藏起来只
                换来一个"要先猜它在哪"的按钮。没在当前页时压暗一档，不抢视线。
                有未保存改动时显示圆点，鼠标移到这个标签上才换回 × */}
            <button
              className="tab-close"
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClose(i);
              }}
              title="关闭"
              aria-label={`关闭 ${labels[i]}`}
            >
              <Icon name="close" size={12} />
            </button>
            <span className="tab-dot" aria-hidden />
          </div>
        ))}

        {/* 紧贴最后一个标签，**跟着标签条一起滚** —— 浏览器就是这样，
            手会顺着最后一个标签摸过去。钉在标签栏最右端的话，标签一多，
            它和最后一个标签之间会隔着一大片空白，看着不像一组东西 */}
        <button
          className="tab-new"
          onClick={onNewTab}
          title="新建文档"
          aria-label="新建文档"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      {menu && (
        <ul
          className="side-menu tab-menu"
          style={{ left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(
            [
              {
                label: menu.i < pinnedCount ? "取消固定" : "固定",
                icon: "pin",
                run: () => onTogglePin(menu.i),
              },
              // 「改状态」和「关掉东西」之间隔一条线：菜单一长，手快的时候
              // 很容易点错，而这两件事的代价差得远
              { label: "关闭", icon: "close", sep: true, run: () => onClose(menu.i) },
              {
                label: "关闭其他",
                icon: "close",
                hint: pinnedCount > 0 ? "固定的留着" : undefined,
                run: () => onCloseOthers(menu.i),
              },
            ] as const
          ).map((item) => (
            <li key={item.label} className={"sep" in item && item.sep ? "is-sep" : undefined}>
              <button
                onClick={() => {
                  setMenu(null);
                  item.run();
                }}
              >
                {/* 一列纯文字的菜单要逐行读；带图标之后眼睛能直接跳到那一条 */}
                <Icon name={item.icon} size={14} />
                {item.label}
                {"hint" in item && item.hint && <span className="menu-hint">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
