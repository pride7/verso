/**
 * 渲染态表格上的结构编辑与单元格就地编辑。DESIGN.md §4.9
 *
 * 在真实浏览器里跑：这一层全是 DOM 事件、焦点与 `ignoreEvent` 的分工 ——
 * 表格里的一切都归 widget 自己（点格子是就地编辑、点把手是菜单），只有
 * 键盘把光标走进来才交还编辑器退回源码。分工判错的表现（表格锁死 /
 * 一点就退回源码 / 编辑格聚不上焦）在单元测试里一条都验不了。
 *
 * 纯逻辑（插到第几行、竖线怎么对齐）在 `tableOps.test.ts` 里，那份在 Node 跑。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor/index";
import { applySettings, DEFAULT_SETTINGS } from "../../../src/app/settings";
import "../../../src/ui/styles.css";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

/** 光标放在文档最末尾，保证不碰到表格 —— 碰到它就整块退回源码了 */
function mount(doc: string) {
  applySettings(DEFAULT_SETTINGS);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
    selection: { anchor: doc.length },
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
    }),
  });
  views.push(view);
  return view;
}

const settle = () => new Promise((r) => setTimeout(r, 250));

const DOC = "正文\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n结尾";

/** 带真实坐标地按一下再点一下。少了 mousedown 就验不到「焦点没被抢走」 */
function click(el: Element) {
  const box = el.getBoundingClientRect();
  const at = {
    bubbles: true,
    button: 0,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  };
  el.dispatchEvent(new MouseEvent("mousedown", at));
  el.dispatchEvent(new MouseEvent("click", at));
}

/** 从列边界拖一段真实的 pointer 手势。事件发给 window，覆盖拖出表头后的路径。 */
function dragWidth(el: Element, delta: number) {
  const box = el.getBoundingClientRect();
  const start = {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  };
  el.dispatchEvent(new PointerEvent("pointerdown", start));
  window.dispatchEvent(new PointerEvent("pointermove", { ...start, clientX: start.clientX + delta }));
  window.dispatchEvent(new PointerEvent("pointerup", { ...start, clientX: start.clientX + delta }));
}

/** 菜单里那几条的文字 */
function menuLabels(v: EditorView): string[] {
  return [...v.dom.querySelectorAll(".cm-table-menu li > button")].map((b) =>
    (b.textContent ?? "").trim(),
  );
}

function menuItem(v: EditorView, label: string): HTMLElement {
  const found = [...v.dom.querySelectorAll<HTMLElement>(".cm-table-menu li > button")].find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  if (!found) throw new Error(`菜单里没有「${label}」，只有：${menuLabels(v).join("、")}`);
  return found;
}

const cols = (v: EditorView) => v.dom.querySelectorAll<HTMLElement>(".cm-table-grip.is-col");
const rows = (v: EditorView) => v.dom.querySelectorAll<HTMLElement>(".cm-table-grip.is-row");
const resizers = (v: EditorView) => v.dom.querySelectorAll<HTMLElement>(".cm-table-resize");

