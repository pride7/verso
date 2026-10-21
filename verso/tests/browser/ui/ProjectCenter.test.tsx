import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "../../../src/ui/styles.css";

// 最近修改的顺序是 Alpha → Beta → Gamma；创建顺序有意反过来（Alpha 最早建），
// 排序方式一换，顺序就得跟着变，两份时间才验得出「排的是哪一个」
const rows = [
  { path: "Alpha.md", title: "Alpha", props: { status: "进行中", summary: "准备首轮验证", next: "跑基线", blocker: "缺数据", updated: "2026-08-07T01:00:00Z", created: "2026-08-01T01:00:00Z" } },
  { path: "Beta.md", title: "Beta", props: { status: "已完成", summary: "已经交付", next: "", blocker: "", updated: "2026-08-06T01:00:00Z", created: "2026-08-03T01:00:00Z" } },
  { path: "Gamma.md", title: "Gamma", props: { status: "自定义状态", summary: "整理资料", next: "补文档", blocker: "", updated: "2026-08-05T01:00:00Z", created: "2026-08-02T01:00:00Z" } },
];
const apiMock = {
  viewQuery: vi.fn(async () => ({ rows, columns: [], view: "table", groupBy: null, properties: [] })),
  propSet: vi.fn(async (_path: string, _key: string, _value: string | null) => {}),
  propDefSet: vi.fn(async (_key: string, _def: unknown) => {}),
  propSchema: vi.fn(async () => ({ status: { type: "select", options: ["未开始", "进行中", "已完成", "复核中"] } })),
  order: vi.fn(async (_parent: string) => [] as string[]),
  reorder: vi.fn(async (_parent: string, _paths: string[]) => {}),
};
vi.mock("../../../src/host/api", () => ({ api: apiMock }));
const { ProjectCenter } = await import("../../../src/ui/ProjectCenter");

let root: Root | null = null;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => {
  root?.unmount(); root = null; document.body.innerHTML = ""; vi.clearAllMocks();
  localStorage.removeItem("verso.projectCenter.sort");
  localStorage.removeItem("verso.projectCenter.filter");
});

function mount(overrides: Partial<Parameters<typeof ProjectCenter>[0]> = {}) {
  const host = document.createElement("div"); host.id = "root"; document.body.appendChild(host);
  root = createRoot(host);
  const props = { revision: 0, promotableNote: null as string | null, onOpen: vi.fn(), onNew: vi.fn(), onPromote: vi.fn(), onClose: vi.fn(), onChanged: vi.fn(), onError: vi.fn(), ...overrides };
  root.render(<ProjectCenter {...props} />);
  return props;
}

/** 鼠标按住一张卡片拖到另一张的中心再松手。每一步之间等两帧：位置是在 rAF 里算的 */
async function drag(from: string, onto: string) {
  const card = (title: string) => [...document.querySelectorAll<HTMLElement>(".project-center-card")].find((el) => el.querySelector("h2")?.textContent === title)!;
  const start = card(from).getBoundingClientRect();
  const end = card(onto).getBoundingClientRect();
  const at = (rect: DOMRect) => ({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  const pointer = { pointerId: 1, pointerType: "mouse", button: 0, bubbles: true, cancelable: true };
  card(from).dispatchEvent(new PointerEvent("pointerdown", { ...pointer, ...at(start) }));
  window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: at(start).clientX + 10, clientY: at(start).clientY + 10 }));
  await tick(40);
  window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, ...at(end) }));
  await tick(40);
  window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, ...at(end) }));
  // 松手那一下浏览器会补一个 click，拖完不能把项目打开
  card(from).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick(260);
}

const titles = () => [...document.querySelectorAll(".project-center-card h2")].map((title) => title.textContent);

