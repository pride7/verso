/**
 * 状态栏上的版本记录点。DESIGN.md §2.8
 *
 * 提交本身在 Rust 那边测（`vault/git.rs` 的 commit_tests，用真仓库跑）。
 * 这一层只验界面这半边：必要时先冲盘、外部改动不能被旧正文覆盖、
 * 没有改动时不该能点、
 * 以及 §2.8 那条「对用户隐藏 git」—— 状态栏上不许出现 commit/branch 字样。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConflictFile, FileDiff, NoteContent, NoteRef, Suggestion, TreeNode, VaultInfo } from "./types";

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
/** 打开着的那篇在磁盘上的样子。同步拉取会改它 —— 测「自动换成磁盘版」用 */
let noteMtime = 0;
let noteBody = "正文\n";
/** 假装在手机上 —— 后台恢复扫描只在移动端跑 */
let mobileFlag = false;
const rebuildIndex = vi.fn(async () => ({}));
/** 调用顺序 —— 「先保存再提交」全靠它验 */
const calls: string[] = [];

const NOW_S = Math.floor(Date.now() / 1000);
const HISTORY = [
  {
    id: "aaa",
    message: "更新「甲」",
    detail: "整理 AI 改写后的论证。\n\n更新  甲.md\nCo-Authored-By: Claude <noreply@anthropic.com>",
    authorName: "pride7",
    authorEmail: "pride7@example.com",
    at: NOW_S - 120,
    files: [{ path: "甲.md", kind: "modified" as const }],
    additions: 12,
    deletions: 3,
  },
  {
    id: "bbb",
    message: "新增「甲」「乙」",
    detail: "新增  甲.md\n新增  乙.md",
    authorName: "Verso",
    authorEmail: "verso@localhost",
    at: NOW_S - 7200,
    files: [
      { path: "甲.md", kind: "added" as const },
      { path: "乙.md", kind: "added" as const },
    ],
    additions: 8,
    deletions: 0,
  },
];
const LONG_LINE =
  "这是一段由 AI 改写的很长文字，需要始终留在各自的对比栏里。".repeat(18) +
  "an_unusually_long_identifier_that_must_also_wrap_without_horizontal_scrolling";
const gitRestore = vi.fn(async (_commit: string, _path: string) => {});
const gitDiscard = vi.fn(async (_path: string) => {
  dirty = 0;
});
const gitDiffFile = vi.fn(async (path: string, _commit?: string) => ({
  path,
  kind: "modified" as const,
  additions: 1,
  deletions: 1,
  binary: false,
  hunks: [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        { kind: "context" as const, oldLine: 1, newLine: 1, text: "标题" },
        {
          kind: "deleted" as const,
          oldLine: 2,
          newLine: null,
          text: `AI 修改前：${LONG_LINE}`,
        },
        {
          kind: "added" as const,
          oldLine: null,
          newLine: 2,
          text: `AI 修改后：${LONG_LINE}`,
        },
        { kind: "context" as const, oldLine: 3, newLine: 3, text: "结尾" },
      ],
    },
  ],
}));

/** 后端拦下关窗之后发来的那个事件，测试里手动触发 */
let fireClosing: (() => void) | null = null;
/** 文件监听事件；自动记录的空闲窗口要靠它重新计时 */
let fireVaultChanged: ((paths: string[]) => void) | null = null;
const closeNow = vi.fn(async () => {
  calls.push("close");
  return null;
});
/** 每条测试自己覆盖，`getSettings` 读它 */
let settingsPatch: Record<string, unknown> = {};

/** 配的远端。每条测试自己定 */
let remoteUrl: string | null = "https://example.com/notes.git";
let recentShared = false;
let pendingSuggestions: Suggestion[] = [];
const reviewSuggestionSubmit = vi.fn(async (title: string): Promise<Suggestion> => {
  dirty = 0;
  return {
    id: "suggestion-1",
    title,
    authorName: "pride7",
    authorEmail: "pride7@example.com",
    at: NOW_S,
    files: [{ path: "甲.md", previousPath: null, kind: "modified" }],
    additions: 1,
    deletions: 1,
  };
});
const reviewSuggestionList = vi.fn(async () => pendingSuggestions);
const reviewSuggestionDiff = vi.fn((id: string, path: string) => gitDiffFile(path, id));
const reviewSuggestionResolve = vi.fn(async (_id: string, _accepted: string[], _resolutions: unknown[]) => ({
  done: true,
  conflicts: [],
  warning: null,
}));
const vaultSync = vi.fn(async () => ({
  committed: null,
  pulled: 2,
  pushed: 1,
  conflicts: [] as ConflictFile[],
}));
const vaultSyncResolve = vi.fn(async (_resolutions: unknown) => ({
  committed: null,
  pulled: 1,
  pushed: 1,
  conflicts: [],
}));
/** 冲突面板对比本地↔远端用。固定一段「第一行两边不同」的 diff */
const textDiff = vi.fn(async (path: string, _old: string, _next: string): Promise<FileDiff> => ({
  path,
  kind: "modified" as const,
  additions: 1,
  deletions: 1,
  binary: false,
  hunks: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { kind: "deleted" as const, oldLine: 1, newLine: null, text: "本地的第一行" },
        { kind: "added" as const, oldLine: null, newLine: 1, text: "远端的第一行" },
      ],
    },
  ],
}));
const tokenSet = vi.fn(async (_url: string, _token: string) => null);

