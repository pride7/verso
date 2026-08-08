import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { renderInline } from "../editor/inline";
import { activeHeading, outlineDepths, type Heading } from "../core/outline";
import type { EditorHandle } from "./Editor";

/**
 * 大纲。DESIGN.md §6.3 里「编辑区右侧那一栏」的落地方式。
 *
 * 两个入口共用同一份数据：
 *
 * - **侧栏面板**（`OutlineView`）—— 和文档树、搜索、标签并列的第四个视图。
 *   跳转、看结构都在这里，也是「不能假设有键盘」那条要求的可点击入口。
 * - **浮动目录**（`OutlineFloat`）—— 贴在正文右侧的一排短横线，鼠标移上去
 *   才展开成文字。Notion 的那个。它的价值在于**不占版面**：侧栏是留给
 *   文档树的，而读长文时又总想知道「我在哪、下一节是什么」。
 *
 * 两者都放在这一个文件里：它们是同一个功能的两张脸，共享层级归一化和
 * 「当前在哪一节」的判定，拆开只会让两边慢慢长歪。
 */

interface Props {
  headings: Heading[];
  /** 当前所在的那一条，-1 表示视线还在第一条标题之前 */
  activeIndex: number;
  onPick: (h: Heading) => void;
}

/** 标题可以是空的（正在敲的 `## ` 就是），列表里得有东西占位 */
const EMPTY = "（无标题）";

/**
 * 大纲脱离 CodeMirror 渲染，标题里的 `$…$` 不会自动经过 live preview。
 * 复用表格那套安全的行内渲染器：只构造 DOM，既能显示 KaTeX，也不会把标题
 * 里的 HTML 当成可执行内容塞进页面。
 */
function OutlineLabel({ text, className }: { text: string; className: string }) {
  const mount = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) node.replaceChildren(renderInline(text));
    },
    [text],
  );
  return <span ref={mount} className={className} />;
}

/**
 * 「视线落在哪一节」。
 *
 * 判定依据是**滚动位置**而不是光标：读的时候光标可能停在几屏之外，
 * 那时候高亮光标所在的节，等于告诉用户一个他看不见的位置。
 *
 * 滚动的容器是 `.main`（编辑器本身不滚，见 styles.css「编辑区」一节），
 * 所以监听用捕获阶段的全局 scroll —— scroll 事件不冒泡，但会捕获。
 * 这样这个 hook 不必知道滚动容器是谁，App 也不必为它多传一个 ref。
 */
export function useActiveHeading(
  headings: Heading[],
  editorRef: React.MutableRefObject<EditorHandle | null>,
): number {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = editorRef.current?.topLine();
      setActive(top == null ? -1 : activeHeading(headings, top));
    };
    // 滚动一帧最多算一次。标题数量通常是几十条，但滚动事件是每像素来的
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    // 切笔记、改标题之后也要立刻重算，不能等下一次滚动
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [headings, editorRef]);

  return active;
}

/** 侧栏里的大纲面板 */
export function OutlineView({ headings, activeIndex, onPick }: Props) {
  const depths = outlineDepths(headings);

  if (headings.length === 0) {
    return (
      <p className="side-empty">
        这篇笔记还没有标题。
        <br />
        用 <code># 标题</code> 起一节，大纲会自己出现。
      </p>
    );
  }

  return (
    <ul className="side-list outline-list" aria-label="当前文档大纲">
      {headings.map((h, i) => {
        const text = h.text || EMPTY;
        return (
          <li key={`${h.line}:${i}`}>
            <button
              className={`outline-row depth-${depths[i]}${i === activeIndex ? " is-active" : ""}`}
              style={{ "--outline-indent": `${depths[i] * 12}px` } as CSSProperties}
              onClick={() => onPick(h)}
              title={`H${h.level} · ${text}`}
              aria-label={`${h.level} 级标题：${text}`}
            >
              {/* 数字圆点比写完整的 H1/H2 少占一半宽度；title 与 aria-label
                  仍明确说出它是标题等级，不会被误解成章节编号。 */}
              <span className="outline-level" aria-hidden="true">{h.level}</span>
              <OutlineLabel text={text} className={`outline-text lv-${depths[i]}`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 浮在正文右侧的目录。
 *
 * 收起时是一排右对齐的短横线，长度按层级递减 —— 不看也知道「这篇文章
 * 有多少节、结构多深」。鼠标移上去整条展开成标题文字。
 *
 * 展开完全交给 CSS（`:hover` / `:focus-within`），不用 React state：
 * 鼠标在十几个条目之间移动会把每一次进出都变成一次重渲染，而这里正好是
 * 用户视线所在的位置，掉帧最显眼。
 */
export function OutlineFloat({ headings, activeIndex, onPick }: Props) {
  const depths = outlineDepths(headings);

  return (
    <nav className="toc-float" aria-label="大纲">
      <ol className="toc-list">
        {headings.map((h, i) => (
          <li key={`${h.line}:${i}`}>
            <button
              className={`toc-item lv-${depths[i]}${i === activeIndex ? " is-active" : ""}`}
              onClick={() => onPick(h)}
              title={h.text || EMPTY}
            >
              <OutlineLabel text={h.text || EMPTY} className="toc-label" />
              <span className="toc-dash" />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
