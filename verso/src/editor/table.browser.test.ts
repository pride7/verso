/**
 * 渲染态表格上的结构编辑。DESIGN.md §4.9
 *
 * 在真实浏览器里跑：这一层全是 DOM 事件与 `ignoreEvent` 的分工 —— 把手要
 * 被 widget 自己吃掉、单元格要放给编辑器。两者只差一个判断，而判错的表现
 * （表格锁死 / 点一下就退回源码）在单元测试里一条都验不了。
 *
 * 纯逻辑（插到第几行、竖线怎么对齐）在 `tableOps.test.ts` 里，那份在 Node 跑。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "./index";
import { applySettings, DEFAULT_SETTINGS } from "../settings";
import "../styles.css";

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

describe("把手", () => {
  it("每列一个列把手，每行一个行把手（表头也有）", async () => {
    const v = mount(DOC);
    await settle();
    expect(cols(v)).toHaveLength(2);
    // 表头 + 两行数据
    expect(rows(v)).toHaveLength(3);
  });

  it("平时不显示，鼠标进了表格才浮现", async () => {
    const v = mount(DOC);
    await settle();
    const grip = cols(v)[0];
    expect(Number(getComputedStyle(grip).opacity)).toBe(0);
    // 藏着的时候不能挡住单元格 —— 点单元格是进源码改字的唯一入口
    expect(getComputedStyle(grip).pointerEvents).toBe("none");
  });

  // 把手是绝对定位到单元格上、再探进外面那层的内边距里的，而外面那层是
  // `overflow-x: auto` —— 位置算错一点就被整个裁掉，表现是「把手根本不出现」，
  // 和「样式没生效」长得一模一样（callout 的左侧色条踩过同一条）
  it("落在表格框里，没被裁掉，也没压住单元格的字", async () => {
    const v = mount(DOC);
    await settle();
    const wrap = v.dom.querySelector<HTMLElement>(".cm-table")!.getBoundingClientRect();
    const th = v.dom.querySelector<HTMLElement>(".cm-table th")!.getBoundingClientRect();
    const col = cols(v)[0].getBoundingClientRect();
    const row = rows(v)[1].getBoundingClientRect();

    expect(col.height).toBeGreaterThan(2);
    expect(col.top).toBeGreaterThanOrEqual(wrap.top);
    // 列把手在表头上沿之上，不盖住列名
    expect(col.bottom).toBeLessThanOrEqual(th.top + 1);
    expect(row.width).toBeGreaterThan(2);
    expect(row.left).toBeGreaterThanOrEqual(wrap.left);
    // 行把手待在第一格的左内边距里
    expect(row.right).toBeLessThanOrEqual(th.left + 12);
  });

  it("点列把手弹出菜单", async () => {
    const v = mount(DOC);
    await settle();
    click(cols(v)[0]);
    expect(menuLabels(v)).toContain("在右侧插入列");
    // 再点一下收起来
    click(cols(v)[0]);
    expect(v.dom.querySelector(".cm-table-menu")).toBeNull();
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

  it("点单元格照旧回到源码 —— 放行把手不能把整块事件都放行", async () => {
    const v = mount(DOC);
    await settle();
    click(v.dom.querySelector(".cm-table td")!);
    await settle();
    expect(v.dom.querySelector(".cm-table")).toBeNull();
    expect(v.dom.textContent).toContain("|---|---|");
  });
});
