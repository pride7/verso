/**
 * 状态栏上的版本记录点。DESIGN.md §2.8
 *
 * 提交本身在 Rust 那边测（`vault/git.rs` 的 commit_tests，用真仓库跑）。
 * 这一层只验界面这半边：**先冲盘再提交**、没有改动时不该能点、
 * 以及 §2.8 那条「对用户隐藏 git」—— 状态栏上不许出现 commit/branch 字样。
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

/** 后端说现在有几个改动。每条测试自己定 */
let dirty = 0;
/** 调用顺序 —— 「先保存再提交」全靠它验 */
const calls: string[] = [];

const gitCommit = vi.fn(async (_message?: string) => {
  calls.push("commit");
  dirty = 0;
  return { id: "abc", message: "更新「甲」", files: 1 };
});

vi.mock("./api", () => ({
  api: {
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
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async () => {
      calls.push("save");
      return 0;
    },
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
      modified: dirty,
      deleted: 0,
      dirty,
      lastMessage: dirty === 0 ? "更新 1 个" : null,
      lastAt: 1_754_000_000,
    }),
    gitCommit: (message?: string) => gitCommit(message),
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
  dirty = 0;
  calls.length = 0;
  gitCommit.mockClear();
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

const point = () => document.querySelector<HTMLButtonElement>(".status-git");

describe("版本记录点", () => {
  it("干净时显示「已记录」，而且点不动", async () => {
    await mount();
    expect(point()?.textContent).toContain("已记录");
    expect(point()?.disabled).toBe(true);
  });

  it("有改动时显示几个改动", async () => {
    dirty = 3;
    await mount();
    expect(point()?.textContent).toContain("3 个改动");
    expect(point()?.disabled).toBe(false);
  });

  it("点一下**先冲盘再提交** —— 不然记下的是上一版", async () => {
    dirty = 1;
    await mount();
    await act(async () => {
      point()!.click();
      await settle(400);
    });

    expect(gitCommit).toHaveBeenCalledTimes(1);
    expect(calls.indexOf("save")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("save")).toBeLessThan(calls.indexOf("commit"));
    // 提交完状态点自己变回「已记录」，不弹任何提示条
    expect(point()?.textContent).toContain("已记录");
  });

  /**
   * §2.8：**对用户隐藏 git**。界面上只有「有几个改动」和「已记录」，
   * 不出现 commit / branch / push / stage 这些词。
   */
  it("状态栏上不出现 git 的黑话", async () => {
    dirty = 2;
    await mount();
    const text = document.querySelector(".status")!.textContent ?? "";
    for (const word of ["commit", "branch", "push", "stage", "提交历史"]) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  /** 命令面板只列**当前能用**的命令，所以没改动时它压根不出现 */
  it("有改动时命令面板里才有「提交当前改动」", async () => {
    dirty = 1;
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
      await settle(200);
    });
    const labels = [...document.querySelectorAll(".palette-label")].map((b) => b.textContent);
    expect(labels).toContain("记一个版本");
  });

  it("能自己写说明 —— 自动生成的只说动了哪几篇，说不出为什么", async () => {
    dirty = 1;
    await mount();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("整理了一遍");
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
      await settle(200);
    });
    const item = [...document.querySelectorAll<HTMLElement>(".palette-list button")].find(
      (b) => b.querySelector(".palette-label")?.textContent === "记一个版本并写说明…",
    )!;
    await act(async () => {
      item.click();
      await settle(400);
    });

    expect(gitCommit).toHaveBeenCalledWith("整理了一遍");
    prompt.mockRestore();
  });

  it("说明留空就当作没按 —— 不该记下一个空说明的版本", async () => {
    dirty = 1;
    await mount();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("   ");
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
      await settle(200);
    });
    const item = [...document.querySelectorAll<HTMLElement>(".palette-list button")].find(
      (b) => b.querySelector(".palette-label")?.textContent === "记一个版本并写说明…",
    )!;
    await act(async () => {
      item.click();
      await settle(300);
    });

    expect(gitCommit).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("没有改动时那条命令不出现 —— 面板只列当前能用的", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
      await settle(200);
    });
    const labels = [...document.querySelectorAll(".palette-label")].map((b) => b.textContent);
    expect(labels).not.toContain("记一个版本");
  });
});
