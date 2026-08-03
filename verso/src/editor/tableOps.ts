/**
 * GFM 表格的结构编辑：插行、插列、删除、移动、改列对齐。DESIGN.md §4.9
 *
 * 渲染态表格上的那些把手（`table.ts` 的 widget）和命令面板里那几条命令
 * （`App.tsx`）走的是这同一套函数。两条路各写一遍的话，「菜单里删得掉、
 * 命令删出错」这类偏差迟早出现 —— 而它只在某一条路上复现，最难查。
 *
 * 逻辑做成**纯函数**（文本 → 文本），和 `format.ts` 同一个路子：能在 Node
 * 里测，不必起浏览器。只有「表格在文档的哪一段」这一步要用到语法树。
 *
 * ## 每次改动都把整张表重排一遍
 *
 * 插一列意味着每一行都要多一根竖线。源码本来是不是对齐的、有没有首尾竖线、
 * 分隔行有几个减号，全都五花八门 —— 在这些形态上做「局部插入」，结果是
 * 一张越改越乱的表。所以这里的做法是：解析成结构、改结构、**整张重新排版**。
 *
 * 代价是用户手排的那份空格会被换成本模块的排法（列宽按内容对齐）。这是有意
 * 的：Markdown 表格的源码可读性几乎全部来自竖线对齐，而人手维护它正是最烦的
 * 那件事。列宽按**显示宽度**算，中文按两格 —— 用 `length` 的话中文表格会全歪。
 */
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

export type Align = "left" | "center" | "right";

/** 一张表：表头 + 若干行，外加每列的对齐方式 */
export interface TableData {
  header: string[];
  rows: string[][];
  align: Align[];
}

/**
 * 行号里表示「表头」的那个值。
 *
 * 表头不是 `rows` 里的一员（它在结构上是另一回事），但定位一个单元格时又
 * 必须能指到它，于是给它一个哨兵值。分隔行也算表头 —— 光标停在 `|---|` 上
 * 时，用户心里指的是上面那一行。
 */
export const HEADER = -1;

export type TableOp =
  | "row-above"
  | "row-below"
  | "row-delete"
  | "row-up"
  | "row-down"
  | "col-left"
  | "col-right"
  | "col-delete"
  | "col-move-left"
  | "col-move-right"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-cycle";

// ---------------------------------------------------------------- 解析

/**
 * 把 `| a | b |` 切成单元格。
 *
 * 手写切分而不是 `split("|")`：要支持 `\|` 转义（单元格里写竖线），
 * 而 split 会把转义的那个也切开。
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let i = 0;
  // 去掉首尾的竖线 —— GFM 允许写也允许不写
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 2;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * 从分隔行（`|---|:--:|---:|`）读出每列的对齐。
 *
 * 冒号的位置就是对齐方式，这是 GFM 的规矩：左冒号=左，右冒号=右，
 * 两边都有=居中。没有冒号则默认左对齐。
 */
function parseAlign(sep: string): Align[] {
  return splitRow(sep).map((c) => {
    const t = c.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

/** 分隔行长这样：`|---|:-:|`，至少要有一个 `-` */
export const SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function parseTable(text: string): TableData | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2 || !SEP_RE.test(lines[1])) return null;

  const header = splitRow(lines[0]);
  const align = parseAlign(lines[1]);
  const rows = lines.slice(2).map(splitRow);

  // 对齐数补齐到列数：分隔行比表头短是常见的手写产物，缺的按 GFM 的默认走左对齐
  while (align.length < header.length) align.push("left");
  align.length = header.length;
  // 行短了补空格 —— 少写一根竖线不该让整张表错位。
  // **长了不截断**：那几个单元格虽然渲染时看不见，但确实是用户打进去的字，
  // 一次「插入行」把它们抹掉是没有征兆的数据丢失
  for (const r of rows) {
    while (r.length < header.length) r.push("");
  }
  return { header, align, rows };
}

/** 表格第一行的缩进。表格可以嵌在列表项里，重排时要把它原样带回去 */
export function indentOf(text: string): string {
  return /^([ \t]*)/.exec(text.split(/\r?\n/)[0] ?? "")?.[1] ?? "";
}

// ---------------------------------------------------------------- 排版

/**
 * 显示宽度：全角字符算两格。
 *
 * 等宽字体下中文占两个西文字符的位置，按 `String.length` 算的话，一张中文表
 * 的竖线会歪得比不对齐还难看。范围取的是 CJK、假名、谚文、全角标点与常见
 * emoji —— 不追求 Unicode 东亚宽度表的完整性，那份表大而全，而这里排的是
 * 一张笔记里的表格，差一格没有任何后果。
 */
function width(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0x303e) ||
      (c >= 0x3041 && c <= 0x33ff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0xa000 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff) ||
      (c >= 0x20000 && c <= 0x3fffd);
    n += wide ? 2 : 1;
  }
  return n;
}

