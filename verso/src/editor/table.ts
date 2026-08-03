/**
 * GFM 表格的 live preview 与**渲染态上的结构编辑**。DESIGN.md §2.4、§4.9
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
 * ## 结构和文字都在渲染态上改，光标都不进去
 *
 * 「插一行」「删一列」这类**结构**操作在源码上做的代价极不成比例：插一列
 * 要在每一行的同一个位置各加一根竖线，人手做一次要数五六遍。所以渲染态的
 * 表格上挂了把手（列头上一条横杠、每行左边一条竖杠），点开是菜单，改的是
 * 文件里的那张表 —— 全部走 `tableOps.ts` 那套纯函数。
 *
 * **把手和菜单有意不动光标**：光标一进表格范围整块就退回源码，而用户刚点的
 * 是渲染态上的按钮，退回源码等于把他扔进另一个界面。改完仍然是渲染态，可以
 * 接着点下一个。
 *
 * 单元格里的**文字**同理（v0.6.20 起）：点一格，那一格就地变成一个
 * plaintext-only 的 contenteditable，显示这一格的源码，失焦或按键导航时写回
 * 文件。Tab / Enter / 方向键在格子间走，Tab 走过最后一格自动加一行 ——
 * Notion / 思源的手感。输入法与格内撤销交给浏览器：这只是一格纯文本，
 * 不是把编辑器重写一遍。上一版「点单元格整块退回源码去改」要求用户在
 * 源码里数竖线找格子，被判为不好用。
 *
 * 代价是格内没有 snippet、`[[` 补全那套能力 —— 要用它们时用方向键把光标
 * 走进表格（或 Ctrl+E 切源码模式），整块照旧退回源码，那条路没有堵。
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
import {
  type Align,
  applyOp,
  formatTable,
  HEADER,
  indentOf,
  normalizeCell,
  parseTable,
  rewriteCell,
  setCell,
  type TableData,
  type TableOp,
} from "./tableOps";

export { parseTable } from "./tableOps";

/** 打开一格编辑时光标落在哪：全选（键盘导航）、头尾（跨格的方向键）、点击点 */
type Caret = "all" | "start" | "end" | { x: number; y: number };

/**
 * 写回文件会让整个 widget 重建（src 变了，`eq` 不等），「接着编辑下一格」
 * 的目标只能寄存在模块级，由新建的那个 widget 认领。按表格的起点配对 ——
 * 只改表格内部的文字时起点不动。
 */
let pendingEdit: { from: number; row: number; col: number; caret: Caret } | null = null;

/**
 * 把手和菜单的图标。
 *
 * 这里不能用 `components/Icon.tsx` —— 那是个 React 组件，而 widget 只有裸
 * DOM。路径按同一套规矩画：16×16、描边 1.5、只用 currentColor（§6 的图标约定）。
 */
const ICONS = {
  plus: "M8 3.5v9M3.5 8h9",
  up: "M8 13V3.4M4.4 7 8 3.4 11.6 7",
  down: "M8 3v9.6M4.4 9 8 12.6 11.6 9",
  left: "M13 8H3.4M7 4.4 3.4 8 7 11.6",
  right: "M3 8h9.6M9 4.4 12.6 8 9 11.6",
  trash: "M3.2 4.4h9.6M6.4 4.4V2.8h3.2v1.6M4.6 4.4l.6 8.4h5.6l.6-8.4",
  "align-left": "M3 4.5h10M3 8h6M3 11.5h10",
  "align-center": "M3 4.5h10M5 8h6M3 11.5h10",
  "align-right": "M3 4.5h10M7 8h6M3 11.5h10",
} as const;

function icon(name: keyof typeof ICONS, size = 13): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[name]);
  svg.appendChild(path);
  return svg;
}

interface MenuItem {
  op: TableOp;
  label: string;
  icon: keyof typeof ICONS;
}

/** 列头菜单。顺序按「加 → 挪 → 删」，删除永远在最后一条，不容易误点 */
const COL_ITEMS: MenuItem[] = [
  { op: "col-left", label: "在左侧插入列", icon: "plus" },
  { op: "col-right", label: "在右侧插入列", icon: "plus" },
  { op: "col-move-left", label: "左移一列", icon: "left" },
  { op: "col-move-right", label: "右移一列", icon: "right" },
  { op: "col-delete", label: "删除这一列", icon: "trash" },
];

