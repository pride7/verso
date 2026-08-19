/** 网页 HTML、选区 + URL 与普通文本粘贴共用的一条入口。 */
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { htmlToMarkdown, plainTextIsSource } from "./htmlToMarkdown";
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

/**
 * 插入并把光标放到插入内容之后。
 *
 * **光标位置必须按 `Text` 算，不能按原字符串的 `length`。** CM6 收下字符串时
 * 会按 `/\r\n?|\n/` 切行，`\r\n` 存进文档只剩一个 `\n` —— 而 Windows 上从
 * VS Code、记事本、浏览器复制出来的正是 CRLF。按原串长度算出来的位置比文档
 * 末尾**多出「有几个 `\r`」那么多**，CM 检查选区时直接抛
 * `RangeError: Selection points outside of document`，整个事务连同插入一起
 * 作废 —— 屏幕上的表现是「粘贴毫无反应，一个字都没进来」。
 */
function insert(view: EditorView, value: string, userEvent = "input.paste") {
  const selection = view.state.selection.main;
  const text = view.state.toText(value);
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
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

      // 只有排版样式、没有任何结构的 HTML 不算富文本：那是编辑器复制源码时
      // 附带的一层包装，用户复制的就是 Markdown 本身。走 HTML 那条路只会把
      // `**加粗**` 当字面量转义掉、把挨着的行拆成一段一段，所以这里退回纯文本。
      const html = event.clipboardData?.getData("text/html") ?? "";
      const rich = !!html && !plainTextIsSource(html, plain);
      if (rich && !pointInCode(view.state, selection.from)) {
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
