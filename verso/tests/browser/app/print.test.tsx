/**
 * 打印取的是**哪一份正文**（§2.12）。
 *
 * 这条只能在 App 这一层验，而且必须有真的编辑器：`note` 是「打开那一刻从磁盘
 * 读进来的那份」，之后每一次改动只进 `body` 状态，连保存都不回写它。曾经打印
 * 直接拿 `note.body` 去排版，于是：
 *
 * - 新建一篇写满再打印 → 一张只有标题的白纸
 * - 打开一篇改半天再打印 → 印出来的是**改之前**的样子
 *
 * 两种都不报错，要等 PDF 发出去才看得见。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "../../../src/core/types";

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "test-vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const doc = (name: string, path: string, children: TreeNode[] = []): TreeNode => ({
  name,
  path,
  kind: "document",
  children,
  childDir: children.length ? name : null,
  order: null,
  created: null,
  updated: null,
});

const TREE: TreeNode[] = [doc("甲", "甲.md", [doc("甲一", "甲/甲一.md")])];

/** 磁盘上那份。测试里只有「打开时读到的」才走它 */
const DISK: Record<string, string> = {
  "甲.md": "打开时的旧正文。\n",
  "甲/甲一.md": "子文档的正文。\n",
};

vi.mock("../../../src/host/dialog", () => ({ confirm: async () => true }));

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "甲.md" }),
    openVault: async () => VAULT,
    tree: async () => TREE,
    listNotes: async () =>
      [
        { path: "甲.md", name: "甲" },
        { path: "甲/甲一.md", name: "甲一" },
      ] as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: null,
        title: path === "甲.md" ? "甲" : "甲一",
        frontmatter: {},
        frontmatterText: null,
        body: DISK[path] ?? "",
        mtimeMs: 1000,
      }) as NoteContent,
    writeNote: async () => 1001,
    statNote: async () => 1000,
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
    writeExport: async () => null,
    writeFrontmatter: async () => 1000,
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
  onVaultChanged: async () => () => {},
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

/** 像真的打字一样改正文 —— 走编辑器自己的那条 `onChange` */
async function retype(text: string) {
  const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    await settle(200);
  });
}

/** `Mod+Alt+P` —— 命令表里 `note.print` 的默认键位 */
async function openPrintDialog() {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyP", ctrlKey: true, altKey: true, bubbles: true }),
    );
    await settle(400);
  });
}

const preview = () => document.querySelector(".print-preview")?.textContent ?? "";

describe("打印取的是编辑器里此刻的正文", () => {
  it("刚改完还没保存也照样印得出来", async () => {
    await mount();
    await retype("改完之后的新正文。\n");
    await openPrintDialog();

    expect(document.querySelector(".print-dialog"), "打印对话框没打开").not.toBeNull();
    expect(preview()).toContain("改完之后的新正文");
    expect(preview(), "印的是打开那一刻的旧内容").not.toContain("打开时的旧正文");
  });

  it("正文清空之后重写，预览不是一张白纸", async () => {
    await mount();
    // 新建笔记后写满是最常见的一种：打开时正文是空的
    await retype("");
    await retype("## 一节\n\n新建之后写进去的内容。\n");
    await openPrintDialog();

    expect(preview()).toContain("新建之后写进去的内容");
  });

  it("子文档仍然从磁盘读 —— 只有打开着的那篇有「此刻」可言", async () => {
    await mount();
    await retype("父文档改过的正文。\n");
    await openPrintDialog();

    const children = [...document.querySelectorAll<HTMLInputElement>(".print-check input")][1];
    expect(children.disabled, "甲.md 下面挂着甲一.md").toBe(false);
    await act(async () => {
      children.click();
      await settle(200);
    });
    expect(preview()).toContain("父文档改过的正文");
    expect(preview()).toContain("子文档的正文");
  });
});
