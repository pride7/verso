/**
 * 项目中心和单项目总览摆到手机上（390×844）是什么样。
 *
 * 两个组件各自的行为测试在 ProjectCenter / ProjectDashboard 那两个文件里；
 * 这里只管**窄屏上的版式**：有没有照搬桌面那一套（横排的行、并排的列）、
 * 有没有横向溢出、字是不是被挤成一个一个竖着排。
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { NoteContent } from "../../../src/core/types";
import "../../../src/ui/styles.css";

const PHONE = { w: 390, h: 844 };
const DAY = 86_400_000;
const NOW = Date.now();

const project: NoteContent = {
  path: "可信解码.md",
  id: null,
  title: "可信解码",
  frontmatter: {
    type: "project",
    status: "进行中",
    summary: "先确认误差来源，再决定要不要换解码器。",
    next: "跑完温度消融",
    blocker: "缺一组长文本的标注数据",
  },
  frontmatterText: null,
  body: "",
  mtimeMs: 1,
};

const item = (
  section: string,
  type: string,
  title: string,
  status: string,
  summary: string,
  daysAgo: number,
): NoteContent => ({
  path: `可信解码/${section}/${title}.md`,
  id: null,
  title,
  frontmatter: { type, status, summary },
  frontmatterText: null,
  body: "",
  mtimeMs: NOW - daysAgo * DAY,
});

const children = [
  item("实验", "experiment", "温度消融实验", "进行中", "0.2 到 1.0 五档，看幻觉率怎么变", 0),
  item("实验", "experiment", "长上下文基线", "待开始", "", 1),
  item("实验", "experiment", "束搜索宽度对比", "已完成", "宽度 4 以后收益很小", 3),
  item("问题", "question", "为什么验证集误差反而上升", "进行中", "怀疑是标注口径变了", 4),
  item("问题", "question", "评测集有没有泄漏", "已解决", "查过，没有", 9),
  item("决策", "decision", "采用哪套评测指标", "讨论中", "在 FActScore 和人工打分之间选", 12),
  item("资料", "resource", "ParallelBench 论文", "已收录", "", 30),
];
const progress: NoteContent = {
  path: "可信解码/进展.md",
  id: null,
  title: "进展",
  frontmatter: { type: "project-log" },
  frontmatterText: null,
  body: [
    "## 2026-10-13 21:40",
    "",
    "温度 0.2 和 0.6 两档跑完，幻觉率差了将近一倍，比预想的大。",
    "",
    "## 2026-10-12 10:05",
    "",
    "完成基线，评测脚本整理进仓库。",
    "",
  ].join("\n"),
  mtimeMs: 60,
};
const disk = new Map<string, NoteContent>([...children, progress].map((note) => [note.path, note]));

const projects = [
  { path: "可信解码.md", title: "可信解码", props: { status: "进行中", summary: "先确认误差来源，再决定要不要换解码器。", next: "跑完温度消融", blocker: "缺一组长文本的标注数据", updated: "2026-10-13T13:40:00Z", created: "2026-09-01T01:00:00Z" } },
  { path: "论文复现.md", title: "论文复现：Attention Is All You Need", props: { status: "暂停", summary: "等显卡", next: "", blocker: "", updated: "2026-10-01T01:00:00Z", created: "2026-08-03T01:00:00Z" } },
  { path: "读书.md", title: "读书笔记整理", props: { status: "已完成", summary: "全部归档", next: "", blocker: "", updated: "2026-09-20T01:00:00Z", created: "2026-08-02T01:00:00Z" } },
];

const apiMock = {
  readNote: vi.fn(async (path: string) => disk.get(path)!),
  createNote: vi.fn(async () => ({ path: "", title: "", id: null })),
  writeNote: vi.fn(async () => 1),
  propSet: vi.fn(async () => {}),
  propSchema: vi.fn(async () => ({})),
  order: vi.fn(async () => [] as string[]),
  propDefSet: vi.fn(async () => {}),
  viewQuery: vi.fn(async () => ({ rows: projects, columns: [], view: "table", groupBy: null, properties: [] })),
};
vi.mock("../../../src/host/api", () => ({ api: apiMock }));
const { ProjectDashboard } = await import("../../../src/ui/ProjectDashboard");
const { ProjectCenter } = await import("../../../src/ui/ProjectCenter");

let root: Root | null = null;

beforeEach(async () => {
  document.documentElement.dataset.touch = "on";
  await page.viewport(PHONE.w, PHONE.h);
});
// 视口是整个浏览器实例共享的，不还原会污染同一次运行里后跑的文件
afterEach(async () => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.touch;
  await page.viewport(1440, 900);
});

function host() {
  const el = document.createElement("div");
  el.id = "root";
  // 手机上它们占的是正文那一格：满宽、定高、自己滚
  el.style.cssText = `width:${PHONE.w}px;height:${PHONE.h}px;display:flex;flex-direction:column`;
  document.body.appendChild(el);
  root = createRoot(el);
  return el;
}

function mountDashboard() {
  host();
  root!.render(
    <ProjectDashboard
      project={project}
      notes={[...disk.keys()].map((path) => ({ path, name: path }))}
      revision={0}
      onOpen={() => {}}
      onEdit={() => {}}
      onRename={() => {}}
      onMove={() => {}}
      onChanged={() => {}}
      onError={() => {}}
    />,
  );
}

function mountCenter() {
  host();
  root!.render(
    <ProjectCenter
      revision={0}
      promotableNote={null}
      onOpen={() => {}}
      onNew={() => {}}
      onPromote={() => {}}
      onClose={() => {}}
      onChanged={() => {}}
      onError={() => {}}
    />,
  );
}

/**
 * 伸出屏幕右边的东西。
 *
 * **不跳过滚动容器。** `.project-scroll` 是 `overflow-y: auto`，而 CSS 规定另一个
 * 轴的 `visible` 会被强制成 `auto` —— 于是它横向也成了滚动容器，伸出去的行
 * 不会撑宽页面，只是被它裁掉、或者要横着滑才看得见。这两屏没有任何东西是
 * 该横着滑的，所以一律按屏幕右边缘算。
 */
