/**
 * `/` 命令菜单的条目表。DESIGN.md §4.3
 *
 * ## 为什么单独一个文件
 *
 * 三处都要用到它：编辑器里的补全来源、设置界面里那排「显示哪几条」的开关、
 * 以及自定义条目的解析。放在 `editor/completion.ts` 里的话，设置界面就得
 * 从编辑器扩展里 import 一张表，而那边还牵着 CodeMirror 的一堆东西。
 *
 * 顺带：这里全是纯函数，能在 Node 里穷举着测。
 *
 * ## 光标位为什么改成 `$0`
 *
 * 原来用 `|`，而**表格那条模板本身全是 `|`** —— `indexOf("|")` 找到的是
 * 第一个竖线，插进去的表格于是少了一根竖线、光标还停在行首。改成 `$0`
 * 之后没有这个歧义，也和公式 snippet 的写法一致（用户已经认得它）。
 */

/** `/` 菜单里那几条「不插文本、交回给 App 做一件事」的选项 */
export type SlashAction = "template" | "journal" | "issues" | "knowledge";

export interface SlashItem {
  label: string;
  detail: string;
  /** 插入的文本，`$0` 标出插入后光标停的位置。有 `action` 的条目不用它 */
  template?: string;
  /**
   * 不插文本，而是让 App 做一件事。
   *
   * 为什么放进 `/` 菜单而不是只做成命令：`/` 是写作过程中手不离键盘的入口，
   * 而插入模板、记一条进展恰恰发生在写作中途。只藏在命令面板里的功能，
   * 不知道它存在的人永远不会用到。
   */
  action?: SlashAction;
}

/**
 * 内置条目。**`label` 同时是它的 id** —— 设置里「隐藏哪几条」记的就是它，
 * 所以改这里的 label 等于让用户之前的隐藏设置失效，别随手改。
 */
export const BUILTIN_SLASH: SlashItem[] = [
  { label: "一级标题", detail: "# ", template: "# $0" },
  { label: "二级标题", detail: "## ", template: "## $0" },
  { label: "三级标题", detail: "### ", template: "### $0" },
  { label: "无序列表", detail: "- ", template: "- $0" },
  { label: "有序列表", detail: "1. ", template: "1. $0" },
  { label: "待办", detail: "- [ ] ", template: "- [ ] $0" },
  { label: "引用", detail: "> ", template: "> $0" },
  { label: "提示 callout", detail: "> [!note]", template: "> [!note] $0\n> " },
  { label: "警告 callout", detail: "> [!warning]", template: "> [!warning] $0\n> " },
  { label: "代码块", detail: "```", template: "```$0\n\n```" },
  { label: "分隔线", detail: "---", template: "---\n$0" },
  { label: "表格", detail: "GFM 表格", template: "| $0 |  |\n|---|---|\n|  |  |" },
  { label: "行内公式", detail: "$…$", template: "$$0$" },
  { label: "块级公式", detail: "$$…$$", template: "$$\n$0\n$$" },
  { label: "内部链接", detail: "[[…]]", template: "[[$0]]" },
  { label: "高亮", detail: "==…==", template: "==$0==" },
  {
    label: "database 视图",
    detail: "按属性筛选笔记的表格",
    template: '```verso-view\nfrom: "$0"\nview: table\ncolumns: [title]\n```',
  },
  // 带一行现成的流程图：一个空的 ```mermaid 块对着的是「我该写什么语法」，
  // 而改一行现成的比从零写快得多
  {
    label: "Mermaid 图",
    detail: "流程图、时序图…",
    template: "```mermaid\ngraph TD\n  A[$0] --> B[结束]\n```",
  },
  // 排在最后：这三条开的是浮层、或者要问 App 才知道插什么，
  // 和上面那些「插一段固定文本」不是一类动作
  { label: "插入模板", detail: "template", action: "template" },
  { label: "进展记录", detail: "带时间戳的一节（§2.10）", action: "journal" },
  { label: "未关闭的条目", detail: "issue 列表", action: "issues" },
  { label: "知识库", detail: "分类总览 + 最近更新 + 长期未更新", action: "knowledge" },
];

/** 把模板拆成「要插入的文本」和「光标落点」。没写 `$0` 就落在末尾 */
export function applyCaret(template: string): { text: string; caret: number } {
  const at = template.indexOf("$0");
  if (at < 0) return { text: template, caret: template.length };
  return { text: template.slice(0, at) + template.slice(at + 2), caret: at };
}

/**
 * 解析设置里那段自定义 JSON。
 *
 * **一条坏了不能连累其他**（和自定义 snippet 同一条规矩）：逐条校验，坏的
 * 跳过并报告。用户的表可能有几十条，为第 7 条的一个拼写错误让前 6 条失效，
 * 等于让人在最熟的输入方式上突然失手，还完全不知道为什么。
 */
export function parseSlashCustom(text: string): { items: SlashItem[]; errors: string[] } {
  const src = text.trim();
  if (!src) return { items: [], errors: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(src);
  } catch (e) {
    return { items: [], errors: [`JSON 解析失败：${(e as Error).message}`] };
  }
  if (!Array.isArray(raw)) return { items: [], errors: ["最外层应当是一个数组 []"] };

  const items: SlashItem[] = [];
  const errors: string[] = [];
  raw.forEach((row, i) => {
    const at = `第 ${i + 1} 条`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${at}：应当是一个对象 {}`);
      return;
    }
    const { label, detail, template } = row as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim()) {
      errors.push(`${at}：缺少 label（菜单里显示的名字）`);
      return;
    }
    if (typeof template !== "string" || !template) {
      errors.push(`${at}「${label}」：缺少 template（要插入的文本）`);
      return;
    }
    if (detail !== undefined && typeof detail !== "string") {
      errors.push(`${at}「${label}」：detail 应当是一段文字`);
      return;
    }
    items.push({ label: label.trim(), detail: detail ?? "", template });
  });
  return { items, errors };
}

/**
 * 菜单里最终显示哪些条目。
 *
 * 自定义的排在内置之后 —— 内置那几条是肌肉记忆，位置不该被自定义顶掉。
 * 隐藏按 label 匹配：自定义条目用了同名的话，隐藏的仍然只是内置那一条。
 */
export function slashItems(hidden: readonly string[], custom: readonly SlashItem[]): SlashItem[] {
  const off = new Set(hidden);
  return [...BUILTIN_SLASH.filter((b) => !off.has(b.label)), ...custom];
}
