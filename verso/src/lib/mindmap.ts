/**
 * 思维导图 = 大纲的另一种编辑视图。DESIGN.md §4.7
 *
 * ## 为什么不存坐标
 *
 * 导图有三条路：新开一个 `.canvas` JSON（Obsidian）、在 `.md` 里自创标记、
 * 或者**认「结构就是缩进」**。前两条一条违反 §0 第 1 条（记事本打开是一堆
 * JSON，坐标从 Markdown 派生不出来，它就成了第二份真源），一条违反第 3 条。
 *
 * 所以这里一个字节都不额外存：**一个节点就是正文里的一行**（标题或列表项），
 * 布局每次算出来。在图上改一下 = 改那一行 Markdown；AI 在终端里改完文件，
 * 图立刻跟着变。
 *
 * ## 为什么自己扫一遍而不复用 outline.ts
 *
 * `outline.ts` 只认标题，而导图必须收列表 —— AI 吐出来的一堆要点粘进笔记
 * 就是列表，不收它们这个功能就废了一半。围栏跳过那几行逻辑是重复的，但把
 * 两边合并成一个「什么都解析」的函数会让大纲那边被迫处理它不关心的东西。
 */

export type NodeKind = "root" | "heading" | "list" | "task";

export interface MindNode {
  /** 正文里的行号（1 起）。同一份文档内唯一，直接当 id 用；根节点是 0 */
  line: number;
  /** 显示文字，已去掉 `#`、`- `、`[x]` 这些标记 */
  text: string;
  kind: NodeKind;
  /** 任务项勾没勾上 */
  done?: boolean;
  /** 这一行的前缀（`## `、`  - `、`- [x] `）。加兄弟节点时照抄 */
  prefix: string;
  /** 列表项的缩进宽度（空格数）。标题是 0 */
  indent: number;
  /** 标题的 `#` 个数；列表是 0 */
  level: number;
  /** 子树在正文里的最后一行（含自己）。插入/删除靠它 */
  endLine: number;
  children: MindNode[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^( {0,3})(#{1,6})[ \t]+(.*?)[ \t]*$/;
/** `- ` / `* ` / `+ ` / `1. ` / `1) `，前面可以有任意缩进 */
const ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
/** 列表项开头的任务标记 */
const TASK = /^\[([ xX])\][ \t]+(.*)$/;

/** Tab 按 4 空格算 —— 只要**同一份文档里**一致，深度判断就不会错 */
function indentWidth(raw: string): number {
  let n = 0;
  for (const c of raw) n += c === "\t" ? 4 : 1;
  return n;
}

/** 去掉行内标记，只留人读的那部分（和大纲面板同一套规则） */
export function plainText(raw: string): string {
  return raw
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, inner: string) => {
      const bar = inner.indexOf("|");
      return bar < 0 ? inner : inner.slice(bar + 1);
    })
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(?!\s)(.*?)(?<!\s)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .trim();
}

interface Frame {
  node: MindNode;
  /** 标题按 `#` 个数排，列表一律排在所有标题之后、彼此按缩进排 */
  rank: number;
}

/**
 * 把正文解析成一棵树。根节点是笔记本身，`line` 为 0。
 *
 * 层级规则：标题按 `#` 个数；列表项**永远挂在最近的标题下面**，彼此按缩进
 * 嵌套。这正是 Markdown 本来的语义，不是我们发明的规矩。
 */
export function parseMindmap(body: string, title: string): MindNode {
  const root: MindNode = {
    line: 0,
    text: title,
    kind: "root",
    prefix: "",
    indent: 0,
    level: 0,
    endLine: 0,
    children: [],
  };

  const lines = body.split(/\r\n|\r|\n/);
  const stack: Frame[] = [{ node: root, rank: 0 }];
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const f = FENCE.exec(line);
    if (f) {
      const [, marker, rest] = f;
      if (!fence) {
        fence = { char: marker[0], len: marker.length };
        continue;
      }
      if (marker[0] === fence.char && marker.length >= fence.len && rest.trim() === "") {
        fence = null;
        continue;
      }
    }
    // 代码块里的 `# 注释` 和 `- 列表` 不是结构（和大纲、索引一致）
    if (fence) continue;

    const atx = ATX.exec(line);
    if (atx) {
      const level = atx[2].length;
      const node: MindNode = {
        line: i + 1,
        text: plainText(atx[3]),
        kind: "heading",
        prefix: `${atx[1]}${atx[2]} `,
        indent: 0,
        level,
        endLine: i + 1,
        children: [],
      };
      // 标题只能挂在更浅的标题下面
      while (stack.length > 1 && stack[stack.length - 1].rank >= level) stack.pop();
      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, rank: level });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const indent = indentWidth(item[1]);
      const task = TASK.exec(item[3]);
      // 列表一律排在所有标题之后（+100），彼此按缩进比
      const rank = 100 + indent;
      const node: MindNode = {
        line: i + 1,
        text: plainText(task ? task[2] : item[3]),
        kind: task ? "task" : "list",
        done: task ? task[1].toLowerCase() === "x" : undefined,
        prefix: `${item[1]}${item[2]} ${task ? `[${task[1]}] ` : ""}`,
        indent,
        level: 0,
        endLine: i + 1,
        children: [],
      };
      while (stack.length > 1 && stack[stack.length - 1].rank >= rank) stack.pop();
      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, rank });
      continue;
    }
  }

  fixEnds(root, lines.length);
  return root;
}

