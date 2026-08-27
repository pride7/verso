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
};
vi.mock("../../../src/host/api", () => ({ api: apiMock }));
const { ProjectCenter } = await import("../../../src/ui/ProjectCenter");

let root: Root | null = null;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => {
  root?.unmount(); root = null; document.body.innerHTML = ""; vi.clearAllMocks();
  localStorage.removeItem("verso.projectCenter.sort");
});

function mount(overrides: Partial<Parameters<typeof ProjectCenter>[0]> = {}) {
  const host = document.createElement("div"); host.id = "root"; document.body.appendChild(host);
  root = createRoot(host);
  const props = { revision: 0, promotableNote: null as string | null, onOpen: vi.fn(), onNew: vi.fn(), onPromote: vi.fn(), onClose: vi.fn(), onChanged: vi.fn(), onError: vi.fn(), ...overrides };
  root.render(<ProjectCenter {...props} />);
  return props;
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
});
