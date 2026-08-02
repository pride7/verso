/**
 * 窄屏布局。DESIGN.md §1.2 / §6.1
 *
 * 这一层量的是**几何关系**，不是类名：侧栏是不是盖在正文上、正文有没有被
 * 挤没、点开一篇之后抽屉收没收。类名对着而布局错了的话，看起来仍然是老样子
 * —— 而在 390px 的屏上那意味着完全没法用。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "./types";

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "test-vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const doc = (name: string, path: string): TreeNode => ({
  name,
  path,
  kind: "document",
  children: [],
  childDir: null,
  order: null,
  created: null,
  updated: null,
});

vi.mock("./api", () => ({
  api: {
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "甲.md" }),
    openVault: async () => VAULT,
    tree: async () => [doc("甲", "甲.md"), doc("乙", "乙.md")],
    listNotes: async () =>
      [
        { path: "甲.md", name: "甲" },
        { path: "乙.md", name: "乙" },
      ] as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: null,
        title: path.replace(/\.md$/, ""),
        frontmatter: {},
        frontmatterText: null,
        body: "正文，够长一点，好看出正文列有没有被挤没。\n",
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "x.md", id: null, title: "x" }),
    createUntitled: async () => ({ path: "x.md", id: null, title: "x" }),
    renameNote: async () => "",
    moveNote: async () => "",
    deleteNote: async () => {},
    search: async () => [],
    backlinks: async () => [],
    allTags: async () => [],
    notesByTag: async () => [],
    viewQuery: async () => ({ columns: [], rows: [], view: "table", groupBy: null }),
    propSet: async () => {},
    propRename: async () => {},
    propSchema: async () => ({}),
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
    gitStatus: async () => ({
      enabled: true,
      added: 0,
      modified: 0,
      deleted: 0,
      dirty: 0,
      lastMessage: null,
      lastAt: null,
    }),
    gitCommit: async () => null,
    gitHistory: async () => [],
    syncRemoteGet: async () => ({ url: null, branch: "main", needsToken: false }),
    syncTokenHas: async () => false,
    workspaceGet: async () => ({ tabs: ["甲.md"], active: 0, pinnedCount: 0 }),
    workspaceSet: async () => {},
    getSettings: async () => ({}),
    setSettings: async (s: unknown) => s,
    openTerminal: async () => {},
    rebuildIndex: async () => ({}),
    ptyOpen: async () => "1",
    ptyWrite: async () => {},
    ptyResize: async () => {},
    ptyClose: async () => {},
  },
  onVaultChanged: async () => () => {},
  onAppClosing: async () => () => {},
  onPtyData: async () => () => {},
  onPtyExit: async () => () => {},
  pickVaultFolder: async () => null,
}));

const { default: App } = await import("./App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

/** 手机竖屏。iPhone 14 / 多数安卓旗舰都在这个尺寸附近 */
const PHONE = { w: 390, h: 844 };

async function mount() {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App />);
    await settle(600);
  });
}

beforeEach(async () => {
  localStorage.clear();
  await page.viewport(PHONE.w, PHONE.h);
});

afterEach(async () => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  // 视口是整个浏览器实例共享的，不还原会污染同一次运行里后跑的文件
  await page.viewport(1440, 900);
});

const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();

describe("手机竖屏下的布局", () => {
  it("看一眼：抽屉开着 / 关着", async () => {
    await mount();
    await page.screenshot({ path: "__shots__/20-phone-drawer.png" });
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    await page.screenshot({ path: "__shots__/21-phone-reading.png" });
  });

  it("侧栏是盖上去的，正文仍然占满剩下的宽度", async () => {
    await mount();
    const side = box(".sidebar")!;
    const main = box(".main")!;

    // 盖在上面：两者横向有重叠。挤在一起的话 main 会从 side 的右边才开始
    expect(side.right).toBeGreaterThan(main.left);
    // 正文列至少要有大半个屏 —— 挤成一条就等于没法读
    expect(main.width).toBeGreaterThan(PHONE.w * 0.7);
    // 抽屉自己也得留一条正文出来，那是关掉它的唯一出口
    expect(side.right).toBeLessThan(PHONE.w);
  });

  it("点开一篇之后抽屉自己收起来", async () => {
    await mount();
    expect(box(".sidebar")).toBeTruthy();
    expect(document.querySelector(".app")?.className).toContain("is-narrow");

    await act(async () => {
      // 点的是 `.tree-label` 那个按钮，不是整行 —— 行本身只是容器
      [...document.querySelectorAll<HTMLElement>(".tree-label")]
        .find((r) => r.textContent?.includes("乙"))!
        .click();
      await settle(400);
    });
    expect(document.querySelector(".sidebar"), "点完还得再手动关一次的话，那一下就白点了").toBeNull();
  });

  it("点正文那一条（遮罩）也能关掉抽屉", async () => {
    await mount();
    expect(document.querySelector(".sidebar-scrim")).toBeTruthy();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(200);
    });
    expect(document.querySelector(".sidebar")).toBeNull();
    expect(document.querySelector(".sidebar-scrim")).toBeNull();
  });

  /**
   * §6.1 移动那一列：满宽减 20px 边距（桌面上是 24）。
   *
   * **量出来的值，不是查类名。** 而且要一起验「正文和面包屑还对着」——
   * 这一处的内边距是和 `.editor-host` 的 -26px 外边距配对的，只改一边
   * 就会让正文比标题往左错出去几像素，那种错位一眼看不出、但满屏都不对劲
   */
  it("正文边距收窄，而且仍然和面包屑对齐", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    expect(getComputedStyle(document.querySelector(".editor")!).paddingLeft).toBe("20px");

    const crumb = document.querySelector(".breadcrumb")!.getBoundingClientRect();
    const text = document.querySelector(".cm-line")!.getBoundingClientRect();
    expect(Math.abs(text.left - crumb.left)).toBeLessThan(2);
  });

  it("界面没有横向溢出 —— 一滑就跑偏是移动端最招人烦的毛病", async () => {
    await mount();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(PHONE.w);
    const app = box(".app")!;
    expect(app.right).toBeLessThanOrEqual(PHONE.w + 0.5);
  });

  it("回到宽屏，侧栏变回占一列的样子", async () => {
    await mount();
    await act(async () => {
      await page.viewport(1440, 900);
      await settle(300);
    });
    const side = box(".sidebar")!;
    const main = box(".main")!;
    expect(side.right).toBeLessThanOrEqual(main.left + 0.5);
    expect(document.querySelector(".sidebar-scrim"), "宽屏上不该有遮罩").toBeNull();
  });
});
