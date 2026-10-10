/**
 * 侧栏的头部、底部和拖拽调宽。
 *
 * 调宽必须在真浏览器里验：它读的是 `clientX` 的差值再写进 grid 轨道，
 * 没有布局引擎时轨道宽度恒为 0，怎么拖都「通过」。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/host/dialog", () => ({ confirm: vi.fn(async () => true) }));

import type { NoteContent, NoteRef, RecentVault, SharedSpaceAccess, TreeNode, VaultInfo } from "../../../src/core/types";
import { isMac } from "../../../src/core/platform";

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

/** 已经加入的那个共享空间。`KNOWN` 里显示的是它的空间名「共同论文」 */
const ARTICLE_VAULT: VaultInfo = {
  root: "D:/Notes/article",
  name: "article",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const KNOWN: RecentVault[] = [
  { root: VAULT.root, name: VAULT.name, available: true, shared: false },
  { root: OTHER_VAULT.root, name: OTHER_VAULT.name, available: true, shared: false },
  { root: ARTICLE_VAULT.root, name: "共同论文", available: true, shared: true },
  { root: "D:/Notes/moved", name: "moved", available: false, shared: false },
];

const doc = (path: string, children: TreeNode[] = []): TreeNode => ({
  name: path.split("/").pop()!.replace(/\.md$/, ""),
  path,
  kind: "document",
  children,
  childDir: children.length ? path.replace(/\.md$/, "") : null,
  order: null,
  created: null,
  updated: null,
});

const TREE: TreeNode[] = [doc("论文.md")];

/** 共享空间里的内容：一个项目，底下两层 */
const ARTICLE_TREE: TreeNode[] = [
  doc("项目.md", [doc("项目/实验.md", [doc("项目/实验/数据.md")])]),
];
const BASE_TREES: Record<string, TreeNode[]> = {
  [VAULT.root]: TREE,
  [ARTICLE_VAULT.root]: ARTICLE_TREE,
};

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
  return [OTHER_VAULT, ARTICLE_VAULT].find((item) => item.root === path) ?? VAULT;
});
/** 每个仓库此刻的文档树。用例里可以把某个空间换成空的 */
let trees: Record<string, TreeNode[]> = { ...BASE_TREES };
const peekSpaceTree = vi.fn(async (root: string) => trees[root] ?? []);
/** 新建文档那一刻后端开着的是哪个仓库 —— 「建在了哪个空间里」只有这里看得出 */
const createdIn: string[] = [];
const createUntitled = vi.fn(async (_parent: string | null) => {
  createdIn.push(backendRoot);
  return { path: "未命名.md", id: "u", title: "未命名" };
});
/** 每个仓库上次留下的标签。默认都是空的 */
let savedTabs: Record<string, { tabs: string[]; active: number; pinnedCount: number }> = {};
const pickVaultFolder = vi.fn(async () => null as string | null);
const pickCloneFolder = vi.fn(async () => JOINED_VAULT.root as string | null);
const cloneDestination = vi.fn(async (_folder: string) => JOINED_VAULT.root);
const cloneVault = vi.fn(async (_input: Record<string, string>) => {
  backendRoot = JOINED_VAULT.root;
  return JOINED_VAULT;
});
const shareCurrentNote = vi.fn(async (_input: Record<string, unknown>) => {
  backendRoot = JOINED_VAULT.root;
  return { vault: JOINED_VAULT, note: "论文.md", notice: null };
});
const shareGitHub = vi.fn(async (_input: Record<string, unknown>) => {
  backendRoot = JOINED_VAULT.root;
  return { vault: JOINED_VAULT, note: "论文.md", notice: "已创建私人共享空间" };
});
const shareToSpace = vi.fn(async (_input: Record<string, unknown>) => {
  backendRoot = JOINED_VAULT.root;
  return { vault: JOINED_VAULT, note: "论文.md", notice: "已加入共享空间" };
});
const unshare = vi.fn(async (_input: Record<string, unknown>) => ({
  vault: VAULT,
  note: "项目.md",
  notice: "已移回私人空间",
}));
const checkShareAccess = vi.fn(async (): Promise<SharedSpaceAccess> => ({
  members: ["person-1"],
  pending: ["person-3"],
  github: true,
  verified: true,
  warning: null,
}));
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

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => reopen,
    openVault: (path: string) => openVault(path),
    cloneVault: (input: Record<string, string>) => cloneVault(input),
    cloneDestination: (name: string) => cloneDestination(name),
    shareNotePreview: async (note: string) => ({
      note,
      documents: [note, "论文/实验.md"],
      files: [note, "论文/实验.md", "论文/data.csv"],
      attachments: ["attachments/figure.png"],
      linkedNotes: ["私人记录.md"],
    }),
    shareNote: (input: Record<string, unknown>) => shareCurrentNote(input),
    shareSpaces: async () => [
      {
        root: "D:/Notes/article",
        name: "共同论文",
        members: ["person-1"],
        entries: ["项目.md"],
        remote: "https://github.com/owner/shared.git",
      },
    ],
    shareSpaceAccess: () => checkShareAccess(),
    sharedSpaceInvite: async () => checkShareAccess(),
    sharedSpaceRemoveMember: async () => checkShareAccess(),
    shareNoteToSpace: (input: Record<string, unknown>) => shareToSpace(input),
    githubAccount: async () => ({ login: "owner" }),
    githubConnect: async () => ({ login: "owner" }),
    githubDisconnect: async () => {},
    shareNoteToGitHub: (input: Record<string, unknown>) => shareGitHub(input),
    unshareNote: (spaceRoot: string, note: string, privateRoot: string) =>
      unshare({ spaceRoot, note, privateRoot }),
    recentVaults: async () => knownVaults,
    forgetVault: async (path: string) => {
      knownVaults = knownVaults.filter((item) => item.root !== path);
    },
    tree: async () => trees[backendRoot] ?? TREE,
    peekSpaceTree: (root: string) => peekSpaceTree(root),
    listNotes: async () => NOTES,
    // 共享空间里那几篇按路径给；别的一律是 NOTE，老用例都照这个写的
    readNote: async (path: string) =>
      path.startsWith("项目") ? { ...NOTE, path, title: path, body: `# ${path}\n` } : NOTE,
    writeNote: (path: string, body: string) => writeNote(path, body),
    statNote: async () => 0,
    createNote: async () => ({ path: "x.md", id: "x", title: "x" }),
    createUntitled: (parent: string | null) => createUntitled(parent),
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
    gitIdentityGet: async () => ({ name: "林", email: "lin@example.com" }),
    gitIdentitySet: async (name: string, email: string) => ({ name, email }),
    workspaceGet: async () => savedTabs[backendRoot] ?? { tabs: [], active: 0 },
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
  pickImageSavePath: async () => null,
}));

