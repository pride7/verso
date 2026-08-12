/**
 * CodeMirror 6 的组装。DESIGN.md §4
 *
 * 有意不用 `basicSetup` —— 它塞了行号、代码折叠、括号匹配高亮这些
 * 代码编辑器的东西。这是笔记软件，正文区域应当看起来像一篇排好版的文章。
 */
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, dropCursor, rectangularSelection } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

import type { NoteRef } from "../core/types";

import { autoFence } from "./autoFence";
import { calculationAssistance } from "./calculation";
import { codeBlocks } from "./codeBlock";
import { completion } from "./completion";
import { compositionKeyGuard, compositionTracker } from "./compositionGuard";
import { headingFolding } from "./fold";
import { insertMarkdownLineBreak } from "./lineBreak";
import { listRenumber } from "./listRenumber";
import { livePreview } from "./livePreview";
import { markdownExtended } from "./markdownExtended";
import { mathDelimiterPaste } from "./mathDelimiters";
import { mathPreview } from "./mathPreview";
import { paragraphSpacing } from "./paragraphSpacing";
import { imagePaste, type SaveAttachment } from "./paste";
import { richTextPaste } from "./richPaste";
import { snippetEngine } from "./snippets";
import { tables } from "./table";
import { parseCustomSnippets } from "../core/snippets/custom";
import type { SnippetSpec } from "../core/snippets/types";
import { versoHighlighting, versoTheme } from "./theme";
import { typography } from "./typography";
import { viewBlocks } from "./viewBlock";

export { mathContextAt, type MathContext } from "./mathContext";

/**
 * 自定义 snippet 单独放一个 compartment。
 *
 * 不这么做的话，在设置里改一条 snippet 就得重建整个 EditorView —— 光标位置、
 * 撤销历史、滚动位置全丢。compartment 让这次改动只是一次 reconfigure。
 */
const snippetCompartment = new Compartment();

/**
 * 实时预览的全部装饰。**源码模式就是把这一组整个摘掉。**
 *
 * 顺序有讲究，和它们原来在 `createExtensions` 里的先后一致：
 * `viewBlocks` 替换整个代码块，优先级必须高于代码块自身的高亮；
 * `tables` 同理。
 *
 * 高亮（`versoHighlighting`）**不在这一组里** —— 源码模式要看的是
 * Markdown 源码，不是纯文本。标题仍然大、代码仍然是等宽，只是 `##`、
 * `**` 这些标记不再被藏起来，公式和表格也不再被渲染成最终形态。
 */
// mathPreview 也在这组里：源码模式的本意是「只看源码」，光标扫过每个
// 公式都弹预览会变成干扰
const PREVIEW: Extension = [livePreview, codeBlocks, viewBlocks, tables, paragraphSpacing, mathPreview];

/**
 * 预览装饰单独放一个 compartment，理由和 snippet 那个一样：
 * 切一次模式就丢光标、丢撤销历史、丢滚动位置的话，这个开关只会被用一次。
 */
const previewCompartment = new Compartment();

/** 切源码模式。`on` 为真时摘掉全部 live preview 装饰 */
export function applySourceMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: previewCompartment.reconfigure(on ? [] : PREVIEW) });
}

/** 设置里的自定义 snippet 变了之后调它。返回解析过程中的错误，供设置界面显示 */
export function applyCustomSnippets(view: EditorView, text: string): string[] {
  const { specs, errors } = parseCustomSnippets(text);
  view.dispatch({
    effects: snippetCompartment.reconfigure(snippetEngine({ custom: specs })),
  });
  return errors;
}

export interface EditorCallbacks {
  onChange: (body: string) => void;
  onSaveNow: () => void;
  /** 点击 `[[链接]]` 时触发，参数是链接目标文本 */
  onFollowLink: (target: string) => void;
  /**
   * 当前笔记清单，`[[` 补全用。
   *
   * 用 getter 而不是直接传数组：新建/删除笔记后清单会变，传死的话
   * 得重建整个编辑器，光标和撤销历史全没了。
   */
  getNotes: () => NoteRef[];
  /** 设置里的自定义 snippet（Latex Suite 格式的 JSON 文本） */
  customSnippets?: SnippetSpec[];
  /** 建 view 时是不是源码模式。之后的切换走 `applySourceMode` */
  sourceMode?: boolean;
  /** 粘贴图片或拖入文件时存进 vault，返回相对路径。不给就不接管文件传入 */
  saveAttachment?: SaveAttachment;
  /** 存附件失败时报给用户 —— 粘贴没反应是最难自查的一类问题 */
  onError?: (msg: string) => void;
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
    // 有意不用 drawSelection：它自绘的选区把中间行整行铺满（代码编辑器
    // 风格），在排好版的文章里显得一大块底色悬在文字外。原生 ::selection
    // 只贴着文字画，和 Obsidian 一致。它的另一个卖点是多光标/矩形选区的
    // 渲染，而本项目从未启用 allowMultipleSelections，用不上。
    // 颜色在 theme.ts 的 `::selection`，光标色是 .cm-content 的 caret-color
    dropCursor(),
    rectangularSelection(),
    EditorView.lineWrapping,

