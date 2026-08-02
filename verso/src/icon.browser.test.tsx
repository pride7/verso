/**
 * 文档图标（§2.3 的 frontmatter `icon`）走 App 整条链路。
 *
 * 纯 Node 给不出答案的是**「看得见吗」**：
 *
 * 1. 选择器是浮层，而它的两个入口都长在滚动容器里。`overflow` 裁剪不改变
 *    `getBoundingClientRect`，也不影响 DOM 查询 —— 查得到、量得出、就是
 *    一个像素都看不见（v0.5.38 那个列头菜单一模一样）。只有命中测试
 *    （`elementFromPoint`）抓得到，而它需要真实布局引擎。
 * 2. 树的每一行前面多了一格图标之后，长名字还能不能正常截断、行会不会
 *    被撑出侧栏 —— 同样是布局问题。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "./types";

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "test-vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

/** 磁盘上的图标。`propSet` 改它，`tree` / `readNote` 都从这里读 */
let icons: Record<string, string> = {};

const doc = (name: string, path: string): TreeNode => ({
  name,
  path,
  kind: "document",
  children: [],
  childDir: null,
  order: null,
  created: null,
  updated: null,
  icon: icons[path] ?? null,
});

const PATHS: [string, string][] = [
  ["甲", "甲.md"],
  ["一个特别特别长的文档名字用来看截断", "长.md"],
];

const propSet = vi.fn(async (path: string, key: string, value: string | null) => {
  if (key !== "icon") return;
  if (value === null) delete icons[path];
  else icons[path] = value;
});

vi.mock("./api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: null }),
    openVault: async () => VAULT,
    tree: async () => PATHS.map(([n, p]) => doc(n, p)),
    listNotes: async () => PATHS.map(([name, path]) => ({ path, name })) as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: path,
        title: path,
        frontmatter: icons[path] ? { icon: icons[path] } : {},
        frontmatterText: "",
        body: "正文\n",
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "x.md", id: "x", title: "x" }),
    createUntitled: async () => ({ path: "新.md", id: "x", title: "新" }),
    renameNote: async () => "",
    moveNote: async () => "",
    deleteNote: async () => {},
    search: async () => [],
    backlinks: async () => [],
    allTags: async () => [],
    notesByTag: async () => [],
    viewQuery: async () => ({ columns: [], rows: [], view: "table", groupBy: null }),
    propSet: (p: string, k: string, v: string | null) => propSet(p, k, v),
    propRename: async () => {},
    propSchema: async () => ({}),
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
    workspaceGet: async () => ({ tabs: [], active: 0, pinnedCount: 0 }),
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
  onBackendNotice: async () => () => {},
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

beforeEach(() => {
  localStorage.clear();
  icons = {};
  propSet.mockClear();
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

async function mountApp() {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App />);
    await settle(500);
  });
}

const rows = () => [...document.querySelectorAll<HTMLElement>(".tree-row")];
const rowFor = (name: string) =>
  rows().find((r) => r.querySelector(".tree-name")?.textContent === name)!;
const picker = () => document.querySelector<HTMLElement>(".icon-picker");

async function click(el: HTMLElement, ms = 300) {
  await act(async () => {
    el.click();
    await settle(ms);
  });
}

/** 在某一行上右键，然后点菜单里那一条 */
async function menuItem(row: HTMLElement, label: string) {
  const box = row.getBoundingClientRect();
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 20,
        clientY: box.top + 8,
      }),
    );
    await settle(60);
  });
  return [...document.querySelectorAll<HTMLElement>(".ctx button")].find(
    (b) => b.textContent === label,
  );
}