function overflowing(scope: Element) {
  const bad: string[] = [];
  for (const el of scope.querySelectorAll<HTMLElement>("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= PHONE.w + 0.5) continue;
    bad.push(`${el.className || el.tagName} → ${Math.round(r.right)}`);
  }
  return bad;
}

describe("手机上的单项目总览", () => {
  it("看一眼", async () => {
    mountDashboard();
    await vi.waitFor(() => expect(document.querySelector(".project-snapshot")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: "__shots__/p01-phone-project.png" });
    const scroll = document.querySelector<HTMLElement>(".project-scroll")!;
    for (const [i, y] of [800, 1600, 2400].entries()) {
      scroll.scrollTop = y;
      await new Promise((r) => setTimeout(r, 100));
      await page.screenshot({ path: `__shots__/p0${i + 2}-phone-project-scroll.png` });
    }
  });

  it("没有东西伸出屏幕", async () => {
    mountDashboard();
    await vi.waitFor(() => expect(document.querySelector(".project-snapshot")).not.toBeNull());
    expect(overflowing(document.getElementById("root")!)).toEqual([]);
    const scroll = document.querySelector<HTMLElement>(".project-scroll")!;
    expect(scroll.scrollWidth, "总览能横着滑 = 有东西伸出去了").toBeLessThanOrEqual(scroll.clientWidth);
  });

  /**
   * 桌面是一行五样，390 的屏上标题只剩 140px 左右。手机上拆成两行：
   * 标题占左边两行高，状态在右上、日期和分类在右下。
   */
  it("记录行在手机上拆成两行，标题读得下", async () => {
    mountDashboard();
    await vi.waitFor(() => expect(document.querySelector(".project-item")).not.toBeNull());
    for (const row of document.querySelectorAll<HTMLElement>(".project-item")) {
      const title = row.querySelector<HTMLElement>(".project-item-copy strong")!;
      const name = title.textContent;
      expect(title.getBoundingClientRect().width, `「${name}」的标题被挤窄了`).toBeGreaterThan(200);
      const status = row.querySelector<HTMLElement>(".project-status-trigger")!.getBoundingClientRect();
      const when = row.querySelector<HTMLElement>(".project-item-when")!.getBoundingClientRect();
      // 状态在上、日期（和分类）在下 —— 不是和日期挤在同一行
      expect(when.top, `「${name}」的日期没换到状态下面`).toBeGreaterThanOrEqual(status.bottom - 2);
      // 下面那一行的右边缘和状态对齐
      const below = [...row.querySelectorAll<HTMLElement>(".project-item-when, .project-item-pin, .project-kind")]
        .map((el) => el.getBoundingClientRect().right);
      expect(Math.abs(Math.max(...below) - status.right), `「${name}」右边没对齐`).toBeLessThan(2);
    }
  });
});

describe("手机上改项目状态", () => {
  /**
   * 头部那个「更新状态」在窄屏上藏着（挤不下），而手机上没有别的地方改摘要、
   * 下一步和阻碍 —— 只剩去改源码。入口挪到了状态卡片上
   */
  it("状态卡片上有「更新状态」，点开就是那个弹窗", async () => {
    mountDashboard();
    await vi.waitFor(() => expect(document.querySelector(".project-snapshot")).not.toBeNull());
    const head = [...document.querySelectorAll<HTMLElement>(".project-head .project-btn")]
      .find((b) => b.textContent === "更新状态")!;
    expect(getComputedStyle(head).display, "头部那个本来就藏着，这条测的是替代入口").toBe("none");

    const edit = document.querySelector<HTMLButtonElement>(".project-snapshot .project-snapshot-edit")!;
    const r = edit.getBoundingClientRect();
    expect(r.height, "够不着").toBeGreaterThanOrEqual(32);
    expect(r.right).toBeLessThanOrEqual(PHONE.w);
    edit.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("更新当前状态"));
  });

  it("桌面上状态卡片里不多出一个按钮", async () => {
    await page.viewport(1440, 900);
    mountDashboard();
    await vi.waitFor(() => expect(document.querySelector(".project-snapshot")).not.toBeNull());
    const edit = document.querySelector<HTMLElement>(".project-snapshot-edit")!;
    expect(getComputedStyle(edit).display).toBe("none");
  });
});