const { default: App } = await import("../../../src/app/App");

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
  cloneDestination.mockClear();
  shareCurrentNote.mockClear();
  shareGitHub.mockClear();
  shareToSpace.mockClear();
  unshare.mockClear();
  checkShareAccess.mockClear();
  writeNote.mockClear();
  workspaceSet.mockClear();
  workspaceWrites.length = 0;
  peekSpaceTree.mockClear();
  createUntitled.mockClear();
  createdIn.length = 0;
  trees = { ...BASE_TREES };
  savedTabs = {};
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
/** 两区里的某一区（§2.8）。这份数据里有一个共享空间，所以侧栏总是分区的 */
const zone = (label: "共享" | "私人") => el<HTMLElement>(`.space-zone[aria-label="${label}"]`);
const rowsIn = (label: "共享" | "私人") =>
  [...(zone(label)?.querySelectorAll<HTMLElement>(".tree-row") ?? [])];
/** 自己仓库里的那一行 —— 共享区排在上面，光找 `.tree-row` 拿到的是别人空间里的 */
const privateRow = () => rowsIn("私人")[0];
const width =() => Math.round(document.querySelector(".sidebar")!.getBoundingClientRect().width);

async function fire(target: HTMLElement, type: string, init: Record<string, unknown> = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(e);
    await settle(30);
  });
}

