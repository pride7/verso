import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  createNote: vi.fn(async () => ({ path: "", title: "", id: null })),
  writeNote: vi.fn(async () => 1),
  propSet: vi.fn(async () => {}),
};
vi.mock("../api", () => ({ api: apiMock }));
const { ProjectDashboard } = await import("./ProjectDashboard");

let root: Root | null = null;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => { root?.unmount(); root = null; document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("科研项目工作台", () => {
  it("默认只露三条进行中事项，并把当前状态保持在首屏", async () => {
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    expect(document.querySelector(".project-snapshot")?.textContent).toContain("先确认误差来源");
    expect(document.querySelectorAll(".project-item")).toHaveLength(3);
    expect(document.querySelector(".project-more")?.textContent).toContain("查看全部 5 条");
    (document.querySelector(".project-more") as HTMLButtonElement).click();
    await tick();
    expect(document.querySelectorAll(".project-item")).toHaveLength(5);
  });

  it("记录入口默认就是进展，只要求填写内容", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    (document.querySelector(".project-btn.primary") as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector(".project-dialog h2")?.textContent).toBe("记录到项目");
    expect(document.querySelector(".project-dialog input")).toBeNull();
    expect(document.querySelector(".project-dialog textarea")).not.toBeNull();
  });
});
