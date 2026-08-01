/**
 * 侧栏的头部、底部和拖拽调宽。
 *
 * 调宽必须在真浏览器里验：它读的是 `clientX` 的差值再写进 grid 轨道，
 * 没有布局引擎时轨道宽度恒为 0，怎么拖都「通过」。
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

const TREE: TreeNode[] = [
  {
    name: "论文",
    path: "论文.md",
    kind: "document",
    children: [],
    childDir: null,
    order: null,
    created: null,
    updated: null,
  },
];

const NOTE: NoteContent = {
  path: "论文.md",
  id: "x",
  title: "论文",
  frontmatter: {},
  frontmatterText: "",
  body: "# 论文\n",
  mtimeMs: 0,
};

const NOTES: NoteRef[] = [{ path: "论文.md", name: "论文" }];

const setSettings = vi.fn(async (s: Record<string, unknown>) => s);

vi.mock("./api", () => ({
  api: {
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "论文.md" }),
    openVault: async () => VAULT,
    tree: async () => TREE,
    listNotes: async () => NOTES,
    readNote: async () => NOTE,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "x.md", id: "x", title: "x" }),
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
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
    workspaceGet: async () => ({ tabs: [], active: 0 }),
    workspaceSet: async () => {},
    getSettings: async () => ({ treeSort: "name" }),
    setSettings: (s: Record<string, unknown>) => setSettings(s),
    openTerminal: async () => {},
    rebuildIndex: async () => ({}),
    ptyOpen: async () => "1",
    ptyWrite: async () => {},
    ptyResize: async () => {},
    ptyClose: async () => {},
  },
  onVaultChanged: async () => () => {},
  onPtyData: async () => () => {},
  onPtyExit: async () => () => {},
  pickVaultFolder: async () => null,
}));

const { default: App } = await import("./App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  setSettings.mockClear();
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
    await settle();
  });
}

const el = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const width = () => Math.round(document.querySelector(".sidebar")!.getBoundingClientRect().width);

async function fire(target: HTMLElement, type: string, init: Record<string, unknown> = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(e);
    await settle(30);
  });
}

describe("侧栏头部", () => {
  // 之前视图名、vault 名、排序下拉框、新建按钮四样挤在一行里，
  // 一个原生 <select> 就吃掉小一半宽度
  it("头部只有标题和图标按钮，vault 名不在里面", async () => {
    await mountApp();
    const head = el(".sidebar-head")!;
    expect(head.textContent).toBe("文档");
    expect(head.querySelector("select"), "头部不该再有原生下拉框").toBeNull();
    expect(head.querySelector(".vault-name"), "vault 名已经挪到底部").toBeNull();
  });

  it("vault 名在底部，点它换库", async () => {
    await mountApp();
    const foot = el(".sidebar-foot")!;
    expect(foot.textContent).toContain("test-vault");
    expect(foot.querySelector("button")).not.toBeNull();
  });

  it("排序菜单：打开、选中项带勾、选完就关", async () => {
    await mountApp();
    const btn = el<HTMLButtonElement>('.side-act[aria-label="排序方式"]')!;

    expect(el(".side-menu"), "一开始是关着的").toBeNull();
    await fire(btn, "mousedown");
    await act(async () => {
      btn.click();
      await settle(60);
    });

    const menu = el(".side-menu")!;
    expect(menu).not.toBeNull();
    // 默认是「名称 A→Z」，勾应该在它身上
    expect(menu.querySelector(".is-current")?.textContent).toContain("名称 A→Z");

    const manual = [...menu.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("手动排序"),
    )!;
    await act(async () => {
      manual.click();
      await settle(60);
    });

    expect(el(".side-menu"), "选完要关掉").toBeNull();
    const last = setSettings.mock.calls[setSettings.mock.calls.length - 1][0] as {
      treeSort: string;
    };
    expect(last.treeSort).toBe("manual");
  });
});

describe("拖右边缘调宽度", () => {
  it("往右拖变宽，宽度记进 localStorage", async () => {
    await mountApp();
    const before = width();
    const bar = el<HTMLElement>(".sidebar-resizer")!;

    await fire(bar, "mousedown", { clientX: before });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: before + 80 }));
      await settle(30);
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mouseup"));
      await settle(30);
    });

    expect(width()).toBe(before + 80);
    expect(Number(localStorage.getItem("verso.sidebarWidth"))).toBe(before + 80);
  });

  // 没有下限的话能拖到只剩几像素，文件名一个字都看不见，
  // 而且那条拖杆自己也变得难再抓住
  it("有下限，拖不成一条缝", async () => {
    await mountApp();
    const before = width();
    const bar = el<HTMLElement>(".sidebar-resizer")!;

    await fire(bar, "mousedown", { clientX: before });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: -500 }));
      await settle(30);
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mouseup"));
      await settle(30);
    });

    expect(width()).toBe(180);
  });

  it("双击复位", async () => {
    await mountApp();
    const bar = el<HTMLElement>(".sidebar-resizer")!;

    await fire(bar, "mousedown", { clientX: 252 });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
      await settle(30);
    });
    expect(width()).not.toBe(252);

    await fire(bar, "dblclick");
    expect(width()).toBe(252);
  });
});
