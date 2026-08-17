import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { NoteContent } from "../../../src/core/types";
import "../../../src/ui/styles.css";

const project = {
  path: "项目.md", id: null, title: "可信解码", frontmatter: { type: "project", status: "进行中", summary: "先确认误差来源。", next: "跑完消融", blocker: "缺一组数据" }, frontmatterText: null, body: "", mtimeMs: 1,
};
const children = Array.from({ length: 5 }, (_, i) => ({
  path: `项目/实验/实验 ${i + 1}.md`, id: null, title: `实验 ${i + 1}`, frontmatter: { type: "experiment", status: "进行中", summary: `结果 ${i + 1}` }, frontmatterText: null, body: i === 4 ? "## 方法\n\n正文采用贝叶斯优化。" : "", mtimeMs: 10 - i,
}));
const progress = { path: "项目/进展.md", id: null, title: "进展", frontmatter: { type: "project-log" }, frontmatterText: null, body: "## 2026-08-06 10:00\n\n完成基线。", mtimeMs: 20 };
const disk = new Map<string, NoteContent>([...children, progress].map((value) => [value.path, value]));

const INITIAL_STATUSES = ["自定义状态"];
let statusOptions = [...INITIAL_STATUSES];

const apiMock = {
  readNote: vi.fn(async (path: string) => disk.get(path)!),
  createNote: vi.fn(async (_parent: string | null, _title: string) => ({ path: "", title: "", id: null })),
  writeNote: vi.fn(async (_path: string, _body: string) => 1),
  propSet: vi.fn(async (_path: string, _key: string, _value: string | null) => {}),
  // 词表是有状态的：写进去的那一份下次读得回来 —— 「删掉一个状态」这条路
  // 正是靠「读回来的少了一条」才验得了
  propSchema: vi.fn(async () => ({ status: { type: "select" as const, options: statusOptions } })),
  propDefSet: vi.fn(async (key: string, def: { type: string; options?: string[] }) => {
    if (key === "status") statusOptions = def.options ?? [];
  }),
};
vi.mock("../../../src/host/api", () => ({ api: apiMock }));
const { ProjectDashboard } = await import("../../../src/ui/ProjectDashboard");

let root: Root | null = null;
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
// 视口是整个 Chromium 实例共享的，改完必须还原 —— 不还原的话，同一次运行里
// 后跑的文件会在手机尺寸下跑，而它们的几何断言都是照桌面写的
afterEach(async () => {
  root?.unmount(); root = null; document.body.innerHTML = ""; vi.clearAllMocks();
  delete document.documentElement.dataset.touch;
  statusOptions = [...INITIAL_STATUSES];
  await page.viewport(1440, 900);
});

