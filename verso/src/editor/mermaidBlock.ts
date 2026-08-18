/**
 * 把 ` ```mermaid ` 代码块替换成渲染好的图。DESIGN.md §4.11
 *
 * 与公式、database 视图一样走 live preview 的规则：光标进代码块就露出源码，
 * 移开就渲染。块级替换必须来自 StateField（§4.2 里那条 CM6 硬约束）。
 *
 * 渲染本身是异步的（mermaid 要先动态 import 再跑一遍布局），所以 widget 先
 * 挂占位、拿到 SVG 再填 —— 这一点和同步的 KaTeX 不同，也是这里比
 * `viewBlock.ts` 多出来的复杂度。
 */
import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { cachedMermaid, onMermaidThemeChange, renderMermaid } from "./mermaid";
import { parseAdvanced, parseRefresh } from "./parseRefresh";

/** 围栏上的语言标注是不是 mermaid。`mermaid` 后面还跟别的参数时不算 */
export function isMermaidInfo(info: string): boolean {
  return info.trim().toLowerCase() === "mermaid";
}

/**
 * 这一行是不是 mermaid 块的开围栏。
 *
 * 给 `codeBlock.ts` 用：它按行工作，拿不到语法树上的 `CodeInfo`。两处认的
 * 必须是同一件事，所以规则只有 `isMermaidInfo` 这一份。
 */
export function isMermaidFenceLine(text: string): boolean {
  const fence = /^\s*(?:```|~~~)(.*)$/.exec(text);
  return !!fence && isMermaidInfo(fence[1]);
}

/**
 * 光标要**真的落在块里面**才退回源码。
 *
 * 与 `viewBlock.ts` 同一份判断，理由也一样：边界也算「碰到」的话，在图的
 * 上下一行点一下、或者从相邻行按一下方向键，整张图就变回一段源码 —— 而那
 * 两个位置恰恰最常落到。
 */
function touched(state: EditorState, from: number, to: number) {
  for (const r of state.selection.ranges) {
    if (r.empty ? r.from > from && r.from < to : r.from < to && r.to > from) return true;
  }
  return false;
}

/**
 * 这一块现在是渲染成图了，还是露着源码。
 *
 * `codeBlock.ts` 据此决定要不要给它画代码块的底色：换成图之后再叠一层底色，
 * 图周围就多一圈灰边。
 */
export function mermaidRendered(state: EditorState, from: number, to: number): boolean {
  return !touched(state, from, to);
}

/** 一个 mermaid 块：整块的范围，以及块内源码那一段的范围 */
export interface MermaidBlock {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
  source: string;
}

/** 正文里所有 mermaid 块。渲染与预览共用同一份识别规则 */
export function mermaidBlocks(state: EditorState): MermaidBlock[] {
  const out: MermaidBlock[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const info = node.node.getChild("CodeInfo");
      if (!info || !isMermaidInfo(state.doc.sliceString(info.from, info.to))) return false;
      const body = node.node.getChild("CodeText");
      // 空块（```mermaid 紧接 ```）没有 CodeText。它照样是个 mermaid 块 ——
      // 只是渲染出来是一句「空的图表」，而不是让整块掉回普通代码块
      const bodyFrom = body ? body.from : node.to;
      const bodyTo = body ? body.to : node.to;
      out.push({
        from: node.from,
        to: node.to,
        bodyFrom,
        bodyTo,
        source: state.doc.sliceString(bodyFrom, bodyTo),
      });
      return false;
    },
  });
  return out;
}

/**
 * 每个已挂上的图对应的收尾动作（取消主题订阅、别再往已经移走的 DOM 上画）。
 *
 * 挂在 DOM 上而不是 widget 实例上：同一个 widget 实例可能被 CM6 拿去建第二
 * 个 DOM，存在实例上的话前一份订阅就再也取消不掉了。
 */
const cleanups = new WeakMap<HTMLElement, () => void>();

class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    /** 块内源码那一段的开头。「编辑」按钮把光标送到这里 */
    readonly bodyFrom: number,
  ) {
    super();
  }

  eq(other: MermaidWidget) {
    return other.source === this.source && other.bodyFrom === this.bodyFrom;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-mermaid";

    const body = document.createElement("div");
    body.className = "cm-mermaid-body";
    el.appendChild(body);

    const edit = document.createElement("button");
    edit.className = "cm-mermaid-edit";
    edit.type = "button";
    edit.textContent = "编辑";
    edit.title = "编辑图表源码";
    // 整块是 atomic range，方向键一步跨过去 —— 这个按钮和双击是**唯一**
    // 进得去的路（同 viewBlock.ts 的「看源码」）
    const editSource = () => view.dispatch({ selection: { anchor: this.bodyFrom }, scrollIntoView: true });
    edit.addEventListener("click", editSource);
    el.appendChild(edit);
    el.addEventListener("dblclick", editSource);

    let alive = true;
    const paint = (result: { svg?: string; error?: string }) => {
      if (!alive) return;
      el.classList.toggle("is-error", !!result.error);
      if (result.svg) {
        // innerHTML 的受控例外，同 KaTeX：mermaid 在 `securityLevel: "strict"`
        // 下关掉标签内 HTML 与 click 交互，并用 DOMPurify 洗过这段 SVG
        body.innerHTML = result.svg;
        return;
      }
      // 出错时把源码一并显示出来：图没了又看不见源码的话，屏幕上就只剩
      // 一句报错，连自己写了什么都得先点「编辑」才知道
      body.textContent = "";
      const message = document.createElement("p");
      message.className = "cm-mermaid-message";
      message.textContent = result.error ?? "图表语法有误";
      const source = document.createElement("pre");
      source.textContent = this.source;
      body.append(message, source);
    };

    const ready = cachedMermaid(this.source);
    if (ready) {
      paint(ready);
    } else {
      body.textContent = "图表渲染中…";
      void renderMermaid(this.source).then(paint);
    }

    // 图是渲染成 SVG 存下来的，不像 CSS 那样自己会跟着主题变色
    const unsubscribe = onMermaidThemeChange(() => {
      void renderMermaid(this.source).then(paint);
    });
    cleanups.set(el, () => {
      alive = false;
      unsubscribe();
    });

    return el;
  }

  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
    cleanups.delete(dom);
  }

  /** 「编辑」按钮要点得动，事件不能被编辑器拦下 */
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const marks: Range<Decoration>[] = [];
  for (const block of mermaidBlocks(state)) {
    if (touched(state, block.from, block.to)) continue;
    marks.push(
      Decoration.replace({ widget: new MermaidWidget(block.source, block.bodyFrom) })
        .range(block.from, block.to),
    );
  }
  return RangeSet.of(marks, true);
}

const mermaidBlockField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    // 解析推进由 parseRefresh 派发 effect 通知 —— 不要在这里自己比较
    // syntaxTree（详见 parseRefresh.ts）
    const parsed = tr.effects.some((e) => e.is(parseAdvanced));
    if (!tr.docChanged && !tr.selection && !parsed) return deco.map(tr.changes);
    return build(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const mermaidBlockExtension: Extension = [
  parseRefresh,
  mermaidBlockField,
  EditorView.atomicRanges.of((view) => view.state.field(mermaidBlockField, false) ?? Decoration.none),
];

/** 测试用：数一数当前 state 会渲染出多少张图 */
export function mermaidBlockCount(state: EditorState): number {
  let n = 0;
  build(state).between(0, state.doc.length, () => {
    n++;
  });
  return n;
}