describe("图标栏", () => {
  /**
   * 「动态」曾经是六个面板里唯一一个没有默认键位的 —— v0.5.45 把它加进命令表
   * 时就漏了，之后一直没人发现。这类遗漏在界面上完全看不出来：图标在、点得动、
   * 面板也正常打开，只有想用快捷键的人会发现按不出来。所以按规则钉住：
   * **每一个侧栏面板都必须advertise 一个快捷键**，而不是逐条列出键位。
   */
  it("图标栏上每个开关都有默认快捷键", async () => {
    await mountApp();
    // 六个面板 + 源码模式 / 思维导图 / 项目中心 / 终端，都是 aria-pressed 的开关
    const rails = [...document.querySelectorAll<HTMLElement>(".rail-btn[aria-pressed]")];
    expect(rails.length).toBeGreaterThanOrEqual(9);
    // 键位提示由 `hint()` 拼成「名字 (键)」；终端那条后面还接了右键说明，
    // 所以只要求括号出现过，不要求它在末尾
    const missing = rails.filter((button) => !/\(.+\)/.test(button.title)).map((button) => button.title);
    expect(missing, "这些入口没有快捷键").toEqual([]);
  });

  it("动态用 Mod+Shift+H 打开", async () => {
    await mountApp();
    expect(el(".sidebar-head")!.textContent).toBe("文档");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "h",
        code: "KeyH",
        ...(isMac ? { metaKey: true } : { ctrlKey: true }),
        shiftKey: true,
        bubbles: true,
      }));
      await settle(120);
    });
    expect(el(".sidebar-head")!.textContent).toBe("动态");
  });
});

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
    // 共享空间已经摆在侧栏的「共享」区里，这里不再列一遍（§2.8）
    expect([...menu.querySelectorAll(".vault-menu-label")].map((node) => node.textContent))
      .toEqual(["私人"]);
    expect(menu.textContent).not.toContain("共同论文");
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

  it("空间管理能从共享列表进入，并明确确认后把内容迁回私人", async () => {
    await mountApp();
    el<HTMLButtonElement>(".vault-name")!.click();
    await settle(30);
    const manageSpaces = [...document.querySelectorAll<HTMLButtonElement>(".vault-menu-action")]
      .find((button) => button.textContent?.includes("管理空间"))!;
    manageSpaces.click();
    await settle(40);

    const sharedRow = [...document.querySelectorAll<HTMLElement>(".vault-manager-row")]
      .find((row) => row.textContent?.includes("共同论文"))!;
    await act(async () => {
      [...sharedRow.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "管理")!.click();
      await settle(120);
    });

    expect(el(".shared-space-dialog")?.textContent).toContain("项目");
    expect(el(".shared-space-dialog")?.textContent).toContain("@person-1");
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".shared-entry-row button")][0].click();
      await settle(20);
    });
    const confirm = [...document.querySelectorAll<HTMLButtonElement>(".shared-unshare-confirm button")]
      .find((button) => button.textContent?.trim() === "移回私人")!;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      el<HTMLInputElement>(".shared-unshare-check input")!.click();
      await settle(20);
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      confirm.click();
      await settle(500);
    });

    expect(unshare).toHaveBeenCalledWith({
      spaceRoot: "D:/Notes/article",
      note: "项目.md",
      privateRoot: VAULT.root,
    });
    expect(el(".shared-space-dialog")).toBeNull();
  });

  it("粘贴邀请就能加入：地址、位置与署名都自动填好，不必再挑文件夹", async () => {
    await mountApp();
    el<HTMLButtonElement>(".vault-name")!.click();
    await settle(30);
    const join = [...document.querySelectorAll<HTMLButtonElement>(".vault-menu-action")].find(
      (button) => button.textContent?.includes("加入共享空间"),
    )!;
    join.click();
    await settle(60);

    const invite = document.querySelector<HTMLTextAreaElement>(".join-invite-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(
        invite,
        ["【Verso 共享空间邀请】组会记录", "https://github.com/team/shared.git"].join("\n"),
      );
      invite.dispatchEvent(new Event("input", { bubbles: true }));
      await settle(80);
    });

    const dialog = document.querySelector(".join-vault")!;
    expect(dialog.textContent).toContain("组会记录");
    expect(dialog.textContent).toContain("将以已连接的 @owner");
    expect(dialog.textContent).toContain(JOINED_VAULT.root);
    expect(cloneDestination).toHaveBeenCalledWith("shared");

    await act(async () => {
      document.querySelector<HTMLFormElement>(".join-vault form")!.requestSubmit();
      await settle(500);
    });

    // 位置和署名都是算出来的：受邀者一次文件夹选择器都不用点
    expect(pickCloneFolder).not.toHaveBeenCalled();
    expect(cloneVault).toHaveBeenCalledWith({
      url: "https://github.com/team/shared.git",
      path: JOINED_VAULT.root,
      token: "",
      name: "林",
      email: "lin@example.com",
    });
    expect(document.querySelector(".join-vault")).toBeNull();
    expect(el(".sidebar-foot")?.textContent).toContain("shared");
  });

  it("已有空间必须亲自选择，并在移动前核对实际成员", async () => {
    await mountApp();
    const row = privateRow();
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }),
    );
    await settle(30);
    const share = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find(
      (button) => button.textContent?.includes("共享这篇"),
    )!;
    share.click();
    await settle(50);

    const dialog = el(".share-note")!;
    const dialogBox = dialog.getBoundingClientRect();
    expect(dialogBox.left).toBeGreaterThanOrEqual(0);
    expect(dialogBox.top).toBeGreaterThanOrEqual(0);
    expect(dialogBox.right).toBeLessThanOrEqual(window.innerWidth);
    expect(dialogBox.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(dialog.textContent).toContain("论文/实验.md");
    expect(dialog.textContent).toContain("论文/data.csv");
    expect(dialog.textContent).toContain("attachments/figure.png");
    expect(dialog.textContent).toContain("私人记录");
    expect(dialog.textContent).toContain("仍是私人内容");
    expect(dialog.textContent).toContain("共同论文");
    expect(dialog.textContent).toContain("@person-1");

    const submit = dialog.querySelector<HTMLButtonElement>('.join-actions button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain("请先选择");
    const existing = [...dialog.querySelectorAll<HTMLButtonElement>(".share-space-options button")].find(
      (button) => button.textContent?.includes("共同论文"),
    )!;
    await act(async () => {
      existing.click();
      await settle(80);
    });
    expect(checkShareAccess).toHaveBeenCalledOnce();
    expect(dialog.textContent).toContain("已加入：@person-1");
    expect(dialog.textContent).toContain("等待接受：@person-3");
    expect(submit.disabled).toBe(false);

    await act(async () => {
      dialog.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await settle(500);
    });

    expect(shareToSpace).toHaveBeenCalledWith({
      note: "论文.md",
      spaceRoot: "D:/Notes/article",
      name: "林",
      email: "lin@example.com",
    });
    expect(shareGitHub).not.toHaveBeenCalled();
    expect(pickCloneFolder).not.toHaveBeenCalled();
    expect(document.querySelector(".share-note")).toBeNull();
    expect(el(".sidebar-foot")?.textContent).toContain("shared");
  });

  it("GitHub 成员核对失败时不允许移动私人内容", async () => {
    checkShareAccess.mockResolvedValueOnce({
      members: ["person-1"],
      pending: [],
      github: true,
      verified: false,
      warning: "暂时无法从 GitHub 核对成员。",
    });
    await mountApp();
    privateRow().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }),
    );
    await settle(30);
    const share = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find(
      (button) => button.textContent?.includes("共享这篇"),
    )!;
    await act(async () => {
      share.click();
      await settle(60);
    });

    const dialog = el(".share-note")!;
    const existing = [...dialog.querySelectorAll<HTMLButtonElement>(".share-space-options button")].find(
      (button) => button.textContent?.includes("共同论文"),
    )!;
    await act(async () => {
      existing.click();
      await settle(80);
    });

    expect(dialog.textContent).toContain("暂时无法从 GitHub 核对成员。");
    expect(dialog.textContent).toContain("重新核对");
    expect(dialog.querySelector<HTMLButtonElement>('.join-actions button[type="submit"]')!.disabled).toBe(true);
    expect(shareToSpace).not.toHaveBeenCalled();
  });

  it("成员组合不同时仍可新建 GitHub 私有空间", async () => {
    await mountApp();
    privateRow().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }),
    );
    await settle(30);
    const share = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find(
      (button) => button.textContent?.includes("共享这篇"),
    )!;
    await act(async () => {
      share.click();
      await settle(60);
    });
    const dialog = el(".share-note")!;
    const create = [...dialog.querySelectorAll<HTMLButtonElement>(".share-space-options button")].find(
      (button) => button.textContent?.includes("新建共享空间"),
    )!;
    await act(async () => {
      create.click();
      await settle(30);
    });
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>(".join-field input")];
    const type = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle(20);
      });
    };
    await type(inputs[0], "person-2");
    await act(async () => {
      dialog.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await settle(500);
    });
    expect(shareGitHub).toHaveBeenCalledWith({
      note: "论文.md",
      collaborators: ["person-2"],
      name: "林",
      email: "lin@example.com",
      // 名字留空 = 让后端自动起一个
      repository: "",
    });
  });

  /**
   * 仓库**建好之后改不了名**（改了所有人的远端地址就断了），所以这个输入
   * 必须在建库之前问。留空才用自动生成的名字。
   */
  it("快速创建时可以自己给空间起名", async () => {
    await mountApp();
    privateRow().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }),
    );
    await settle(30);
    const share = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find(
      (button) => button.textContent?.includes("共享这篇"),
    )!;
    await act(async () => {
      share.click();
      await settle(60);
    });
    const dialog = el(".share-note")!;
    await act(async () => {
      [...dialog.querySelectorAll<HTMLButtonElement>(".share-space-options button")]
        .find((button) => button.textContent?.includes("新建共享空间"))!
        .click();
      await settle(30);
    });
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>(".join-field input")];
    const type = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle(20);
      });
    };
    await type(inputs[0], "person-2");
    // 第二个输入框就是空间名 —— 它必须和成员摆在一起，事后没有第二次机会
    await type(inputs[1], "小组论文");
    await act(async () => {
      dialog.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await settle(500);
    });
    expect(shareGitHub).toHaveBeenCalledWith(
      expect.objectContaining({ repository: "小组论文" }),
    );
  });

  it("高级入口仍可使用已有的 GitLab 或自托管空仓库", async () => {
    await mountApp();
    privateRow().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }),
    );
    await settle(30);
    const share = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find(
      (button) => button.textContent?.includes("共享这篇"),
    )!;
    await act(async () => {
      share.click();
      await settle(60);
    });
    const dialog = el(".share-note")!;
    const create = [...dialog.querySelectorAll<HTMLButtonElement>(".share-space-options button")].find(
      (button) => button.textContent?.includes("新建共享空间"),
    )!;
    await act(async () => {
      create.click();
      await settle(30);
    });
    const advanced = [...dialog.querySelectorAll<HTMLButtonElement>(".share-mode button")].find(
      (button) => button.textContent?.includes("使用已有仓库"),
    )!;
    await act(async () => {
      advanced.click();
      await settle(30);
    });
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>(".join-field input")];
    const type = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle(20);
      });
    };
    await type(inputs[0], "https://gitlab.example.com/team/article.git");
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>(".join-path-row button")!.click();
      await settle(40);
    });
    await type(inputs[2], "gitlab-token");
    await act(async () => {
      dialog.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await settle(500);
    });
    expect(shareCurrentNote).toHaveBeenCalledWith({
      note: "论文.md",
      url: "https://gitlab.example.com/team/article.git",
      path: JOINED_VAULT.root,
      token: "gitlab-token",
      name: "林",
      email: "lin@example.com",
    });
  });

  it("已连接 GitHub 时，已有 GitHub 空仓库也不需要重复填写令牌", async () => {
    await mountApp();
    privateRow().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }),
    );
    await settle(30);
    [...document.querySelectorAll<HTMLButtonElement>(".ctx button")]
      .find((button) => button.textContent?.includes("共享这篇"))!
      .click();
    await settle(60);
    const dialog = el(".share-note")!;
    [...dialog.querySelectorAll<HTMLButtonElement>(".share-space-options button")]
      .find((button) => button.textContent?.includes("新建共享空间"))!
      .click();
    await settle(30);
    [...dialog.querySelectorAll<HTMLButtonElement>(".share-mode button")]
      .find((button) => button.textContent?.includes("使用已有仓库"))!
      .click();
    await settle(30);

    const inputs = [...dialog.querySelectorAll<HTMLInputElement>(".join-field input")];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        .call(inputs[0], "https://github.com/team/shared.git");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      await settle(30);
    });
    expect(dialog.textContent).toContain("访问令牌（可选）");
    expect(dialog.textContent).toContain("将使用已连接的 @owner");
    await act(async () => {
      dialog.querySelector<HTMLButtonElement>(".join-path-row button")!.click();
      await settle(40);
    });
    expect(dialog.querySelector<HTMLInputElement>(".join-path-row input")!.value).toBe(JOINED_VAULT.root);
    await act(async () => {
      dialog.querySelector<HTMLFormElement>("form")!.requestSubmit();
      await settle(500);
    });
    expect(dialog.querySelector(".join-error")?.textContent).toBeFalsy();
    expect(shareCurrentNote).toHaveBeenCalledWith({
      note: "论文.md",
      url: "https://github.com/team/shared.git",
      path: JOINED_VAULT.root,
      token: "",
      name: "林",
      email: "lin@example.com",
    });
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
      (button) => button.textContent?.includes("管理空间"),
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

