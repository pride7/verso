/**
 * 状态四档的样子（§2.10）。**不是断言型测试**，产物是给人看的 PNG ——
 * 和 DatabaseView 里那组视图截图一个用途。
 *
 * 颜色这件事没法靠断言判好坏：能断言的只有「两档不一样」（那条在
 * `ProjectDashboard.test.tsx` 里），而「一屏摆在一起是不是还成体系」
 * 只能看。两套主题各来一张，深色不是把浅色反过来那么简单。
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import "../../../src/ui/styles.css";

const project = {
  path: "项目.md", id: null, title: "可信解码", frontmatter: { type: "project", status: "进行中", summary: "先确认误差来源。", next: "跑完消融", blocker: "缺一组数据" }, frontmatterText: null, body: "", mtimeMs: 1,
};
const make = (path: string, type: string, status: string, summary: string, mtimeMs: number, pinned = false) =>
  ({ path, id: null, title: path.split("/").pop()!.replace(/\.md$/, ""), frontmatter: { type, status, summary, ...(pinned ? { pinned: true } : {}) }, frontmatterText: null, body: "", mtimeMs });
const children = [
  make("项目/实验/encoder的设计", "experiment", "进行中", "可以改，而且证据比 pooling 那次还硬", 9, true),
  make("项目/实验/温度消融", "experiment", "已暂停", "等外部数据", 8),
  make("项目/问题/数据如何处理的？", "question", "已解决", "关于数据预处理（openwebtext-t5）", 7),
  make("项目/问题/架构如何设计？", "question", "待解决", "现在的框架甚至没有预测 EOS。", 6),
  make("项目/决策/整体架构", "decision", "已决定", "Encoder 输入应该不包含 BOS，但必须包含 EOS。", 5),
  make("项目/决策/旧的切块方案", "decision", "已废弃", "learned chunking 退化成均匀切块", 4),
  make("项目/资料/ParallelBench", "resource", "待整理", "并行解码的评测集", 3),
];
const disk = new Map(children.map((value) => [value.path, value]));

const apiMock = {
  readNote: vi.fn(async (path: string) => disk.get(path)!),
  createNote: vi.fn(async () => ({ path: "", title: "", id: null })),
  writeNote: vi.fn(async () => 1),
  propSet: vi.fn(async () => {}),
  propSchema: vi.fn(async () => ({ status: { type: "select" as const, options: [] } })),
  propDefSet: vi.fn(async () => {}),
};
vi.mock("../../../src/host/api", () => ({ api: apiMock }));
const { ProjectDashboard } = await import("../../../src/ui/ProjectDashboard");

let root: Root | null = null;
const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(async () => { root?.unmount(); root = null; document.body.innerHTML = ""; document.documentElement.removeAttribute("data-theme"); await page.viewport(1440, 900); });

describe("视觉：状态分档", () => {
  const shot = async (name: string) => { await tick(300); await page.screenshot({ path: `__shots__/${name}.png` }); };

  it("浅色和深色各来一张", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await page.viewport(1440, 1180);
    await tick();
    await shot("30-tone-light");
    document.documentElement.setAttribute("data-theme", "dark");
    await shot("31-tone-dark");
  });

  it("状态菜单：每档一个点，删除要先问一句", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    // 触摸模式：删除按钮没有 hover 可依赖，平时就露着 —— 顺便量一遍手机上的尺寸
    document.documentElement.setAttribute("data-touch", "on");
    await page.viewport(760, 900);
    await tick();
    document.querySelector<HTMLButtonElement>('.project-item button[aria-label="架构如何设计？的状态"]')!.click();
    await tick(60);
    [...document.querySelectorAll<HTMLElement>(".project-status-option")]
      .find((row) => row.textContent === "已搁置")!
      .querySelector<HTMLButtonElement>(".project-status-drop")!
      .click();
    await shot("32-tone-status-menu");
    document.documentElement.removeAttribute("data-touch");
  });

  it("新增状态时先说清楚它会落到哪一档", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await page.viewport(760, 640);
    await tick();
    document.querySelector<HTMLButtonElement>('.project-item button[aria-label="架构如何设计？的状态"]')!.click();
    await tick(60);
    document.querySelector<HTMLButtonElement>(".project-status-new")!.click();
    await tick(60);
    await userEvent.fill(document.querySelector<HTMLInputElement>(".project-status-add input")!, "等复现结果");
    await shot("33-tone-new-status");
  });

  it("行内的置顶记号和「移到」二级菜单", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await page.viewport(760, 620);
    await tick();
    const row = [...document.querySelectorAll<HTMLElement>(".project-item")].find((item) => item.textContent?.includes("encoder的设计"))!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 330 }));
    await tick(60);
    [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent?.startsWith("移到"))!.click();
    await shot("34-pin-and-move.png".replace(".png", ""));
  });
});