describe("单项目总览", () => {
  it("默认只露三条进行中事项，并把当前状态保持在首屏", async () => {
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    // 首屏要等的是**这一块真的挂上去**，不是一个拍脑袋的毫秒数：这一条要读
    // 子文档、算摘要，冷启动那一次（模块刚 import、CSS 刚解析）在慢一些的
    // 引擎上过不了 80ms。之后几条都在已经渲染好的 DOM 上操作，tick 够用
    await vi.waitFor(() => expect(document.querySelector(".project-snapshot")).not.toBeNull());
    expect(document.querySelector(".project-snapshot")?.textContent).toContain("先确认误差来源");
    const active = document.querySelector(".project-columns .project-section:first-child")!;
    expect(active.querySelectorAll(".project-item")).toHaveLength(3);
    expect(active.querySelector(".project-more")?.textContent).toContain("查看全部 5 条");
    (active.querySelector(".project-more") as HTMLButtonElement).click();
    await tick();
    expect(active.querySelectorAll(".project-item")).toHaveLength(5);
    expect(document.querySelectorAll(".project-record-group")).toHaveLength(4);
  });

  it("搜索记录的完整正文和进展，命中项不受三条折叠限制", async () => {
    document.documentElement.dataset.touch = "on";
    await page.viewport(390, 844);
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await vi.waitFor(() => expect(document.querySelector(".project-snapshot")).not.toBeNull());
    const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索项目记录与进展"]')!;

    // 关键词只出现在第五条的正文第二段，不在标题或摘要里；它原本也沉在“查看全部”后面。
    await userEvent.fill(search, "贝叶斯");
    await tick();
    expect([...document.querySelectorAll(".project-columns .project-item-copy strong")].map((row) => row.textContent)).toEqual(["实验 5"]);
    expect(document.querySelectorAll(".project-record-group")).toHaveLength(1);
    expect(document.querySelector(".project-search-count")?.textContent).toBe("1 条记录 · 0 条进展");
    expect(document.querySelector(".project-more")).toBeNull();
    const clear = document.querySelector<HTMLButtonElement>('button[aria-label="清空搜索"]')!;
    expect(clear.getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
    expect(clear.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);

    await userEvent.fill(search, "基线");
    await tick();
    expect(document.querySelectorAll(".project-item")).toHaveLength(0);
    expect(document.querySelector(".project-progress")?.textContent).toContain("完成基线");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".project-progress p")!).fontSize)
      .toBe("13.5px");
    expect(document.querySelector(".project-search-count")?.textContent).toBe("0 条记录 · 1 条进展");

    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="清空搜索"]')!);
    await tick();
    expect(search.value).toBe("");
    expect(document.querySelectorAll(".project-columns .project-section:first-child .project-item")).toHaveLength(3);
    expect(document.querySelectorAll(".project-record-group")).toHaveLength(4);
  });

  it("每条记录带一个日期，说的是创建时间", async () => {
    const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const ulid = (ms: number) => {
      let head = "";
      for (let value = ms, i = 0; i < 10; i += 1, value = Math.floor(value / 32)) {
        head = CROCKFORD[value % 32] + head;
      }
      return `${head}ABCDEFGHJKMNPQRS`;
    };
    const day = 86_400_000;
    const now = Date.now();
    const old = new Date(now - 5 * day);
    const dated: NoteContent[] = [
      // 五天前提的问题，但今天刚碰过 —— 日期要说「哪天提的」，那才是清单的排序口径
      { path: "项目/问题/旧问题.md", id: ulid(now - 5 * day), title: "旧问题", frontmatter: { type: "question", status: "进行中", summary: "" }, frontmatterText: null, body: "", mtimeMs: now },
      { path: "项目/问题/今天的问题.md", id: ulid(now), title: "今天的问题", frontmatter: { type: "question", status: "进行中", summary: "" }, frontmatterText: null, body: "", mtimeMs: now },
      // 别的编辑器建的：没有 ULID，只能退回文件时间
      { path: "项目/问题/没有 id.md", id: null, title: "没有 id", frontmatter: { type: "question", status: "进行中", summary: "" }, frontmatterText: null, body: "", mtimeMs: now - day },
    ];
    dated.forEach((note) => disk.set(note.path, note));
    try {
      const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
      root.render(<ProjectDashboard project={project} notes={dated.map(({ path }) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
      await vi.waitFor(() => expect(document.querySelector(".project-item-when")).not.toBeNull());

      const group = [...document.querySelectorAll<HTMLElement>(".project-record-group")]
        .find((card) => card.querySelector("h3")?.textContent === "问题")!;
      const rows = [...group.querySelectorAll<HTMLElement>(".project-item")];
      const when = (title: string) => rows
        .find((row) => row.querySelector("strong")?.textContent === title)!
        .querySelector<HTMLElement>(".project-item-when")!;

      expect(when("今天的问题").textContent).toBe("今天");
      // 创建于五天前、今天才改过：显示的是创建那天
      expect(when("旧问题").textContent).toBe(`${old.getMonth() + 1}月${old.getDate()}日`);
      expect(when("旧问题").title).toContain("创建于");
      expect(when("旧问题").title).toContain("最后修改");
      // 没有 ULID 的那条只知道文件时间，就不能说成「创建于」
      expect(when("没有 id").textContent).toBe("昨天");
      expect(when("没有 id").title.startsWith("最后修改")).toBe(true);

      // 日期不许把标题挤没：它是定宽的一小格，标题仍占着剩下的地方
      const box = when("今天的问题").getBoundingClientRect();
      const copy = rows[0].querySelector<HTMLElement>(".project-item-copy")!.getBoundingClientRect();
      expect(box.width).toBeLessThan(90);
      expect(copy.width).toBeGreaterThan(box.width * 2);
    } finally {
      dated.forEach((note) => disk.delete(note.path));
    }
  });

  it("记录入口默认就是进展，只要求填写内容", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
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
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={onOpen} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    (document.querySelector(".project-btn.primary") as HTMLButtonElement).click();
    await tick();
    const experiment = [...document.querySelectorAll<HTMLButtonElement>(".project-kind-tabs button")].find((button) => button.textContent === "实验")!;
    experiment.click();
    await tick();
    expect(document.querySelector(".project-dialog h2")?.textContent).toBe("新建实验文档");
    expect(document.querySelector(".project-dialog header p")).toBeNull();
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
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const status = document.querySelector<HTMLButtonElement>('.project-item button[aria-label="实验 1的状态"]')!;
    await userEvent.click(status);
    const options = [...document.querySelectorAll<HTMLButtonElement>('.project-status-menu [role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["未开始", "进行中", "已完成", "自定义状态"]);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    await userEvent.click(options[2]);
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("项目/实验/实验 1.md", "status", "已完成");

    const updatedStatus = document.querySelector<HTMLButtonElement>('.project-item button[aria-label="实验 1的状态"]')!;
    await userEvent.click(updatedStatus);
    const updatedOptions = [...document.querySelectorAll<HTMLButtonElement>('.project-status-menu [role="option"]')];
    expect(updatedOptions.map((option) => option.textContent)).toEqual(["未开始", "进行中", "已完成", "自定义状态"]);
    expect(updatedOptions[2].getAttribute("aria-selected")).toBe("true");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-status-new")!);
    const custom = document.querySelector<HTMLInputElement>(".project-status-add input")!;
    await userEvent.fill(custom, "复现中");
    // 新状态不会分到新颜色，而是落进已有的某一档 —— 按下「添加」之前就得看得见
    const hint = document.querySelector<HTMLElement>(".project-status-hint")!;
    expect(hint.textContent).toContain("正在推进");
    expect(hint.querySelector<HTMLElement>(".tone-dot")!.dataset.tone).toBe("active");
    await userEvent.fill(custom, "待复核");
    expect(document.querySelector<HTMLElement>(".project-status-hint")!.textContent).toContain("还没开始");
    await userEvent.fill(custom, "复现中");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-status-add button")!);
    await tick();
    expect(apiMock.propDefSet).toHaveBeenCalledWith(
      "status",
      expect.objectContaining({ type: "select", options: expect.arrayContaining(["复现中"]) }),
    );
    expect(apiMock.propSet).toHaveBeenCalledWith("项目/实验/实验 1.md", "status", "复现中");
  });

  it("置顶把一条钉在最前面，但不撑破三条的上限", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const active = document.querySelector(".project-columns .project-section:first-child")!;
    // 默认按最近改动：实验 1 最新，实验 5 最旧、连露都露不出来
    expect([...active.querySelectorAll(".project-item-copy strong")].map((row) => row.textContent))
      .toEqual(["实验 1", "实验 2", "实验 3"]);

    // 实验 5 沉在「查看全部」后面 —— 那正是置顶要解决的处境
    const card = [...document.querySelectorAll<HTMLElement>(".project-record-group")]
      .find((group) => group.querySelector("h3")?.textContent === "实验")!;
    await userEvent.click(card.querySelector<HTMLButtonElement>(".project-more")!);
    await tick();
    const last = [...card.querySelectorAll<HTMLElement>(".project-item")]
      .find((row) => row.textContent?.includes("实验 5"))!;
    last.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent === "置顶")!);
    await tick();
    // 写的是真布尔（`pinned` 先被声明成 checkbox），不是字符串
    expect(apiMock.propDefSet).toHaveBeenCalledWith("pinned", { type: "checkbox" });
    expect(apiMock.propSet).toHaveBeenCalledWith("项目/实验/实验 5.md", "pinned", "true");
    expect([...active.querySelectorAll(".project-item-copy strong")].map((row) => row.textContent))
      .toEqual(["实验 5", "实验 1", "实验 2"]);
    // 上限仍然是三条：置顶只是排到前面，不是额外多露一条
    expect(active.querySelectorAll(".project-item")).toHaveLength(3);
    expect(active.querySelector(".project-item-pin")).not.toBeNull();
  });

  it("换分类是真的搬文件，type 跟着一起改", async () => {
    const onMove = vi.fn();
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={onMove} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const row = document.querySelector(".project-item")!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    const submenu = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent?.startsWith("移到"))!;
    submenu.click();
    await tick();
    // 当前分类不在候选里 —— 移到自己那一类是一次什么都不会发生的操作
    const targets = [...document.querySelectorAll<HTMLButtonElement>(".ctx-sub button")].map((button) => button.textContent);
    expect(targets).toEqual(["问题", "决策", "资料"]);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx-sub button")].find((button) => button.textContent === "问题")!);
    await tick();
    expect(apiMock.propSet).toHaveBeenCalledWith("项目/实验/实验 1.md", "type", "question");
    expect(onMove).toHaveBeenCalledWith("项目/实验/实验 1.md", "项目/问题.md");
  });

  it("状态可以删掉：只去掉菜单里那一条，笔记一个字都不改", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const status = document.querySelector<HTMLButtonElement>('.project-item button[aria-label="实验 1的状态"]')!;
    await userEvent.click(status);
    // 正在用的那个不给删 —— 删了它还得留在菜单里，看着像没删掉
    const rows = [...document.querySelectorAll<HTMLElement>(".project-status-option")];
    expect(rows.find((row) => row.textContent === "进行中")?.querySelector(".project-status-drop")).toBeNull();

    // 删除按钮必须整个待在菜单里。`.project-status-menu button` 那条把宽度设成
    // 100%，而层叠是逐属性的 —— 漏了写回 auto 的话它会顶着整条菜单的宽度溢出去
    // 勾和叉共用行尾那一格，所以两者必须在同一条竖线上 —— 各画各的话差半格，
    // 两行一比就看得出来
    const centers = [...document.querySelectorAll<HTMLElement>(".project-status-mark")]
      .map((mark) => { const box = mark.getBoundingClientRect(); return box.left + box.width / 2; });
    expect(centers.length).toBeGreaterThan(1);
    expect(Math.max(...centers) - Math.min(...centers), "勾和叉没对齐").toBeLessThanOrEqual(0.5);
    // 方的：只给宽度的话高度只有图标那么高，悬停底一铺就是一条扁横杠
    for (const mark of document.querySelectorAll<HTMLElement>(".project-status-mark")) {
      const box = mark.getBoundingClientRect();
      expect(Math.abs(box.width - box.height), "行尾那一格不是方的").toBeLessThanOrEqual(0.5);
    }

    const menuBox = document.querySelector(".project-status-menu")!.getBoundingClientRect();
    for (const drop of document.querySelectorAll<HTMLElement>(".project-status-drop")) {
      const box = drop.getBoundingClientRect();
      expect(box.width, "删除按钮不该占满整条菜单").toBeLessThan(menuBox.width / 2);
      expect(box.right, "删除按钮溢出菜单右边").toBeLessThanOrEqual(menuBox.right + 0.5);
    }

    await userEvent.click(rows.find((row) => row.textContent === "已完成")!.querySelector<HTMLButtonElement>(".project-status-drop")!);
    await tick();
    expect(document.querySelector(".project-status-confirm")?.textContent).toContain("已有记录不受影响");
    await userEvent.click(document.querySelector<HTMLButtonElement>(".project-status-confirm .danger")!);
    await tick();
    // 写回去的是「少了这一条」的词表，笔记的 status 没有被动过
    expect(apiMock.propDefSet).toHaveBeenCalledWith("status", {
      type: "select",
      options: expect.not.arrayContaining(["已完成"]),
    });
    expect(apiMock.propSet).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('.project-status-menu [role="option"]')].map((option) => option.textContent))
      .toEqual(["未开始", "进行中", "自定义状态"]);
  });

  it("分类可以删掉，文档留在文档树里", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    expect(document.querySelectorAll(".project-record-group")).toHaveLength(4);
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".project-records-head button")].find((button) => button.textContent === "管理分类")!);
    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="删除分类实验"]')!);
    // 非空分类要先说清楚文件不会被删，再让人按下去
    expect(document.querySelector(".project-section-confirm p")?.textContent).toContain("文档不会删除");
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
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
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
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
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
    root.render(<ProjectDashboard project={project} notes={[]} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
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
    root.render(<ProjectDashboard project={custom} notes={[]} revision={0} onOpen={onOpen} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
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
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={onOpen} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const row = document.querySelector(".project-item")!;
    expect(row.querySelector(".project-item-open > svg")).toBeNull();
    await userEvent.click(row.querySelector<HTMLButtonElement>(".project-item-open")!);
    expect(onOpen).toHaveBeenCalledWith("项目/实验/实验 1.md", undefined);
  });

  it("状态按语义分档上色，五档各是各的颜色", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    // 用分类卡片里的那一行：「正在推进」按状态过滤，选了「已完成」它会直接
    // 离开那张清单，手里的 DOM 就成了游离节点
    const row = [...document.querySelectorAll<HTMLElement>(".project-record-group .project-item")]
      .find((item) => item.textContent?.includes("实验 1"))!;
    const pill = row.querySelector<HTMLButtonElement>(".project-status-trigger")!;
    expect(pill.dataset.tone).toBe("active");
    const active = getComputedStyle(pill).backgroundColor;

    pill.click();
    await tick();
    const dots = [...row.querySelectorAll<HTMLElement>(".project-status-menu .tone-dot")];
    // 未开始 / 进行中 / 已完成，外加 schema 里那个自定义状态
    expect(dots.map((dot) => dot.dataset.tone)).toEqual(["todo", "active", "done", "todo"]);
    expect(new Set(dots.map((dot) => getComputedStyle(dot).backgroundColor)).size).toBe(3);

    // 换成「已完成」，胶囊立刻换一档 —— 这正是原来看不出来的那件事
    await userEvent.click([...row.querySelectorAll<HTMLButtonElement>(".project-status-menu button")].find((button) => button.textContent === "已完成")!);
    await tick();
    expect(pill.dataset.tone).toBe("done");
    expect(getComputedStyle(pill).backgroundColor).not.toBe(active);
  });

  it("总览里就能改名，不用去文档树里把它找出来", async () => {
    const onRename = vi.fn();
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={onRename} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const row = document.querySelector(".project-item")!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find((button) => button.textContent?.includes("重命名"))!);
    await tick();
    const input = row.querySelector<HTMLInputElement>(".project-item-rename")!;
    expect(input.value).toBe("实验 1");
    // 同一条记录在下面的分类卡片里还有一行；改名框只能长在点开的那一行上，
    // 否则两个输入框会互相抢焦点，先出现的那个当场失焦提交、看着像没点中
    expect(document.querySelectorAll(".project-item-rename")).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    await userEvent.fill(input, "编码器消融");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await tick();
    expect(onRename).toHaveBeenCalledWith("项目/实验/实验 1.md", "编码器消融");
    // 乐观更新：不等文档树推回来，这一行已经是新名字
    expect(document.querySelector(".project-item-copy strong")?.textContent).toBe("编码器消融");
  });

  it("右键菜单可以删除记录，并把确认与清理交给上层", async () => {
    const onDelete = vi.fn();
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onDelete={onDelete} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const row = document.querySelector(".project-item")!;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await tick();
    const remove = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")]
      .find((button) => button.textContent?.trim() === "删除")!;
    expect(remove.classList).toContain("ctx-danger");
    await userEvent.click(remove);
    expect(onDelete).toHaveBeenCalledWith("项目/实验/实验 1.md");
  });

  it("手指没有右键：长按同样弹出那份菜单，划动则不弹", async () => {
    const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    root.render(<ProjectDashboard project={project} notes={[...disk.keys()].map((path) => ({ path, name: path }))} revision={0} onOpen={() => {}} onEdit={() => {}} onRename={() => {}} onMove={() => {}} onChanged={() => {}} onError={() => {}} />);
    await tick();
    const row = document.querySelector(".project-item")!;
    const touch = (type: string, x: number, y: number) =>
      row.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1, clientX: x, clientY: y }));

    // 按住往上划 = 滚页面，不该弹菜单
    touch("pointerdown", 300, 300);
    touch("pointermove", 300, 260);
    await tick(600);
    expect(document.querySelector(".ctx")).toBeNull();
    touch("pointerup", 300, 260);

    touch("pointerdown", 300, 300);
    await tick(600);
    expect(document.querySelector(".ctx")?.textContent).toContain("重命名");
  });
});
