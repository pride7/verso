import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "../../../src/ui/styles.css";

const rows = [
  { path: "Alpha.md", title: "Alpha", props: { status: "进行中", summary: "准备首轮验证", next: "跑基线", blocker: "缺数据", updated: "2026-08-07T01:00:00Z" } },
  { path: "Beta.md", title: "Beta", props: { status: "已完成", summary: "已经交付", next: "", blocker: "", updated: "2026-08-06T01:00:00Z" } },
  { path: "Gamma.md", title: "Gamma", props: { status: "自定义状态", summary: "整理资料", next: "补文档", blocker: "", updated: "2026-08-05T01:00:00Z" } },
];
const apiMock = {
  viewQuery: vi.fn(async () => ({ rows, columns: [], view: "table", groupBy: null, properties: [] })),
};
vi.mock("../../../src/host/api", () => ({ api: apiMock }));
const { ProjectCenter } = await import("../../../src/ui/ProjectCenter");

let root: Root | null = null;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

function mount(overrides: Partial<Parameters<typeof ProjectCenter>[0]> = {}) {
  const host = document.createElement("div"); host.id = "root"; document.body.appendChild(host);
  root = createRoot(host);
  const props = { revision: 0, promotableNote: null as string | null, onOpen: vi.fn(), onNew: vi.fn(), onPromote: vi.fn(), onClose: vi.fn(), onError: vi.fn(), ...overrides };
  root.render(<ProjectCenter {...props} />);
  return props;
}

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
    expect([...document.querySelectorAll(".project-center-card h2")].map((title) => title.textContent)).toEqual(["Beta"]);
    await userEvent.click(filters[0]);
    await userEvent.fill(document.querySelector<HTMLInputElement>('.project-center-search input')!, "资料");
    expect([...document.querySelectorAll(".project-center-card h2")].map((title) => title.textContent)).toEqual(["Gamma"]);
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
});
