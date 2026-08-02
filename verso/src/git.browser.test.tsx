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

const NOW_S = Math.floor(Date.now() / 1000);
const HISTORY = [
  {
    id: "aaa",
    message: "更新「甲」",
    at: NOW_S - 120,
    files: [{ path: "甲.md", kind: "modified" as const }],
  },
  {
    id: "bbb",
    message: "新增「甲」「乙」",
    at: NOW_S - 7200,
    files: [
      { path: "甲.md", kind: "added" as const },
      { path: "乙.md", kind: "added" as const },
    ],
  },
];
const gitRestore = vi.fn(async (_commit: string, _path: string) => {});

/** 后端拦下关窗之后发来的那个事件，测试里手动触发 */
let fireClosing: (() => void) | null = null;
const closeNow = vi.fn(async () => {
  calls.push("close");
  return null;
});
/** 每条测试自己覆盖，`getSettings` 读它 */
let settingsPatch: Record<string, unknown> = {};

/** 配的远端。每条测试自己定 */
let remoteUrl: string | null = "https://example.com/notes.git";
const vaultSync = vi.fn(async () => ({
  committed: null,
  pulled: 2,
  pushed: 1,
  conflicts: [] as string[],
}));
const tokenSet = vi.fn(async (_url: string, _token: string) => null);

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
    gitHistory: async () => HISTORY,
    gitRestoreFile: (commit: string, path: string) => gitRestore(commit, path),
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
    getSettings: async () => settingsPatch,
    setSettings: async (s: unknown) => s,
    openTerminal: async () => {},
    rebuildIndex: async () => ({}),
    ptyOpen: async () => "1",
    ptyWrite: async () => {},
    ptyResize: async () => {},
    ptyClose: async () => {},
  },
  onVaultChanged: async () => () => {},
  onAppClosing: async (cb: () => void) => {
    fireClosing = cb;
    return () => {
      fireClosing = null;
    };
  },
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
  gitRestore.mockClear();
  closeNow.mockClear();
  settingsPatch = {};
  remoteUrl = "https://example.com/notes.git";
  vaultSync.mockClear();
  tokenSet.mockClear();
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

describe("侧栏里的版本历史", () => {
  async function openPanel() {
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="历史"]')!.click();
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

    const no = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      document.querySelector<HTMLElement>(".hist-restore")!.click();
      await settle(200);
    });
    expect(gitRestore).not.toHaveBeenCalled();
    no.mockRestore();

    const yes = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      document.querySelector<HTMLElement>(".hist-restore")!.click();
      await settle(300);
    });
    expect(gitRestore).toHaveBeenCalledWith("aaa", "甲.md");
    yes.mockRestore();
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
   * 冲突走 `error` 而不是那句会自己消失的话 —— 它需要人去处理，
   * 一闪而过等于没说。而且要说清是**哪几篇**
   */
  it("冲突时说清是哪几篇，并且留在屏幕上", async () => {
    vaultSync.mockResolvedValueOnce({
      committed: null,
      pulled: 0,
      pushed: 0,
      conflicts: ["数学/线性代数.md", "乙.md"],
    });
    await mount();
    await act(async () => {
      syncBtn()!.click();
      await settle(400);
    });

    const msg = document.querySelector(".error")?.textContent ?? "";
    expect(msg).toContain("数学/线性代数");
    expect(msg).toContain("乙");
    expect(msg).not.toContain(".md");
    expect(document.querySelector(".status-notice"), "冲突不该同时报一句好消息").toBeFalsy();
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
