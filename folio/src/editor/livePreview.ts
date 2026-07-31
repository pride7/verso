/**
 * Live preview —— DESIGN.md §4.2
 *
 *   光标不在该节点范围内  →  Decoration.replace(widget)，渲染成最终形态
 *   光标进入该节点范围    →  移除 decoration，露出源码
 *
 * ## 为什么拆成两层
 *
 * CM6 有一条硬约束：**跨行的 replace decoration 和块级 decoration 都不能
 * 由 ViewPlugin 产出**，只能来自 StateField（"Decorations that replace line
 * breaks may not be specified via plugins"）。原因是它们改变文档的块结构，
 * CM6 必须在计算视口之前就知道。
 *
 * 而 §4.2 的性能红线要求「只扫 visibleRanges」，那又只有 ViewPlugin 能做到。
 * 两者不可兼得，所以按是否跨行分工：
 *
 *   - StateField：跨行的块级公式。数量少，全文扫描的代价可以接受。
 *   - ViewPlugin：行内的一切。只扫可视区，长文档里每次按键都不卡。
 */
import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { MathWidget } from "./widgets";

/** 只藏起标记符号（`**`、`==`、`#` 等），内容照常显示 */
const hideMark = Decoration.replace({});

const styleMarks = {
  wikiLink: Decoration.mark({ class: "cm-wikilink" }),
  embed: Decoration.mark({ class: "cm-embed" }),
  hashtag: Decoration.mark({ class: "cm-hashtag" }),
  highlight: Decoration.mark({ class: "cm-highlight" }),
  callout: Decoration.mark({ class: "cm-callout-marker" }),
};

/**
 * 光标（或选区）是否碰到了这个节点。
 *
 * 用闭区间而不是开区间：光标停在公式紧邻的位置时也要露出源码，否则
 * 想编辑一个公式却发现光标一挪到边界它就变回渲染态，根本改不了。
 */
function touched(state: EditorState, from: number, to: number) {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

function mathSource(state: EditorState, from: number, to: number, display: boolean) {
  const raw = state.doc.sliceString(from, to);
  const delim = display ? 2 : 1;
  return raw.slice(delim, raw.length - delim).trim();
}

function spansLines(state: EditorState, from: number, to: number) {
  return state.doc.lineAt(from).number !== state.doc.lineAt(to).number;
}

// ---------------------------------------------------------------------------
// 第一层：跨行块级公式（StateField）
// ---------------------------------------------------------------------------

function computeBlockMath(state: EditorState): DecorationSet {
  const marks: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "BlockMath") return;
      const { from, to } = node;
      // 单行的 `$$x$$` 交给 ViewPlugin，那边能享受可视区优化
      if (!spansLines(state, from, to)) return false;
      if (touched(state, from, to)) return false;
      const source = mathSource(state, from, to, true);
      if (!source) return false;
      marks.push(
        Decoration.replace({ widget: new MathWidget(source, true, from) }).range(from, to),
      );
      return false;
    },
  });
  return RangeSet.of(marks, true);
}

const blockMathField = StateField.define<DecorationSet>({
  create: computeBlockMath,
  update(deco, tr) {
    // 选区变化也要重算 —— 光标移进/移出公式正是切换源码与渲染态的时机
    if (!tr.docChanged && !tr.selection) return deco.map(tr.changes);
    return computeBlockMath(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// 第二层：行内内容（ViewPlugin，只扫可视区）
// ---------------------------------------------------------------------------

function buildInlineDecorations(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const state = view.state;
  const tree = syntaxTree(state);

  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    tree.iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        const { name, from, to } = node;

        switch (name) {
          case "InlineMath":
          case "BlockMath": {
            // 跨行的归 StateField 管，这里必须跳过，否则会触发
            // "Decorations that replace line breaks may not be specified via plugins"
            if (spansLines(state, from, to)) return false;
            if (touched(state, from, to)) return false;
            const display = name === "BlockMath";
            const source = mathSource(state, from, to, display);
            if (!source) return false;
            marks.push(
              Decoration.replace({
                widget: new MathWidget(source, display, from),
              }).range(from, to),
            );
            return false;
          }

          case "WikiLink":
          case "Embed": {
            if (touched(state, from, to)) return false;
            marks.push((name === "Embed" ? styleMarks.embed : styleMarks.wikiLink).range(from, to));
            return; // 继续进入子节点，好把 [[ ]] 藏掉
          }

          case "WikiLinkMarker":
            // 父节点被光标碰到时不会走到这里（上面 return false 了）
            if (from < to) marks.push(hideMark.range(from, to));
            return false;

          // 别名存在时藏掉目标名，只显示别名 —— [[特征值|左奇异向量]] 应当只显示后者
          case "WikiLinkTarget": {
            if (node.node.parent?.getChild("WikiLinkAlias")) marks.push(hideMark.range(from, to));
            return false;
          }

          case "Hashtag":
            marks.push(styleMarks.hashtag.range(from, to));
            return false;

          case "Highlight":
            if (touched(state, from, to)) return false;
            marks.push(styleMarks.highlight.range(from, to));
            return;

          case "HighlightMarker":
            marks.push(hideMark.range(from, to));
            return false;

          case "CalloutMarker":
            marks.push(styleMarks.callout.range(from, to));
            return false;

          // ---- 标准 Markdown 的标记符号 ----
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark": {
            const parent = node.node.parent;
            if (parent && touched(state, parent.from, parent.to)) return false;
            marks.push(hideMark.range(from, to));
            return false;
          }

          case "HeaderMark": {
            const parent = node.node.parent;
            if (parent && touched(state, parent.from, parent.to)) return false;
            // 连同标记后的空格一起藏，否则标题会莫名缩进一格
            const line = state.doc.lineAt(from);
            const end =
              from === line.from && state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
            if (from < end) marks.push(hideMark.range(from, end));
            return false;
          }
        }
        return;
      },
    });
  }

  // RangeSetBuilder 要求按 from 递增添加，而语法树遍历的产出顺序不保证如此
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of marks) builder.add(m.from, m.to, m.value);
  return builder.finish();
}

class InlinePreviewPlugin implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildInlineDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = buildInlineDecorations(update.view);
    }
  }
}

const inlinePreviewPlugin = ViewPlugin.fromClass(InlinePreviewPlugin, {
  decorations: (v) => v.decorations,
});

export const livePreview: Extension = [
  blockMathField,
  inlinePreviewPlugin,
  // 被替换掉的区域视为一个整体，否则方向键会「卡」进看不见的源码里，
  // 按一次左键光标像是没动
  EditorView.atomicRanges.of((view) => view.state.field(blockMathField, false) ?? Decoration.none),
  EditorView.atomicRanges.of(
    (view) => view.plugin(inlinePreviewPlugin)?.decorations ?? Decoration.none,
  ),
];
