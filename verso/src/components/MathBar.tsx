/**
 * 移动端公式工具条。DESIGN.md §5.5
 *
 * 符号表和「最近用过」的逻辑在 `lib/mathbar.ts`（那边能在 Node 里穷举着测），
 * 这里只管交互。
 *
 * ## 三个必须这样做的地方
 *
 * 1. **按下时必须 `preventDefault`。** 不拦的话浏览器会把焦点从编辑器挪到
 *    按钮上，软键盘随之收起、光标位置丢失 —— 用户点一个 `α` 的代价是键盘
 *    弹上弹下一轮。这条在桌面上完全看不出来，正是移动端最容易漏的一类。
 * 2. **长按出变体，但手指一动就取消。** 手机上横向滑动工具条是主要操作
 *    （一页放不下），滑动时手指必然在某个键上停留超过 500ms —— 不取消的话
 *    每滑一次都会弹出一个变体面板。
 * 3. **`←` `→` 常驻在最右边，不跟着分页滑走。** 它替代的是 Tab 键，而 Tab
 *    在任何一页上都要能按到。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { MATH_PAGES, loadRecent, pushRecent, saveRecent, type MathKey } from "../lib/mathbar";

interface Props {
  /** 插入一段带跳转点的 snippet */
  onInsert: (replacement: string) => void;
  onNext: () => void;
  onPrev: () => void;
}

/** 长按多久算长按。500ms 是移动端的通行值，短了会和「点一下」混淆 */
const LONG_PRESS_MS = 500;
/** 手指移动超过这么多像素就当成在滑动，取消长按 */
const MOVE_TOLERANCE = 8;

export function MathBar({ onInsert, onNext, onPrev }: Props) {
  const [page, setPage] = useState(0);
  const [recent, setRecent] = useState<MathKey[]>(() => loadRecent());
  /** 正在展开变体的那个键，以及它在屏幕上的横向位置 */
  const [variants, setVariants] = useState<{ key: MathKey; x: number } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** 长按已经触发过：松手时就不要再当成「点一下」插入一次 */
  const fired = useRef(false);

  const cancelPress = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancelPress, []);

  /**
   * 变体面板挂在被长按那个键的正上方，而靠右边的键会让它整个伸出屏幕 ——
   * 390px 宽的屏上，一行最后两三个键都会中招。
   *
   * **只能等它渲染出来再量**：面板有几个变体、每个多宽，都要等字体上屏才
   * 定得下来。用 `useLayoutEffect` 在浏览器绘制之前挪好，不然会看见它先
   * 歪一下再跳回来
   */
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || !variants) return;
    const w = el.getBoundingClientRect().width;
    const max = window.innerWidth - w - 6;
    el.style.left = `${Math.max(6, Math.min(variants.x, max))}px`;
  }, [variants]);

  const use = (key: MathKey) => {
    onInsert(key.insert);
    setRecent((list) => {
      const next = pushRecent(list, key);
      saveRecent(next);
      return next;
    });
    setVariants(null);
  };

  const press = (key: MathKey, e: React.PointerEvent<HTMLButtonElement>) => {
    // 焦点必须留在编辑器里，否则软键盘收起、光标丢失
    e.preventDefault();
    fired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    if (!key.variants) return;
    const el = e.currentTarget;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      const box = el.getBoundingClientRect();
      setVariants({ key, x: box.left });
    }, LONG_PRESS_MS);
  };

  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    if (Math.abs(e.clientX - s.x) > MOVE_TOLERANCE || Math.abs(e.clientY - s.y) > MOVE_TOLERANCE) {
      cancelPress();
    }
  };

  const release = (key: MathKey) => {
    const longPressed = fired.current;
    cancelPress();
    // 长按已经开了变体面板，松手不该再插一次
    if (!longPressed) use(key);
  };

  const keys = page === -1 ? recent : MATH_PAGES[page].keys;

  return (
    <div className="mathbar" role="toolbar" aria-label="公式符号">
      <div className="mathbar-pages">
        {/* 「最近」只在真有内容时出现 —— 一个永远空着的标签只是噪音 */}
        {recent.length > 0 && (
          <button
            className={page === -1 ? "is-on" : undefined}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setPage(-1)}
          >
            最近
          </button>
        )}
        {MATH_PAGES.map((p, i) => (
          <button
            key={p.id}
            className={page === i ? "is-on" : undefined}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setPage(i)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mathbar-row">
        <div className="mathbar-keys">
          {keys.map((key) => (
            <button
              key={key.insert}
              className={`mathbar-key${key.variants ? " has-more" : ""}`}
              aria-label={key.name ?? key.label}
              onPointerDown={(e) => press(key, e)}
              onPointerMove={move}
              onPointerUp={() => release(key)}
              onPointerCancel={cancelPress}
            >
              {key.label}
            </button>
          ))}
        </div>

        {/* 替代 Tab 键（§5.5）。常驻，不跟着分页滑走 */}
        <div className="mathbar-nav">
          <button
            aria-label="上一个位置"
            onPointerDown={(e) => e.preventDefault()}
            onClick={onPrev}
          >
            ←
          </button>
          <button
            aria-label="下一个位置"
            onPointerDown={(e) => e.preventDefault()}
            onClick={onNext}
          >
            →
          </button>
        </div>
      </div>

      {variants && (
        <>
          {/* 点别处收起来。盖住整屏而不是只盖工具条 —— 变体面板弹出来之后，
              用户下一个动作十有八九是「算了」 */}
          <div
            className="mathbar-scrim"
            onPointerDown={(e) => {
              e.preventDefault();
              setVariants(null);
            }}
          />
          <div className="mathbar-variants" ref={panelRef} style={{ left: variants.x }}>
            {variants.key.variants!.map((v) => (
              <button
                key={v.insert}
                aria-label={v.name ?? v.label}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => use(v)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