const gitCommit = vi.fn(async (_message?: string) => {
  calls.push("commit");
  dirty = 0;
  return { id: "abc", message: "更新「甲」", files: 1 };
});

/**
 * 确认框走 `lib/dialog` 而不是 `window.confirm` —— 见 `noGlobalDialog.test.ts`。
 * 这里必须 mock：真的那个要发 Tauri IPC，浏览器里没有。
 */
const confirmMock = vi.fn(async (_message: string) => true);
vi.mock("./lib/dialog", () => ({ confirm: (m: string) => confirmMock(m) }));

vi.mock("./api", () => ({
  api: {
    isMobile: async () => mobileFlag,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "甲.md" }),
    recentVaults: async () => [{ root: VAULT.root, name: VAULT.name, available: true, shared: recentShared }],
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
        body: noteBody,
        mtimeMs: noteMtime,
      }) as NoteContent,
    writeNote: async () => {
      calls.push("save");
      return 0;
    },
    statNote: async () => noteMtime,
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
    gitHistory: async () => HISTORY,
    gitWorkingChanges: async () =>
      dirty > 0 ? [{ path: "甲.md", kind: "modified" as const }] : [],
    gitDiffFile: (path: string, commit?: string) => gitDiffFile(path, commit),
    gitDiscardFile: (path: string) => gitDiscard(path),
    gitRestoreFile: (commit: string, path: string) => gitRestore(commit, path),
    gitIdentityGet: async () => ({ name: "Verso", email: "verso@localhost" }),
    workspaceGet: async () => ({ tabs: ["甲.md"], active: 0, pinnedCount: 0 }),
    workspaceSet: async () => {},
    closeNow: () => closeNow(),
    syncRemoteGet: async () => ({
      url: remoteUrl,
      branch: "main",
      needsToken: !!remoteUrl?.startsWith("https"),
    }),
    syncRemoteSet: async (url: string) => {
      remoteUrl = url || null;
      return { url: remoteUrl, branch: "main", needsToken: !!remoteUrl?.startsWith("https") };
    },
    syncTokenSet: (url: string, token: string) => tokenSet(url, token),
    syncTokenHas: async () => false,
    vaultSync: () => vaultSync(),
    vaultSyncResolve: (resolutions: unknown) => vaultSyncResolve(resolutions),
    reviewSuggestionSubmit: (title: string) => reviewSuggestionSubmit(title),
    reviewSuggestionList: () => reviewSuggestionList(),
    reviewSuggestionDiff: (id: string, path: string) => reviewSuggestionDiff(id, path),
    reviewSuggestionResolve: (id: string, accepted: string[], resolutions: unknown[]) =>
      reviewSuggestionResolve(id, accepted, resolutions),
    textDiff: (path: string, old: string, next: string) => textDiff(path, old, next),
    getSettings: async () => settingsPatch,
    setSettings: async (s: unknown) => s,
    openTerminal: async () => {},
    rebuildIndex: () => rebuildIndex(),
    ptyOpen: async () => "1",
    ptyWrite: async () => {},
    ptyResize: async () => {},
    ptyClose: async () => {},
  },
  onBackendNotice: async () => () => {},
  onVaultChanged: async (cb: (paths: string[]) => void) => {
    fireVaultChanged = cb;
    return () => {
      fireVaultChanged = null;
    };
  },
  onAppClosing: async (cb: () => void) => {
    fireClosing = cb;
    return () => {
      fireClosing = null;
    };
  },
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
  dirty = 0;
  noteMtime = 0;
  noteBody = "正文\n";
  mobileFlag = false;
  rebuildIndex.mockClear();
  calls.length = 0;
  gitCommit.mockClear();
  gitRestore.mockClear();
  gitDiscard.mockClear();
  gitDiffFile.mockClear();
  closeNow.mockClear();
  settingsPatch = {};
  remoteUrl = "https://example.com/notes.git";
  recentShared = false;
  pendingSuggestions = [];
  vaultSync.mockClear();
  vaultSyncResolve.mockClear();
  reviewSuggestionSubmit.mockClear();
  reviewSuggestionList.mockClear();
  reviewSuggestionDiff.mockClear();
  reviewSuggestionResolve.mockClear();
  textDiff.mockClear();
  tokenSet.mockClear();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
});

