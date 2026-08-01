/**
 * 表格单元格里的行内标记渲染。
 *
 * ## 为什么要自己写一个
 *
 * 表格是整块替换成 `<table>` 的（见 table.ts），单元格里的内容不再经过
 * CodeMirror 的 live preview —— 那套是给"文档里的一段范围"用的，而单元格
 * 是 widget 内部的独立 DOM。所以这里需要一个**只负责渲染、不负责编辑**的
 * 小解析器。
 *
 * ## 安全边界
 *
 * **一律构造 DOM 节点，绝不拼 HTML 字符串。** 单元格内容是用户写的，而笔记
 * 可能来自分享或 AI 生成（§7.5 同一条边界）—— 拼字符串就等于把「打开一篇
 * 笔记」变成「执行一段陌生 HTML」。
 *
 * 支持的范围有意保守：代码、粗体、斜体、删除线、高亮、行内公式、内部链接。
 * 这些覆盖了表格里几乎所有实际用法；嵌套（粗体里套斜体）不支持 —— 真需要
 * 的时候把光标移进去看源码就行。
 */
import katex from "katex";

/** 优先级从高到低。代码排第一 —— 反引号里的东西一律按字面处理 */
const RULES: { re: RegExp; render: (m: RegExpExecArray) => Node }[] = [
  {
    re: /`([^`]+)`/,
    render: (m) => el("code", m[1], "cm-inline-code"),
  },
  {
    re: /\$([^$\n]+)\$/,
    render: (m) => math(m[1]),
  },
  {
    // 内部链接。表格里点不了（widget 内部没有接跳转），显示成链接样式
    // 但不可点，好过显示一堆方括号
    re: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/,
    render: (m) => el("span", m[2] ?? m[1], "cm-wikilink"),
  },
  { re: /\*\*([^*]+)\*\*/, render: (m) => el("strong", m[1]) },
  { re: /==([^=]+)==/, render: (m) => el("mark", m[1], "cm-highlight") },
  { re: /~~([^~]+)~~/, render: (m) => el("del", m[1]) },
  { re: /(?<![*\w])\*([^*\n]+)\*(?!\w)/, render: (m) => el("em", m[1]) },
];

function el(tag: string, text: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function math(src: string): HTMLElement {
  const span = document.createElement("span");
  try {
    // trust: false —— 禁掉 \href \htmlClass 这类能注入的命令（§7.5）
    span.innerHTML = katex.renderToString(src, { throwOnError: false, trust: false });
  } catch {
    // 渲染失败就退回源码，不要让一个写错的公式把整张表变空
    span.textContent = `$${src}$`;
    span.className = "cm-math-error";
  }
  return span;
}

/**
 * 把一段行内 Markdown 渲染成 DOM 片段。
 *
 * 每一轮找出**最靠前**的那个匹配（不是第一条规则的匹配）—— 按规则顺序
 * 依次找会让 `**粗** 和 \`代码\`` 里的代码被粗体先切开。
 */
export function renderInline(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let rest = text;

  while (rest) {
    let best: { at: number; m: RegExpExecArray; render: (m: RegExpExecArray) => Node } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.at)) best = { at: m.index, m, render: rule.render };
    }
    if (!best) break;

    if (best.at > 0) frag.append(rest.slice(0, best.at));
    frag.append(best.render(best.m));
    rest = rest.slice(best.at + best.m[0].length);
  }

  if (rest) frag.append(rest);
  return frag;
}
