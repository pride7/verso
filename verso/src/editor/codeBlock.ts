/**
 * 围栏代码块的 live preview。DESIGN.md §4.2
 *
 * 四件事一起做：给每一行加底色的行装饰、**把上下两行围栏藏起来**、
 * 给内容行编号、右上角挂一个复制按钮。
 *
 * 语法高亮不在这里 —— 那是 `markdown({ codeLanguages })` 按围栏上的语言
 * 标注嵌套解析出来的，配色在 theme.ts。
 *
 * ## 为什么合在一个 StateField 里
 *
 * 藏一整行要连它的换行符一起替换掉，那是跨行的 replace —— §4.2 那条 CM6
 * 硬约束：跨行 replace 只能来自 StateField，ViewPlugin 会直接报错。
 *
 * 而行装饰本来可以放 ViewPlugin（只扫可视区，更快）。但两边都要判断
 * 「光标碰到这个块没有」，分开写就有两处判断，迟早漂移成「围栏藏了但底色
 * 还在」这种半吊子状态。代码块数量少，全文扫描的代价可以接受。
 *
 * ## 为什么围栏该藏
 *
 * 其他标记（`#`、`**`、`>`、`[!note]`）光标移开都会藏起来，围栏留着就不一致。
 * 光标一进块内立刻露出源码，语言标注照样能改。
 */
import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import { isMermaidFenceLine, mermaidRendered } from "./mermaidBlock";
import { parseAdvanced, parseRefresh } from "./parseRefresh";
import { CodeCopyWidget } from "./widgets";

const hide = Decoration.replace({});

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

      const first = state.doc.lineAt(node.from);
      // ` ```verso-view ` 整块被 database 视图换掉了（viewBlock.ts），
      // 再叠一层底色会在视图周围留一圈灰边
      if (/^\s*```[ \t]*verso-view\b/.test(first.text)) return false;
      // ` ```mermaid ` 同理，但它只在**渲染成图的时候**让位：光标进去露出
      // 源码时它就是一个普通代码块，底色、行号、复制按钮都该照常有
      if (isMermaidFenceLine(first.text) && mermaidRendered(state, node.from, node.to)) return false;

      const last = state.doc.lineAt(node.to);
      const open = !touched(state, node.from, node.to);

      // **必须确认最后一行真的是收尾围栏。**
      //
      // 只判断"跨了多行"是不够的：围栏没闭合时（正在敲一个新代码块），
      // lezer 的 FencedCode 节点会一直延伸到文末，last 就是最后一行**内容**，
      // 把它藏掉等于把代码吃了。
      const closed = last.number > first.number && /^\s*```+\s*$/.test(last.text);

      const hideFences = open && closed;

      // 内容行的范围。围栏没闭合时最后一行是**内容**，不是收尾围栏
      const firstBody = first.number + 1;
      const lastBody = closed ? last.number - 1 : last.number;
      const bodyCount = lastBody - firstBody + 1;

      // 圆角标记要同时给围栏行**和**相邻的内容行。
      //
      // 藏围栏是连换行符一起替换的，CM6 会把围栏行和它相邻的内容行合并成
      // 一个可视行 —— 而合并之后只有一份行装饰生效（先遇到的那一份）。
      // 只标在围栏行上的话，圆角会跟着被藏起来的那一行一起消失。
      // 两边都标，哪一行活下来都对。
      //
      // 内容不超过一行时更进一步：首尾围栏和这一行内容会**全部**合成同一个
      // 可视行，活下来的只有开头围栏那一份装饰。不把 is-close 也补给它，
      // 单行代码块就会只有上半部分是圆角、下边还少一截内边距
      const oneVisualLine = hideFences && bodyCount <= 1;
      const opens = new Set([first.number, ...(hideFences ? [first.number + 1] : [])]);
      const closes = new Set([
        last.number,
        ...(hideFences ? [last.number - 1] : []),
        ...(oneVisualLine ? [first.number] : []),
      ]);

      // 只有一行内容就不编号 —— 给 `npm i` 标个「1」纯粹是噪音
      const numbered = bodyCount >= 2;

      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n);
        const isFence = n === first.number || (closed && n === last.number);
        const cls = [
          "cm-code",
          opens.has(n) ? "is-open" : "",
          closes.has(n) ? "is-close" : "",
          // 光标在块里时围栏是可见的源码，淡化一下；藏起来时就不需要了
          isFence && !open ? "is-fence" : "",
          // 编号占的那条左边距要整块一致，围栏行也得留 —— 否则光标一进来，
          // 露出的 ``` 会比下面的代码往左突出一截
          numbered ? "is-numbered" : "",
        ]
          .filter(Boolean)
          .join(" ");

        // 行号走行属性 + CSS 的 `::before`，不做成 widget：生成内容不进
        // 选区也不进剪贴板，框选整块代码复制出来才是干净的
        //
        // 开头的围栏被藏起来时它和第一行代码合成一个可视行，而合并之后
        // **生效的是围栏行的装饰**（CM6 的 ContentBuilder 先遇到谁用谁），
        // 所以「1」要同时挂到围栏行上。收尾那边相反 —— 文本先于替换出现，
        // 生效的本来就是最后一行内容，不用管
        const ln = n >= firstBody && n <= lastBody ? n - firstBody + 1 : hideFences && n === first.number ? 1 : 0;
        const attributes = numbered && ln ? { "data-ln": String(ln) } : undefined;

        marks.push(Decoration.line({ class: cls, attributes }).range(line.from));
      }

      // 复制按钮挂在**第一行内容**上，而不是围栏行上：围栏行会随光标
      // 进出而藏/显，挂在它上面按钮就跟着闪。空块（``` 紧接 ```）没什么可复制
      if (bodyCount >= 1) {
        const from = state.doc.line(firstBody).from;
        const code = state.doc.sliceString(from, state.doc.line(lastBody).to);
        marks.push(
          // side: 1 —— 藏围栏那个 replace 正好结束在这个位置上，
          // 排在它后面才不会被一起吞掉
          Decoration.widget({ widget: new CodeCopyWidget(code), side: 1 }).range(from),
        );
      }

      if (hideFences) {
        // 连换行符一起替换，整行才会消失。留下的第一行代码会顶到
        // 原来围栏那一行的位置上
        marks.push(hide.range(first.from, Math.min(first.to + 1, state.doc.length)));
        marks.push(hide.range(Math.max(last.from - 1, first.from), last.to));
      }

      return false;
    },
  });

  return RangeSet.of(marks, true);
}

const codeBlockField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    // 选区变化也要重算 —— 光标进出代码块正是切换源码与渲染态的时机。
    // 解析推进由 parseRefresh 派发 effect 通知（详见 parseRefresh.ts）
    const parsed = tr.effects.some((e) => e.is(parseAdvanced));
    if (!tr.docChanged && !tr.selection && !parsed) return deco.map(tr.changes);
    return build(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const codeBlocks: Extension = [parseRefresh, codeBlockField];