afterEach(async () => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  await page.viewport(1440, 900);
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

  it("编辑器没有未保存内容时直接提交，不重写外部 AI 改过的文件", async () => {
    dirty = 1;
    await mount();
    await act(async () => {
      point()!.click();
      await settle(400);
    });

    expect(gitCommit).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain("save");
    expect(calls).toContain("commit");
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

describe("侧栏里的动态", () => {
  async function openPanel() {
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="动态"]')!.click();
      await settle(300);
    });
  }

  it("列出每一版，新的在前，时间是人话", async () => {
    await mount();
    await openPanel();

    const rows = [...document.querySelectorAll<HTMLElement>(".hist-msg")].map((e) => e.textContent);
    expect(rows).toEqual(["更新「甲」", "新增「甲」「乙」"]);
    // 只验「接上了」。**具体怎么措辞由 `lib/relTime.test.ts` 钉**（那边的
    // now 是注入的，怎么跑都一样）—— 在这里写死「2 小时前」的话，
    // 半夜跑测试会变成「昨天 23:50」，而那正是它该有的行为
    const when = [...document.querySelectorAll<HTMLElement>(".hist-when")].map((e) => e.textContent);
    expect(when[0]).toBe("2 分钟前");
    expect(when[1]).toBeTruthy();
    expect(when[1]).not.toBe(when[0]);
  });

  it("展开看动了哪几篇", async () => {
    await mount();
    await openPanel();
    await act(async () => {
      document.querySelectorAll<HTMLElement>(".hist-head")[1].click();
      await settle(150);
    });

    const files = [...document.querySelectorAll<HTMLElement>(".hist-path")].map((e) => e.textContent);
    expect(files).toEqual(["甲", "乙"]);
    expect(document.querySelector(".hist-kind")?.textContent).toBe("新增");
    const entry = document.querySelector<HTMLElement>(".hist > li")!;
    const node = document.querySelector<HTMLElement>(".hist-head")!;
    const branch = document.querySelector<HTMLElement>(".hist > li > .hist-files")!;
    expect(getComputedStyle(node).fontSize).toBe("12px");
    expect(getComputedStyle(entry, "::before").width).toBe("1px");
    expect(getComputedStyle(node, "::before").borderRadius).toBe("50%");
    expect(getComputedStyle(branch, "::before").borderLeftWidth).toBe("1px");
    // 时间线圆点就是这一条活动的锚点；不要再插一个只为展开而存在的箭头。
    expect(node.querySelector(".hist-caret")).toBeNull();
  });

  it("当前改动可以确认后撤销，取消时不动文件", async () => {
    dirty = 1;
    await mount();
    await openPanel();

    confirmMock.mockResolvedValue(false);
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".hist-discard")!.click();
      await settle(120);
    });
    expect(gitDiscard).not.toHaveBeenCalled();

    confirmMock.mockResolvedValue(true);
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".hist-discard")!.click();
      await settle(300);
    });
    expect(gitDiscard).toHaveBeenCalledWith("甲.md");
  });

  it("分界线可用键盘调整，也能复位为按内容适应", async () => {
    dirty = 1;
    await mount();
    await openPanel();
    const divider = document.querySelector<HTMLElement>(".hist-divider")!;

    await act(async () => {
      divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await settle(50);
    });
    expect(document.querySelector(".history-view")?.classList.contains("is-resized")).toBe(true);
    expect(localStorage.getItem("verso.historyWorkingHeight")).toBeTruthy();

    await act(async () => {
      divider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      await settle(50);
    });
    expect(document.querySelector(".history-view")?.classList.contains("is-resized")).toBe(false);
    expect(localStorage.getItem("verso.historyWorkingHeight")).toBeNull();
  });

  it("悬停版本节点显示完整说明、作者、准确时间和改动统计", async () => {
    await mount();
    await openPanel();
    const head = document.querySelector<HTMLElement>(".hist-head")!;
    await act(async () => {
      head.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await settle(320);
    });

    const card = document.querySelector<HTMLElement>(".hist-popover")!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("pride7");
    expect(card.textContent).toContain("pride7@example.com");
    expect(card.textContent).toContain("整理 AI 改写后的论证");
    expect(card.textContent).toContain("12 行插入（+）");
    expect(card.textContent).toContain("3 行删除（−）");
    expect(card.textContent).toMatch(/\d{4}年\d+月\d+日 \d{2}:\d{2}/);

    const side = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    expect(getComputedStyle(card).position).toBe("fixed");
    expect(box.left).toBeGreaterThanOrEqual(side.right);
    expect(box.right).toBeLessThanOrEqual(window.innerWidth + 0.5);
  });

  it("当前改动直接列在顶部，点文件就在正文区打开对比", async () => {
    dirty = 1;
    await mount();
    await openPanel();

    expect(document.querySelector("#working-title")?.textContent).toBe("当前改动");
    expect(document.querySelector(".hist-working .hist-path")?.textContent).toBe("甲");
    await act(async () => {
      document.querySelector<HTMLElement>(".hist-working .hist-file")!.click();
      await settle(250);
    });

    expect(gitDiffFile).toHaveBeenCalledWith("甲.md", undefined);
    expect(document.querySelector(".diff-context")?.textContent).toBe("当前改动");
    expect(document.querySelector(".diff-view")?.textContent).toContain("AI 修改前");
    expect(document.querySelector(".diff-view")?.textContent).toContain("AI 修改后");
  });

  it("历史文件比较这一版与上一版，左右两栏同宽且改动行对齐", async () => {
    await mount();
    await openPanel();
    await act(async () => {
      document.querySelectorAll<HTMLElement>(".hist-head")[0].click();
      await settle(100);
      document.querySelector<HTMLElement>(".hist > li .hist-file")!.click();
      await settle(250);
    });

    expect(gitDiffFile).toHaveBeenCalledWith("甲.md", "aaa");
    expect(document.querySelector(".diff-context")?.textContent).toBe("更新「甲」");
    const row = document.querySelectorAll<HTMLElement>(".diff-split-row")[1];
    const [left, right] = [...row.children] as HTMLElement[];
    const l = left.getBoundingClientRect();
    const r = right.getBoundingClientRect();
    expect(l.width).toBeGreaterThan(250);
    expect(Math.abs(l.width - r.width)).toBeLessThan(1);
    expect(Math.abs(l.top - r.top)).toBeLessThan(1);
    expect(l.height).toBeGreaterThan(40);
    const body = document.querySelector<HTMLElement>(".diff-body")!;
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
  });

  it("关掉对比回到原笔记，不增删标签", async () => {
    dirty = 1;
    await mount();
    await openPanel();
    const before = document.querySelectorAll(".tab").length;
    await act(async () => {
      document.querySelector<HTMLElement>(".hist-working .hist-file")!.click();
      await settle(200);
      document.querySelector<HTMLElement>(".diff-close")!.click();
      await settle(200);
    });

    expect(document.querySelector(".diff-view")).toBeNull();
    expect(document.querySelector(".editor")).toBeTruthy();
    expect(document.querySelectorAll(".tab").length).toBe(before);
  });

  it("窄屏改成单列差异，不把左右两栏硬塞进手机", async () => {
    dirty = 1;
    await page.viewport(390, 844);
    await mount();
    await openPanel();
    await act(async () => {
      document.querySelector<HTMLElement>(".hist-working .hist-file")!.click();
      await settle(250);
    });

    expect(getComputedStyle(document.querySelector<HTMLElement>(".diff-split")!).display).toBe(
      "none",
    );
    expect(getComputedStyle(document.querySelector<HTMLElement>(".diff-unified")!).display).toBe(
      "block",
    );
    const main = document.querySelector<HTMLElement>(".main")!.getBoundingClientRect();
    const view = document.querySelector<HTMLElement>(".diff-view")!.getBoundingClientRect();
    expect(view.left).toBeGreaterThanOrEqual(main.left - 0.5);
    const body = document.querySelector<HTMLElement>(".diff-body")!;
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
  });

  /**
   * 回退会覆盖当前正文 —— 后端在覆盖前会先把现状记一个版本（所以丢不了），
   * 但那是「事后能找回来」，不是「本来就没事」。这种事得由人点头。
   */
  it("回退前先问一句，点取消就什么都不做", async () => {
    await mount();
    await openPanel();
    await act(async () => {
      document.querySelectorAll<HTMLElement>(".hist-head")[0].click();
      await settle(150);
    });

    confirmMock.mockResolvedValue(false);
    await act(async () => {
      document.querySelector<HTMLElement>(".hist-restore")!.click();
      await settle(200);
    });
    expect(gitRestore).not.toHaveBeenCalled();

    confirmMock.mockResolvedValue(true);
    await act(async () => {
      document.querySelector<HTMLElement>(".hist-restore")!.click();
      await settle(300);
    });
    expect(gitRestore).toHaveBeenCalledWith("aaa", "甲.md");
  });
});