describe("手机上的项目中心", () => {
  it("看一眼", async () => {
    mountCenter();
    await vi.waitFor(() => expect(document.querySelector(".project-center-card")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: "__shots__/p05-phone-center.png" });
    const scroll = document.querySelector<HTMLElement>(".project-center-scroll")!;
    scroll.scrollTop = 800;
    await new Promise((r) => setTimeout(r, 100));
    await page.screenshot({ path: "__shots__/p06-phone-center-scroll.png" });
  });

  it("没有东西伸出屏幕", async () => {
    mountCenter();
    await vi.waitFor(() => expect(document.querySelector(".project-center-card")).not.toBeNull());
    expect(overflowing(document.getElementById("root")!)).toEqual([]);
  });

  /** 桌面上为了一排卡片齐平给的最小高度，单列时只会在内容少的卡片中间空出一块 */
  it("卡片按内容高，不留桌面那块空白", async () => {
    mountCenter();
    await vi.waitFor(() => expect(document.querySelector(".project-center-card")).not.toBeNull());
    for (const card of document.querySelectorAll<HTMLElement>(".project-center-card")) {
      const summary = card.querySelector<HTMLElement>(":scope > p")!.getBoundingClientRect();
      const now = card.querySelector<HTMLElement>(".project-center-card-now")!.getBoundingClientRect();
      expect(now.top - summary.bottom, `「${card.querySelector("h2")?.textContent}」中间空着一块`).toBeLessThan(24);
    }
  });
});
