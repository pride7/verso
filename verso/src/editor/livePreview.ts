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
import type { SyntaxNode } from "@lezer/common";
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

import { parseAdvanced, parseRefresh } from "./parseRefresh";
import { calloutKind } from "./callout";
import { ImageWidget, imageSrc, looksLikeImage, parseWidth } from "./image";
import { BulletWidget, CalloutWidget, MathWidget, TaskWidget } from "./widgets";

/** 只藏起标记符号（`**`、`==`、`#` 等），内容照常显示 */
const hideMark = Decoration.replace({});

const styleMarks = {
  wikiLink: Decoration.mark({ class: "cm-wikilink" }),
  embed: Decoration.mark({ class: "cm-embed" }),
  hashtag: Decoration.mark({ class: "cm-hashtag" }),
  highlight: Decoration.mark({ class: "cm-highlight" }),
  callout: Decoration.mark({ class: "cm-callout-marker" }),
  taskDone: Decoration.mark({ class: "cm-task-done" }),
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

/** 取语法子节点的文本。`![[图.png|300]]` 的目标和别名都靠它拿 */
function childText(state: EditorState, node: SyntaxNode, name: string): string | null {
  const child = node.getChild(name);
  return child ? state.doc.sliceString(child.from, child.to) : null;
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
    // 选区变化也要重算 —— 光标移进/移出公式正是切换源码与渲染态的时机。
    // 解析推进由 parseRefresh 这个 ViewPlugin 检测后派发 effect 通知；
    // 不要在这里自己比较 syntaxTree（详见 parseRefresh.ts）。
    const parsed = tr.effects.some((e) => e.is(parseAdvanced));
    if (!tr.docChanged && !tr.selection && !parsed) return deco.map(tr.changes);
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
            // `![[图.png]]` 换成真图。别名段是宽度（§4.2），解析在 image.ts
            if (name === "Embed") {
              const target = childText(state, node.node, "WikiLinkTarget");
              if (target && looksLikeImage(target)) {
                const src = imageSrc(target);
                if (src) {
                  const alias = childText(state, node.node, "WikiLinkAlias");
                  marks.push(
                    Decoration.replace({
                      widget: new ImageWidget(src, target, parseWidth(alias), from, to),
                    }).range(from, to),
                  );
                  return false;
                }
              }
            }
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

          // 代码块整个交给 codeBlock.ts（那边要跨行藏围栏，只能在
          // StateField 里做）。这里**必须 return false 不往里走** ——
          // 否则下面的 CodeMark 分支会把围栏的反引号也藏掉，和那边的
          // 整行隐藏打架，结果是藏了 ``` 却留下语言标注
          case "FencedCode":
            return false;

          // ---- 引用块与 callout ----
          //
          // 靠**行装饰**画左侧色条和底色。行装饰不替换换行符，所以
          // ViewPlugin 里可以安全产出（那条硬约束只挡跨行的 replace）。
          case "Blockquote": {
            // 光标进来就整块回到源码，和别的 live preview 规则一致
            if (touched(state, from, to)) return false;

            // 按**首行文本**判断是不是 callout，不查语法树。
            //
            // `getChild("CalloutMarker")` 是错的：标记嵌在
            // Blockquote > Paragraph > CalloutMarker，而 getChild 只看直接
            // 子节点，永远返回 null —— 表现是 callout 全都退化成普通引用，
            // 但徽标又是好的（那条走的是另一个 case），很难看出问题在哪。
            const head = state.doc.lineAt(from);
            const m = /^\s*>\s*(\[!\s*[^\]\s]+\s*\][-+]?)/.exec(head.text);
            const kind = m ? calloutKind(m[1]) : null;

            const first = head.number;
            const last = state.doc.lineAt(to).number;
            for (let n = first; n <= last; n++) {
              const line = state.doc.line(n);
              const cls = [
                kind ? "cm-callout" : "cm-quote",
                kind ? `cm-callout-${kind.tone}` : "",
                n === first ? "is-open" : "",
                n === last ? "is-close" : "",
                kind && n === first ? "is-title" : "",
              ]
                .filter(Boolean)
                .join(" ");
              marks.push(Decoration.line({ class: cls }).range(line.from));
            }
            // 继续进入子节点，把 `>` 和 `[!note]` 藏掉
            return;
          }

          // `>` 连同后面那个空格一起藏掉 —— 左侧色条已经表明这是引用了
          case "QuoteMark": {
            const quote = node.node.parent;
            if (quote && touched(state, quote.from, quote.to)) return false;
            const end = state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
            marks.push(hideMark.range(from, end));
            return false;
          }

          case "CalloutMarker": {
            const quote = node.node.parent;
            if (quote && touched(state, quote.from, quote.to)) return false;
            const kind = calloutKind(state.doc.sliceString(from, to));
            // 标题写了就用标题，没写就用类型的中文名
            const rest = state.doc.sliceString(to, state.doc.lineAt(to).to).trim();
            const label = rest || kind.label;
            const end = rest ? to : state.doc.lineAt(to).to;
            marks.push(
              Decoration.replace({
                widget: new CalloutWidget(kind.tone, kind.icon, label),
              }).range(from, end),
            );
            // 标题已经进 widget 了，把原文那段也吃掉，否则会重复显示一遍
            if (rest) marks.push(hideMark.range(to, state.doc.lineAt(to).to));
            return false;
          }

          // ---- 标准 Markdown 的标记符号 ----
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark": {
            const parent = node.node.parent;
            if (parent && touched(state, parent.from, parent.to)) return false;
            marks.push(hideMark.range(from, to));
            return false;
          }

          // ---- 任务列表 ----
          //
          // GFM 把 `- [x] 事项` 解析成 ListItem > (ListMark, Task > TaskMarker)。
          // 光标进入这一行时整行回到源码，和别的 live preview 规则一致。
          case "TaskMarker": {
            const line = state.doc.lineAt(from);
            if (touched(state, line.from, line.to)) return false;
            const checked = /[xX]/.test(state.doc.sliceString(from + 1, from + 2));
            marks.push(
              Decoration.replace({ widget: new TaskWidget(checked, from) }).range(from, to),
            );
            // 勾掉的事项整行降级 —— 一眼能看出哪些做完了。
            // 只到行尾，不跨行，所以 ViewPlugin 里可以安全产出
            // 从文字开始划，跳过复选框后面那个空格 —— 不跳的话删除线
            // 会从框的右边伸出来一小截，像多了个短横
            const textStart = state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
            if (checked && textStart < line.to) {
              marks.push(styleMarks.taskDone.range(textStart, line.to));
            }
            return false;
          }

          case "ListMark": {
            const line = state.doc.lineAt(from);
            if (touched(state, line.from, line.to)) return false;
            // 有序列表的 `1.` 是内容的一部分，不能换成圆点
            if (!/^[-*+]$/.test(state.doc.sliceString(from, to))) return false;
            // 任务项的 `-` 直接藏掉：复选框本身已经表明这是一个列表项，
            // 再画个圆点会变成「• ☐ 事项」，多一个符号
            const isTask = !!node.node.parent?.getChild("Task");
            marks.push(
              (isTask
                ? hideMark
                : Decoration.replace({ widget: new BulletWidget() })
              ).range(from, to),
            );
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
  // RangeSetBuilder 要求按 (from, startSide) 递增添加，而语法树遍历的产出
  // 顺序不保证如此。startSide 必须参与排序 —— 行装饰的 startSide 比普通
  // mark 小得多，同一个位置上排错了会直接抛 "Ranges must be added sorted"
  marks.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide || a.to - b.to);
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
    // **解析推进也要重建。**
    //
    // 构造这个插件的那一刻文档往往还没解析完（CM6 的解析是 view 建好之后
    // 异步进行的），那时 `syntaxTree` 是空的，什么也算不出来。而下面三个
    // 条件都不包含"解析完成"，于是要等用户碰一下（挪光标、打个字）才补上。
    //
    // 平时不容易发现：打开笔记后总会有别的事件触发更新，看起来是好的。
    // 只有在"挂上去之后什么都不做"的场景（比如测试、或者纯阅读一篇笔记）
    // 才会露出源码。database 视图当初踩的是同一个坑，解法也一样 ——
    // 听 parseRefresh 派发的 effect。
    const parsed = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(parseAdvanced)),
    );
    if (update.docChanged || update.viewportChanged || update.selectionSet || parsed) {
      this.decorations = buildInlineDecorations(update.view);
    }
  }
}

const inlinePreviewPlugin = ViewPlugin.fromClass(InlinePreviewPlugin, {
  decorations: (v) => v.decorations,
});

export const livePreview: Extension = [
  parseRefresh,
  blockMathField,
  inlinePreviewPlugin,
  // 被替换掉的区域视为一个整体，否则方向键会「卡」进看不见的源码里，
  // 按一次左键光标像是没动
  EditorView.atomicRanges.of((view) => view.state.field(blockMathField, false) ?? Decoration.none),
  EditorView.atomicRanges.of(
    (view) => view.plugin(inlinePreviewPlugin)?.decorations ?? Decoration.none,
  ),
];