/** 子树的最后一行 = 自己和所有后代里最大的那个行号 */
function fixEnds(node: MindNode, docLines: number): number {
  let end = node.line;
  for (const c of node.children) end = Math.max(end, fixEnds(c, docLines));
  node.endLine = node.kind === "root" ? docLines : end;
  return end;
}

/** 深度优先展平，方便查找和键盘上下移动 */
export function flatten(node: MindNode, out: MindNode[] = []): MindNode[] {
  out.push(node);
  for (const c of node.children) flatten(c, out);
  return out;
}

export function findNode(root: MindNode, line: number): MindNode | null {
  return flatten(root).find((n) => n.line === line) ?? null;
}

export function parentOf(root: MindNode, line: number): MindNode | null {
  for (const n of flatten(root)) {
    if (n.children.some((c) => c.line === line)) return n;
  }
  return null;
}

// ---------------------------------------------------------------- 改文本
//
// 每个操作都算出一个**按行的替换**交给编辑器执行，而不是自己拼出一整篇新
// 正文：整篇替换会让 CM6 把光标、选区、滚动位置全部重算一遍，而且撤销栈里
// 留下的是「换掉了整个文档」这么一步。

export interface Edit {
  /** 要替换的行范围，1 起、闭区间。`fromLine > toLine` 表示纯插入 */
  fromLine: number;
  toLine: number;
  /** 替换成什么。空串 = 删掉这几行 */
  insert: string;
}

/** 改一个节点的文字。前缀（`## `、`- [x] `）原样保留 */
export function editText(node: MindNode, text: string): Edit {
  return { fromLine: node.line, toLine: node.line, insert: node.prefix + text.trim() };
}

/**
 * 新子节点用什么前缀。
 *
 * **已经有子节点就照第一个子节点抄** —— 用户已经在这一层表达过「这里是标题
 * 还是列表」，跟着他走。没有子节点时：标题给下一级标题（从空笔记搭骨架这条
 * 路要通），列表给缩进深一级的列表。
 */
function childPrefix(node: MindNode): string {
  if (node.children.length > 0) {
    const first = node.children[0];
    // 任务项的勾选状态不该被继承 —— 新建的一条当然是没做完的
    return first.kind === "task" ? first.prefix.replace(/\[[ xX]\]/, "[ ]") : first.prefix;
  }
  if (node.kind === "root") return "# ";
  if (node.kind === "heading") {
    return node.level >= 6 ? "- " : `${"#".repeat(node.level + 1)} `;
  }
  return `${" ".repeat(node.indent + 2)}- `;
}

