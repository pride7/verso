/**
 * GFM 表格的 live preview。DESIGN.md §2.4
 *
 * ## 为什么是整块替换，而不是像 callout 那样加行装饰
 *
 * callout 和代码块每一行仍然是"一行文本"，加个底色就成立。表格不是 ——
 * 它要求**跨行对齐列**，而 CM6 的每一行是独立的块级盒子，没有办法让第 2 行
 * 的第 3 列和第 5 行的第 3 列对齐。只能整块换成一个真正的 `<table>`。
 *
 * 代价是光标不能停在渲染态里。所以沿用块级公式那条规则：**光标碰到就整块
 * 回到源码**，移开再渲染。这也是这个编辑器里所有"块"的统一规则。
 *
 * ## 为什么在 StateField 里
 *
 * 替换范围跨行 —— §4.2 那条 CM6 硬约束：跨行的 replace decoration 只能来自
 * StateField，ViewPlugin 会直接报错。表格数量少，全文扫描可以接受。
 */
import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { renderInline } from "./inline";
import { parseAdvanced, parseRefresh } from "./parseRefresh";

/** 一张表：表头 + 若干行，外加每列的对齐方式 */
interface TableData {
  header: string[];
  rows: string[][];
  align: ("left" | "center" | "right")[];
}

/**
 * 从分隔行（`|---|:--:|---:|`）读出每列的对齐。
 *
 * 冒号的位置就是对齐方式，这是 GFM 的规矩：左冒号=左，右冒号=右，
 * 两边都有=居中。没有冒号则默认左对齐。
 */
function parseAlign(sep: string): TableData["align"] {
  return splitRow(sep).map((c) => {
    const t = c.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

/**
 * 把 `| a | b |` 切成单元格。
 *
 * 手写切分而不是 `split("|")`：要支持 `\|` 转义（单元格里写竖线），
 * 而 split 会把转义的那个也切开。
 */
function splitRow(line: string): string[] {
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

/** 分隔行长这样：`|---|:-:|`，至少要有一个 `-` */
const SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function parseTable(text: string): TableData | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2 || !SEP_RE.test(lines[1])) return null;

  const header = splitRow(lines[0]);
  const align = parseAlign(lines[1]);
  const rows = lines.slice(2).map(splitRow);
  return { header, align, rows };
}

class TableWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }

  eq(other: TableWidget) {
    return other.src === this.src;
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-table";
    const data = parseTable(this.src);
    if (!data) {
      wrap.textContent = this.src;
      return wrap;
    }

    const table = document.createElement("table");
    const thead = table.createTHead();
    const hr = thead.insertRow();
    data.header.forEach((cell, i) => {
      const th = document.createElement("th");
      // 走 renderInline：它只构造 DOM 节点、从不拼 HTML 字符串。
      // 单元格内容是用户写的，而笔记可能来自分享或 AI 生成（§7.5）
      th.appendChild(renderInline(cell));
      th.style.textAlign = data.align[i] ?? "left";
      hr.appendChild(th);
    });

    const tbody = table.createTBody();
    for (const row of data.rows) {
      const tr = tbody.insertRow();
      // 按表头的列数补齐/截断，否则少写一个竖线整张表就错位
      for (let i = 0; i < data.header.length; i++) {
        const td = tr.insertCell();
        td.appendChild(renderInline(row[i] ?? ""));
        td.style.textAlign = data.align[i] ?? "left";
      }
    }

    wrap.appendChild(table);
    return wrap;
  }

  /** 表格里要能选中文字复制，事件不该被编辑器吞掉 */
  ignoreEvent() {
    return true;
  }
}

function touched(state: EditorState, from: number, to: number) {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

function build(state: EditorState): DecorationSet {
  const marks: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      const { from, to } = node;
      if (touched(state, from, to)) return false;
      const src = state.doc.sliceString(from, to);
      if (!parseTable(src)) return false;
      marks.push(Decoration.replace({ widget: new TableWidget(src), block: true }).range(from, to));
      return false;
    },
  });
  return RangeSet.of(marks, true);
}

const tableField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    // 和块级公式、database 视图一样：解析推进由 parseRefresh 派发 effect
    // 通知，不要在这里自己比较 syntaxTree（详见 parseRefresh.ts）
    const parsed = tr.effects.some((e) => e.is(parseAdvanced));
    if (!tr.docChanged && !tr.selection && !parsed) return deco.map(tr.changes);
    return build(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const tables: Extension = [
  parseRefresh,
  tableField,
  EditorView.atomicRanges.of((view) => view.state.field(tableField, false) ?? Decoration.none),
];
