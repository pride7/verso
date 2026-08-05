/**
 * 公式输入预览。DESIGN.md §5.3
 *
 * 光标一进公式，live preview 就退回源码（§4.2）—— 于是正在编辑的那一刻
 * 恰恰看不到渲染结果，写没写对要把光标挪出去才知道。这里在公式上方挂一个
 * tooltip，随每次输入用 KaTeX 实时重渲染当前源码，Obsidian 的同款体验。
 *
 * 锚在**公式起点**而不是光标：输入时预览才不会跟着光标横向乱跳。
 */
import { type EditorState, type Extension, StateField } from "@codemirror/state";
import { showTooltip, type Tooltip } from "@codemirror/view";
import katex from "katex";

import { mathContextAt } from "./mathContext";
import { mathSource } from "./mathSource";
import { parseAdvanced } from "./parseRefresh";

function tooltipFor(state: EditorState): Tooltip | null {
  const ctx = mathContextAt(state, state.selection.main.head);
  // 未闭合的行内公式不弹（`open` 只出现在数 `$` 的兜底路径）：那条路
  // 会把 `$5 起，精装 $20` 之间也判成公式（§5.2 的已知取舍）。误触发
  // snippet 无所谓，但弹一个把中文当 LaTeX 渲染的预览就太扎眼了。
  // 块级公式没有这个问题 —— 没闭合的 `$$` 解析器也会建出 BlockMath。
  if (!ctx || ctx.open) return null;

  const src = mathSource(state, ctx.from, ctx.to, ctx.kind === "block");
  if (!src) return null;

  const display = ctx.kind === "block";
  return {
    pos: ctx.from,
    above: true,
    arrow: false,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-math-preview";
      // throwOnError: false —— 正在输入中的公式几乎总是「暂时不合法」，
      // 此时 KaTeX 把源码按错误色渲染出来，比整个预览闪没了更有用
      dom.innerHTML = katex.renderToString(src, {
        displayMode: display,
        throwOnError: false,
        strict: false,
        trust: false, // 同 widgets.ts：笔记可能来自他人，不放行 \href 等
      });
      return { dom };
    },
  };
}

/**
 * 不做 LRU 缓存（widgets.ts 那份是给滚动复用的）：这里每敲一个字符源码
 * 都不同，缓存只会被一次性的中间状态灌满，反而把真正会复用的条目挤掉。
 * 单条公式的同步渲染在毫秒级，直接算。
 */
const mathPreviewField = StateField.define<Tooltip | null>({
  create: tooltipFor,
  update(value, tr) {
    // 解析推进也要重算 —— 打开笔记那一刻语法树还是空的（同 livePreview）
    const parsed = tr.effects.some((e) => e.is(parseAdvanced));
    if (!tr.docChanged && !tr.selection && !parsed) return value;
    return tooltipFor(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

export const mathPreview: Extension = mathPreviewField;