describe("把手", () => {
  it("每列一个列把手，每行一个行把手（表头也有）", async () => {
    const v = mount(DOC);
    await settle();
    expect(cols(v)).toHaveLength(2);
    // 表头 + 两行数据
    expect(rows(v)).toHaveLength(3);
    expect(cols(v)[0].querySelector("svg"), "点阵图标要让入口看得出是操作把手").toBeTruthy();
  });

  it("平时不显示，鼠标进了表格才浮现", async () => {
    const v = mount(DOC);
    await settle();
    const grip = cols(v)[0];
    expect(Number(getComputedStyle(grip).opacity)).toBe(0);
    // 藏着的时候不能挡住单元格 —— 点单元格是就地改字的入口
    expect(getComputedStyle(grip).pointerEvents).toBe("none");
  });

  // 把手内收进单元格：列头上方不能再被撑出一条空白工具栏，行把手也不能
  // 用一排按钮外壳把第一列文字推得太远。
  it("内收在单元格里，不额外撑高表头，也不压住文字", async () => {
    const v = mount(DOC);
    await settle();
    const wrap = v.dom.querySelector<HTMLElement>(".cm-table")!.getBoundingClientRect();
    const th = v.dom.querySelector<HTMLElement>(".cm-table th")!.getBoundingClientRect();
    const col = cols(v)[0].getBoundingClientRect();
    const row = rows(v)[1].getBoundingClientRect();

    expect(col.height).toBeGreaterThan(2);
    expect(th.top - wrap.top, "表头上方只该有正常的块内边距").toBeLessThan(16);
    expect(col.top).toBeGreaterThanOrEqual(th.top);
    expect(col.bottom).toBeLessThanOrEqual(th.bottom);
    expect(col.right).toBeLessThanOrEqual(th.right);
    expect(row.width).toBeGreaterThan(2);
    expect(row.left).toBeGreaterThanOrEqual(wrap.left);
    // 行把手待在第一格专门预留的左内边距里，不压住正文
    expect(row.right).toBeLessThanOrEqual(th.left + 27);
    const rowStyle = getComputedStyle(rows(v)[1]);
    expect(rowStyle.borderTopWidth, "默认不能出现一整列按钮外框").toBe("0px");
    expect(rowStyle.boxShadow).toBe("none");
    expect(rowStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("点列把手弹出带上下文和分组的菜单", async () => {
    const v = mount(DOC);
    await settle();
    click(cols(v)[0]);
    expect(menuLabels(v)).toContain("在右侧插入列");
    const menu = v.dom.querySelector<HTMLElement>(".cm-table-menu")!;
    expect(menu.querySelector(".cm-table-menu-title")?.textContent).toBe("第 1 列操作");
    expect(menu.querySelectorAll(".cm-table-menu-divider").length).toBe(3);
    expect(menu.querySelector("button.is-danger")?.textContent).toContain("删除这一列");
    expect(cols(v)[0].getAttribute("aria-expanded")).toBe("true");
    const box = menu.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    // 再点一下收起来
    click(cols(v)[0]);
    expect(v.dom.querySelector(".cm-table-menu")).toBeNull();
    expect(cols(v)[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("做不了的那几条不出现在菜单里", async () => {
    const v = mount(DOC);
    await settle();
    click(cols(v)[0]);
    // 第一列没有「左移一列」
    expect(menuLabels(v)).not.toContain("左移一列");
    expect(menuLabels(v)).toContain("右移一列");
  });

  it("表头的行把手只提供「在下方插入行」", async () => {
    const v = mount(DOC);
    await settle();
    click(rows(v)[0]);
    expect(menuLabels(v)).toEqual(["在下方插入行"]);
    expect(v.dom.querySelector(".cm-table-menu-title")?.textContent).toBe("表头操作");
    expect(v.dom.querySelector(".cm-table-menu-divider")).toBeNull();
  });
});

describe("手动列宽", () => {
  it("每列边界都有拖杆，命中区骑在表头边缘而不占一层高度", async () => {
    const v = mount(DOC);
    await settle();
    expect(resizers(v)).toHaveLength(2);
    const th = v.dom.querySelector<HTMLElement>(".cm-table th")!.getBoundingClientRect();
    const handle = resizers(v)[0].getBoundingClientRect();
    // collapse 的表格边框会落在半像素上；拖杆贴边即可，不要求浮点数逐位相等。
    expect(Math.abs(handle.top - th.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(handle.bottom - th.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(handle.left + handle.width / 2 - th.right)).toBeLessThanOrEqual(1);
    expect(handle.left, "列操作点阵与列宽拖杆不能重叠").toBeGreaterThan(cols(v)[0].getBoundingClientRect().right);
  });

  it("左右拖动只改变视图里的列宽，不改 Markdown，也不误入单元格编辑", async () => {
    const v = mount(DOC);
    await settle();
    const original = v.state.doc.toString();
    const before = v.dom.querySelector<HTMLElement>(".cm-table th")!.getBoundingClientRect().width;
    dragWidth(resizers(v)[0], 96);
    const table = v.dom.querySelector<HTMLElement>(".cm-table table")!;
    const after = v.dom.querySelector<HTMLElement>(".cm-table th")!.getBoundingClientRect().width;
    expect(after - before).toBeGreaterThan(80);
    expect(table.classList.contains("is-manual-width")).toBe(true);
    expect(v.state.doc.toString()).toBe(original);
    expect(editingCell(v)).toBeNull();
    expect(document.body.classList.contains("is-table-resizing")).toBe(false);
  });

  it("改单元格重建表格后保留宽度；双击边界恢复自动布局", async () => {
    const v = mount(DOC);
    await settle();
    dragWidth(resizers(v)[0], 88);
    const manualWidth = v.dom.querySelector<HTMLElement>(".cm-table th")!.getBoundingClientRect().width;

    click(v.dom.querySelector(".cm-table td")!);
    const cell = editingCell(v)!;
    cell.textContent = "改过";
    cell.blur();
    await settle();

    const rebuilt = v.dom.querySelector<HTMLElement>(".cm-table table")!;
    const keptWidth = v.dom.querySelector<HTMLElement>(".cm-table th")!.getBoundingClientRect().width;
    expect(rebuilt.classList.contains("is-manual-width")).toBe(true);
    expect(Math.abs(keptWidth - manualWidth)).toBeLessThanOrEqual(2);

    resizers(v)[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(rebuilt.classList.contains("is-manual-width")).toBe(false);
    expect(rebuilt.style.width).toBe("");
    expect(rebuilt.querySelector("col")?.getAttribute("style") ?? "").not.toContain("width");
  });
});

describe("改的是文件里的那张表", () => {
  it("插入一列 —— 每一行都多一根竖线", async () => {
    const v = mount(DOC);
    await settle();
    click(cols(v)[0]);
    click(menuItem(v, "在右侧插入列"));
    await settle();
    const table = v.state.doc.toString().split("\n").slice(2, 6);
    expect(table).toEqual([
      "| 甲  |     | 乙  |",
      "| --- | --- | --- |",
      "| 1   |     | 2   |",
      "| 3   |     | 4   |",
    ]);
  });

  it("插入一行", async () => {
    const v = mount(DOC);
    await settle();
    click(rows(v)[1]);
    click(menuItem(v, "在上方插入行"));
    await settle();
    expect(v.state.doc.toString().split("\n")[4]).toBe("|     |     |");
  });

  it("删除一行", async () => {
    const v = mount(DOC);
    await settle();
    click(rows(v)[2]);
    click(menuItem(v, "删除这一行"));
    await settle();
    const text = v.state.doc.toString();
    expect(text).not.toContain("3");
    expect(text).toContain("| 1   | 2   |");
  });

  it("改列的对齐，写进分隔行的冒号", async () => {
    const v = mount(DOC);
    await settle();
    click(cols(v)[1]);
    const center = v.dom.querySelector<HTMLElement>('.cm-table-aligns button[aria-label="居中"]')!;
    click(center);
    await settle();
    expect(v.state.doc.toString().split("\n")[3]).toBe("| --- | :-: |");
  });

  it("正文一个字都不动", async () => {
    const v = mount(DOC);
    await settle();
    click(cols(v)[0]);
    click(menuItem(v, "在左侧插入列"));
    await settle();
    const text = v.state.doc.toString();
    expect(text.startsWith("正文\n\n")).toBe(true);
    expect(text.endsWith("\n\n结尾")).toBe(true);
  });
});

describe("改完仍然是渲染态", () => {
  // 这是这个功能的全部意义：在渲染好的表格上直接改。改一次就被扔回源码
  // 的话，还不如自己去源码里数竖线
  it("插完一行，表格还渲染着，把手也还在", async () => {
    const v = mount(DOC);
    await settle();
    click(rows(v)[1]);
    click(menuItem(v, "在下方插入行"));
    await settle();
    expect(v.dom.querySelector(".cm-table table")).not.toBeNull();
    expect(rows(v)).toHaveLength(4);
    expect(v.dom.querySelector(".cm-table-menu")).toBeNull();
  });

});

/** 正在编辑的那格（就地编辑的 contenteditable span） */
function editingCell(v: EditorView) {
  return v.dom.querySelector<HTMLElement>(".cm-table-cell.is-editing");
}

function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

describe("单元格就地编辑", () => {
  it("点一格就地进入编辑，表格不退回源码", async () => {
    const v = mount(DOC);
    await settle();
    click(v.dom.querySelector(".cm-table td")!);
    expect(v.dom.querySelector(".cm-table table")).not.toBeNull();
    const cell = editingCell(v)!;
    expect(cell).not.toBeNull();
    // 编辑态显示的是这一格的源码
    expect(cell.textContent).toBe("1");
    expect(document.activeElement).toBe(cell);
  });

  it("失焦写回文件，写完还渲染着", async () => {
    const v = mount(DOC);
    await settle();
    click(v.dom.querySelector(".cm-table td")!);
    const cell = editingCell(v)!;
    cell.textContent = "改过";
    cell.blur();
    await settle();
    expect(v.state.doc.toString()).toContain("| 改过 | 2   |");
    expect(v.dom.querySelector(".cm-table table")).not.toBeNull();
    expect(editingCell(v)).toBeNull();
  });

  it("Tab 写回当前格、移到下一格接着编辑", async () => {
    const v = mount(DOC);
    await settle();
    click(v.dom.querySelector(".cm-table td")!);
    const cell = editingCell(v)!;
    cell.textContent = "新";
    press(cell, "Tab");
    await settle();
    expect(v.state.doc.toString()).toContain("| 新  | 2   |");
    // widget 已经重建过一轮，下一格（同行第二格）接着处于编辑态
    expect(editingCell(v)?.textContent).toBe("2");
  });

  it("最后一格按 Tab 自动加一行，接着编辑新行 —— 连续录入不用碰鼠标", async () => {
    const v = mount(DOC);
    await settle();
    const tds = v.dom.querySelectorAll<HTMLElement>(".cm-table td");
    click(tds[tds.length - 1]);
    press(editingCell(v)!, "Tab");
    await settle();
    expect(v.state.doc.toString().split("\n")).toContain("|     |     |");
    expect(rows(v)).toHaveLength(4);
    expect(editingCell(v)).not.toBeNull();
  });

  it("Enter 走到下一行同一列；Escape 收掉编辑态", async () => {
    const v = mount(DOC);
    await settle();
    click(v.dom.querySelector(".cm-table td")!);
    press(editingCell(v)!, "Enter");
    const below = editingCell(v)!;
    expect(below.textContent).toBe("3");
    press(below, "Escape");
    expect(editingCell(v)).toBeNull();
    expect(v.dom.querySelector(".cm-table table")).not.toBeNull();
  });

  it("键盘把光标走进表格，整块照旧退回源码 —— 进源码那条路没有堵", async () => {
    const v = mount(DOC);
    await settle();
    v.dispatch({ selection: { anchor: DOC.indexOf("| 1") + 2 } });
    await settle();
    expect(v.dom.querySelector(".cm-table")).toBeNull();
    expect(v.dom.textContent).toContain("|---|---|");
  });
});
