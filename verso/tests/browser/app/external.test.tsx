/**
 * 「文件已被外部程序修改」那条提示。DESIGN.md §2.7
 *
 * 它曾经**关不掉**：提示上「保留我的」按的就是保存，而保存自己会让文件
 * 监听器响一次 —— 原子写是「写临时文件 + rename」，一次 rename 在 Windows 上
 * 能产生不止一个事件，Rust 侧的自写登记（`watcher.rs` 的 `SelfWrites`）
 * 只抵得掉第一个。漏过来的那个又把提示招回来，点多少次都一样。
 *
 * 所以这里验的是「收到事件之后**比一次 mtime 再决定报不报**」。
 * 这条只能在 App 这一层验：它跨了监听、保存、mtime 三处。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "../../../src/core/types";

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

/** 磁盘上那份的 mtime。写入会推进它，「外部程序改了」也靠改它来模拟 */
let diskMtime = 1000;
/** 每一次真的落盘写进去的正文。判断「有没有偷偷保存」用它 */
const written: string[] = [];
/** 监听器推来的那个回调，测试里手动触发 */
let fireChanged: ((paths: string[]) => void) | null = null;

vi.mock("../../../src/host/dialog", () => ({ confirm: async () => true }));

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "甲.md" }),
    openVault: async () => VAULT,
    tree: async () => [doc("甲", "甲.md")],
    listNotes: async () => [{ path: "甲.md", name: "甲" }] as NoteRef[],
    readNote: async () =>
      ({
        path: "甲.md",
        id: null,
        title: "甲",
        frontmatter: {},
        frontmatterText: null,
        body: "正文\n",
        mtimeMs: diskMtime,
      }) as NoteContent,
    // 真实的写入就是这个样子：落盘之后 mtime 变成一个新值，并把它交回前端
    writeNote: async (_path: string, body: string) => {
      written.push(body);
      diskMtime += 1;
      return diskMtime;
    },
    statNote: async () => diskMtime,
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
    propDefSet: async () => {},
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => diskMtime,
    gitStatus: async () => ({
      enabled: false,
      added: 0,
      modified: 0,
      deleted: 0,
      dirty: 0,
      lastMessage: null,
      lastAt: null,
    }),
    gitCommit: async () => null,
    gitHistory: async () => [],
    gitRestoreFile: async () => {},
    workspaceGet: async () => ({ tabs: ["甲.md"], active: 0, pinnedCount: 0 }),
    workspaceSet: async () => {},
    closeNow: async () => null,
    syncRemoteGet: async () => ({ url: null, branch: "main", needsToken: false }),
    syncRemoteSet: async () => ({ url: null, branch: "main", needsToken: false }),
    syncTokenSet: async () => null,
    syncTokenHas: async () => false,
    vaultSync: async () => ({ committed: null, pulled: 0, pushed: 0, conflicts: [] }),
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
  onVaultChanged: async (cb: (paths: string[]) => void) => {
    fireChanged = cb;
    return () => {
      fireChanged = null;
    };
  },
  onAppClosing: async () => () => {},
  onPtyData: async () => () => {},
  onPtyExit: async () => () => {},
  pickVaultFolder: async () => null,
  pickCloneFolder: async () => null,
  pickImageSavePath: async () => null,
}));

const { default: App } = await import("../../../src/app/App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  diskMtime = 1000;
  written.length = 0;
  fireChanged = null;
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

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

const banner = () => document.querySelector(".banner");

/** 往正文里敲一句，把缓冲区弄脏 —— 横幅只在有未保存改动时才该出现 */
async function type(text: string) {
  await act(async () => {
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    content.focus();
    document.execCommand("insertText", false, text);
    await settle(120);
  });
}

/** 让监听器推一次「甲.md 变了」，并等前端把 mtime 问回来 */
async function notifyChanged() {
  await act(async () => {
    fireChanged?.(["甲.md"]);
    await settle(200);
  });
}

describe("外部修改提示", () => {
  it("磁盘上那份没变时不报 —— 我们自己写的那一次也会让监听器响", async () => {
    await mount();
    expect(banner()).toBeNull();
    await notifyChanged();
    expect(banner(), "mtime 没变却报了外部修改").toBeNull();
  });

  /**
   * §2.7 的另一半：**没有未保存改动就直接重载**，不打扰。
   *
   * 以前这里一律弹横幅，而屏幕上仍是旧正文 —— 用户多半没注意那行细字，
   * 接着打字，下一次保存就把外面写进来的整篇盖掉了。
   */
  it("没有未保存改动时静默重载，不弹横幅", async () => {
    await mount();
    diskMtime = 9999; // 别的程序改了这篇
    await notifyChanged();
    expect(banner(), "干净的缓冲区不该拿横幅打扰人").toBeNull();
  });

  it("有未保存改动时才报，让用户自己选", async () => {
    await mount();
    await type("新写的");
    diskMtime = 9999; // 别的程序也改了这篇
    await notifyChanged();
    expect(banner()).not.toBeNull();
    expect(banner()?.textContent).toContain("文件已被外部程序修改");
  });

  /**
   * 横幅上「保留我的 / 加载外部」是要用户选的，而自动保存最多 800ms 就到。
   * 不让开的话用户根本来不及点，一次自动保存就把外面写进来的东西整篇盖掉。
   */
  it("横幅挂着的时候，自动保存不许把外面那份盖掉", async () => {
    await mount();
    await type("新写的");
    diskMtime = 9999;
    await notifyChanged();
    expect(banner()).not.toBeNull();

    const before = written.length;
    // 自动保存的窗口是 800ms，等得比它久
    await act(async () => {
      await settle(1400);
    });
    expect(written.length, "横幅还挂着，自动保存却已经写下去了").toBe(before);
    expect(banner(), "没人选之前横幅要一直在").not.toBeNull();
  });

  /**
   * 这条是这个文件存在的理由。
   *
   * 「保留我的」= 保存，而保存必然让监听器再响一次。不比 mtime 的话
   * 提示会立刻回来 —— 用户看到的是「这个提示点不掉」
   */
  it("按「保留我的」之后提示要真的消失，不能立刻回来", async () => {
    await mount();
    await type("新写的");
    diskMtime = 9999;
    await notifyChanged();
    expect(banner()).not.toBeNull();

    const keep = [...document.querySelectorAll<HTMLButtonElement>(".banner button")].find((b) =>
      b.textContent?.includes("保留我的"),
    )!;
    await act(async () => {
      keep.click();
      await settle(200);
    });
    expect(banner(), "保存之后提示应当消失").toBeNull();

    // 保存自己触发的那一次监听
    await notifyChanged();
    expect(banner(), "自己的保存把提示又招回来了").toBeNull();
  });

  it("改的是别的笔记时不打扰当前这篇", async () => {
    await mount();
    diskMtime = 9999;
    await act(async () => {
      fireChanged?.(["乙.md"]);
      await settle(200);
    });
    expect(banner()).toBeNull();
  });
});
