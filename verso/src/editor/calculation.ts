/** 正文计算建议：`64 * 512 =` 后预览结果，Tab 才真正写入。 */
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { StateEffect, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";

import { calculateExpression } from "../core/calculation";
import { compositionActive } from "./compositionGuard";

const OPAQUE = new Set(["InlineCode", "CodeText", "FencedCode", "CodeBlock"]);

export interface CalculationSuggestion {
  at: number;
  expression: string;
  result: string;
  /** 接受建议时写入的内容；通常是一个空格加结果。 */
  insert: string;
}

/** 代码里的 `=` 是字面量，不能弹正文计算建议。 */
function inCode(state: EditorState, position: number): boolean {
  const at = Math.max(0, Math.min(position > 0 ? position - 1 : position, state.doc.length));
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (OPAQUE.has(node.name)) return true;
  }
  return false;
}

/** 去掉不属于算式的 Markdown 行首与公式开定界符。 */
function expressionText(source: string): string {
  let text = source.trim();
  text = text.replace(/^(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/, "").trim();
  if (text.startsWith("$$")) text = text.slice(2).trim();
  else if (text.startsWith("$")) text = text.slice(1).trim();
  return text;
}

/** 当前光标前有没有一条可接受的计算建议。纯函数，命令入口也复用它。 */
export function calculationSuggestion(state: EditorState): CalculationSuggestion | null {
  const selection = state.selection.main;
  if (!selection.empty || state.selection.ranges.length !== 1 || inCode(state, selection.head)) {
    return null;
  }

  const line = state.doc.lineAt(selection.head);
  const before = state.doc.sliceString(line.from, selection.head);
  const match = /^(.*)=([ \t]*)$/.exec(before);
  if (!match) return null;

  const expression = expressionText(match[1]);
  const result = calculateExpression(expression);
  if (result === null) return null;
  return {
    at: selection.head,
    expression,
    result,
    insert: match[2] ? result : ` ${result}`,
  };
}

/** 接受当前灰色建议。返回写入的结果，null 表示现在没有建议。 */
export function acceptCalculation(view: EditorView): string | null {
  const suggestion = calculationSuggestion(view.state);
  if (!suggestion) return null;
  view.dispatch({
    changes: { from: suggestion.at, insert: suggestion.insert },
    selection: { anchor: suggestion.at + suggestion.insert.length },
    userEvent: "input.calculation",
    scrollIntoView: true,
  });
  view.focus();
  return suggestion.result;
}

/**
 * 命令面板入口：优先接受现有建议；否则计算选区，或计算当前整行。
 * 结果仍写回纯 Markdown，没有只在 Verso 中才看得见的隐藏节点。
 */
export function calculateCurrent(view: EditorView): string | null {
  const accepted = acceptCalculation(view);
  if (accepted !== null) return accepted;

  const selection = view.state.selection.main;
  if (inCode(view.state, selection.head)) return null;

  if (!selection.empty) {
    const original = view.state.doc.sliceString(selection.from, selection.to);
    const leading = original.match(/^\s*/)?.[0] ?? "";
    const trailing = original.match(/\s*$/)?.[0] ?? "";
    let body = original.slice(leading.length, original.length - trailing.length);
    let open = "";
    let close = "";
    if (body.startsWith("$$") && body.endsWith("$$") && body.length > 4) {
      open = close = "$$";
      body = body.slice(2, -2).trim();
    } else if (body.startsWith("$") && body.endsWith("$") && body.length > 2) {
      open = close = "$";
      body = body.slice(1, -1).trim();
    }
    const hasEquals = /=\s*$/.test(body);
    const expression = expressionText(body.replace(/=\s*$/, ""));
    const result = calculateExpression(expression);
    if (result === null) return null;
    const replacement = `${leading}${open}${body}${hasEquals ? " " : " = "}${result}${close}${trailing}`;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: replacement },
      selection: { anchor: selection.from + replacement.length },
      userEvent: "input.calculation",
      scrollIntoView: true,
    });
    view.focus();
    return result;
  }

  const line = view.state.doc.lineAt(selection.head);
  const original = line.text;
  const trimmed = original.trim();
  let expressionSource = trimmed;
  let insertAt = line.to;
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
    expressionSource = trimmed.slice(2, -2);
    insertAt = line.from + original.lastIndexOf("$$");
  } else if (trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed.length > 2) {
    expressionSource = trimmed.slice(1, -1);
    insertAt = line.from + original.lastIndexOf("$");
  }
  const expression = expressionText(expressionSource);
  const result = calculateExpression(expression);
  if (result === null) return null;
  const insert = ` = ${result}`;
  view.dispatch({
    changes: { from: insertAt, insert },
    selection: { anchor: insertAt + insert.length },
    userEvent: "input.calculation",
    scrollIntoView: true,
  });
  view.focus();
  return result;
}

