/**
 * 侧栏的头部、底部和拖拽调宽。
 *
 * 调宽必须在真浏览器里验：它读的是 `clientX` 的差值再写进 grid 轨道，
 * 没有布局引擎时轨道宽度恒为 0，怎么拖都「通过」。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, RecentVault, TreeNode, VaultInfo } from "./types";

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "test-vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const OTHER_VAULT: VaultInfo = {
  root: "D:/Notes/lab",
  name: "lab",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const JOINED_VAULT: VaultInfo = {
  root: "D:/Notes/shared",
  name: "shared",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const KNOWN: RecentVault[] = [
  { root: VAULT.root, name: VAULT.name, available: true },
  { root: OTHER_VAULT.root, name: OTHER_VAULT.name, available: true },
  { root: "D:/Notes/moved", name: "moved", available: false },
];

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
let backendRoot = VAULT.root;
const openVault = vi.fn(async (path: string) => {
  backendRoot = path;
  return path === OTHER_VAULT.root ? OTHER_VAULT : VAULT;
});
const pickVaultFolder = vi.fn(async () => null as string | null);
const pickCloneFolder = vi.fn(async () => JOINED_VAULT.root as string | null);
const cloneVault = vi.fn(async (_input: Record<string, string>) => {
  backendRoot = JOINED_VAULT.root;
  return JOINED_VAULT;
});
const writeNote = vi.fn(async (_path: string, _body: string) => 0);
const workspaceWrites: { root: string; workspace: { tabs: string[]; active: number } }[] = [];
const workspaceSet = vi.fn(async (workspace: { tabs: string[]; active: number }) => {
  workspaceWrites.push({ root: backendRoot, workspace: { ...workspace, tabs: [...workspace.tabs] } });
});
let knownVaults = KNOWN.slice();
let reopen: { vault: VaultInfo; lastNote: string | null } | null = {
  vault: VAULT,
  lastNote: "论文.md",
};

vi.mock("./api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => reopen,
    openVault: (path: string) => openVault(path),
    cloneVault: (input: Record<string, string>) => cloneVault(input),
    recentVaults: async () => knownVaults,
    forgetVault: async (path: string) => {
      knownVaults = knownVaults.filter((item) => item.root !== path);
    },
    tree: async () => TREE,
    listNotes: async () => NOTES,
    readNote: async () => NOTE,
    writeNote: (path: string, body: string) => writeNote(path, body),
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
    gitCommit: async () => null,
    workspaceGet: async () => ({ tabs: [], active: 0 }),
    workspaceSet: (workspace: { tabs: string[]; active: number }) => workspaceSet(workspace),
    getSettings: async () => ({ treeSort: "name" }),
    setSettings: (s: Record<string, unknown>) => setSettings(s),
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
  pickVaultFolder: () => pickVaultFolder(),
  pickCloneFolder: () => pickCloneFolder(),
}));

const { default: App } = await import("./App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  setSettings.mockClear();
  openVault.mockClear();
  pickVaultFolder.mockClear();
  pickCloneFolder.mockClear();
  cloneVault.mockClear();
  writeNote.mockClear();
  workspaceSet.mockClear();
  workspaceWrites.length = 0;
  backendRoot = VAULT.root;
  knownVaults = KNOWN.slice();
  reopen = { vault: VAULT, lastNote: "论文.md" };
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

  it("底部菜单直接列出已记录仓库，点击即可切换，不再打开文件选择器", async () => {
    await mountApp();
    el<HTMLButtonElement>(".vault-name")!.click();
    await settle(40);
    const menu = el(".vault-menu")!;
    expect(menu.textContent).toContain("test-vault");
    expect(menu.textContent).toContain("lab");
    expect(menu.textContent).toContain("位置不可用");
    const menuBox = menu.getBoundingClientRect();
    const sideBox = el(".sidebar")!.getBoundingClientRect();
    const footBox = el(".sidebar-foot")!.getBoundingClientRect();
    expect(menuBox.left).toBeGreaterThanOrEqual(sideBox.left);
    expect(menuBox.right).toBeLessThanOrEqual(sideBox.right);
    expect(menuBox.bottom).toBeLessThanOrEqual(footBox.top);

    const lab = [...menu.querySelectorAll<HTMLButtonElement>(".vault-menu-item")].find((button) =>
      button.textContent?.includes("lab"),
    )!;
    await act(async () => {
      lab.click();
      await settle(500);
    });

    expect(openVault).toHaveBeenCalledWith(OTHER_VAULT.root);
    expect(pickVaultFolder).not.toHaveBeenCalled();
    expect(el(".sidebar-foot")?.textContent).toContain("lab");
  });

  it("不用终端即可填写远端、身份并加入共享仓库", async () => {
    await mountApp();
    el<HTMLButtonElement>(".vault-name")!.click();
    await settle(30);
    const join = [...document.querySelectorAll<HTMLButtonElement>(".vault-menu-action")].find(
      (button) => button.textContent?.includes("加入共享仓库"),
    )!;
    join.click();
    await settle(60);

    const inputs = [...document.querySelectorAll<HTMLInputElement>(".join-field input")];
    const type = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle(20);
      });
    };
    await type(inputs[0], "https://github.com/team/shared.git");
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".join-path-row button")][0].click();
      await settle(40);
    });
    await type(inputs[2], "secret-token");
    await type(inputs[3], "林");
    await type(inputs[4], "lin@example.com");

    await act(async () => {
      document.querySelector<HTMLFormElement>(".join-vault form")!.requestSubmit();
      await settle(500);
    });

    expect(pickCloneFolder).toHaveBeenCalled();
    expect(cloneVault).toHaveBeenCalledWith({
      url: "https://github.com/team/shared.git",
      path: JOINED_VAULT.root,
      token: "secret-token",
      name: "林",
      email: "lin@example.com",
    });
    expect(document.querySelector(".join-vault")).toBeNull();
    expect(el(".sidebar-foot")?.textContent).toContain("shared");
  });

  it("切换前先保存尚未落盘的正文", async () => {
    await mountApp();
    const content = el<HTMLElement>(".cm-content")!;
    content.focus();
    await act(async () => {
      document.execCommand("insertText", false, "切库前刚写的字");
      await settle(30);
    });

    el<HTMLButtonElement>(".vault-name")!.click();
    await settle(30);
    const lab = [...document.querySelectorAll<HTMLButtonElement>(".vault-menu-item")].find(
      (button) => button.textContent?.includes("lab"),
    )!;
    await act(async () => {
      lab.click();
      await settle(500);
    });

    expect(writeNote).toHaveBeenCalled();
    expect(writeNote.mock.calls[0][1]).toContain("切库前刚写的字");
    expect(openVault).toHaveBeenCalledWith(OTHER_VAULT.root);
  });

  it("装载新仓库 workspace 时，不把旧仓库的标签写过去", async () => {
    await mountApp();
    workspaceSet.mockClear();

    el<HTMLButtonElement>(".vault-name")!.click();
    await settle(30);
    const lab = [...document.querySelectorAll<HTMLButtonElement>(".vault-menu-item")].find(
      (button) => button.textContent?.includes("lab"),
    )!;
    await act(async () => {
      lab.click();
      await settle(500);
    });

    // prepareVaultSwitch 会在旧后端上明确保存一次；后端换成 lab 后，第一次写入
    // 必须已经是 lab 自己读出的空标签，不能还是「论文.md」。
    const writesAfterOpen = workspaceWrites.filter((entry) => entry.root === OTHER_VAULT.root);
    expect(writesAfterOpen.length).toBeGreaterThan(0);
    expect(writesAfterOpen.every(({ workspace }) => !workspace.tabs.includes("论文.md"))).toBe(true);
  });

  it("管理面板显示完整路径；移除只忘掉入口", async () => {
    await mountApp();
    el<HTMLButtonElement>(".vault-name")!.click();
    await settle(30);
    const manage = [...document.querySelectorAll<HTMLButtonElement>(".vault-menu-action")].find(
      (button) => button.textContent?.includes("管理仓库"),
    )!;
    await act(async () => {
      manage.click();
      await settle(50);
    });

    const panel = el(".vault-manager")!;
    expect(panel.textContent).toContain(OTHER_VAULT.root);
    const box = panel.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    const remove = panel.querySelector<HTMLButtonElement>(`[aria-label="从列表移除 lab"]`)!;
    await act(async () => {
      remove.click();
      await settle(80);
    });
    expect(el(".vault-manager")?.textContent).not.toContain(OTHER_VAULT.root);
    // 当前仓库没有移除按钮：不能在仍使用它时制造「当前但不在清单」的怪状态。
    expect(panel.querySelector(`[aria-label="从列表移除 ${VAULT.name}"]`)).toBeNull();
  });

  it("上次目录打不开时，欢迎页仍能直接进入其他已记录仓库", async () => {
    reopen = null;
    await mountApp();
    const item = [...document.querySelectorAll<HTMLButtonElement>(".welcome-vault-item")].find(
      (button) => button.textContent?.includes("lab"),
    )!;
    expect(item).not.toBeNull();
    await act(async () => {
      item.click();
      await settle(500);
    });
    expect(openVault).toHaveBeenCalledWith(OTHER_VAULT.root);
    expect(el(".app")).not.toBeNull();
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