    // 放在 markdown() 前面：lang-markdown 自己也会把“选区 + 看起来像 URL 的
    // 文本”包成链接，而且连含空格的多个网址也会误包。事件必须先经过 Verso
    // 的严格规则，网页 HTML 也由这里转成 Markdown。
    richTextPaste(),

    markdown({
      base: markdownLanguage,
      extensions: [GFM, markdownExtended],
      // 代码块内按围栏上的语言标注高亮。
      //
      // M1 时这里是空数组，理由是「为几个片段加载一堆语言包不值得」——
      // 现在不成立了：`@codemirror/language-data` 里每条都是 `LanguageDescription`，
      // 语法包是**用到才动态 import** 的。一篇笔记里没有 Rust 代码块，
      // Rust 的语法包就一个字节都不会读进来。
      //
      // 加载是异步的，解析完树会变 —— 块级 decoration 靠 parseRefresh
      // 的 ViewPlugin 察觉树变化后重算（见 parseRefresh.ts）
      codeLanguages: languages,
    }),

    versoTheme,
    versoHighlighting,

    // 输入法组词事件的统一账本。必须在 PREVIEW 外面：源码模式虽然摘掉
    // live preview，typography 仍然存在，同样不能在 WebKit 组词时改 DOM。
    compositionTracker,
    // 候选词确认的 Enter 只准上屏，不能随后又被默认 keymap 插入一行。
    compositionKeyGuard,

    // §4.3 中西文混排间距。**不进 PREVIEW** —— 它只改字距，不藏任何标记，
    // 源码模式下同样该有：那时读的仍然是中英混排的文字
    typography,

    // §4 标题折叠。**不放进 PREVIEW** —— 源码模式下折叠仍然有用，
    // 那时正是在长文里找东西的时候
    headingFolding,

    // live preview（含 §2.6 database 视图与 §2.4 表格）。整组可摘 —— 见 PREVIEW
    previewCompartment.of(cb.sourceMode ? [] : PREVIEW),
    linkClickHandler(cb.onFollowLink),

    // §4.3 粘贴图片。用 getter 取回调 —— 和 getNotes 同理，App 那边每次
    // 渲染都是新函数，直接闭包进来会让编辑器跟着重建
    imagePaste(
      () => cb.saveAttachment,
      (m) => cb.onError?.(m),
    ),
    // 从论文、聊天工具或 LaTeX 文档粘贴公式时，把 \(...\) / \[...\]
    // 换成 Verso 能渲染的 $...$ / $$...$$。图片粘贴优先走上面那条。
    mathDelimiterPaste(),

    // `64 * 512 =` 后只显示可忽略的结果建议；Tab 才写进 Markdown。
    // 放在 snippet 前面，让屏幕上已经明确出现的「Tab 写入」优先于 tabout。
    calculationAssistance,

    // §5 公式快速输入。必须排在 defaultKeymap 之前 —— snippet 的 Tab
    // 处理要先于「插入缩进」拿到这个键
    snippetCompartment.of(snippetEngine({ custom: cb.customSnippets })),

    // 打完 ``` 自动补收尾围栏。放在 snippet 之后 —— 两者都用
    // transactionFilter，先到的先决定这次输入怎么处理
    autoFence,

    // 删除/粘贴之后把有序列表的编号排顺（1,2,3 删掉 2，剩下的 3 变 2）。
    // 不进 PREVIEW —— 改的是源码本身，源码模式同样该生效
    listRenumber,

    // `[[` 内部链接与 `/` 块插入菜单（§4.3）
    completion(cb.getNotes),

    keymap.of([
      {
        key: "Shift-Enter",
        preventDefault: true,
        run: insertMarkdownLineBreak,
      },
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