describe("自动记录的空闲窗口", () => {
  it("同一文件再次被外部写入会重新计时", async () => {
    vi.useFakeTimers();
    settingsPatch = { autoCommitIdleMin: 1 };
    try {
      const mounting = mount();
      await vi.advanceTimersByTimeAsync(700);
      await mounting;

      dirty = 1;
      await act(async () => {
        fireVaultChanged?.(["甲.md"]);
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40_000);
        fireVaultChanged?.(["甲.md"]);
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(gitCommit, "第二次写入后还没空闲一分钟，不该记录").not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(gitCommit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("查看当前差异时暂停，关闭后再计完整一分钟", async () => {
    vi.useFakeTimers();
    dirty = 1;
    settingsPatch = { autoCommitIdleMin: 1 };
    try {
      const mounting = mount();
      await vi.advanceTimersByTimeAsync(700);
      await mounting;
      await act(async () => {
        document.querySelector<HTMLElement>('.rail-btn[aria-label="动态"]')!.click();
        await vi.advanceTimersByTimeAsync(400);
      });
      await act(async () => {
        document.querySelector<HTMLElement>(".hist-working .hist-file")!.click();
        await vi.advanceTimersByTimeAsync(400);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(70_000);
      });
      expect(gitCommit, "差异仍开着时不该把当前改动自动挪进历史").not.toHaveBeenCalled();

      await act(async () => {
        document.querySelector<HTMLButtonElement>(".diff-close")!.click();
        await vi.advanceTimersByTimeAsync(59_000);
      });
      expect(gitCommit).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(gitCommit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("关窗之前", () => {
  /** 触发 Rust 那边的 `app:closing`，并等收尾跑完 */
  async function close() {
    await act(async () => {
      fireClosing?.();
      await settle(300);
    });
  }

  it("先记一个版本，再放行关窗", async () => {
    dirty = 2;
    await mount();
    calls.length = 0;
    await close();

    expect(gitCommit).toHaveBeenCalled();
    expect(closeNow).toHaveBeenCalled();
    // 顺序反了的话，提交会被销毁的窗口切断
    expect(calls.indexOf("commit")).toBeLessThan(calls.indexOf("close"));
  });

  it("关掉这一档就只放行，不记版本", async () => {
    dirty = 2;
    settingsPatch = { autoCommitOnClose: false };
    await mount();
    calls.length = 0;
    await close();

    expect(gitCommit).not.toHaveBeenCalled();
    expect(closeNow).toHaveBeenCalled();
  });

  /**
   * **收尾失败也必须放行。** 漏掉 `closeNow` 的话，用户看到的是「点 X 没反应」
   * —— Rust 那边虽然有 5 秒兜底，但干等 5 秒和坏掉没区别。
   */
  it("提交失败也照样关得掉", async () => {
    dirty = 2;
    gitCommit.mockRejectedValueOnce(new Error("仓库上锁了"));
    await mount();
    await close();

    expect(closeNow).toHaveBeenCalled();
  });
});

describe("动态里的多人协作", () => {
  const seenKey = `verso.collaborationSeen:${VAULT.root}`;

  async function openPanel() {
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="动态"]')!.click();
      await settle(300);
    });
  }

  it("首次启用先以当前历史为基线，不把旧记录全标成未读", async () => {
    await mount();
    const button = document.querySelector<HTMLElement>('.rail-btn[aria-label="动态"]')!;
    expect(button).toBeTruthy();
    expect(button.querySelector(".rail-badge")).toBeNull();
    expect(JSON.parse(localStorage.getItem(seenKey)!)).toEqual(["aaa", "bbb"]);
  });

  it("提示其他人的新修改，打开后可筛选并查看差异", async () => {
    localStorage.setItem(seenKey, JSON.stringify(["bbb"]));
    await mount();

    const button = document.querySelector<HTMLElement>('.rail-btn[aria-label="动态"]')!;
    expect(button.querySelector(".rail-badge")?.textContent).toBe("1");
    await openPanel();

    expect(document.querySelector(".collab-new")?.textContent).toBe("新");
    expect([...document.querySelectorAll(".hist-author")].map((e) => e.textContent)).toEqual([
      "pride7",
      "你",
    ]);
    expect(button.querySelector(".rail-badge")).toBeNull();

    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(".collab-filter button")]
        .find((item) => item.textContent === "其他人")!
        .click();
      await settle(80);
    });
    expect(document.querySelectorAll(".hist > li")).toHaveLength(1);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".hist-head")!.click();
      await settle(60);
      document.querySelector<HTMLButtonElement>(".hist > li .hist-file")!.click();
      await settle(250);
    });
    expect(gitDiffFile).toHaveBeenCalledWith("甲.md", "aaa");
    expect(document.querySelector(".diff-view")?.textContent).toContain("AI 修改后");
  });

  it("共享空间把待审阅建议放在动态顶部，并能打开审阅", async () => {
    recentShared = true;
    pendingSuggestions = [{
      id: "suggestion-1",
      title: "补充实验结论",
      authorName: "林",
      authorEmail: "lin@example.com",
      at: NOW_S - 60,
      files: [{ path: "甲.md", previousPath: null, kind: "modified" }],
      additions: 4,
      deletions: 1,
    }];
    await mount();
    await openPanel();

    expect(document.querySelector(".review-pending")?.textContent).toContain("补充实验结论");
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".review-pending li > button")!.click();
      await settle(180);
    });
    expect(document.querySelector(".review-modal")?.textContent).toContain("补充实验结论");
    expect(reviewSuggestionDiff).toHaveBeenCalledWith("suggestion-1", "甲.md");
  });
});