/**
 * 侧栏的「共享 / 私人」两区（§2.8）。
 *
 * 以前想看一篇共享笔记得先去底部菜单「切换空间」，整个侧栏和标签栏跟着换掉。
 * 现在两边同时摆着：后端仍然一次只开一个仓库，但那是我们的事，不是用户的。
 */
describe("共享 / 私人两区", () => {
  const names = (label: "共享" | "私人") =>
    rowsIn(label).map((row) => row.querySelector(".tree-name")?.textContent);
  const rowNamed = (label: "共享" | "私人", name: string) =>
    rowsIn(label).find((row) => row.querySelector(".tree-name")?.textContent === name);

  /** 等到那样东西真的出现，不睡固定时长（AGENTS.md：整套并行跑时固定的数会不够） */
  async function waitFor(ready: () => unknown, what: string) {
    const deadline = Date.now() + 4000;
    for (;;) {
      await act(async () => {
        await settle(20);
      });
      if (ready()) return;
      if (Date.now() > deadline) throw new Error(`等了 4 秒也没等到：${what}`);
    }
  }

  async function clickRow(label: "共享" | "私人", name: string) {
    const row = rowNamed(label, name);
    if (!row) throw new Error(`${label}区里没有「${name}」，实际有：${names(label).join("、")}`);
    await act(async () => {
      row.querySelector<HTMLButtonElement>(".tree-label")!.click();
      await settle(20);
    });
  }

  it("共享空间的内容不用切换就在侧栏里：共享在上，私人在下", async () => {
    await mountApp();
    await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");

    expect(zone("共享")!.textContent).toContain("共同论文");
    expect(names("共享")).toEqual(["项目", "实验"]);
    expect(names("私人")).toEqual(["论文"]);
    // 这一切都没有碰后端的当前仓库
    expect(openVault).not.toHaveBeenCalled();
    expect(peekSpaceTree).toHaveBeenCalledWith(ARTICLE_VAULT.root);
    // 当前仓库的树已经在手上，不该再去「预览」一遍
    expect(peekSpaceTree).not.toHaveBeenCalledWith(VAULT.root);

    // 纵向：共享区整个在私人区上面，两区都在侧栏里面
    const shared = zone("共享")!.getBoundingClientRect();
    const mine = zone("私人")!.getBoundingClientRect();
    const side = el(".sidebar-body")!.getBoundingClientRect();
    expect(shared.height).toBeGreaterThan(0);
    expect(mine.height).toBeGreaterThan(0);
    expect(shared.bottom).toBeLessThanOrEqual(mine.top + 1);
    expect(shared.top).toBeGreaterThanOrEqual(side.top);
    expect(mine.bottom).toBeLessThanOrEqual(side.bottom);

    // 横向：空间里的文档比空间那一行缩进一层，私人区的文档不缩
    const left = (node: Element) => Math.round(node.getBoundingClientRect().left);
    const spaceTwisty = left(zone("共享")!.querySelector(".space-row .tree-twisty")!);
    const sharedTwisty = left(rowNamed("共享", "项目")!.querySelector(".tree-twisty")!);
    const mineTwisty = left(rowNamed("私人", "论文")!.querySelector(".tree-twisty")!);
    expect(sharedTwisty).toBeGreaterThan(spaceTwisty);
    expect(mineTwisty).toBe(spaceTwisty);
    // 空间名和文档名都真的画出来了，没有被挤成零宽
    expect(zone("共享")!.querySelector(".space-label .tree-name")!.getBoundingClientRect().width)
      .toBeGreaterThan(20);
  });

  it("点共享区里的一篇就打开它：后台切过去，不经过底部菜单；再点私人区的一篇就回来", async () => {
    await mountApp();
    await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");

    await clickRow("共享", "项目");
    await waitFor(() => el(".tab.is-active")?.textContent?.includes("项目"), "点的那一篇被打开");

    expect(openVault).toHaveBeenCalledWith(ARTICLE_VAULT.root);
    expect(el(".vault-menu"), "没有经过切换菜单").toBeNull();
    expect(el(".sidebar-foot")?.textContent).toContain("共同论文");
    expect(zone("共享")!.querySelector(".tree-row.is-active .tree-name")?.textContent).toBe("项目");

    // 私人那一侧还在原处，变成了只读的；共享这一侧现在才能改
    expect(names("私人")).toEqual(["论文"]);
    expect(zone("私人")!.querySelector(".tree-add")).toBeNull();
    expect(zone("共享")!.querySelector(".tree-add")).not.toBeNull();
    expect(zone("私人")!.querySelector(".tree-row.is-active")).toBeNull();

    await clickRow("私人", "论文");
    await waitFor(() => openVault.mock.calls.length === 2, "切回私人空间");
    await waitFor(
      () => zone("私人")!.querySelector(".tree-row.is-active .tree-name")?.textContent === "论文",
      "私人区里那一篇被选中",
    );
    expect(openVault).toHaveBeenLastCalledWith(VAULT.root);
    expect(el(".sidebar-foot")?.textContent).toContain("test-vault");
    expect(zone("共享")!.querySelector(".tree-add")).toBeNull();
  });

  it("那边上次停在别的页时，打开的仍是点的这一篇，而且会被记进那边的标签", async () => {
    savedTabs[ARTICLE_VAULT.root] = { tabs: ["项目/实验.md"], active: 0, pinnedCount: 0 };
    await mountApp();
    await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");

    await clickRow("共享", "项目");
    await waitFor(() => el(".tab.is-active")?.textContent?.includes("项目"), "点的那一篇被打开");

    expect(el(".tab.is-active .tab-name")?.textContent).toBe("项目");
    // 换库期间「标签一变就落盘」是关着的，这一次得自己存：不然不再动标签就关掉
    // 软件的话，下次回到这个空间看不到刚才点开的这一篇
    const saved = workspaceWrites.filter((entry) => entry.root === ARTICLE_VAULT.root);
    expect(saved.some(({ workspace }) => workspace.tabs.includes("项目.md"))).toBe(true);
    // 私人仓库的标签不能被带过来
    expect(saved.every(({ workspace }) => !workspace.tabs.includes("论文.md"))).toBe(true);
  });

  it("点进去之后那棵树原地变成可改的，展开到哪儿还在哪儿", async () => {
    await mountApp();
    await waitFor(() => rowNamed("共享", "实验"), "共享空间的树");
    // 第二层默认是收着的
    expect(rowNamed("共享", "数据")).toBeUndefined();

    await act(async () => {
      rowNamed("共享", "实验")!.querySelector<HTMLButtonElement>(".tree-twisty")!.click();
      await settle(20);
    });
    expect(rowNamed("共享", "数据")).toBeDefined();

    await clickRow("共享", "数据");
    await waitFor(() => zone("共享")!.querySelector(".tree-add"), "共享这一侧变成可改的");

    // 整棵重新挂载的话，「实验」会收回默认状态，刚点的那一行就不见了
    expect(rowNamed("共享", "数据"), "展开状态跟着留下来").toBeDefined();
    await waitFor(
      () => zone("共享")!.querySelector(".tree-row.is-active .tree-name")?.textContent === "数据",
      "点的那一行被选中",
    );
  });

  it("别的空间的树是只读的：没有新建子文档、拖不进去、右键只有打开", async () => {
    await mountApp();
    await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");
    const row = rowNamed("共享", "项目")!;

    expect(row.querySelector(".tree-add")).toBeNull();
    expect(row.draggable).toBe(false);
    expect(privateRow().draggable).toBe(true);

    // 从自己仓库拖一行过来：放下去会拿两个仓库的路径去调同一次移动，必须放不下
    const data = new DataTransfer();
    data.setData("text/verso-path", "论文.md");
    const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data });
    await act(async () => {
      row.dispatchEvent(over);
      await settle(20);
    });
    expect(over.defaultPrevented, "没有接受这次拖放").toBe(false);
    expect(row.className).not.toContain("is-drop");

    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }),
      );
      await settle(30);
    });
    const items = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].map(
      (button) => button.textContent?.trim(),
    );
    expect(items).toEqual(["打开", "在新标签页打开"]);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".ctx button")!.click();
      await settle(20);
    });
    await waitFor(() => el(".tab.is-active")?.textContent?.includes("项目"), "从右键菜单打开");
    expect(openVault).toHaveBeenCalledWith(ARTICLE_VAULT.root);
  });

  it("空间那一行上的齿轮直接进成员管理", async () => {
    await mountApp();
    await waitFor(() => zone("共享")?.querySelector(".space-manage"), "空间那一行");
    await act(async () => {
      zone("共享")!.querySelector<HTMLButtonElement>(".space-manage")!.click();
      await settle(20);
    });
    await waitFor(() => el(".shared-space-dialog"), "空间管理对话框");
    expect(el(".shared-space-dialog")?.textContent).toContain("@person-1");
    // 管理不等于进入：后端的当前仓库没动
    expect(openVault).not.toHaveBeenCalled();
  });

  // 以前那边只要留着标签，恢复出来的就是那几页，刚移过去的这一篇得自己再去找
  it("移回私人之后落在那一篇上，那边原来开着的标签也还在", async () => {
    savedTabs[VAULT.root] = { tabs: ["论文.md"], active: 0, pinnedCount: 0 };
    await mountApp();
    await waitFor(() => zone("共享")?.querySelector(".space-manage"), "空间那一行");
    await act(async () => {
      zone("共享")!.querySelector<HTMLButtonElement>(".space-manage")!.click();
      await settle(20);
    });
    await waitFor(() => el(".shared-entry-row button"), "空间里的内容清单");
    await act(async () => {
      el<HTMLButtonElement>(".shared-entry-row button")!.click();
      await settle(20);
    });
    await act(async () => {
      el<HTMLInputElement>(".shared-unshare-check input")!.click();
      await settle(20);
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".shared-unshare-confirm button")]
        .find((button) => button.textContent?.trim() === "移回私人")!
        .click();
      await settle(20);
    });

    await waitFor(
      () => el(".tab.is-active .tab-name")?.textContent === "项目",
      "移回来的那一篇被打开",
    );
    expect([...document.querySelectorAll(".tab .tab-name")].map((node) => node.textContent))
      .toEqual(["论文", "项目"]);
  });

  // 手机上不分区，但触屏笔记本会：屏幕够宽、指针却是手指（见 App 里 data-touch
  // 那一段）。两区新加的几个按钮得跟树上的行一样点得着
  it("触摸屏上，区标题和空间那一行的点击目标够大", async () => {
    document.documentElement.dataset.touch = "on";
    try {
      await mountApp();
      await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");
      const box = (sel: string) => zone("共享")!.querySelector(sel)!.getBoundingClientRect();

      expect(box(".zone-head").height).toBeGreaterThanOrEqual(44);
      expect(box(".space-label").height).toBeGreaterThanOrEqual(44);
      expect(box(".space-row .tree-twisty").height).toBeGreaterThanOrEqual(44);
      // 行内的次要图标按 32 算；没有悬停的设备上它们必须一直显示着
      const manage = zone("共享")!.querySelector<HTMLElement>(".space-manage")!;
      const add = zone("共享")!.querySelector<HTMLElement>(".space-add")!;
      for (const button of [add, manage]) {
        expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
        expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
        expect(getComputedStyle(button).opacity).toBe("1");
      }
      // 两个按钮并排不重叠，也没有把空间名挤没、把自己挤出侧栏
      expect(add.getBoundingClientRect().right).toBeLessThanOrEqual(
        manage.getBoundingClientRect().left + 1,
      );
      expect(manage.getBoundingClientRect().right).toBeLessThanOrEqual(
        el(".sidebar")!.getBoundingClientRect().right,
      );
      expect(box(".space-label .tree-name").width).toBeGreaterThan(20);
    } finally {
      delete document.documentElement.dataset.touch;
    }
  });

  /**
   * 两处都列的话是同一样东西的两个入口，行为还不一样（菜单是「整个切过去」，
   * 侧栏是「打开这一篇」）。菜单留给真正不相干的私人仓库。
   */
  it("底部菜单不再重复列共享空间：人在共享空间里时也只列私人的，点一下就回来", async () => {
    await mountApp();
    await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");
    const menuNames = () =>
      [...document.querySelectorAll(".vault-menu-item strong")].map((node) => node.textContent);
    const openMenu = async () => {
      await act(async () => {
        el<HTMLButtonElement>(".vault-name")!.click();
        await settle(40);
      });
    };

    await clickRow("共享", "项目");
    await waitFor(() => el(".tab.is-active")?.textContent?.includes("项目"), "进了共享空间");
    // 底部那一条仍然说得出此刻在哪儿
    expect(el(".sidebar-foot")?.textContent).toContain("共同论文");

    await openMenu();
    expect(menuNames()).toEqual(["test-vault", "lab", "moved"]);
    expect(el(".vault-menu .is-current"), "当前空间不在这张单子里，没有哪一行该打勾").toBeNull();
    // 管理和加入的入口都还在
    expect([...document.querySelectorAll(".vault-menu-action")].map((b) => b.textContent?.trim()))
      .toEqual(["管理空间…", "打开其他文件夹…", "加入共享空间…"]);

    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".vault-menu-item")]
        .find((button) => button.textContent?.includes("test-vault"))!
        .click();
      await settle(20);
    });
    await waitFor(() => el(".sidebar-foot")?.textContent?.includes("test-vault"), "回到私人空间");
    expect(openVault).toHaveBeenLastCalledWith(VAULT.root);
  });

  // 菜单不列共享空间之后，一个空的空间在侧栏里没有任何一行可点 —— 没有这个
  // 「+」就进不去了
  it("空间那一行的「+」直接在这个空间里新建，空的空间也进得去", async () => {
    trees[ARTICLE_VAULT.root] = [];
    await mountApp();
    await waitFor(() => zone("共享")?.querySelector(".space-empty"), "空空间的提示");
    expect(rowsIn("共享")).toEqual([]);

    await act(async () => {
      zone("共享")!.querySelector<HTMLButtonElement>(".space-add")!.click();
      await settle(20);
    });
    await waitFor(() => createUntitled.mock.calls.length > 0, "新建文档");

    expect(openVault).toHaveBeenCalledWith(ARTICLE_VAULT.root);
    // 建在了那个共享空间里，不是此前所在的私人仓库
    expect(createdIn).toEqual([ARTICLE_VAULT.root]);
    await waitFor(() => el(".tab.is-active .tab-name")?.textContent === "未命名", "新文档被打开");
    expect(el(".sidebar-foot")?.textContent).toContain("共同论文");
  });

  it("人已经在那个空间里时，「+」不再切一次，直接新建", async () => {
    await mountApp();
    await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");
    await clickRow("共享", "项目");
    await waitFor(() => zone("共享")!.querySelector(".tree-add"), "共享这一侧变成可改的");
    openVault.mockClear();

    await act(async () => {
      zone("共享")!.querySelector<HTMLButtonElement>(".space-add")!.click();
      await settle(20);
    });
    await waitFor(() => createUntitled.mock.calls.length > 0, "新建文档");

    expect(openVault).not.toHaveBeenCalled();
    expect(createdIn).toEqual([ARTICLE_VAULT.root]);
  });

  it("收起一个区会被记住", async () => {
    await mountApp();
    await waitFor(() => rowNamed("共享", "项目"), "共享空间的树");
    const head = () => zone("共享")!.querySelector<HTMLButtonElement>(".zone-head")!;

    await act(async () => {
      head().click();
      await settle(20);
    });
    expect(head().getAttribute("aria-expanded")).toBe("false");
    expect(zone("共享")!.querySelector(".space-row"), "收起后只剩标题").toBeNull();
    expect(names("私人")).toEqual(["论文"]);

    // 重开软件
    root?.unmount();
    document.body.innerHTML = "";
    await mountApp();
    await waitFor(() => zone("共享"), "两区");
    expect(head().getAttribute("aria-expanded")).toBe("false");
    expect(zone("共享")!.querySelector(".space-row")).toBeNull();
  });

  it("一个共享空间都没有时不分区，侧栏和以前一样", async () => {
    knownVaults = KNOWN.filter((item) => !item.shared);
    await mountApp();
    expect(el(".zone-head")).toBeNull();
    expect(el(".space-zones")).toBeNull();
    expect([...document.querySelectorAll(".tree-row .tree-name")].map((node) => node.textContent))
      .toEqual(["论文"]);
    expect(peekSpaceTree).not.toHaveBeenCalled();
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

describe("大纲的全部折叠 / 全部展开", () => {
  /** 三级结构：两个一级标题各带下属，末端两条没有下属 */
  const DOC = ["# 上篇", "## 方法", "### 实验", "# 下篇", "## 结论"].join("\n\n");

  // 正文得在 App 把它读进来之前就换好，读是异步的，挂完再还原会赶不上
  const original = NOTE.body;
  afterEach(() => { NOTE.body = original; });

  async function mountOutline() {
    localStorage.setItem("verso.sidebarView", "outline");
    localStorage.setItem("verso.sidebarOpen", "1");
    NOTE.body = DOC;
    await mountApp();
  }

  const texts = () => [...document.querySelectorAll(".outline-text")].map((row) => row.textContent);
  const foldAll = () => el<HTMLButtonElement>(".sidebar-head .side-act");

  it("按钮和文档树在同一个位置，一下收全、再一下展开", async () => {
    await mountOutline();
    expect(texts()).toEqual(["上篇", "方法", "实验", "下篇", "结论"]);
    expect(foldAll()!.getAttribute("aria-label")).toBe("全部折叠");

    await fire(foldAll()!, "click");
    expect(texts()).toEqual(["上篇", "下篇"]);
    // 全收着了，按钮才改口说「全部展开」—— 它照实说下一下会发生什么
    expect(foldAll()!.getAttribute("aria-label")).toBe("全部展开");

    await fire(foldAll()!, "click");
    expect(texts()).toEqual(["上篇", "方法", "实验", "下篇", "结论"]);
    expect(foldAll()!.getAttribute("aria-label")).toBe("全部折叠");
  });

  it("手动展开其中一节，按钮就回到「全部折叠」", async () => {
    await mountOutline();
    await fire(foldAll()!, "click");
    expect(foldAll()!.getAttribute("aria-label")).toBe("全部展开");

    await fire(el<HTMLButtonElement>(".outline-twisty")!, "click");
    expect(texts()).toEqual(["上篇", "方法", "下篇"]);
    expect(foldAll()!.getAttribute("aria-label")).toBe("全部折叠");
  });

  it("一条能收的都没有时不摆这个按钮", async () => {
    localStorage.setItem("verso.sidebarView", "outline");
    localStorage.setItem("verso.sidebarOpen", "1");
    await mountApp();
    // 默认那篇只有一个 `# 论文`
    expect(document.querySelectorAll(".outline-text")).toHaveLength(1);
    expect(foldAll()).toBeNull();
  });
});
