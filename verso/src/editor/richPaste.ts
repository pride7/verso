/** 网页 HTML、选区 + URL 与普通文本粘贴共用的一条入口。 */
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { htmlToMarkdown } from "./htmlToMarkdown";
import { pastedMathText, pointInCode } from "./mathDelimiters";

function webUrl(value: string): string | null {
  const text = value.trim();
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

function linkLabel(value: string): string {
  return value.replace(/\s*\n+\s*/g, " ").replace(/([\\\]])/g, "\\$1");
}

function destination(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** 右键菜单和原生 paste 事件共用，确保“选中文字后贴 URL”不会分叉。 */
export function textForPaste(state: EditorState, value: string): string {
  const selection = state.selection.main;
  if (!selection.empty && !pointInCode(state, selection.from)) {
    const url = webUrl(value);
    const selected = state.doc.sliceString(selection.from, selection.to);
    if (url && selected.trim()) return `[${linkLabel(selected)}](${destination(url)})`;
  }
  return pastedMathText(state, value).text;
}

function insert(view: EditorView, value: string, userEvent = "input.paste") {
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: value },
    selection: { anchor: selection.from + value.length },
    userEvent,
    scrollIntoView: true,
  });
}

export function richTextPaste() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const plain = event.clipboardData?.getData("text/plain") ?? "";
      const selection = view.state.selection.main;

      // 明确的“选区 + 单个网址”优先于 HTML：从地址栏复制的网址有时也附带
      // 一小段 <a>，但用户的意图仍是给当前选区加链接。
      if (!selection.empty && webUrl(plain) && !pointInCode(view.state, selection.from)) {
        event.preventDefault();
        insert(view, textForPaste(view.state, plain));
        return true;
      }

      const html = event.clipboardData?.getData("text/html") ?? "";
      if (html && !pointInCode(view.state, selection.from)) {
        const markdown = htmlToMarkdown(html);
        if (markdown) {
          event.preventDefault();
          insert(view, pastedMathText(view.state, markdown).text, "input.paste.html");
          return true;
        }
      }

      // Markdown language 包自身也会尝试“选区 + URL”，但它把含空格的多段
      // 文本也包成链接。只要有选区，就由这一份规则完整接管普通文本粘贴。
      if (!selection.empty && plain) {
        event.preventDefault();
        insert(view, textForPaste(view.state, plain));
        return true;
      }
      return false;
    },
  });
}
