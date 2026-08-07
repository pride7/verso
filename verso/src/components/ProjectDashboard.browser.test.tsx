import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "../styles.css";

const project = {
  path: "项目.md", id: null, title: "可信解码", frontmatter: { type: "project", status: "进行中", summary: "先确认误差来源。", next: "跑完消融", blocker: "缺一组数据" }, frontmatterText: null, body: "", mtimeMs: 1,
};
const children = Array.from({ length: 5 }, (_, i) => ({
  path: `项目/实验/实验 ${i + 1}.md`, id: null, title: `实验 ${i + 1}`, frontmatter: { type: "experiment", status: "进行中", summary: `结果 ${i + 1}` }, frontmatterText: null, body: "", mtimeMs: 10 - i,
}));
const progress = { path: "项目/进展.md", id: null, title: "进展", frontmatter: { type: "project-log" }, frontmatterText: null, body: "## 2026-08-06 10:00\n\n完成基线。", mtimeMs: 20 };
const disk = new Map([...children, progress].map((value) => [value.path, value]));

const apiMock = {
  readNote: vi.fn(async (path: string) => disk.get(path)!),
  createNote: vi.fn(async (_parent: string | null, _title: string) => ({ path: "", title: "", id: null })),
  writeNote: vi.fn(async (_path: string, _body: string) => 1),
  propSet: vi.fn(async (_path: string, _key: string, _value: string | null) => {}),
  propSchema: vi.fn(async () => ({ status: { type: "select" as const, options: ["自定义状态"] } })),
  propDefSet: vi.fn(async (_key: string, _def: unknown) => {}),
};
vi.mock("../api", () => ({ api: apiMock }));
const { ProjectDashboard } = await import("./ProjectDashboard");

let root: Root | null = null;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("单项目总览", () => {
  it("默认只露三条进行中事项，并把当前状态保持在首屏", async () => {
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    expect(document.querySelector(".project-snapshot")?.textContent).toContain("先确认误差来源");
    const active = document.querySelector(".project-columns .project-section:first-child")!;
    expect(active.querySelectorAll(".project-item")).toHaveLength(3);
    expect(active.querySelector(".project-more")?.textContent).toContain("查看全部 5 条");
    (active.querySelector(".project-more") as HTMLButtonElement).click();
    await tick();
    expect(active.querySelectorAll(".project-item")).toHaveLength(5);
    expect(document.querySelectorAll(".project-record-group")).toHaveLength(4);
  });

  it("记录入口默认就是进展，只要求填写内容", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    (document.querySelector(".project-btn.primary") as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector(".project-dialog h2")?.textContent).toBe("记录一条进展");
    expect(document.querySelector(".project-dialog input")).toBeNull();
    expect(document.querySelector(".project-dialog textarea")).not.toBeNull();
  });

  it("实验只在小窗填写标题，创建后立刻交给完整编辑器", async () => {
    apiMock.createNote.mockImplementation(async (parent: string | null, title: string) => ({
      path: parent ? `${parent.replace(/\.md$/, "")}/${title}.md` : `${title}.md`,
      title,
      id: null,
    }));
    const onOpen = vi.fn();
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={onOpen} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    (document.querySelector(".project-btn.primary") as HTMLButtonElement).click();
    await tick();
    const experiment = [...document.querySelectorAll<HTMLButtonElement>(".project-kind-tabs button")].find((button) => button.textContent === "实验")!;
    experiment.click();
    await tick();
    expect(document.querySelector(".project-dialog h2")?.textContent).toBe("新建实验文档");
    expect(document.querySelector(".project-dialog header p")?.textContent).toContain("完整编辑器");
    expect(document.querySelector<HTMLInputElement>(".project-template-choice input")?.checked).toBe(false);
    const title = document.querySelector<HTMLInputElement>(".project-dialog input")!;
    await userEvent.fill(title, "温度消融");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-dialog footer .primary")!);
    await tick(140);
    expect(onOpen).toHaveBeenCalledWith("项目/实验/温度消融.md");
    expect(apiMock.writeNote.mock.calls[0][1]).toBe("");
  });

  it("状态是可扩展的单选，而不是自由文本框", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const status = document.querySelector<HTMLButtonElement>('.project-item button[aria-label="实验 1的状态"]')!;
    await userEvent.click(status);
    const options = [...document.querySelectorAll<HTMLButtonElement>('.project-status-menu [role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["计划中", "进行中", "已暂停", "已完成", "已归档", "自定义状态"]);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    await userEvent.click(options[3]);
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("项目/实验/实验 1.md", "status", "已完成");

    const updatedStatus = document.querySelector<HTMLButtonElement>('.project-item button[aria-label="实验 1的状态"]')!;
    await userEvent.click(updatedStatus);
    const updatedOptions = [...document.querySelectorAll<HTMLButtonElement>('.project-status-menu [role="option"]')];
    expect(updatedOptions.map((option) => option.textContent)).toEqual(["计划中", "进行中", "已暂停", "已完成", "已归档", "自定义状态"]);
    expect(updatedOptions[3].getAttribute("aria-selected")).toBe("true");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-status-new")!);
    const custom = document.querySelector<HTMLInputElement>(".project-status-add input")!;
    await userEvent.fill(custom, "复现中");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-status-add button")!);
    await tick();
    expect(apiMock.propDefSet).toHaveBeenCalledWith(
      "status",
      expect.objectContaining({ type: "select", options: expect.arrayContaining(["复现中"]) }),
    );
    expect(apiMock.propSet).toHaveBeenCalledWith("项目/实验/实验 1.md", "status", "复现中");
  });

  it("记录整行打开文档，不再显示重复的进入箭头", async () => {
    const onOpen = vi.fn();
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={onOpen} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const row = document.querySelector(".project-item")!;
    expect(row.querySelector(".project-item-open > svg")).toBeNull();
    await userEvent.click(row.querySelector<HTMLButtonElement>(".project-item-open")!);
    expect(onOpen).toHaveBeenCalledWith("项目/实验/实验 1.md");
  });
});