describe("项目中心", () => {
  it("汇总全部项目并从卡片进入单项目总览", async () => {
    const props = mount();
    await tick();
    expect(document.querySelectorAll(".project-center-card")).toHaveLength(3);
    expect(document.querySelector(".project-center-overview")?.textContent).toContain("3全部项目");
    expect(document.querySelector(".project-center-overview")?.textContent).toContain("2仍在推进");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-center-card")!);
    expect(props.onOpen).toHaveBeenCalledWith("Alpha.md");
  });

  it("可按固定状态或关键词缩小项目范围", async () => {
    mount();
    await tick();
    const filters = [...document.querySelectorAll<HTMLButtonElement>(".project-center-filters button")];
    expect(filters.map((button) => button.textContent)).toEqual(["全部", "进行中", "已完成", "自定义状态"]);
    await userEvent.click(filters[2]);
    expect(titles()).toEqual(["Beta"]);
    await userEvent.click(filters[0]);
    await userEvent.fill(document.querySelector<HTMLInputElement>('.project-center-search input')!, "资料");
    expect(titles()).toEqual(["Gamma"]);
  });

  it("右键（手机上长按）状态筛选可设为默认，下次打开先显示那一档", async () => {
    mount();
    await tick();
    const active = [...document.querySelectorAll<HTMLButtonElement>(".project-center-filters button")].find((button) => button.textContent === "进行中")!;
    active.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent === "设为默认")!);
    expect(document.querySelector(".ctx")).toBeNull();
    expect(titles()).toEqual(["Alpha"]);
    expect(localStorage.getItem("verso.projectCenter.filter")).toBe("进行中");

    root?.unmount();
    document.body.innerHTML = "";
    mount();
    await tick();
    expect(document.querySelector(".project-center-filters .is-on")?.textContent).toBe("进行中");
    expect(titles()).toEqual(["Alpha"]);
    // 已经是默认的那档，菜单里只说明一下，不再给一个点了没反应的按钮
    document.querySelector(".project-center-filters .is-on")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    await tick();
    expect(document.querySelector<HTMLButtonElement>(".ctx button")?.textContent).toBe("已是默认");
    expect(document.querySelector<HTMLButtonElement>(".ctx button")?.disabled).toBe(true);
  });

  it("把「全部」设回默认就清掉记录；默认那档眼下没有项目时落回「全部」", async () => {
    localStorage.setItem("verso.projectCenter.filter", "未开始");
    mount();
    await tick();
    expect(document.querySelector(".project-center-filters .is-on")?.textContent).toBe("全部");
    expect(titles()).toHaveLength(3);

    localStorage.setItem("verso.projectCenter.filter", "已完成");
    root?.unmount();
    document.body.innerHTML = "";
    mount();
    await tick();
    expect(titles()).toEqual(["Beta"]);
    document.querySelector(".project-center-filters button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent === "设为默认")!);
    expect(titles()).toHaveLength(3);
    expect(localStorage.getItem("verso.projectCenter.filter")).toBeNull();
  });

  it("提供新建项目和返回当前笔记的明确入口", async () => {
    const props = mount();
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-center-head button")].find((button) => button.textContent?.includes("新建项目"))!);
    await userEvent.click(document.querySelector<HTMLButtonElement>('.project-center-head button[aria-label="返回当前笔记"]')!);
    expect(props.onNew).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("当前是普通笔记时，也能选择把它直接设为项目", async () => {
    const props = mount({ promotableNote: "已有方案" });
    await tick();
    const promote = [...document.querySelectorAll<HTMLButtonElement>(".project-center-head button")].find((button) => button.textContent === "设为项目")!;
    expect(promote.title).toContain("已有方案");
    await userEvent.click(promote);
    expect(props.onPromote).toHaveBeenCalledOnce();
  });

  it("右键（手机上长按）卡片可以置顶：写进那篇项目的 frontmatter，卡片排到最前", async () => {
    const props = mount();
    await tick();
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
    const gamma = [...document.querySelectorAll<HTMLElement>(".project-center-card")].find((card) => card.textContent?.includes("Gamma"))!;
    gamma.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent === "置顶")!);
    await tick();
    // 写的是真布尔（`pinned` 先被声明成 checkbox），不是字符串
    expect(apiMock.propDefSet).toHaveBeenCalledWith("pinned", { type: "checkbox" });
    expect(apiMock.propSet).toHaveBeenCalledWith("Gamma.md", "pinned", "true");
    expect(props.onChanged).toHaveBeenCalledOnce();
    expect(titles()).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(document.querySelector(".project-center-card.is-pinned .project-center-card-pin")).not.toBeNull();
    // 菜单里那一条跟着变成「取消置顶」
    gamma.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    expect([...document.querySelectorAll(".ctx button")].map((button) => button.textContent)).toContain("取消置顶");
  });

  it("右键（手机上长按）卡片可以改状态：列出词表里的状态，写回那篇项目的 frontmatter", async () => {
    const props = mount();
    await tick();
    const alpha = [...document.querySelectorAll<HTMLElement>(".project-center-card")].find((card) => card.textContent?.includes("Alpha"))!;
    alpha.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent === "更改状态")!);
    const options = [...document.querySelectorAll<HTMLButtonElement>(".ctx-sub button")];
    expect(options.map((button) => button.textContent)).toEqual(["未开始", "进行中", "已完成", "复核中"]);
    // 每一条带着自己那一档的颜色，选之前就看得出它落在哪一档
    expect(options.map((button) => button.querySelector(".ctx-tone")?.getAttribute("data-tone"))).toEqual(["todo", "active", "done", "active"]);
    await userEvent.click(options[2]);
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("Alpha.md", "status", "已完成");
    expect(props.onChanged).toHaveBeenCalledOnce();
    expect(document.querySelector(".ctx")).toBeNull();
    expect(alpha.querySelector(".project-center-card-status")?.textContent).toBe("已完成");
    // 「仍在推进」跟着少一个
    expect(document.querySelector(".project-center-overview")?.textContent).toContain("1仍在推进");
  });

  it("改状态写失败时，卡片退回原来的状态", async () => {
    apiMock.propSet.mockRejectedValueOnce(new Error("磁盘满了"));
    const props = mount();
    await tick();
    const alpha = [...document.querySelectorAll<HTMLElement>(".project-center-card")].find((card) => card.textContent?.includes("Alpha"))!;
    alpha.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent === "更改状态")!);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx-sub button")].find((button) => button.textContent === "未开始")!);
    await tick();
    expect(props.onError).toHaveBeenCalledWith("磁盘满了");
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(alpha.querySelector(".project-center-card-status")?.textContent).toBe("进行中");
  });

  it("右键（手机上长按）卡片可以删除项目，交给上层走文档树那条确认流程", async () => {
    const onDelete = vi.fn();
    mount({ onDelete });
    await tick();
    const beta = [...document.querySelectorAll<HTMLElement>(".project-center-card")].find((card) => card.textContent?.includes("Beta"))!;
    beta.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent === "删除项目")!);
    expect(onDelete).toHaveBeenCalledWith("Beta.md");
    // 点完菜单就收起，不留在原地
    expect(document.querySelector(".ctx")).toBeNull();
  });

  it("排序方式可以自己选，并记住上次的选择；置顶永远在最前", async () => {
    mount();
    await tick();
    const sortButton = document.querySelector<HTMLButtonElement>(".project-center-sort-btn")!;
    expect(sortButton.textContent).toContain("最近修改");
    await userEvent.click(sortButton);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-center-sort .side-menu button")].find((button) => button.textContent === "最近创建")!);
    expect(titles()).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(sortButton.textContent).toContain("最近创建");
    expect(localStorage.getItem("verso.projectCenter.sort")).toBe("created");

    // 重新打开还是这个顺序
    root?.unmount(); root = null; document.body.innerHTML = "";
    mount();
    await tick();
    expect(titles()).toEqual(["Beta", "Gamma", "Alpha"]);

    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-center-sort-btn")!);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-center-sort .side-menu button")].find((button) => button.textContent === "名称 A→Z")!);
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("按住卡片拖到别处就换位，切到「自定义」并写进顺序文件；拖完不会打开项目", async () => {
    const props = mount();
    await tick();
    await drag("Alpha", "Gamma");
    expect(titles()).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(apiMock.reorder).toHaveBeenCalledWith("/项目中心", ["Beta.md", "Gamma.md", "Alpha.md"]);
    expect(document.querySelector(".project-center-sort-btn")?.textContent).toContain("自定义");
    expect(localStorage.getItem("verso.projectCenter.sort")).toBe("manual");
    // 落定之后不留任何位移，卡片回到普通的样子
    for (const card of document.querySelectorAll<HTMLElement>(".project-center-card")) {
      expect(card.style.transform).toBe("");
      expect(card.classList.contains("is-dragging")).toBe(false);
    }
    expect(document.body.classList.contains("is-sorting")).toBe(false);
    // 没拖的时候点一下照样打开
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-center-card")!);
    expect(props.onOpen).toHaveBeenCalledWith("Beta.md");
  });

  it("拖动中被拖的那张跟手，其余的当场让位；按 Esc 退回原样", async () => {
    mount();
    await tick();
    const cards = [...document.querySelectorAll<HTMLElement>(".project-center-card")];
    const [alpha, , gamma] = cards;
    const from = alpha.getBoundingClientRect();
    const onto = gamma.getBoundingClientRect();
    const pointer = { pointerId: 1, pointerType: "mouse", button: 0, bubbles: true, cancelable: true };
    alpha.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: from.left + 20, clientY: from.top + 20 }));
    window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: onto.left + onto.width / 2 - from.width / 2 + 20, clientY: onto.top + onto.height / 2 - from.height / 2 + 20 }));
    await tick(40);
    expect(alpha.classList.contains("is-dragging")).toBe(true);
    expect(document.body.classList.contains("is-sorting")).toBe(true);
    expect(alpha.style.transform).toContain("translate3d");
    // 还没松手，后面两张已经往前补位了
    expect(cards[1].style.transform).toMatch(/translate3d\(-?\d/);
    expect(cards[1].style.transform).not.toBe("translate3d(0px, 0px, 0px)");
    expect(gamma.style.transform).not.toBe("");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick(260);
    expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(apiMock.reorder).not.toHaveBeenCalled();
    expect(cards.every((card) => card.style.transform === "")).toBe(true);
    // Esc 之后松手不再算一次拖动
    window.dispatchEvent(new PointerEvent("pointerup", pointer));
    await tick(40);
    expect(apiMock.reorder).not.toHaveBeenCalled();
  });

  it("自定义顺序从顺序文件读回来；没排过的沉到底", async () => {
    localStorage.setItem("verso.projectCenter.sort", "manual");
    apiMock.order.mockResolvedValueOnce(["Gamma.md", "Beta.md"]);
    mount();
    await tick();
    expect(apiMock.order).toHaveBeenCalledWith("/项目中心");
    expect(titles()).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("置顶的卡片拖不出置顶组，别的也拖不进去", async () => {
    apiMock.viewQuery.mockResolvedValueOnce({
      rows: rows.map((row) => row.path === "Gamma.md" ? { ...row, props: { ...row.props, pinned: "true" } } : row),
      columns: [], view: "table", groupBy: null, properties: [],
    });
    mount();
    await tick();
    expect(titles()).toEqual(["Gamma", "Alpha", "Beta"]);
    await drag("Beta", "Gamma");
    // 只能落到非置顶组的最前面
    expect(titles()).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(apiMock.reorder).toHaveBeenCalledWith("/项目中心", ["Gamma.md", "Beta.md", "Alpha.md"]);
  });

  it("筛选中拖动只和看得见的邻居换位，看不见的原地不动", async () => {
    // Alpha、Gamma 在推进，Beta 已完成：筛「进行中」时 Beta 夹在两张看得见的中间
    apiMock.viewQuery.mockResolvedValueOnce({
      rows: rows.map((row) => row.path === "Gamma.md" ? { ...row, props: { ...row.props, status: "进行中" } } : row),
      columns: [], view: "table", groupBy: null, properties: [],
    });
    mount();
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-center-filters button")].find((button) => button.textContent === "进行中")!);
    expect(titles()).toEqual(["Alpha", "Gamma"]);
    await drag("Alpha", "Gamma");
    expect(titles()).toEqual(["Gamma", "Alpha"]);
    expect(apiMock.reorder).toHaveBeenCalledWith("/项目中心", ["Beta.md", "Gamma.md", "Alpha.md"]);
  });
});
