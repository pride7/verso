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
 * ## 改文字回源码，改结构不回源码
 *
 * 「插一行」「删一列」这类**结构**操作在源码上做的代价极不成比例：插一列
 * 要在每一行的同一个位置各加一根竖线，人手做一次要数五六遍。所以渲染态的
 * 表格上挂了把手（列头上一条横杠、每行左边一条竖杠），点开是菜单，改的是
 * 文件里的那张表 —— 全部走 `tableOps.ts` 那套纯函数。
 *
 * **这些按钮有意不动光标**：光标一进表格范围整块就退回源码，而用户刚点的是
 * 渲染态上的按钮，退回源码等于把他扔进另一个界面。改完仍然是渲染态，可以
 * 接着点下一个。
 *
 * 单元格里的**文字**反过来 —— 点一下进源码去改。那里有 `[[链接]]`、公式
 * snippet、行内格式快捷键，整套编辑能力都在；在渲染态里做一个 contenteditable
 * 单元格等于把这些重写一遍，还要自己处理输入法与撤销。
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
  HEADER,
  parseTable,
  rewriteTable,
  type TableData,
  type TableOp,
} from "./tableOps";

export { parseTable } from "./tableOps";

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

    /** 做一次结构改动：整张表重排后写回文件 */
    const run = (op: TableOp, row: number, col: number) => {
      closeMenu();
      const to = this.from + this.src.length;
      // 位置对不上就什么都别做。widget 的 from 来自建它时那一次 build，
      // 而写错位置的后果是把别处的正文吃掉 —— 这类损坏没有征兆
      if (view.state.doc.sliceString(this.from, to) !== this.src) return;
      const text = rewriteTable(this.src, op, row, col);
      if (!text) return;
      view.dispatch({
        changes: { from: this.from, to, insert: text },
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

    const table = document.createElement("table");
    const thead = table.createTHead();
    const hr = thead.insertRow();
    data.header.forEach((cell, i) => {
      const th = document.createElement("th");
      // 走 renderInline：它只构造 DOM 节点、从不拼 HTML 字符串。
      // 单元格内容是用户写的，而笔记可能来自分享或 AI 生成（§7.5）
      th.appendChild(renderInline(cell));
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
        td.appendChild(renderInline(row[i] ?? ""));
        td.style.textAlign = data.align[i] ?? "left";
        if (i === 0) td.appendChild(grip("is-row", `第 ${r + 1} 行`, ROW_ITEMS, r, 0));
      }
    });

    wrap.appendChild(table);
    return wrap;
  }

  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
  }

  /**
   * **表格本身的事件必须交给编辑器处理**（返回 false）。
   *
   * 返回 true 的话点击到不了 CodeMirror，光标就永远进不了表格 —— 表格
   * 写完即锁死，单元格里的字再也改不了。
   *
   * 例外是把手和菜单：那些是 widget 自己的控件，点它们不该把光标送进表格
   * （送进去整块就退回源码了，而用户要的正是留在渲染态上接着改）。
   */
  ignoreEvent(event: Event) {
    const t = event.target;
    const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
    return !!el?.closest(".cm-table-ui");
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
 * 表格上的把手（插行插列）不受影响：它们在 `ignoreEvent` 里被单独放行，
 * 走的是 widget 自己的事件，从头到尾没有光标参与。
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
