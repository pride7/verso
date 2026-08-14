/**
 * snippet 提示条的 CodeMirror 接线。DESIGN.md §5.3
 *
 * 候选怎么挑在 `core/snippets/hint.ts`（纯函数，能脱离编辑器测）；这里只管
 * 「什么时候弹、弹在哪、按键怎么走」。
 *
 * ## 只在打字时弹
 *
 * 重算只挂在 `input.type` 上：光标移进一个已有的词中间、撤销、粘贴、
 * snippet 自己展开，都**不**弹。提示条是给「正在往下打」的人看的，
 * 在别的时机冒出来就只是弹窗。
 *
 * ## 锚在前缀的起点
 *
 * 不锚光标：候选列表一边收窄一边横向漂移，眼睛跟不住。锚在用户刚打下的
 * 那几个字符的开头，列表就钉在原地。
 */
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import katex from "katex";

import { mathContextAt } from "../mathContext";
import { expand } from "../../core/snippets/match";
import { hintsFor, type Hint } from "../../core/snippets/hint";
import { expansionSpec } from "./tabstops";
import type { Snippet } from "../../core/snippets/types";

/** 同 `snippets/index.ts`：触发词不跨行，往前看 64 个字符绰绰有余 */
const LOOKBEHIND = 64;

interface HintState {
  items: Hint[];
  /** 高亮到第几条，↑↓ 走它 */
  index: number;
  /** 前缀起点的文档位置，tooltip 锚在这里 */
  at: number;
}

const closeHint = StateEffect.define<null>();
/** ↑↓：−1 / +1 */
const moveHint = StateEffect.define<number>();

function hintAt(snippets: Snippet[], state: EditorState): HintState | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;

  const line = state.doc.lineAt(sel.head);
  const from0 = Math.max(line.from, sel.head - LOOKBEHIND);
  const textBefore = state.doc.sliceString(from0, sel.head);

  const items = hintsFor(snippets, textBefore, mathContextAt(state, sel.head) !== null);
  if (!items.length) return null;
  return { items, index: 0, at: sel.head - items[0].typed.length };
}

function hintField(snippets: Snippet[]) {
  return StateField.define<HintState | null>({
    // 打开笔记那一刻不弹：那不是「正在打字」
    create: () => null,

    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(closeHint)) return null;
        if (e.is(moveHint) && value) {
          const n = value.items.length;
          // 绕回去：候选最多八条，走到底再按一下回到开头比卡住自然
          return { ...value, index: (value.index + e.value + n) % n };
        }
      }
      if (tr.isUserEvent("input.type")) return hintAt(snippets, tr.state);
      // 其余任何改动或移动都收起来，不去猜用户还想不想看
      if (tr.docChanged || tr.selection) return null;
      return value;
    },

    provide: (f) =>
      showTooltip.from(f, (value) => (value ? tooltipFor(value) : null)),
  });
}

/**
 * 预览用的 KaTeX 结果按源码缓存。
 *
 * 和 `mathPreview` 那边的判断相反：那里每敲一个字符源码都不同，缓存只会被
 * 一次性的中间状态灌满；这里的源码来自固定的 snippet 库，同样几条会反复
 * 渲染，缓存命中率接近 100%，条目数也被库的大小封死。
 */
const previewCache = new Map<string, string>();

function preview(latex: string): string {
  let html = previewCache.get(latex);
  if (html === undefined) {
    html = katex.renderToString(latex, { throwOnError: false, strict: false, trust: false });
    previewCache.set(latex, html);
  }
  return html;
}

function row(hint: Hint, active: boolean): HTMLElement {
  const { snippet, typed } = hint;
  const dom = document.createElement("li");
  dom.className = `cm-snippet-hint-item${active ? " is-active" : ""}`;

  const trigger = document.createElement("code");
  trigger.className = "cm-snippet-hint-trigger";
  // 已经打出来的那截加重，剩下的淡一点 —— 「还差这几个字符」要一眼看出来
  const done = document.createElement("b");
  done.textContent = typed;
  trigger.append(done, snippet.trigger.slice(typed.length));
  dom.append(trigger);

  const latex = expand(snippet.replacement).text;
  if (latex.trim()) {
    const sym = document.createElement("span");
    sym.className = "cm-snippet-hint-preview";
    sym.innerHTML = preview(latex);
    dom.append(sym);
  }

  const desc = document.createElement("span");
  desc.className = "cm-snippet-hint-desc";
  desc.textContent = snippet.description ?? "";
  dom.append(desc);

  // 非自动展开的必须按 Tab，标出来 —— 不然会以为打完就有
  if (!snippet.auto) {
    const tab = document.createElement("kbd");
    tab.className = "cm-snippet-hint-key";
    tab.textContent = "Tab";
    dom.append(tab);
  }
  return dom;
}

function tooltipFor(value: HintState): Tooltip {
  return {
    pos: value.at,
    above: false,
    arrow: false,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-snippet-hint";

      const list = document.createElement("ul");
      list.className = "cm-snippet-hint-list";
      value.items.forEach((hint, i) => {
        const item = list.appendChild(row(hint, i === value.index));
        // mousedown 而不是 click：click 之前编辑器已经失焦一次，
        // 光标会先跳到点击处，展开就打在错的位置上
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          applyHint(view, hint);
        });
      });
      dom.append(list);

      const foot = document.createElement("div");
      foot.className = "cm-snippet-hint-foot";
      // 触屏上没有 Tab 也没有方向键，照抄桌面那行只会是句假话；
      // 列表本身仍然有用 —— 手机用户更不可能背下这些触发词
      foot.textContent = touch() ? "点一下插入" : "Tab 展开 · ↑↓ 选 · Esc 关";
      dom.append(foot);

      return { dom };
    },
  };
}

const touch = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

function applyHint(view: EditorView, hint: Hint) {
  const { text, tabstops } = expand(hint.snippet.replacement);
  const to = view.state.selection.main.head;
  const from = to - hint.typed.length;
  view.dispatch(expansionSpec(from, to, text, tabstops, from));
  view.focus();
}

/** 提示条正开着吗 —— 键位要据此决定让不让默认行为走 */
function active(field: StateField<HintState | null>, state: EditorState): HintState | null {
  return state.field(field, false) ?? null;
}

export function snippetHint(snippets: Snippet[]): Extension {
  const field = hintField(snippets);

  return [
    field,
    keymap.of([
      {
        // 放在 snippet 自己的 Tab 之前：提示条开着时，Tab 的明确含义是
        // 「就要高亮的这条」，不该再去猜跳转点或 tabout
        key: "Tab",
        run: (view) => {
          const value = active(field, view.state);
          if (!value) return false;
          applyHint(view, value.items[value.index]);
          return true;
        },
      },
      {
        key: "ArrowDown",
        run: (view) => {
          if (!active(field, view.state)) return false;
          view.dispatch({ effects: moveHint.of(1) });
          return true;
        },
      },
      {
        key: "ArrowUp",
        run: (view) => {
          if (!active(field, view.state)) return false;
          view.dispatch({ effects: moveHint.of(-1) });
          return true;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          if (!active(field, view.state)) return false;
          view.dispatch({ effects: closeHint.of(null) });
          return true;
        },
      },
    ]),
  ];
}

/** 测试用：不经 DOM 直接问「现在会弹哪几条」 */
export function hintItems(state: EditorState, snippets: Snippet[]): Hint[] {
  return hintAt(snippets, state)?.items ?? [];
}
