/**
 * 纯文件夹节点（§2.1，无同名 `.md`）的树上操作走 App 整条链路。
 *
 * 这一类曾经全是死的：右键菜单摆着「新建子文档」「删除」，点了之后后端
 * 报「不是文档」，前端只弹一条错误 —— 单看菜单渲染永远发现不了，
 * 必须把点击接到（mock 的）api 上看它带什么参数、走没走到。
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

/** `数学/` 是纯文件夹：里面有一篇 `数学/代数.md`，但没有 `数学.md` */
const TREE: TreeNode[] = [
  {
    name: "数学",
    path: "数学",
    kind: "folder",
    childDir: null,
    children: [doc("代数", "数学/代数.md")],
    order: null,
    created: null,
    updated: null,
  },
  doc("甲", "甲.md"),
];

const confirmMock = vi.fn(async (_message: string) => true);
vi.mock("./lib/dialog", () => ({ confirm: (m: string) => confirmMock(m) }));

const createNote = vi.fn(async (_parent: string | null, title: string) => ({
  path: `${title}.md`,
  id: "x",
  title,
}));
const createUntitled = vi.fn(async (_parent: string | null) => ({
  path: "数学/未命名.md",
  id: "x",
  title: "未命名",
}));
const deleteNote = vi.fn(async (_path: string, _withChildren: boolean) => {});
const moveNote = vi.fn(async (_path: string, _newParentDoc: string | null) => "甲.md");
const reorderApi = vi.fn(async (_parent: string, _ordered: string[]) => {});

vi.mock("./api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: null }),
    openVault: async () => VAULT,
    tree: async () => TREE,
    listNotes: async () =>
      [
        { path: "数学/代数.md", name: "代数" },
        { path: "甲.md", name: "甲" },
      ] as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: path,
        title: path,
        frontmatter: {},
        frontmatterText: "",
        body: "正文\n",
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: (p: string | null, t: string) => createNote(p, t),
    createUntitled: (p: string | null) => createUntitled(p),
    renameNote: async () => "",
    moveNote: (p: string, parent: string | null) => moveNote(p, parent),
    deleteNote: (p: string, w: boolean) => deleteNote(p, w),
    search: async () => [],
    backlinks: async () => [],
    allTags: async () => [],
    notesByTag: async () => [],
    viewQuery: async () => ({ columns: [], rows: [], view: "table", groupBy: null }),
    propSet: async () => {},
    propRename: async () => {},
    propSchema: async () => ({}),
    reorder: (parent: string, ordered: string[]) => reorderApi(parent, ordered),
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
  pickCloneFolder: async () => null,
}));

const { default: App } = await import("./App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  createNote.mockClear();
  createUntitled.mockClear();
  deleteNote.mockClear();
  moveNote.mockClear();
  reorderApi.mockClear();
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

async function click(el: HTMLElement, ms = 300) {
  await act(async () => {
    el.click();
    await settle(ms);
  });
}

/** 在某一行上右键，然后取菜单里那一条 */
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

describe("纯文件夹的树上操作", () => {
  it("右键 → 删除：弹的是文件夹措辞，带子文档数，然后整个删掉", async () => {
    await mountApp();
    const item = await menuItem(rowFor("数学"), "删除");
    expect(item).toBeTruthy();
    await click(item!);

    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("删除文件夹「数学」"));
    expect(confirmMock.mock.calls[0][0]).toContain("1 个子文档");
    // 文件夹就是那个目录本身，删除必然连内容一起
    expect(deleteNote).toHaveBeenCalledWith("数学", true);
  });

  it("取消删除就什么都不发生", async () => {
    await mountApp();
    confirmMock.mockResolvedValue(false);
    await click((await menuItem(rowFor("数学"), "删除"))!);
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it("右键 → 新建子文档：父节点传的是文件夹路径", async () => {
    await mountApp();
    await click((await menuItem(rowFor("数学"), "新建子文档"))!);
    expect(createUntitled).toHaveBeenCalledWith("数学");
  });

  it("行尾的加号在文件夹上也有，点了建子文档", async () => {
    await mountApp();
    const add = rowFor("数学").querySelector<HTMLElement>(".tree-add");
    expect(add, "文件夹行也要有加号入口").toBeTruthy();
    await click(add!);
    expect(createUntitled).toHaveBeenCalledWith("数学");
  });

  it("右键 → 创建为文档：在旁边补同名 .md，升级成文档节点（§2.1）", async () => {
    await mountApp();
    const item = await menuItem(rowFor("数学"), "创建为文档");
    expect(item, "文件夹的右键菜单里要有这一条").toBeTruthy();
    await click(item!);
    // 顶层文件夹 → 父节点是根（null），标题就是文件夹名
    expect(createNote).toHaveBeenCalledWith(null, "数学");
  });

  it("文档节点的菜单里没有「创建为文档」", async () => {
    await mountApp();
    const item = await menuItem(rowFor("甲"), "创建为文档");
    expect(item).toBeFalsy();
  });
});

/**
 * 「移动到…」和上移/下移 —— 拖拽的可点击等价物（M6）。
 * 触摸屏上 HTML5 拖放完全不可用，没有这几条，手机上就无法调整树结构。
 */
describe("不靠拖拽的移动与排序", () => {
  it("右键 → 移动到…：弹选择器，选中某篇就移过去", async () => {
    await mountApp();
    await click((await menuItem(rowFor("甲"), "移动到…"))!);

    const items = [...document.querySelectorAll<HTMLElement>(".qs-item")];
    // 第一条固定是「顶层」；自己不在候选里
    expect(items[0]?.textContent).toContain("顶层");
    expect(items.some((i) => i.textContent?.includes("代数"))).toBe(true);
    expect(
      items.filter((i) => i.querySelector(".qs-name")?.textContent === "甲"),
    ).toHaveLength(0);

    const target = items.find((i) => i.textContent?.includes("代数"))!;
    await act(async () => {
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await settle(300);
    });
    expect(moveNote).toHaveBeenCalledWith("甲.md", "数学/代数.md");
    expect(document.querySelector(".qs-item"), "选完选择器要关掉").toBeFalsy();
  });

  it("选「顶层」= 移到仓库根", async () => {
    await mountApp();
    await click((await menuItem(rowFor("甲"), "移动到…"))!);
    const top = document.querySelector<HTMLElement>(".qs-item")!;
    await act(async () => {
      top.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await settle(300);
    });
    expect(moveNote).toHaveBeenCalledWith("甲.md", null);
  });

  it("上移/下移按屏幕顺序调整，落到 reorder", async () => {
    await mountApp();
    const up = await menuItem(rowFor("甲"), "上移");
    const down = [...document.querySelectorAll<HTMLElement>(".ctx button")].find(
      (b) => b.textContent === "下移",
    );
    expect(up && down, "文档的菜单里要有上移/下移").toBeTruthy();

    // 顶层只有两项：一端能动、另一端灰着
    const enabled = [up!, down!].filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(1);

    await click(enabled[0]);
    expect(reorderApi).toHaveBeenCalledTimes(1);
    const [parent, ordered] = reorderApi.mock.calls[0];
    expect(parent).toBe("");
    expect(ordered).toContain("甲.md");
  });

  it("纯文件夹的菜单里没有上移/移动到… —— 它当不了拖拽源，菜单口径一致", async () => {
    await mountApp();
    expect(await menuItem(rowFor("数学"), "移动到…")).toBeFalsy();
  });
});