describe("修改建议", () => {
  it("只在共享空间出现，提交成功后回到正式版本并明确提示", async () => {
    recentShared = true;
    dirty = 1;
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("调整论证");
    await mount();
    const button = [...document.querySelectorAll<HTMLButtonElement>(".status-git")]
      .find((item) => item.textContent?.includes("提交建议"));
    expect(button).toBeTruthy();

    await act(async () => {
      button!.click();
      await settle(400);
    });
    expect(reviewSuggestionSubmit).toHaveBeenCalledWith("调整论证");
    expect(document.querySelector(".status-notice")?.textContent).toContain("已回到正式版本");
    prompt.mockRestore();
  });

  it("私人空间即使有远端也不显示审阅入口", async () => {
    recentShared = false;
    await mount();
    const button = [...document.querySelectorAll<HTMLButtonElement>(".status-git")]
      .find((item) => item.textContent?.includes("提交建议"));
    expect(button).toBeFalsy();
  });
});

describe("同步", () => {
  const syncBtn = () =>
    [...document.querySelectorAll<HTMLButtonElement>(".status-git")].find((b) =>
      b.textContent?.includes("同步"),
    );

  it("配了远端才有那个按钮", async () => {
    await mount();
    expect(syncBtn()).toBeTruthy();

    root?.unmount();
    root = null;
    document.body.innerHTML = "";
    remoteUrl = null;
    await mount();
    expect(syncBtn(), "没配远端时不该出现一个永远点不动的按钮").toBeFalsy();
  });

  it("点一下就同步，完事报一句话", async () => {
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });

    expect(vaultSync).toHaveBeenCalled();
    expect(document.querySelector(".status-notice")?.textContent).toBe(
      "拿到 2 个版本，传出 1 个版本",
    );
  });

  it("没什么可同步的时候也说一声", async () => {
    vaultSync.mockResolvedValueOnce({ committed: null, pulled: 0, pushed: 0, conflicts: [] });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });
    expect(document.querySelector(".status-notice")?.textContent).toBe("已经是最新的");
  });

  /**
   * 冲突弹解决面板（§2.8 ConflictView），不再是一句让人自己想办法的报错。
   * 这条走完整回路：弹出 → 逐段选边 → 提交的定稿是「本地全文里那一段
   * 换成远端」→ 面板关掉
   */
  it("冲突弹出解决面板，选完边提交正确的定稿", async () => {
    vaultSync.mockResolvedValueOnce({
      committed: null,
      pulled: 0,
      pushed: 0,
      conflicts: [
        {
          path: "数学/线性代数.md",
          base: null,
          local: "本地的第一行\n共同的第二行",
          remote: "远端的第一行\n共同的第二行",
        },
      ],
    });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });

    const modal = document.querySelector(".conflict-modal");
    expect(modal, "冲突要弹面板").toBeTruthy();
    expect(modal!.textContent).toContain("线性代数");
    expect(document.querySelector(".status-notice"), "冲突不该同时报一句好消息").toBeFalsy();

    // 没选完之前提交按钮点不动 —— 不做默认选择，不自作主张
    const submitBtn = () => document.querySelector<HTMLButtonElement>(".conflict-submit")!;
    expect(submitBtn().disabled).toBe(true);

    // 点「远端」那一栏
    await act(async () => {
      const panes = [...document.querySelectorAll<HTMLButtonElement>(".conflict-pane")];
      expect(panes.length).toBe(2);
      panes[1].click();
      await settle(100);
    });
    expect(submitBtn().disabled).toBe(false);

    await act(async () => {
      submitBtn().click();
      await settle(400);
    });

    // 定稿 = 本地全文里被选中的那一段换成远端的行
    expect(vaultSyncResolve).toHaveBeenCalledWith([
      { path: "数学/线性代数.md", content: "远端的第一行\n共同的第二行" },
    ]);
    expect(document.querySelector(".conflict-modal"), "解决完面板要关掉").toBeFalsy();
  });

  it("整篇二选一：远端删了这篇时不画 diff，选「接受删除」提交 null", async () => {
    vaultSync.mockResolvedValueOnce({
      committed: null,
      pulled: 0,
      pushed: 0,
      conflicts: [{ path: "乙.md", base: "删除前", local: "本地还改过", remote: null }],
    });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });

    const quick = [...document.querySelectorAll<HTMLButtonElement>(".conflict-quick button")];
    const accept = quick.find((b) => b.textContent?.includes("接受删除"))!;
    expect(document.querySelector(".conflict-kind")?.textContent).toContain("删除与修改");
    expect(document.querySelector(".conflict-delete-warning")?.textContent).toContain("不会自动删除");
    expect(document.querySelector<HTMLButtonElement>(".conflict-submit")!.disabled).toBe(true);
    await act(async () => {
      accept.click();
      await settle(100);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".conflict-submit")!.click();
      await settle(400);
    });
    expect(vaultSyncResolve).toHaveBeenCalledWith([{ path: "乙.md", content: null }]);
  });

  it("frontmatter 不同属性自动合并，同一正文不要求重复确认", async () => {
    const base = "---\n状态: 草稿\n评分: 1\n---\n正文\n";
    vaultSync.mockResolvedValueOnce({
      committed: null,
      pulled: 0,
      pushed: 0,
      conflicts: [{
        path: "实验.md",
        base,
        local: base.replace("状态: 草稿", "状态: 完成"),
        remote: base.replace("评分: 1", "评分: 5"),
      }],
    });
    textDiff.mockResolvedValueOnce({
      path: "实验.md", kind: "modified", additions: 0, deletions: 0, binary: false, hunks: [],
    });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });

    expect(document.querySelectorAll(".conflict-property").length).toBe(0);
    expect(vaultSyncResolve).toHaveBeenCalledWith([{
      path: "实验.md",
      content: "---\n状态: 完成\n评分: 5\n---\n正文\n",
    }]);
    expect(document.querySelector(".conflict-modal"), "确定答案应自动完成，不留空面板").toBeNull();
  });

  it("同一属性冲突可两边保留，生成第二个可见属性而不是重复 YAML 键", async () => {
    const base = "---\n状态: 草稿\n---\n正文\n";
    vaultSync.mockResolvedValueOnce({
      committed: null,
      pulled: 0,
      pushed: 0,
      conflicts: [{
        path: "实验.md",
        base,
        local: base.replace("状态: 草稿", "状态: 本地完成"),
        remote: base.replace("状态: 草稿", "状态: 远端完成"),
      }],
    });
    textDiff.mockResolvedValueOnce({
      path: "实验.md", kind: "modified", additions: 0, deletions: 0, binary: false, hunks: [],
    });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });

    expect(document.querySelector(".conflict-kind")?.textContent).toContain("语义冲突");
    const options = [...document.querySelectorAll<HTMLButtonElement>(".conflict-property-options button")];
    expect(options.length).toBe(3);
    await act(async () => {
      options[2].click();
      await settle(80);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".conflict-submit")!.click();
      await settle(400);
    });
    expect(vaultSyncResolve).toHaveBeenCalledWith([{
      path: "实验.md",
      content: "---\n状态: 本地完成\n状态（远端）: 远端完成\n---\n正文\n",
    }]);
  });

  it("正文重叠段落支持两边都保留，公共上下文只出现一次", async () => {
    vaultSync.mockResolvedValueOnce({
      committed: null,
      pulled: 0,
      pushed: 0,
      conflicts: [{
        path: "正文.md",
        base: "共同开头\n原文\n共同结尾",
        local: "共同开头\n本地段落\n共同结尾",
        remote: "共同开头\n远端段落\n共同结尾",
      }],
    });
    textDiff.mockResolvedValueOnce({
      path: "正文.md", kind: "modified", additions: 1, deletions: 1, binary: false,
      hunks: [{
        oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
        lines: [
          { kind: "context", oldLine: 1, newLine: 1, text: "共同开头" },
          { kind: "deleted", oldLine: 2, newLine: null, text: "本地段落" },
          { kind: "added", oldLine: null, newLine: 2, text: "远端段落" },
          { kind: "context", oldLine: 3, newLine: 3, text: "共同结尾" },
        ],
      }],
    });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".conflict-both")!.click();
      await settle(80);
      document.querySelector<HTMLButtonElement>(".conflict-submit")!.click();
      await settle(400);
    });
    expect(vaultSyncResolve).toHaveBeenCalledWith([{
      path: "正文.md",
      content: "共同开头\n本地段落\n远端段落\n共同结尾",
    }]);
  });

  /**
   * 同步拉下来的改动要**直接换进**打开着的笔记。不换的话，文件监听会
   * 紧跟着弹「文件已被外部程序修改」—— 拉哪边用户刚决定过，再问一次
   * 是重复；更糟的是横幅上的「保留我的」会把刚被否掉的旧内容存回去，
   * 一轮冲突解决等于白做（作者真机实测撞上的）
   */
  it("拉取改了打开的笔记时直接换成磁盘版，不弹外部修改横幅", async () => {
    vaultSync.mockImplementationOnce(async () => {
      // 拉取改写了磁盘上的这篇
      noteMtime = 5;
      noteBody = "手机上写的新内容\n";
      return { committed: null, pulled: 1, pushed: 0, conflicts: [] };
    });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });

    expect(document.querySelector(".cm-content")?.textContent).toContain("手机上写的新内容");

    // 拉取产生的文件监听事件随后才到 —— mtime 已对上，不该再弹横幅
    await act(async () => {
      fireVaultChanged?.(["甲.md"]);
      await settle(200);
    });
    expect(document.body.textContent).not.toContain("文件已被外部程序修改");
  });

  it("同步失败把后端那句话原样显示出来", async () => {
    vaultSync.mockRejectedValueOnce(new Error("认证失败：远端不接受这个令牌"));
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });
    expect(document.querySelector(".error")?.textContent).toContain("认证失败");
  });

  it("正在同步时按钮点不动 —— 两次同步撞在一起会把仓库搅乱", async () => {
    let release: (() => void) | null = null;
    vaultSync.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r({ committed: null, pulled: 0, pushed: 0, conflicts: [] });
        }),
    );
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(150);
    });
    expect(syncBtn()!.disabled).toBe(true);
    expect(syncBtn()!.textContent).toContain("同步中");

    await act(async () => {
      syncBtn()!.click();
      release?.();
      await settle(300);
    });
    expect(vaultSync).toHaveBeenCalledTimes(1);
  });
});

/**
 * §2.7 移动端补充：后台恢复时的全量刷新。iOS 后台收不到文件事件、安卓
 * FUSE 上的监听不可靠 —— 后台里另一台设备推了新内容，恢复时必须主动对账。
 */
describe("后台恢复（移动端）", () => {
  it("回到前台：重建索引，并发现打开的笔记被外面改过", async () => {
    mobileFlag = true;
    await mount();
    rebuildIndex.mockClear();

    // 后台期间另一台设备同步了新内容
    noteMtime = 9;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle(300);
    });

    expect(rebuildIndex).toHaveBeenCalled();
    expect(document.body.textContent).toContain("文件已被外部程序修改");
  });

  it("桌面不走这条 —— 聚焦那条路已经覆盖，别重复全量重建", async () => {
    await mount();
    rebuildIndex.mockClear();

    noteMtime = 9;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle(300);
    });
    expect(rebuildIndex).not.toHaveBeenCalled();
  });
});
