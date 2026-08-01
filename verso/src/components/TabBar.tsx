import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { tabLabels } from "../lib/tabs";

interface Props {
  tabs: string[];
  active: number;
  /** 有未保存改动的那一个（同一时刻至多一个 —— 切页会先落盘） */
  dirtyPath?: string | null;
  onPick: (index: number) => void;
  onClose: (index: number) => void;
  onCloseOthers: (index: number) => void;
  /** `to` 是移走之后的目标下标 */
  onMove: (from: number, to: number) => void;
}

/**
 * 标签栏。
 *
 * 只画和交互，状态迁移全在 `lib/tabs.ts` 那些纯函数里 —— 「关了之后跳到谁」
 * 「拖动之后当前页是哪个」这类规则是一堆边界情况，放在组件里没法单独验。
 */
export function TabBar({
  tabs,
  active,
  dirtyPath,
  onPick,
  onClose,
  onCloseOthers,
  onMove,
}: Props) {
  const labels = tabLabels(tabs);
  const strip = useRef<HTMLDivElement | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<number | null>(null);

  // 切到看不见的那个标签时把它滚进来 —— 快捷键切页和「点了链接跳过去」
  // 都可能落在视野外，那时候屏幕上什么都没变，看着像没生效
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(".tab.is-active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);

  useEffect(() => {
    if (menu === null) return;
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
              `${dropAt === i ? " is-drop" : ""}`
            }
            role="tab"
            aria-selected={i === active}
            title={path}
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
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(i);
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
            <span className="tab-name">{labels[i]}</span>
            {/* 未保存的圆点占的是关闭按钮那个位置，悬停时才换成 × ——
                两个都常驻会让标签栏右边挤成一排小图标 */}
            <button
              className="tab-close"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClose(i);
              }}
              title="关闭"
              aria-label={`关闭 ${labels[i]}`}
            >
              <Icon name="close" size={11} />
            </button>
            <span className="tab-dot" aria-hidden />
          </div>
        ))}
      </div>

      {menu !== null && (
        <ul className="side-menu tab-menu" onMouseDown={(e) => e.stopPropagation()}>
          <li>
            <button
              onClick={() => {
                const i = menu;
                setMenu(null);
                onClose(i);
              }}
            >
              关闭
            </button>
          </li>
          <li>
            <button
              onClick={() => {
                const i = menu;
                setMenu(null);
                onCloseOthers(i);
              }}
            >
              关闭其他
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