class CalculationWidget extends WidgetType {
  constructor(readonly suggestion: CalculationSuggestion) {
    super();
  }

  eq(other: CalculationWidget) {
    return other.suggestion.insert === this.suggestion.insert;
  }

  toDOM() {
    const dom = document.createElement("span");
    dom.className = "cm-calculation-suggestion";
    dom.title = "按 Tab 写入计算结果";
    dom.setAttribute("aria-label", `计算结果 ${this.suggestion.result}，按 Tab 写入`);

    const value = document.createElement("span");
    value.className = "cm-calculation-value";
    value.textContent = this.suggestion.insert;
    dom.append(value);

    const hint = document.createElement("span");
    hint.className = "cm-calculation-hint";
    hint.textContent = "Tab 写入";
    dom.append(hint);
    return dom;
  }

  ignoreEvent() {
    return true;
  }
}

function decorations(state: EditorState): DecorationSet {
  const suggestion = calculationSuggestion(state);
  if (!suggestion) return Decoration.none;
  return Decoration.set([
    Decoration.widget({ widget: new CalculationWidget(suggestion), side: 1 }).range(suggestion.at),
  ]);
}

class CalculationPreview implements PluginValue {
  decorations: DecorationSet;
  private composing = false;
  private dismissed: string | null = null;

  constructor(view: EditorView) {
    this.decorations = decorations(view.state);
  }

  visible() {
    return this.decorations.size > 0;
  }

  update(update: ViewUpdate) {
    // 和正文排版共用同一条输入法护栏：候选词还占着 contentDOM 时只移动旧
    // widget，不创建或销毁节点，避免在 macOS 上重新引入拼音残留问题。
    if (compositionActive(update.view)) {
      this.composing = true;
      this.decorations = this.decorations.map(update.changes);
      return;
    }
    const ended = this.composing;
    this.composing = false;
    if (update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(dismissCalculation)))) {
      const current = calculationSuggestion(update.state);
      this.dismissed = current ? `${current.at}:${current.expression}:${current.result}` : null;
      this.decorations = Decoration.none;
      return;
    }
    if (ended || update.docChanged || update.selectionSet) {
      const current = calculationSuggestion(update.state);
      const key = current ? `${current.at}:${current.expression}:${current.result}` : null;
      if (key !== this.dismissed) this.dismissed = null;
      this.decorations = this.dismissed ? Decoration.none : decorations(update.state);
    }
  }
}

const dismissCalculation = StateEffect.define<null>();

const calculationPreview = ViewPlugin.fromClass(CalculationPreview, {
  decorations: (plugin) => plugin.decorations,
});

/** 放在 snippet 之前：建议已经出现时，Tab 的明确含义就是接受结果。 */
export const calculationAssistance: Extension = [
  calculationPreview,
  keymap.of([
    {
      key: "Tab",
      run: (view) => {
        if (!view.plugin(calculationPreview)?.visible()) return false;
        return acceptCalculation(view) !== null;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        if (!view.plugin(calculationPreview)?.visible()) return false;
        view.dispatch({ effects: dismissCalculation.of(null) });
        return true;
      },
    },
  ]),
];
