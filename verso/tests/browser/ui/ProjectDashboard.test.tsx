import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import "../../../src/ui/styles.css";

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
vi.mock("../../../src/host/api", () => ({ api: apiMock }));
const { ProjectDashboard } = await import("../../../src/ui/ProjectDashboard");

let root: Root | null = null;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
// 视口是整个 Chromium 实例共享的，改完必须还原 —— 不还原的话，同一次运行里
// 后跑的文件会在手机尺寸下跑，而它们的几何断言都是照桌面写的
afterEach(async () => {
  root?.unmount(); root = null; document.body.innerHTML = ""; vi.clearAllMocks();
  await page.viewport(1440, 900);
});

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

  it("分类可以删掉，文档留在文档树里", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    expect(document.querySelectorAll(".project-record-group")).toHaveLength(4);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-records-head button")].find((button) => button.textContent === "管理分类")!);
    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="删除分类实验"]')!);
    // 非空分类要先说清楚文件不会被删，再让人按下去
    expect(document.querySelector(".project-section-confirm p")?.textContent).toContain("5 篇文档仍留在文档树");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-section-confirm .danger")!);
    await tick();
    expect(apiMock.propDefSet).toHaveBeenCalledWith("sections", { type: "multi" });
    expect(apiMock.propSet).toHaveBeenCalledWith("项目.md", "sections", "问题、决策、资料");
    expect([...document.querySelectorAll(".project-record-group:not(.is-add) h3")].map((h) => h.textContent)).toEqual(["问题", "决策", "资料"]);
  });

  it("分类靠拖动排序，落点由指示线先说清楚", async () => {
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-records-head button")].find((button) => button.textContent === "管理分类")!);

    const cards = () => [...document.querySelectorAll<HTMLElement>(".project-record-group:not(.is-add)")];
    const grip = cards()[3].querySelector<HTMLElement>(".project-section-grip")!;
    expect(cards()[3].querySelector("h3")?.textContent).toBe("资料");
    // 手柄必须自己关掉 touch-action，否则手机上按住拖只会把页面滚走
    expect(getComputedStyle(grip).touchAction).toBe("none");

    const from = grip.getBoundingClientRect();
    const target = cards()[0].getBoundingClientRect();
    const send = (type: string, x: number, y: number, on: EventTarget) =>
      on.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, button: 0 }));
    send("pointerdown", from.left + 5, from.top + 5, grip);
    // 落在第一张卡片的左半边 = 插到它前面
    send("pointermove", target.left + target.width * 0.2, target.top + 20, window);
    await tick(20);
    expect(cards()[0].classList.contains("is-drop-before")).toBe(true);
    expect(cards()[3].classList.contains("is-dragging")).toBe(true);
    send("pointerup", target.left + target.width * 0.2, target.top + 20, window);
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("项目.md", "sections", "资料、实验、问题、决策");
    expect(cards().map((card) => card.querySelector("h3")?.textContent)).toEqual(["资料", "实验", "问题", "决策"]);
    expect(document.querySelector(".is-drop-before")).toBeNull();
  });

  it("窄屏单列时，前后关系按上下判断", async () => {
    await page.viewport(390, 844);
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-records-head button")].find((button) => button.textContent === "管理分类")!);

    const cards = () => [...document.querySelectorAll<HTMLElement>(".project-record-group:not(.is-add)")];
    // 先确认真的是单列：四张卡片左边缘一样、上边缘各不相同
    const boxes = cards().map((card) => card.getBoundingClientRect());
    expect(new Set(boxes.map((box) => Math.round(box.left))).size).toBe(1);
    expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(4);

    const grip = cards()[0].querySelector<HTMLElement>(".project-section-grip")!;
    const send = (type: string, x: number, y: number, on: EventTarget) =>
      on.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: x, clientY: y, bubbles: true, button: 0 }));
    const start = grip.getBoundingClientRect();
    send("pointerdown", start.left + 5, start.top + 5, grip);
    // 拖到第三张卡片的下半边。此时 x 还落在卡片左半边 —— 按左右判断会得出
    // 「插到它前面」，只有按上下判断才是「插到它后面」
    send("pointermove", boxes[2].left + 30, boxes[2].bottom - 8, window);
    await tick(20);
    send("pointerup", boxes[2].left + 30, boxes[2].bottom - 8, window);
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("项目.md", "sections", "问题、决策、实验、资料");
  });

  it("没有指针也能排序：手柄上按方向键", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={() => {}} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-records-head button")].find((button) => button.textContent === "管理分类")!);
    const grip = document.querySelectorAll<HTMLElement>(".project-section-grip")[1];
    grip.focus();
    await userEvent.keyboard("{ArrowUp}");
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("项目.md", "sections", "问题、实验、决策、资料");
  });

  it("可以自己加分类，新分类同样能建文档", async () => {
    const custom = { ...project, frontmatter: { ...project.frontmatter, sections: ["实验", "复现"] } };
    apiMock.createNote.mockImplementation(async (parent: string | null, title: string) => ({
      path: parent ? `${parent.replace(/\.md$/, "")}/${title}.md` : `${title}.md`, title, id: null,
    }));
    const onOpen = vi.fn();
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={custom} notes={[]} revision={0} onOpen={onOpen} onEdit={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    expect([...document.querySelectorAll(".project-record-group h3")].map((h) => h.textContent)).toEqual(["实验", "复现"]);

    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-records-head button")].find((button) => button.textContent === "管理分类")!);
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-section-new")!);
    await userEvent.fill(document.querySelector<HTMLInputElement>('.project-section-add input')!, "实验");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-section-add .primary")!);
    expect(document.querySelector(".project-section-error")?.textContent).toBe("已经有同名分类了");
    await userEvent.fill(document.querySelector<HTMLInputElement>('.project-section-add input')!, "会议");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-section-add .primary")!);
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("项目.md", "sections", "实验、复现、会议");

    // 自定义分类进得了「记录」小窗，只是没有内置的建议结构
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-btn.primary")!);
    await tick();
    expect([...document.querySelectorAll(".project-kind-tabs button")].map((button) => button.textContent)).toEqual(["进展", "实验", "复现", "会议"]);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-kind-tabs button")].find((button) => button.textContent === "复现")!);
    await tick();
    expect(document.querySelector(".project-dialog h2")?.textContent).toBe("新建复现文档");
    expect(document.querySelector(".project-template-choice")).toBeNull();
    await userEvent.fill(document.querySelector<HTMLInputElement>(".project-dialog input")!, "跑通 baseline");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-dialog footer .primary")!);
    await tick(140);
    expect(onOpen).toHaveBeenCalledWith("项目/复现/跑通 baseline.md");
    expect(apiMock.propSet).toHaveBeenCalledWith("项目/复现/跑通 baseline.md", "type", "复现");
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