/**
 * 在某个节点下面加一个子节点，插在**它整棵子树之后**。
 *
 * 返回新行的行号 —— 界面要立刻把它切进编辑态，加完一个空节点还要用户自己
 * 去找它在哪，这个功能就没法用了。
 */
export function editAddChild(node: MindNode, text = ""): { edit: Edit; line: number } {
  const at = node.endLine;
  const prefix = childPrefix(node);
  // 根节点的 endLine 是全文最后一行，插在它后面就等于追加到文末
  return {
    edit: { fromLine: at + 1, toLine: at, insert: prefix + text },
    line: at + 1,
  };
}

/** 加一个兄弟节点：同样的前缀，插在它子树之后 */
export function editAddSibling(node: MindNode, text = ""): { edit: Edit; line: number } {
  const prefix = node.kind === "task" ? node.prefix.replace(/\[[ xX]\]/, "[ ]") : node.prefix;
  return {
    edit: { fromLine: node.endLine + 1, toLine: node.endLine, insert: prefix + text },
    line: node.endLine + 1,
  };
}

/** 删掉一个节点**连同它的子树** —— 图上看不见的行也一起删，否则会留下孤儿 */
export function editRemove(node: MindNode): Edit {
  return { fromLine: node.line, toLine: node.endLine, insert: "" };
}

/** 勾选／取消一个任务项。存储仍然是 `- [x]`，拖进 Obsidian 也认 */
export function editToggleTask(node: MindNode): Edit | null {
  if (node.kind !== "task") return null;
  const next = node.prefix.replace(/\[[ xX]\]/, node.done ? "[ ]" : "[x]");
  return { fromLine: node.line, toLine: node.line, insert: next + node.text };
}

/** 子树里有几个节点。删之前要不要问一句，看它 */
export function subtreeSize(node: MindNode): number {
  return flatten(node).length;
}

// ---------------------------------------------------------------- 布局
//
// 横向树，根在左。中文长标题不撑碍，深层级也不会爆 —— 幕布、Workflowy 都是
// 这个路子。**布局不进文件**，每次算出来。

export const NODE_W = 190;
export const NODE_H = 30;
export const COL_GAP = 46;
export const ROW_GAP = 12;

export interface Placed {
  node: MindNode;
  x: number;
  y: number;
  depth: number;
  /** 有子节点但被折叠了 —— 界面要给个「还有东西」的提示 */
  collapsed: boolean;
}

export interface Layout {
  nodes: Placed[];
  /** 连线：从父节点右边缘到子节点左边缘 */
  links: { from: Placed; to: Placed }[];
  width: number;
  height: number;
}

/**
 * 算坐标。折叠的节点不参与 —— 它们的位置根本不该占地方。
 *
 * 叶子按出现顺序依次往下排，父节点取「第一个和最后一个孩子的中点」。
 * 这是最省事又最好读的一种：兄弟之间等距，父节点永远在自己那一簇的正中。
 */
export function layout(root: MindNode, collapsed: ReadonlySet<number> = new Set()): Layout {
  const nodes: Placed[] = [];
  const links: { from: Placed; to: Placed }[] = [];
  let cursor = 0;

  const walk = (node: MindNode, depth: number): Placed => {
    const isCollapsed = collapsed.has(node.line) && node.children.length > 0;
    const x = depth * (NODE_W + COL_GAP);

    if (isCollapsed || node.children.length === 0) {
      const y = cursor;
      cursor += NODE_H + ROW_GAP;
      const placed: Placed = { node, x, y, depth, collapsed: isCollapsed };
      nodes.push(placed);
      return placed;
    }

    const kids = node.children.map((c) => walk(c, depth + 1));
    const y = (kids[0].y + kids[kids.length - 1].y) / 2;
    const placed: Placed = { node, x, y, depth, collapsed: false };
    nodes.push(placed);
    for (const k of kids) links.push({ from: placed, to: k });
    return placed;
  };

  walk(root, 0);

  const maxX = Math.max(...nodes.map((n) => n.x));
  const maxY = Math.max(...nodes.map((n) => n.y));
  return { nodes, links, width: maxX + NODE_W, height: maxY + NODE_H };
}
