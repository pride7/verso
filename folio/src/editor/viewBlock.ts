/**
 * 把 ` ```folio-view ` 代码块替换成渲染好的 database 视图。DESIGN.md §2.6
 *
 * 与公式一样走 live preview 的规则：光标进入代码块时露出源码，移开就渲染。
 * 块级替换必须来自 StateField（§4.2 里那条 CM6 硬约束）。
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

/** 由 App 注入：把一个 DOM 容器渲染成 React 的 DatabaseView */
export interface ViewRenderer {
  mount: (el: HTMLElement, source: string) => void;
  unmount: (el: HTMLElement) => void;
}

let renderer: ViewRenderer | null = null;

export function setViewRenderer(r: ViewRenderer) {
  renderer = r;
}

class ViewBlockWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: ViewBlockWidget) {
    return other.source === this.source;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-dbview";
    // 先放占位，React 挂上之后会覆盖。没有它的话「decoration 没生成」和
    // 「React 没挂上」两种失败长得一模一样，都是一片空白。
    el.textContent = "database 视图加载中…";
    renderer?.mount(el, this.source);
    return el;
  }

  destroy(dom: HTMLElement) {
    renderer?.unmount(dom);
  }

  /** 表格里要能点击、能输入，事件不能被编辑器拦下 */
  ignoreEvent() {
    return true;
  }
}

function touched(state: EditorState, from: number, to: number) {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

function build(state: EditorState): DecorationSet {
  const marks: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const text = state.doc.sliceString(node.from, node.to);
      const m = /^```[ \t]*folio-view[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(text);
      if (!m) return;
      if (touched(state, node.from, node.to)) return false;

      marks.push(
        Decoration.replace({ widget: new ViewBlockWidget(m[1]) }).range(node.from, node.to),
      );
      return false;
    },
  });

  return RangeSet.of(marks, true);
}

const viewBlockField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    // 不要在这里比较 syntaxTree 来判断「解析推进了」，也不要在 build() 里
    // 用 ensureSyntaxTree —— StateField 的更新顺序不保证语言字段已为新
    // state 更新完，那时拿到的是空树，结果是每次都算出空的 decoration 集，
    // 视图全部消失。实测踩过两次。
    // 代价：初始视口之外的视图要等一次编辑或光标移动才出现（已知限制）。
    if (!tr.docChanged && !tr.selection) return deco.map(tr.changes);
    return build(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const viewBlocks: Extension = [
  viewBlockField,
  EditorView.atomicRanges.of((view) => view.state.field(viewBlockField, false) ?? Decoration.none),
];
