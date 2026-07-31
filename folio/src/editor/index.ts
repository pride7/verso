/**
 * CodeMirror 6 的组装。DESIGN.md §4
 *
 * 有意不用 `basicSetup` —— 它塞了行号、代码折叠、括号匹配高亮这些
 * 代码编辑器的东西。这是笔记软件，正文区域应当看起来像一篇排好版的文章。
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor, rectangularSelection } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

import { livePreview } from "./livePreview";
import { markdownExtended } from "./markdownExtended";
import { snippetEngine } from "./snippets";
import { folioHighlighting, folioTheme } from "./theme";

export { mathContextAt, type MathContext } from "./mathContext";

export interface EditorCallbacks {
  onChange: (body: string) => void;
  onSaveNow: () => void;
  /** 点击 `[[链接]]` 时触发，参数是链接目标文本 */
  onFollowLink: (target: string) => void;
}

/** 点击内部链接时跳转。放在 CM6 层是因为要拿到点击位置对应的语法节点。 */
function linkClickHandler(onFollowLink: (target: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.target instanceof HTMLElement)) return false;
      // 只处理被标成 wikilink 的区域
      if (!event.target.closest(".cm-wikilink")) return false;
      const pos = view.posAtDOM(event.target);
      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1);
      for (; node; node = node.parent) {
        if (node.name === "WikiLink" || node.name === "Embed") {
          const target = node.getChild("WikiLinkTarget");
          if (target) {
            event.preventDefault();
            onFollowLink(view.state.doc.sliceString(target.from, target.to));
            return true;
          }
        }
      }
      return false;
    },
  });
}

export function createExtensions(cb: EditorCallbacks): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    EditorView.lineWrapping,

    markdown({
      base: markdownLanguage,
      extensions: [GFM, markdownExtended],
      // 关掉代码块内的语言高亮：笔记里的代码块大多是片段，
      // 为它加载一堆语言包不值得，M1 先不做
      codeLanguages: [],
    }),

    folioTheme,
    folioHighlighting,
    livePreview,
    linkClickHandler(cb.onFollowLink),

    // §5 公式快速输入。必须排在 defaultKeymap 之前 —— snippet 的 Tab
    // 处理要先于「插入缩进」拿到这个键
    snippetEngine(),

    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          cb.onSaveNow();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]),

    EditorView.updateListener.of((u) => {
      if (u.docChanged) cb.onChange(u.state.doc.toString());
    }),
  ];
}