/** 行把手菜单。表头那一条只会剩下「在下方插入行」—— 别的对表头都不成立 */
const ROW_ITEMS: MenuItem[] = [
  { op: "row-above", label: "在上方插入行", icon: "plus" },
  { op: "row-below", label: "在下方插入行", icon: "plus" },
  { op: "row-up", label: "上移一行", icon: "up" },
  { op: "row-down", label: "下移一行", icon: "down" },
  { op: "row-delete", label: "删除这一行", icon: "trash" },
];

const ALIGNS: { align: Align; label: string; icon: keyof typeof ICONS }[] = [
  { align: "left", label: "左对齐", icon: "align-left" },
  { align: "center", label: "居中", icon: "align-center" },
  { align: "right", label: "右对齐", icon: "align-right" },
];

/** widget 被移除时要收的尾（关掉还开着的菜单、摘掉全局监听） */
const cleanups = new WeakMap<HTMLElement, () => void>();

class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    /** 表格在文档里的起点。改结构时要换掉的正是 `[from, from + src.length)` */
    readonly from: number,
  ) {
    super();
  }

  eq(other: TableWidget) {
    return other.src === this.src && other.from === this.from;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-table";
    const data = parseTable(this.src);
    if (!data) {
      wrap.textContent = this.src;
      return wrap;
    }

    let menu: HTMLElement | null = null;
    let opener: HTMLElement | null = null;

    const closeMenu = () => {
      menu?.remove();
      opener?.classList.remove("is-open");
      menu = null;
      opener = null;
    };

    /**
     * 点到别处、按 Escape、滚动，都该把菜单收起来。
     *
     * **开着菜单的那个把手要放过** —— 不放过的话，按下时这里先关一次、
     * 松开时 click 又开一次，于是「再点一下收起来」永远失效
     */
    const onDocDown = (e: Event) => {
      const t = e.target instanceof Node ? e.target : null;
      if (t && (menu?.contains(t) || opener?.contains(t))) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    view.scrollDOM.addEventListener("scroll", closeMenu);
    cleanups.set(wrap, () => {
      closeMenu();
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
      view.scrollDOM.removeEventListener("scroll", closeMenu);
    });

    // ---------------------------------------------------------- 就地编辑
    // `cellAt[0]` 是表头那行的内容 span，`cellAt[r + 1]` 是第 r 行的

    const cellAt: HTMLElement[][] = [];
    let editing: { row: number; col: number; el: HTMLElement } | null = null;

    const rawOf = (row: number, col: number) =>
      (row === HEADER ? data.header[col] : data.rows[row]?.[col]) ?? "";

    /** 摘掉编辑态（不写回），返回编辑后的文字 */
    const closeEditor = (): string => {
      const e = editing!;
      editing = null;
      const text = e.el.textContent ?? "";
      e.el.removeEventListener("keydown", onCellKey);
      e.el.removeEventListener("blur", onCellBlur);
      e.el.removeAttribute("contenteditable");
      e.el.classList.remove("is-editing");
      // 真写回时整个 widget 会重建，这一句只服务「没改动」的收场
      e.el.replaceChildren(renderInline(normalizeCell(text)));
      return text;
    };

    /** 把一格的文字写回文件。真的写了返回 true（widget 随之整个重建） */
    const commitCell = (row: number, col: number, text: string): boolean => {
      const to = this.from + this.src.length;
      if (view.state.doc.sliceString(this.from, to) !== this.src) return false;
      const next = rewriteCell(this.src, row, col, text);
      if (!next) return false;
      view.dispatch({ changes: { from: this.from, to, insert: next }, userEvent: "input.table" });
      return true;
    };

    const placeCaret = (el: HTMLElement, at: Caret) => {
      const sel = window.getSelection();
      if (!sel) return;
      // 点哪儿光标落哪儿。编辑态换成了源码文本，坐标未必严丝合缝，
      // caretRangeFromPoint 给的是最近的位置 —— 比一律跳到末尾贴心
      const clicked = typeof at === "object" ? document.caretRangeFromPoint?.(at.x, at.y) : null;
      let range = clicked && el.contains(clicked.startContainer) ? clicked : null;
      if (!range) {
        const r = document.createRange();
        r.selectNodeContents(el);
        if (at !== "all") r.collapse(at === "start");
        range = r;
      }
      sel.removeAllRanges();
      sel.addRange(range);
    };

    const openEditor = (row: number, col: number, caret: Caret) => {
      const el = cellAt[row === HEADER ? 0 : row + 1]?.[col];
      if (!el) return;
      editing = { row, col, el };
      el.textContent = rawOf(row, col);
      // plaintext-only：格式靠 Markdown 标记表达，粘贴也顺带只收纯文本
      el.setAttribute("contenteditable", "plaintext-only");
      el.classList.add("is-editing");
      el.addEventListener("keydown", onCellKey);
      el.addEventListener("blur", onCellBlur);
      el.focus();
      placeCaret(el, caret);
    };

    /** 收掉当前编辑并写回。点到别处（失焦）、Escape 都走这条 */
    const finishEdit = () => {
      if (!editing) return;
      const { row, col } = editing;
      commitCell(row, col, closeEditor());
    };

    /** 移到另一格接着编辑。写回会重建 widget，目标格先寄存给新 widget 认领 */
    const go = (row: number, col: number, caret: Caret = "all") => {
      if (!editing) return;
      const { row: r0, col: c0 } = editing;
      const text = closeEditor();
      pendingEdit = { from: this.from, row, col, caret };
      if (!commitCell(r0, c0, text)) {
        pendingEdit = null;
        openEditor(row, col, caret);
      }
    };

    /**
     * Tab 走过最后一格：加一行接着编辑 —— Notion 连续录入的手感。
     * 当前格的字和新行必须在**一次** dispatch 里落地：分两次的话第一次
     * 重建就把寄存的目标格消费掉了。
     */
    const growAndGo = () => {
      if (!editing) return;
      const { row, col } = editing;
      const text = closeEditor();
      const to = this.from + this.src.length;
      if (view.state.doc.sliceString(this.from, to) !== this.src) return;
      const base = setCell(data, row, col, text) ?? data;
      const next = applyOp(base, "row-below", row, col);
      if (!next) return;
      pendingEdit = { from: this.from, row: row === HEADER ? 0 : row + 1, col: 0, caret: "all" };
      view.dispatch({
        changes: { from: this.from, to, insert: formatTable(next, indentOf(this.src)) },
        userEvent: "input.table",
      });
    };

    /** 光标是否顶在编辑格的头/尾 —— 左右方向键要不要跨格全看这个 */
    const caretEdge = (el: HTMLElement) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return { start: false, end: false };
      const r = sel.getRangeAt(0);
      const pre = r.cloneRange();
      pre.selectNodeContents(el);
      pre.setEnd(r.startContainer, r.startOffset);
      const post = r.cloneRange();
      post.selectNodeContents(el);
      post.setStart(r.endContainer, r.endOffset);
      return { start: pre.toString() === "", end: post.toString() === "" };
    };

    const onCellKey = (e: KeyboardEvent) => {
      // 输入法组词中的 Enter/方向键是在跟候选框说话，不是跟表格
      if (!editing || e.isComposing) return;
      const { row, col, el } = editing;
      const last = data.rows.length - 1;
      const cols = data.header.length;
      const nav = (r: number, c: number, caret: Caret = "all") => {
        e.preventDefault();
        go(r, c, caret);
      };
      switch (e.key) {
        case "Tab":
          if (e.shiftKey) {
            if (col > 0) nav(row, col - 1);
            else if (row === 0) nav(HEADER, cols - 1);
            else if (row > 0) nav(row - 1, cols - 1);
            else e.preventDefault(); // 表头第一格，前面没有了；别让 Tab 跑去切焦点
          } else if (col < cols - 1) nav(row, col + 1);
          else if (row === HEADER && last >= 0) nav(0, 0);
          else if (row !== HEADER && row < last) nav(row + 1, 0);
          else {
            e.preventDefault();
            growAndGo();
          }
          break;
        case "Enter":
          // Enter 到底不加行（手滑攒空行），要加行用 Tab 或把手
          e.preventDefault();
          if (row === HEADER && last >= 0) go(0, col);
          else if (row !== HEADER && row < last) go(row + 1, col);
          else {
            finishEdit();
            view.focus();
          }
          break;
        case "Escape":
          e.preventDefault();
          finishEdit();
          view.focus();
          break;
        case "ArrowLeft":
          if (col > 0 && caretEdge(el).start) nav(row, col - 1, "end");
          break;
        case "ArrowRight":
          if (col < cols - 1 && caretEdge(el).end) nav(row, col + 1, "start");
          break;
        case "ArrowUp":
          if (row === 0) nav(HEADER, col);
          else if (row > 0) nav(row - 1, col);
          break;
        case "ArrowDown":
          if (row === HEADER && last >= 0) nav(0, col);
          else if (row !== HEADER && row < last) nav(row + 1, col);
          break;
      }
    };

    const onCellBlur = () => finishEdit();

    /**
     * 点到哪格编辑哪格。挂在 `<table>` 上做委托 —— 把手（`.cm-table-ui`）
     * 有自己的事件，编辑中的格子里再点是挪光标，都放过。
     */
    const cellDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest(".cm-table-ui")) return;
      const cell = t.closest<HTMLElement>("td, th");
      if (!cell || cell.dataset.col === undefined) return;
      if (editing?.el.contains(t)) return;
      // 不拦的话浏览器会先把焦点甩到 contenteditable=false 的 widget 上，
      // 表现成编辑器光标丢一下再回来
      e.preventDefault();
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const caret = { x: e.clientX, y: e.clientY };
      if (editing) go(row, col, caret);
      else openEditor(row, col, caret);
    };

    // ---------------------------------------------------------- 结构操作

    /** 做一次结构改动：整张表重排后写回文件 */
    const run = (op: TableOp, row: number, col: number) => {
      closeMenu();
      const to = this.from + this.src.length;
      // 位置对不上就什么都别做。widget 的 from 来自建它时那一次 build，
      // 而写错位置的后果是把别处的正文吃掉 —— 这类损坏没有征兆
      if (view.state.doc.sliceString(this.from, to) !== this.src) return;
      // 正编着的那格先把字收进来，不然点一下把手就把没写回的字扔了
      const base = editing ? (setCell(data, editing.row, editing.col, closeEditor()) ?? data) : data;
      const next = applyOp(base, op, row, col) ?? (base !== data ? base : null);
      if (!next) return;
      view.dispatch({
        changes: { from: this.from, to, insert: formatTable(next, indentOf(this.src)) },
        userEvent: "input.table",
      });
      // 有意不设 selection：光标一进表格范围整块就退回源码，而点按钮的人
      // 要的正是「留在渲染态接着改」
    };

    /**
     * 建一个把手上的菜单。
     *
     * **`position: fixed`，坐标在打开那一刻算好** —— 外面那层 `.cm-table` 是
     * `overflow-x: auto`，而 CSS 规定一个轴是 auto 时另一个轴的 visible 会被
     * 强制成 auto，absolute 的菜单会被裁掉下半截（database 视图那边踩过同一条）。
     */
    const openMenu = (grip: HTMLElement, items: MenuItem[], row: number, col: number) => {
      if (opener === grip) return closeMenu();
      closeMenu();

      const ul = document.createElement("ul");
      ul.className = "cm-table-menu cm-table-ui";
      ul.setAttribute("role", "menu");

      // 菜单里只留**真的做得了**的那几条：删掉唯一一列、把第一行再往上移，
      // 这些请求由 applyOp 统一判定 —— 灰着的菜单项等于让人点两次才知道不行
      for (const it of items) {
        if (!applyOp(data, it.op, row, col)) continue;
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.appendChild(icon(it.icon));
        btn.appendChild(document.createTextNode(it.label));
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => run(it.op, row, col));
        li.appendChild(btn);
        ul.appendChild(li);
      }

      // 对齐是列独有的一条，做成一行三个小按钮（同 database 视图的「类型」那行）：
      // 三条并排的文字菜单项会把这个菜单撑成一长条
      if (items === COL_ITEMS) {
        const li = document.createElement("li");
        li.className = "cm-table-menu-sub";
        li.appendChild(icon("align-left"));
        const label = document.createElement("span");
        label.textContent = "对齐";
        li.appendChild(label);
        const box = document.createElement("span");
        box.className = "cm-table-aligns";
        for (const a of ALIGNS) {
          const b = document.createElement("button");
          b.appendChild(icon(a.icon));
          b.title = a.label;
          b.setAttribute("aria-label", a.label);
          if ((data.align[col] ?? "left") === a.align) b.classList.add("is-on");
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => run(`align-${a.align}` as TableOp, row, col));
          box.appendChild(b);
        }
        li.appendChild(box);
        ul.appendChild(li);
      }

      const r = grip.getBoundingClientRect();
      // 靠右的列、靠下的表格不能让菜单跑出视口：宽高按实际的量不到（还没进
      // DOM），用一个够用的估值先夹一下，比出屏之后再修一次要稳
      const w = 168;
      const h = 40 + ul.childElementCount * 28;
      ul.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`;
      ul.style.top = `${Math.min(r.bottom + 4, Math.max(4, window.innerHeight - h - 4))}px`;
      wrap.appendChild(ul);
      grip.classList.add("is-open");
      menu = ul;
      opener = grip;
    };

    const grip = (cls: string, label: string, items: MenuItem[], row: number, col: number) => {
      const b = document.createElement("button");
      b.className = `cm-table-grip cm-table-ui ${cls}`;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-haspopup", "menu");
      // 按下就 preventDefault：不拦的话浏览器会把焦点从编辑器挪到按钮上，
      // 桌面上表现成光标丢失，手机上是软键盘弹一轮（AGENTS.md 里那条）
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => openMenu(b, items, row, col));
      return b;
    };

    /** 一格的内容 span：渲染态/编辑态在这层切换，把手仍然直接挂在格子上 */
    const content = (row: number, col: number, text: string): HTMLElement => {
      const span = document.createElement("span");
      span.className = "cm-table-cell";
      // 走 renderInline：它只构造 DOM 节点、从不拼 HTML 字符串。
      // 单元格内容是用户写的，而笔记可能来自分享或 AI 生成（§7.5）
      span.appendChild(renderInline(text));
      (cellAt[row === HEADER ? 0 : row + 1] ??= [])[col] = span;
      return span;
    };

    const table = document.createElement("table");
    table.addEventListener("mousedown", cellDown);
    const thead = table.createTHead();
    const hr = thead.insertRow();
    data.header.forEach((cell, i) => {
      const th = document.createElement("th");
      th.dataset.row = String(HEADER);
      th.dataset.col = String(i);
      th.appendChild(content(HEADER, i, cell));
      th.style.textAlign = data.align[i] ?? "left";
      // 列把手在表头上沿。表头那一行同时也是「行把手」的落点（只提供
      // 「在下方插入行」）—— 一张还没有数据行的表全靠它才加得出第一行
      if (i === 0) th.appendChild(grip("is-row", "表头", ROW_ITEMS, HEADER, 0));
      th.appendChild(grip("is-col", `第 ${i + 1} 列`, COL_ITEMS, HEADER, i));
      hr.appendChild(th);
    });

    const tbody = table.createTBody();
    data.rows.forEach((row, r) => {
      const tr = tbody.insertRow();
      // 按表头的列数补齐/截断，否则少写一个竖线整张表就错位
      for (let i = 0; i < data.header.length; i++) {
        const td = tr.insertCell();
        td.dataset.row = String(r);
        td.dataset.col = String(i);
        td.appendChild(content(r, i, row[i] ?? ""));
        td.style.textAlign = data.align[i] ?? "left";
        if (i === 0) td.appendChild(grip("is-row", `第 ${r + 1} 行`, ROW_ITEMS, r, 0));
      }
    });

    wrap.appendChild(table);

    // 上一个 widget 寄存的「接着编辑这一格」。这时还在 CM 的 update 里，
    // DOM 尚未挂进文档，焦点落不住 —— 等一拍
    if (pendingEdit && pendingEdit.from === this.from) {
      const p = pendingEdit;
      pendingEdit = null;
      setTimeout(() => openEditor(p.row, p.col, p.caret), 0);
    }
    return wrap;
  }

  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
  }

  /**
   * `<table>` 里的一切事件都归 widget 自己：点格子是就地编辑、点把手是
   * 结构菜单、编辑格里的按键是 contenteditable 的输入 —— 交给 CodeMirror
   * 的话，点击会把光标送进表格范围，整块当场退回源码，就地编辑就不存在了。
   *
   * 表格外面那圈（`.cm-table` 的内边距）仍然交回编辑器（返回 false），
   * 点那里等于点表格旁边的正文。
   */
  ignoreEvent(event: Event) {
    const t = event.target;
    const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
    return !!el?.closest(".cm-table-ui, .cm-table table");
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
      marks.push(
        Decoration.replace({ widget: new TableWidget(src, from), block: true }).range(from, to),
      );
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

/**
 * 有意**不注册 `atomicRanges`**。
 *
 * 注册了的话方向键会整块跳过表格，键盘用户永远进不去 —— 而 §1.2 那条
 * 「交互不能假设有键盘」反过来同样成立：也不能假设有鼠标。
 *
 * 不注册时，光标一移进表格范围，`touched()` 就为真、渲染态自动换回源码，
 * 于是方向键"走进表格"这件事是自然发生的，不需要额外做什么。database
 * 视图那边保留 atomicRanges 是因为它的 widget 本身可交互（点单元格改属性），
 * 光标没有进去的必要。
 *
 * 表格上的把手和单元格的就地编辑不受影响：它们在 `ignoreEvent` 里被整体
 * 放行，走的是 widget 自己的事件，从头到尾没有光标参与。
 */
export const tables: Extension = [parseRefresh, tableField];

/** 测试用：当前 state 会渲染出几张表 */
export function tableCount(state: EditorState): number {
  let n = 0;
  build(state).between(0, state.doc.length, () => {
    n++;
  });
  return n;
}

export type { TableData };
