/**
 * 浏览器剪贴板里的 HTML → Verso 可保存的普通 Markdown。
 *
 * 只保留笔记里有稳定表达的结构；脚本、样式、表单之类一律丢掉。这里不把
 * HTML 原样塞进正文：网页内容属于外部输入，而且纯 Markdown 才是仓库真源。
 */

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "canvas", "form"]);
const BLOCK = new Set([
  "address", "article", "aside", "details", "div", "figcaption", "figure", "footer",
  "header", "main", "nav", "p", "section", "summary",
]);

interface Context {
  pre?: boolean;
}

function text(value: string, pre = false): string {
  if (pre) return value.replace(/\r\n?/g, "\n");
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([*_[\]])/g, "\\$1");
}

function children(el: Element, ctx: Context = {}): string {
  return [...el.childNodes].map((node) => render(node, ctx)).join("");
}

function fenced(value: string): string {
  const body = value.replace(/^\n+|\n+$/g, "");
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${body}\n${fence}\n\n`;
}

function inlineCode(value: string): string {
  const body = value.replace(/\s+/g, " ").trim();
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const tick = "`".repeat(longest + 1);
  const pad = body.startsWith("`") || body.endsWith("`") ? " " : "";
  return `${tick}${pad}${body}${pad}${tick}`;
}

function safeHref(raw: string | null): string | null {
  const href = raw?.trim() ?? "";
  if (!href || /^(?:javascript|data|file):/i.test(href)) return null;
  return /^(?:https?:|mailto:)/i.test(href) ? href : null;
}

function renderList(el: Element, ordered: boolean, depth = 0): string {
  let n = Number(el.getAttribute("start") ?? 1);
  const lines: string[] = [];
  for (const child of [...el.children]) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const nested = [...child.children].filter((item) => {
      const tag = item.tagName.toLowerCase();
      return tag === "ul" || tag === "ol";
    });
    const body = [...child.childNodes]
      .filter((node) => !(node instanceof Element && ["ul", "ol"].includes(node.tagName.toLowerCase())))
      .map((node) => render(node, {}))
      .join("")
      .replace(/\s*\n+\s*/g, " ")
      .trim();
    const prefix = ordered ? `${n}. ` : "- ";
    lines.push(`${"  ".repeat(depth)}${prefix}${body}`.trimEnd());
    for (const list of nested) {
      lines.push(renderList(list, list.tagName.toLowerCase() === "ol", depth + 1).trimEnd());
    }
    n += 1;
  }
  return `${lines.join("\n")}\n\n`;
}

function table(el: Element): string {
  const rows = [...el.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) =>
      children(cell).replace(/\s*\n+\s*/g, " ").trim().replace(/\|/g, "\\|"),
    ),
  ).filter((row) => row.length > 0);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const fill = (row: string[]) => [...row, ...Array(Math.max(0, width - row.length)).fill("")];
  const header = fill(rows[0]);
  const rest = rows.slice(1).map(fill);
  return [header, header.map(() => "---"), ...rest]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n") + "\n\n";
}

function render(node: Node, ctx: Context): string {
  if (node.nodeType === Node.TEXT_NODE) return text(node.nodeValue ?? "", !!ctx.pre);
  if (!(node instanceof Element)) return "";
  const tag = node.tagName.toLowerCase();
  if (SKIP.has(tag) || node.getAttribute("aria-hidden") === "true") return "";
  if (tag === "br") return "\n";
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children(node).trim()}\n\n`;
  if (tag === "strong" || tag === "b") return `**${children(node).trim()}**`;
  if (tag === "em" || tag === "i") return `*${children(node).trim()}*`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${children(node).trim()}~~`;
  if (tag === "pre") return fenced(node.textContent ?? "");
  if (tag === "code") return ctx.pre ? text(node.textContent ?? "", true) : inlineCode(node.textContent ?? "");
  if (tag === "blockquote") {
    const body = children(node).trim().split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
    return `${body}\n\n`;
  }
  if (tag === "ul" || tag === "ol") return renderList(node, tag === "ol");
  if (tag === "table") return table(node);
  if (tag === "hr") return "---\n\n";
  if (tag === "a") {
    const label = children(node).trim();
    const href = safeHref(node.getAttribute("href"));
    return href && label ? `[${label}](${href.replace(/\)/g, "%29")})` : label;
  }
  if (tag === "img") {
    const src = safeHref(node.getAttribute("src"));
    if (!src || src.startsWith("mailto:")) return text(node.getAttribute("alt") ?? "");
    return `![${text(node.getAttribute("alt") ?? "")}](${src.replace(/\)/g, "%29")})`;
  }
  const body = children(node, ctx);
  return BLOCK.has(tag) ? `${body.trim()}\n\n` : body;
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return children(doc.body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
