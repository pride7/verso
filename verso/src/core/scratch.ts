/**
 * 结构化草稿台（DESIGN.md §4.7.1）。
 *
 * 它不定义新格式：卡片就是思维导图已经认得的 Markdown 标题/列表项，
 * 所有结构操作仍然产出一次按行编辑。这层保持纯 TS，便于把「缩进到底改了
 * 哪几行」这类边界验清楚。
 */

import {
  ancestorLines,
  editMove,
  findNode,
  flatten,
  parentOf,
  parseMindmap,
  type Edit,
  type MindNode,
} from "./mindmap";

export function scratchTree(body: string, title = "草稿箱"): MindNode {
  return parseMindmap(body, title);
}

export function scratchCards(root: MindNode): MindNode[] {
  return flatten(root).filter((node) => node.kind !== "root");
}

/** 在全文末尾加一张顶层卡片。根节点默认会加标题，草稿台刻意用列表。 */
export function addScratchCard(body: string, root: MindNode, text = ""): { edit: Edit; line: number } {
  if (body.length === 0) {
    return { edit: { fromLine: 1, toLine: 1, insert: `- ${text.trim()}` }, line: 1 };
  }
  const line = root.endLine + 1;
  return {
    edit: { fromLine: line, toLine: root.endLine, insert: `- ${text.trim()}` },
    line,
  };
}

function subtreeLines(body: string, node: MindNode): string[] {
  return body.split(/\r\n|\r|\n/).slice(node.line - 1, node.endLine);
}

/** Tab：连同子树缩进两格。没有前一个同级卡片时不能凭空缩进。 */
export function indentScratchCard(body: string, root: MindNode, line: number): Edit | null {
  const node = findNode(root, line);
  if (!node || (node.kind !== "list" && node.kind !== "task")) return null;
  const parent = parentOf(root, line);
  if (!parent) return null;
  const at = parent.children.findIndex((child) => child.line === line);
  if (at <= 0) return null;
  return {
    fromLine: node.line,
    toLine: node.endLine,
    insert: subtreeLines(body, node).map((raw) => `  ${raw}`).join("\n"),
  };
}

/** Shift+Tab：连同子树提升一层，最多回到顶层。 */
export function outdentScratchCard(body: string, root: MindNode, line: number): Edit | null {
  const node = findNode(root, line);
  if (!node || (node.kind !== "list" && node.kind !== "task") || node.indent < 2) return null;
  return {
    fromLine: node.line,
    toLine: node.endLine,
    insert: subtreeLines(body, node)
      .map((raw) => raw.replace(/^ {1,2}/, ""))
      .join("\n"),
  };
}

/** 上下只在当前兄弟之间移；不用几何拖放推断意图。 */
export function moveScratchCard(
  body: string,
  root: MindNode,
  line: number,
  direction: -1 | 1,
): Edit | null {
  const parent = parentOf(root, line);
  if (!parent) return null;
  const at = parent.children.findIndex((child) => child.line === line);
  const target = parent.children[at + direction];
  if (!target) return null;
  return editMove(body, root, line, target.line, direction < 0 ? "before" : "after");
}

/**
 * 把选中卡片连同子树复制为可直接写进新笔记的 Markdown。
 *
 * 父子同时被选时只取父级一次；单独选中深层卡片时去掉它原有的基础缩进，
 * 否则新文档会从一个没有父项的四格列表开始。
 */
export function selectedScratchMarkdown(
  body: string,
  root: MindNode,
  selected: ReadonlySet<number>,
): string {
  const nodes = scratchCards(root)
    .filter((node) => selected.has(node.line))
    .filter((node) => !ancestorLines(root, node.line)
      .some((line) => line !== 0 && line !== node.line && selected.has(line)))
    .sort((a, b) => a.line - b.line);

  return nodes
    .map((node) => {
      const remove = node.kind === "list" || node.kind === "task" ? node.indent : 0;
      return subtreeLines(body, node)
        .map((raw) => (remove > 0 ? raw.slice(Math.min(remove, raw.search(/\S|$/))) : raw))
        .join("\n");
    })
    .join("\n\n")
    .trimEnd();
}
