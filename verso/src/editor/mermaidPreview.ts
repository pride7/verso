/**
 * Mermaid 输入预览。DESIGN.md §4.11
 *
 * 和公式那边（mathPreview.ts）同一个道理：光标一进代码块，live preview 就
 * 退回源码 —— 于是正在画图的那一刻恰恰看不到图，写没写对要把光标挪出去才
 * 知道。这里在**代码块下方**接一块预览，随输入重画。
 *
 * ## 为什么不是 tooltip（公式那种）
 *
 * 试过，挡住源码。tooltip 是浮层：要 `above` 就得上方装得下，装不下 CM6 会
 * 把它翻到下面 —— 而那一面正是代码块自己，于是一整块源码被盖住。公式的预览
 * 只有一行高，翻转也就压住半行；一张图动辄几百像素，翻下来什么都看不见了。
 *
 * 块级 widget 没有这个问题：它**占文档的位置**（进高度图、参与滚动），永远
 * 不压在任何东西上面，页面自己往下让。
 *
 * ## 为什么 `eq` 说不等、`updateDOM` 却复用同一个 DOM
 *
 * 源码一变 widget 就是新的（`eq` 为假），但要是让 CM6 重建 DOM，每敲一个
 * 字符预览都会闪一下白、还会丢掉「上一张画成功的图」。所以 `updateDOM` 就地
 * 更新并返回 true —— 防抖与上一版的状态挂在 DOM 上，跨过 widget 实例的更替。
 */
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { cachedMermaid, renderMermaid } from "./mermaid";
import { mermaidBlocks, type MermaidBlock } from "./mermaidBlock";
import { parseAdvanced } from "./parseRefresh";

/** 手停多久开始画。太短会在打字中途排布局，太长又像没反应 */
const DELAY = 300;

/** 光标所在的那个 mermaid 块，没有就是 null */
function blockAt(state: EditorState): MermaidBlock | null {
  const head = state.selection.main.head;
  for (const block of mermaidBlocks(state)) {
    if (head > block.from && head < block.to) return block;
  }
  return null;
}

interface Painter {
  timer?: ReturnType<typeof setTimeout>;
  /** 最后一次交给渲染的源码。用来跳过「没变」和作废「过期的那一版」 */
  wanted: string;
  /** 已经画上去过一张图没有。没有的话出错时只能显示报错 */
  drawn: boolean;
}

const painters = new WeakMap<HTMLElement, Painter>();

function draw(dom: HTMLElement, source: string, view: EditorView) {
  const painter = painters.get(dom);
  if (!painter || painter.wanted === source) return;
  painter.wanted = source;

  const paint = (result: { svg?: string; error?: string }) => {
    // 画的时候源码又变了（异步渲染期间用户还在打字）：这一版作废，
    // 后面那次渲染会带着新的源码回来
    if (painter.wanted !== source || !painters.has(dom)) return;
    if (result.svg) {
      dom.classList.remove("is-stale");
      dom.innerHTML = result.svg;
      painter.drawn = true;
    } else if (!painter.drawn) {
      // 一张都还没画成过，这时只能说这句 —— 空着更让人以为是坏了
      dom.textContent = result.error ?? "图表语法有误";
    } else {
      // 已经有上一张图了，留着它，只是淡一点表示「这一版还没画出来」
      dom.classList.add("is-stale");
    }
    // 图的高度和占位那一行差着几百像素，高度图得跟着更新，
    // 否则正文往下滚会滚不到底
    view.requestMeasure();
  };

  // 缓存里现成的就同步画：切回一张画过的图不该也等这一拍
  const ready = cachedMermaid(source);
  if (ready) {
    paint(ready);
    return;
  }
  if (!painter.drawn) dom.textContent = "图表渲染中…";
  clearTimeout(painter.timer);
  painter.timer = setTimeout(() => void renderMermaid(source).then(paint), DELAY);
}

class MermaidPreviewWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: MermaidPreviewWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-mermaid-preview";
    painters.set(dom, { wanted: "", drawn: false });
    draw(dom, this.source, view);
    return dom;
  }

  updateDOM(dom: HTMLElement, view: EditorView) {
    if (!painters.has(dom)) return false;
    draw(dom, this.source, view);
    return true;
  }

  destroy(dom: HTMLElement) {
    clearTimeout(painters.get(dom)?.timer);
    painters.delete(dom);
  }

  /** 预览是给人看的，不参与编辑 —— 点它不该把光标搬进来 */
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const block = blockAt(state);
  if (!block) return Decoration.none;
  const source = state.doc.sliceString(block.bodyFrom, block.bodyTo);
  // block widget 只能落在行边界上（CM6 的硬约束）。收尾围栏那一行的行尾
  // 就是这一块的末尾，预览接在它下面
  const at = state.doc.lineAt(block.to).to;
  return RangeSet.of([
    Decoration.widget({ widget: new MermaidPreviewWidget(source), block: true, side: 1 }).range(at),
  ]);
}

const mermaidPreviewField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    // 解析推进由 parseRefresh 派发 effect 通知（详见 parseRefresh.ts）。
    // syntaxTree 在这里只是被 blockAt 间接用到，规矩一样
    const parsed = tr.effects.some((e) => e.is(parseAdvanced));
    if (!tr.docChanged && !tr.selection && !parsed) return deco.map(tr.changes);
    return build(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const mermaidPreview: Extension = mermaidPreviewField;

/** 测试用：当前 state 会不会挂出预览 */
export function mermaidPreviewCount(state: EditorState): number {
  // syntaxTree 要先解析过才数得准，和别的块级 decoration 同理
  syntaxTree(state);
  let n = 0;
  build(state).between(0, state.doc.length, () => {
    n++;
  });
  return n;
}