/** 单元格里的竖线要转义回去 —— `splitRow` 把 `\|` 读成了裸的 `|` */
function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** 分隔行的一格：冒号的位置就是对齐方式 */
function sepCell(align: Align, w: number): string {
  if (align === "center") return `:${"-".repeat(w - 2)}:`;
  if (align === "right") return `${"-".repeat(w - 1)}:`;
  // 左对齐**不写冒号**。GFM 的默认就是左对齐，写 `:---` 只是多一份噪音
  return "-".repeat(w);
}

/** 排成竖线对齐的 Markdown。列宽取该列最宽的那一格，最少 3（分隔行放得下 `---`） */
export function formatTable(t: TableData, indent = ""): string {
  const cols = Math.max(t.header.length, ...t.rows.map((r) => r.length), 1);
  const grid = [t.header, ...t.rows].map((r) =>
    Array.from({ length: cols }, (_, i) => escapeCell(r[i] ?? "")),
  );
  const w = Array.from({ length: cols }, (_, c) =>
    Math.max(3, ...grid.map((r) => width(r[c]))),
  );
  const line = (r: string[]) =>
    `${indent}| ${r.map((c, i) => c + " ".repeat(w[i] - width(c))).join(" | ")} |`;
  const sep = `${indent}| ${w.map((n, i) => sepCell(t.align[i] ?? "left", n)).join(" | ")} |`;
  return [line(grid[0]), sep, ...grid.slice(1).map(line)].join("\n");
}

// ---------------------------------------------------------------- 改结构

function clone(t: TableData): TableData {
  return { header: [...t.header], align: [...t.align], rows: t.rows.map((r) => [...r]) };
}

const CYCLE: Record<Align, Align> = { left: "center", center: "right", right: "left" };

/**
 * 对表格做一次操作。`row` 是行下标（`HEADER` 表示表头），`col` 是列下标。
 *
 * **做不了就返回 `null`**（删掉唯一一列、把第一行再往上移…）而不是悄悄
 * 返回原样：调用方要靠这个把菜单项变灰、让命令不产生一次空的撤销记录。
 */
