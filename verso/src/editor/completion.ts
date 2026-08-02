/**
 * 两个补全来源：`[[` 内部链接、`/` 块插入菜单。DESIGN.md §4.3
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

import { rankNotes } from "../lib/fuzzy";
import type { NoteRef } from "../types";
import { mathContextAt } from "./mathContext";

/**
 * `[[` 内部链接补全。
 *
 * 笔记清单用 getter 拿而不是当参数传死 —— 新建/删除笔记后清单会变，
 * 传死的话得重建整个编辑器，光标和撤销历史全没了。
 */
export function wikiLinkSource(getNotes: () => NoteRef[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    // `[[` 之后、`]]` 之前的部分。不允许跨行和嵌套 `[`
    const m = ctx.matchBefore(/\[\[[^\]\n[]*/);
    if (!m) return null;
    // 只有 `[[` 还没打完整时不弹，避免打单个 `[` 就跳出来
    if (m.text.length < 2) return null;

    const query = m.text.slice(2);
    const notes = getNotes();
    const ranked = rankNotes(notes, query, 30);

    const options: Completion[] = ranked.map((r) => ({
      label: r.item.name,
      detail: r.item.path.replace(/\.md$/, ""),
      // 已经打了 `[[`，补全时把 `]]` 一起补上，省一次手动收尾
      apply: `${r.item.name}]]`,
      type: "text",
    }));

    // 没有匹配时给一条「新建」——wiki 式写作里，链到还不存在的笔记是常态
    if (query.trim() && !options.some((o) => o.label === query)) {
      options.push({
        label: query,
        detail: "新建这篇笔记",
        apply: `${query}]]`,
        type: "keyword",
        boost: -50,
      });
    }

    return {
      from: m.from + 2,
      options,
      // 输入过程中持续过滤，不要每敲一个字符重新触发一轮
      validFor: /^[^\]\n[]*$/,
    };
  };
}

/** `/` 菜单里那几条「不插文本、交回给 App 做一件事」的选项 */
export type SlashAction = "template" | "journal" | "issues";

interface Block {
  label: string;
  detail: string;
  /** `|` 标出插入后光标应当停的位置。有 `action` 的条目不用它 */
  template?: string;
  /**
   * 不插文本，而是让 App 做一件事（目前只有「插入模板」）。
   *
   * 为什么放进 `/` 菜单而不是只做成命令：`/` 是写作过程中手不离键盘的
   * 入口，而插入模板恰恰发生在写作中途。只藏在命令面板里的功能，
   * 不知道它存在的人永远不会用到（§4.3 里 `/` 菜单存在的同一个理由）。
   */
  action?: SlashAction;
}

/**
 * `/` 命令菜单。§4.3 里说它是「Markdown 也能有 Notion 手感」的关键 ——
 * 用户不需要记语法，输入 `/` 选「三级标题」，编辑器插入 `### `。
 * 存储仍然是纯文本。
 */
const BLOCKS: Block[] = [
  { label: "一级标题", detail: "# ", template: "# |" },
  { label: "二级标题", detail: "## ", template: "## |" },
  { label: "三级标题", detail: "### ", template: "### |" },
  { label: "无序列表", detail: "- ", template: "- |" },
  { label: "有序列表", detail: "1. ", template: "1. |" },
  { label: "待办", detail: "- [ ] ", template: "- [ ] |" },
  { label: "引用", detail: "> ", template: "> |" },
  { label: "提示 callout", detail: "> [!note]", template: "> [!note] |\n> " },
  { label: "警告 callout", detail: "> [!warning]", template: "> [!warning] |\n> " },
  { label: "代码块", detail: "```", template: "```|\n\n```" },
  { label: "分隔线", detail: "---", template: "---\n|" },
  { label: "表格", detail: "GFM 表格", template: "| | |\n|---|---|\n| | |\n|" },
  { label: "行内公式", detail: "$…$", template: "$|$" },
  { label: "块级公式", detail: "$$…$$", template: "$$\n|\n$$" },
  { label: "内部链接", detail: "[[…]]", template: "[[|]]" },
  { label: "高亮", detail: "==…==", template: "==|==" },
  {
    label: "database 视图",
    detail: "按属性筛选笔记的表格",
    template: '```verso-view\nfrom: "|"\nview: table\ncolumns: [title]\n```',
  },
  // 排在最后：这三条开的是浮层或者要问 App 才知道插什么，
  // 和上面那些「插一段固定文本」不是一类动作
  { label: "插入模板", detail: "template", action: "template" },
  { label: "进展记录", detail: "带时间戳的一节（§2.10）", action: "journal" },
  { label: "未关闭的条目", detail: "issue 列表", action: "issues" },
];

/**
 * `/` 菜单里的动作项要交回给 App 执行。
 *
 * 用一个模块级的回调而不是把它一路传进来：补全来源是在建 EditorView 时
 * 固化进扩展里的，而 App 的回调每次渲染都是新函数 —— 传进来会导致每次
 * 渲染都重建整个编辑器（和 `getNotes` 用 getter 是同一个理由）。
 */
let onAction: ((id: SlashAction) => void) | null = null;

export function setSlashAction(fn: ((id: SlashAction) => void) | null) {
  onAction = fn;
}

export function slashSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\/[一-龥a-zA-Z]*/);
  if (!m) return null;

  // 公式里的 `/` 是除号或 `\frac` 的触发词，绝不能弹菜单
  if (mathContextAt(ctx.state, ctx.pos) !== null) return null;

  // 只看**紧邻的前一个字符**是不是空白或行首。
  //
  // 别要求「整行都是空的」—— 那样在段落中间或行尾打 `/` 就不触发了，
  // 而那正是最常见的用法（Notion 里任何位置都能用）。只挡住 `a/b`、
  // URL 里的 `/` 就够了。
  const prev = m.from > 0 ? ctx.state.doc.sliceString(m.from - 1, m.from) : "";
  if (prev && !/\s/.test(prev)) return null;

  const query = m.text.slice(1);
  return {
    from: m.from,
    // **必须自己过滤，并且告诉 CM6 别再滤一遍。**
    //
    // `from` 指到 `/` 上，所以 CM6 眼里的查询串是 `/标题` 而不是 `标题`。
    // 它默认会拿这整串去模糊匹配每个选项的 label，而 `/` 不出现在
    // 「一级标题」里 —— 结果是我筛出来的选项被它全部滤掉，菜单一片空，
    // 表现为「打 / 什么都不弹」。`[[` 补全没这个毛病，因为它的 `from`
    // 指在 `[[` 之后。
    //
    // 关掉它自己的过滤，顺带能按 detail 匹配（`/###`、`/table` 都能搜到），
    // 这是纯按 label 匹配做不到的。代价是 `validFor` 不能留 —— 那会让
    // CM6 复用旧结果、只做本地过滤，而本地过滤已经被关掉了，打字就不再收窄。
    // 17 个选项重查一次的开销可以忽略。
    filter: false,
    options: BLOCKS.filter(
      (b) => !query || b.label.includes(query) || b.detail.toLowerCase().includes(query.toLowerCase()),
    ).map((b) => ({
      label: b.label,
      detail: b.detail,
      type: "keyword",
      apply: (view, _c, from, to) => {
        if (b.action) {
          // 先把 `/关键词` 那几个字删掉再交出去 —— 模板文本是随后异步
          // 插进来的，留着它会变成插入内容的一部分
          view.dispatch({ changes: { from, to }, userEvent: "input.slash" });
          onAction?.(b.action);
          return;
        }
        const caret = b.template!.indexOf("|");
        const text = b.template!.replace("|", "");
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + (caret < 0 ? text.length : caret) },
          userEvent: "input.slash",
          scrollIntoView: true,
        });
      },
    })),
  };
}

export function completion(getNotes: () => NoteRef[]): Extension {
  return autocompletion({
    override: [wikiLinkSource(getNotes), slashSource],
    // 不要自动选中第一条：`[[` 之后直接按回车换行是很常见的操作，
    // 默认选中会让回车变成「插入某个笔记名」
    defaultKeymap: true,
    activateOnTyping: true,
    selectOnOpen: false,
    icons: false,
  });
}