describe("文档图标", () => {
  it("右键 → 设置图标 → 选一个，写进 frontmatter 并显示在树上", async () => {
    await mountApp();
    const item = await menuItem(rowFor("甲"), "设置图标…");
    expect(item, "文档节点的右键菜单里要有这一条").toBeTruthy();
    await click(item!);

    expect(picker(), "选择器要弹出来").not.toBeNull();
    const cell = [...picker()!.querySelectorAll<HTMLElement>(".icon-cell")].find(
      (b) => b.textContent === "📘",
    )!;
    await click(cell, 400);

    // 走的是 prop_set —— 和属性条、database 视图同一条写入路径
    expect(propSet).toHaveBeenCalledWith("甲.md", "icon", "📘");
    expect(picker(), "选完就关").toBeNull();
    expect(rowFor("甲").querySelector(".tree-icon")?.textContent).toBe("📘");
  });

  /**
   * 这一条是这个文件存在的理由：浮层被祖先的 `overflow` 裁掉时，
   * DOM 查得到、`getBoundingClientRect` 也量得出，只有命中测试看得见。
   */
  it("选择器真的显示在屏幕上，没有被侧栏裁掉", async () => {
    await mountApp();
    await click((await menuItem(rowFor("甲"), "设置图标…"))!);

    const p = picker()!;
    const box = p.getBoundingClientRect();
    expect(box.width, "面板要有实际尺寸").toBeGreaterThan(100);
    // 完整落在窗口内 —— 靠底部的行会把它顶出去，所以定位要往回收
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);

    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 12);
    expect(p.contains(hit), "面板中间那一点必须真的能点到面板自己").toBe(true);
  });

  it("再选一次是换图标；「去掉图标」把这个字段删掉", async () => {
    icons["甲.md"] = "📘";
    await mountApp();
    await click((await menuItem(rowFor("甲"), "换个图标…"))!);

    // 当前用着的那个要被标出来
    const current = picker()!.querySelector<HTMLElement>(".icon-cell.is-current");
    expect(current?.textContent).toBe("📘");

    await click(picker()!.querySelector<HTMLElement>(".icon-clear")!, 400);
    expect(propSet).toHaveBeenCalledWith("甲.md", "icon", null);
    expect(rowFor("甲").querySelector(".tree-icon.is-default"), "回到默认图标").not.toBeNull();
  });

  /**
   * 一往下滑面板就消失过一次：关闭用的 scroll 监听挂在捕获阶段（scroll 不
   * 冒泡，不挂捕获收不到滚动容器的滚动），于是**面板自己那一列图标滚一下
   * 也被当成了「页面滚了」**。两种滚动必须按事件源头分开。
   */
  it("在面板里往下翻图标，面板不能消失", async () => {
    await mountApp();
    await click((await menuItem(rowFor("甲"), "设置图标…"))!);

    const body = picker()!.querySelector<HTMLElement>(".icon-picker-body")!;
    expect(body.scrollHeight, "内容要真的超出一屏，否则这条测试没意义").toBeGreaterThan(
      body.clientHeight,
    );
    await act(async () => {
      body.scrollTop = 200;
      body.dispatchEvent(new Event("scroll", { bubbles: false }));
      await settle(80);
    });
    expect(picker(), "翻图标不该把面板关掉").not.toBeNull();
    expect(body.scrollTop).toBeGreaterThan(0);
  });

  // 反过来：正文/侧栏滚动时它得关掉。fixed 的浮层不跟着祖先滚，
  // 留在原地就成了指着错东西的一块浮板
  it("外面的东西一滚就关掉", async () => {
    await mountApp();
    await click((await menuItem(rowFor("甲"), "设置图标…"))!);
    const side = document.querySelector<HTMLElement>(".sidebar-body")!;
    await act(async () => {
      side.dispatchEvent(new Event("scroll", { bubbles: false }));
      await settle(80);
    });
    expect(picker()).toBeNull();
  });

  it("搜不到的字符也能用 —— 这张表只有一百多个", async () => {
    await mountApp();
    await click((await menuItem(rowFor("甲"), "设置图标…"))!);

    const input = picker()!.querySelector<HTMLInputElement>(".icon-search")!;
    await act(async () => {
      // 搜索框是**受控**输入框：React 在 DOM 节点上挂了一个值追踪器，直接
      // 写 `input.value` 会连它一起更新，随后那个 input 事件就被当成「值
      // 没变」丢掉了。走原生 setter 才能让它认账（改名那个输入框是
      // 非受控的，所以那边直接赋值就够）
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "囍");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await settle(60);
    });
    const literal = picker()!.querySelector<HTMLElement>(".icon-literal .icon-cell")!;
    expect(literal.textContent).toBe("囍");
    await click(literal, 400);
    expect(propSet).toHaveBeenCalledWith("甲.md", "icon", "囍");
  });

  it("面包屑上的图标是设图标的主入口，点它弹同一个面板", async () => {
    await mountApp();
    await click(rowFor("甲").querySelector<HTMLElement>(".tree-label")!, 400);

    const crumb = document.querySelector<HTMLElement>(".crumb-icon")!;
    expect(crumb, "打开笔记后面包屑上要有那个位置").toBeTruthy();
    await click(crumb);
    expect(picker()).not.toBeNull();

    await click(
      [...picker()!.querySelectorAll<HTMLElement>(".icon-cell")].find(
        (b) => b.textContent === "📗",
      )!,
      400,
    );
    expect(propSet).toHaveBeenCalledWith("甲.md", "icon", "📗");
    // 面包屑读的是 note.frontmatter，改完必须重读这篇 —— 否则屏幕上还是旧的
    expect(document.querySelector(".crumb-icon")?.textContent).toBe("📗");
  });

  it("标签栏上也带图标 —— 标签等宽，名字先被截断", async () => {
    icons["甲.md"] = "📘";
    await mountApp();
    await click(rowFor("甲").querySelector<HTMLElement>(".tree-label")!, 400);
    expect(document.querySelector(".tab .tab-icon")?.textContent).toBe("📘");
  });

  /**
   * 多一格图标之后长名字还得截断在行内。撑出去的话侧栏会出现横向滚动条，
   * 而右边那个「新建子文档」按钮会被推到看不见的地方
   */
  it("长名字仍然截断在行内，不把树撑宽", async () => {
    icons["长.md"] = "📚";
    await mountApp();
    const row = rowFor("一个特别特别长的文档名字用来看截断");
    const name = row.querySelector<HTMLElement>(".tree-name")!;
    expect(name.scrollWidth, "名字本身确实比容器长（否则这条测试没意义）").toBeGreaterThan(
      name.clientWidth,
    );
    const tree = document.querySelector<HTMLElement>(".sidebar-body")!;
    expect(tree.scrollWidth).toBeLessThanOrEqual(tree.clientWidth);
  });
});