export function applyOp(t: TableData, op: TableOp, row: number, col: number): TableData | null {
  const n = clone(t);
  const cols = n.header.length;
  const empty = () => Array.from({ length: cols }, () => "");
  const inCol = col >= 0 && col < cols;
  const inRow = row >= 0 && row < n.rows.length;

  switch (op) {
    case "row-above":
      // 表头上面没有「行」—— 表头就是这张表的第一行
      if (!inRow) return null;
      n.rows.splice(row, 0, empty());
      return n;
    case "row-below":
      if (!inRow && row !== HEADER) return null;
      // 光标在表头时插到最前面，这正是「表头下面」
      n.rows.splice(row === HEADER ? 0 : row + 1, 0, empty());
      return n;
    case "row-delete":
      // 表头删不得：没有表头的 GFM 表格不成立，整张表会退化成几行普通文字
      if (!inRow) return null;
      n.rows.splice(row, 1);
      return n;
    case "row-up":
      if (!inRow || row === 0) return null;
      [n.rows[row - 1], n.rows[row]] = [n.rows[row], n.rows[row - 1]];
      return n;
    case "row-down":
      if (!inRow || row === n.rows.length - 1) return null;
      [n.rows[row], n.rows[row + 1]] = [n.rows[row + 1], n.rows[row]];
      return n;

    case "col-left":
    case "col-right": {
      if (!inCol) return null;
      const at = op === "col-left" ? col : col + 1;
      n.header.splice(at, 0, "");
      n.align.splice(at, 0, "left");
      for (const r of n.rows) r.splice(at, 0, "");
      return n;
    }
    case "col-delete":
      // 一列都不剩的表格是一堆孤零零的竖线，不如不给删
      if (!inCol || cols <= 1) return null;
      n.header.splice(col, 1);
      n.align.splice(col, 1);
      for (const r of n.rows) r.splice(col, 1);
      return n;
    case "col-move-left":
    case "col-move-right": {
      const to = op === "col-move-left" ? col - 1 : col + 1;
      if (!inCol || to < 0 || to >= cols) return null;
      for (const r of [n.header, n.align, ...n.rows]) {
        [r[col], r[to]] = [r[to], r[col]];
      }
      return n;
    }

    case "align-left":
    case "align-center":
    case "align-right":
    case "align-cycle": {
      if (!inCol) return null;
      const want =
        op === "align-cycle" ? CYCLE[n.align[col] ?? "left"] : (op.slice(6) as Align);
      if (n.align[col] === want) return null;
      n.align[col] = want;
      return n;
    }
  }
}

/**
 * 单元格文字要过的那道闸：GFM 的一格里放不下换行，粘贴进来的折成空格。
 * 首尾空白顺手去掉 —— `splitRow` 解析时本来就会 trim，留着只会让
 * 「改没改过」的判断出假阳性。
 */
export function normalizeCell(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, " ").trim();
}

/**
 * 改一格的文字。渲染态的就地编辑（table.ts）走这条。
 *
 * 不塞进 `applyOp` 的枚举里：那套 op 都是无参的结构操作，为这一条给所有
 * 调用点背上一个可选的 text 参数不值得。
 *
 * 没改动（或位置不存在）返回 `null`，理由同 `applyOp`：调用方靠它避免
 * 一次空的撤销记录。
 */
export function setCell(t: TableData, row: number, col: number, text: string): TableData | null {
  if (col < 0 || col >= t.header.length) return null;
  const cells = row === HEADER ? t.header : t.rows[row];
  if (!cells) return null;
  const v = normalizeCell(text);
  if ((cells[col] ?? "") === v) return null;
  const n = clone(t);
  (row === HEADER ? n.header : n.rows[row])[col] = v;
  return n;
}

/** `setCell` 的源码版：一整张表的源码 → 改完一格的源码 */
export function rewriteCell(
  src: string,
  row: number,
  col: number,
  text: string,
): string | null {
  const data = parseTable(src);
  if (!data) return null;
  const next = setCell(data, row, col, text);
  return next && formatTable(next, indentOf(src));
}

/**
 * 一整张表的源码 → 做完一次操作的源码。渲染态的把手走这条。
 * 做不了（或表格解析不了）返回 `null`。
 */
export function rewriteTable(
  src: string,
  op: TableOp,
  row: number,
  col: number,
): string | null {
  const data = parseTable(src);
  if (!data) return null;
  const next = applyOp(data, op, row, col);
  return next && formatTable(next, indentOf(src));
}

// ---------------------------------------------------------------- 定位

/** 光标所在的那张表：在文档里的范围、结构，以及光标落在哪一格 */
export interface TableSite {
  from: number;
  to: number;
  src: string;
  data: TableData;
  /** `HEADER` 表示表头或分隔行，否则是 `data.rows` 的下标 */
  row: number;
  col: number;
}

/** 一行里第 `col` 格的内容从哪个偏移开始。找的是**没被转义**的竖线 */
function cellStart(line: string, col: number): number {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") pipes.push(i);
  }
  // 本模块排出来的表一定有首尾竖线，第 c 格就在第 c 根竖线后面那个空格之后
  if (col < pipes.length) return Math.min(pipes[col] + 2, line.length);
  return line.length;
}

