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
function wikiLinkSource(getNotes: () => NoteRef[]) {
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

interface Block {
  label: string;
  detail: string;
  /** `|` 标出插入后光标应当停的位置 */
  template: string;
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
    template: '```folio-view\nfrom: "|"\nview: table\ncolumns: [title]\n```',
  },
];

function slashSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\/[一-龥a-zA-Z]*/);
  if (!m) return null;

  // 公式里的 `/` 是除号或 `\frac` 的触发词，绝不能弹菜单
  if (mathContextAt(ctx.state, ctx.pos) !== null) return null;

  const line = ctx.state.doc.lineAt(m.from);
  const before = ctx.state.doc.sliceString(line.from, m.from);
  // 只在行首或空白之后触发。否则写 `a/b`、URL 里的 `/` 都会弹出来
  if (before.trim().length > 0) return null;

  const query = m.text.slice(1);
  return {
    from: m.from,
    options: BLOCKS.filter(
      (b) => !query || b.label.includes(query) || b.detail.toLowerCase().includes(query.toLowerCase()),
    ).map((b) => ({
      label: b.label,
      detail: b.detail,
      type: "keyword",
      apply: (view, _c, from, to) => {
        const caret = b.template.indexOf("|");
        const text = b.template.replace("|", "");
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + (caret < 0 ? text.length : caret) },
          userEvent: "input.slash",
          scrollIntoView: true,
        });
      },
    })),
    validFor: /^\/[一-龥a-zA-Z]*$/,
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