/** 偏移 `off` 落在这一行的第几格 */
function cellIndexAt(line: string, off: number): number {
  let n = 0;
  for (let i = 0; i < off && i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") n++;
  }
  // 有首竖线时，第一根竖线之前是行首空白，不算一格
  const lead = /^\s*\|/.test(line);
  return Math.max(0, lead ? n - 1 : n);
}

/** 表格文本里第 (row, col) 格的内容偏移。改完表之后把光标送回原来那一格用 */
export function cellOffset(text: string, row: number, col: number): number {
  const lines = text.split("\n");
  const li = Math.min(Math.max(row === HEADER ? 0 : row + 2, 0), lines.length - 1);
  let start = 0;
  for (let i = 0; i < li; i++) start += lines[i].length + 1;
  return start + cellStart(lines[li], col);
}

/**
 * 光标（或指定位置）所在的表格。不在表格里返回 `null`。
 *
 * 走语法树而不是自己往上下扫行：表格的边界该到哪儿由 Markdown 解析器说了算，
 * 自己数「还有没有竖线」会在「表格紧挨着一段带竖线的正文」上判错，而那种
 * 判错的后果是**改写了不该改的几行**。
 */
export function tableAt(state: EditorState, pos = state.selection.main.head): TableSite | null {
  const tree = syntaxTree(state);
  // 两边都试：光标停在表格头一个字之前时只有 side=1 找得到，停在末尾时反之
  for (const side of [1, -1] as const) {
    for (let node = tree.resolveInner(pos, side); node; node = node.parent!) {
      if (node.name !== "Table") continue;
      const src = state.doc.sliceString(node.from, node.to);
      const data = parseTable(src);
      if (!data) return null;
      const first = state.doc.lineAt(node.from).number;
      const line = state.doc.lineAt(Math.min(Math.max(pos, node.from), node.to));
      const idx = line.number - first;
      return {
        from: node.from,
        to: node.to,
        src,
        data,
        // 0 是表头、1 是分隔行 —— 分隔行上的光标算在表头上
        row: idx <= 1 ? HEADER : idx - 2,
        col: Math.min(cellIndexAt(line.text, pos - line.from), data.header.length - 1),
      };
    }
  }
  return null;
}

/** 操作做完之后光标该落在哪一格 */
function cursorAfter(op: TableOp, site: TableSite, next: TableData): [number, number] {
  const { row, col } = site;
  switch (op) {
    // 插进来的那一行/那一列是空的，光标进去就能直接打字
    case "row-above":
      return [row, col];
    case "row-below":
      return [row === HEADER ? 0 : row + 1, col];
    case "row-delete":
      return [next.rows.length === 0 ? HEADER : Math.min(row, next.rows.length - 1), col];
    case "row-up":
      return [row - 1, col];
    case "row-down":
      return [row + 1, col];
    case "col-left":
      return [row, col];
    case "col-right":
    case "col-move-right":
      return [row, col + 1];
    case "col-delete":
      return [row, Math.min(col, next.header.length - 1)];
    case "col-move-left":
      return [row, col - 1];
    default:
      return [row, col];
  }
}

/**
 * 命令面板／快捷键那条路：对光标所在的表格做一次操作。
 *
 * 光标改完之后**留在表格里**（落在操作对应的那一格）—— 从键盘走这条路的人
 * 正要接着打字，把光标送出去等于逼他再点一次。渲染态的把手不走这里，它有意
 * 不动光标，好让表格保持渲染（见 `table.ts`）。
 */
export function tableOpSpec(state: EditorState, op: TableOp): TransactionSpec | null {
  const site = tableAt(state);
  if (!site) return null;
  const next = applyOp(site.data, op, site.row, site.col);
  if (!next) return null;

  const text = formatTable(next, indentOf(site.src));
  const [row, col] = cursorAfter(op, site, next);
  return {
    changes: { from: site.from, to: site.to, insert: text },
    selection: EditorSelection.cursor(site.from + cellOffset(text, row, col)),
    userEvent: "input.table",
    scrollIntoView: true,
  };
}
