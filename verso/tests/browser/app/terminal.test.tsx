/**
 * 终端的停靠位置与「把上下文发给终端」。DESIGN.md §7.3 / §7.6
 *
 * 这一层量的是**几何和字节**，不是类名：终端到底在正文右边还是下面、切一次
 * 停靠有没有把跑着的进程杀掉、按下那个键之后 PTY 里真的收到了什么。类名对着
 * 而这三件事错了的话，正是「看起来做完了、用起来是坏的」。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendToTerminal } from "../../../src/core/termBus";
import { isMac } from "../../../src/core/platform";
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

/** PTY 收到的字节。`ptyWrite` 是终端里发生的一切最终必经的那道口子 */
let written: string[] = [];
let opened = 0;
let closed = 0;

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "甲.md" }),
    openVault: async () => VAULT,
    tree: async () => [doc("甲", "甲.md"), doc("乙", "乙.md")],
    listNotes: async () =>
      [
        { path: "甲.md", name: "甲" },
        { path: "乙.md", name: "乙" },
      ] as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: null,
        title: path.replace(/\.md$/, ""),
        frontmatter: {},
        frontmatterText: null,
        body: "第一段正文。\n\n第二段正文。\n",
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async () => 0,
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
    propDefSet: async () => {},
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
    gitStatus: async () => ({
      enabled: true,
      added: 0,
      modified: 0,
      deleted: 0,
      dirty: 0,
      lastMessage: null,
      lastAt: null,
    }),
    gitCommit: async () => null,
    gitHistory: async () => [],
    syncRemoteGet: async () => ({ url: null, branch: "main", needsToken: false }),
    syncTokenHas: async () => false,
    workspaceGet: async () => ({ tabs: ["甲.md"], active: 0, pinnedCount: 0 }),
    workspaceSet: async () => {},
    getSettings: async () => ({}),
    setSettings: async (s: unknown) => s,
    openTerminal: async () => {},
    rebuildIndex: async () => ({}),
    ptyOpen: async () => {
      opened++;
      return String(opened);
    },
    ptyWrite: async (_id: string, data: string) => {
      written.push(data);
    },
    ptyResize: async () => {},
    ptyClose: async () => {
      closed++;
    },
  },
  onBackendNotice: async () => () => {},
  onVaultChanged: async () => () => {},
  onAppClosing: async () => () => {},
  onPtyData: async () => () => {},
  onPtyExit: async () => () => {},
  pickVaultFolder: async () => null,
  pickCloneFolder: async () => null,
}));

const { default: App } = await import("../../../src/app/App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const WIDE = { w: 1440, h: 900 };
/** §1.2 的窄屏门槛是 640px，这个尺寸稳稳在里面 */
const NARROW = { w: 560, h: 900 };

async function waitUntil(check: () => boolean, timeoutMs = 6_000) {
  const deadline = performance.now() + timeoutMs;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error("等待异步界面状态超时");
    // 每轮单独 act，才能让上一轮定时器触发的 React 更新真正提交。
    await act(async () => {
      await settle(100);
    });
  }
}

async function mount() {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App />);
    await settle(500);
  });
  // PTY 是异步起的（还要等第一次真实布局）。完整 browser 套件并发争 CPU 时，
  // 一次长 act 会攒住中途产生的 React 更新；拆成多轮等待可观察结果，避免把
  // 机器负载误报成产品失败。
  if (localStorage.getItem("verso.termOpen") === "1") {
    await waitUntil(() => opened > 0);
  }
}

/** 从某个元素上发一个按键。target 决定了它会不会被「终端里键盘归 shell」挡掉 */
async function hotkeyOn(el: HTMLElement, key: string, opts: KeyboardEventInit = {}) {
  const platformOpts = isMac && opts.ctrlKey && !opts.metaKey
    ? { ...opts, ctrlKey: false, metaKey: true }
    : opts;
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...platformOpts }));
    await settle(300);
  });
}

/** 发一个全局快捷键。target 在终端外面 */
const hotkey = (key: string, opts: KeyboardEventInit = {}) => hotkeyOn(document.body, key, opts);

const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();

beforeEach(async () => {
  localStorage.clear();
  written = [];
  opened = 0;
  closed = 0;
  await page.viewport(WIDE.w, WIDE.h);
});

afterEach(async () => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  await page.viewport(1440, 900);
});

describe("终端停靠位置", () => {
  it("默认吸底：在正文下面、横着铺满", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    const term = box(".term")!;
    const main = box(".main")!;
    expect(term.top).toBeGreaterThan(main.top);
    // 横向和正文对齐（同一列），不是挤在旁边
    expect(Math.abs(term.left - main.left)).toBeLessThan(2);
  });

  it("靠右竖排：在正文右边，且从标签栏一直通到状态栏", async () => {
    localStorage.setItem("verso.termOpen", "1");
    localStorage.setItem("verso.termDock", "right");
    await mount();

    const term = box(".term")!;
    const main = box(".main")!;
    const tabs = box(".tabbar")!;
    const status = box(".status")!;

    // 在正文右边，两者不重叠 —— 重叠的话就是盖上去了，不是分栏
    expect(term.left).toBeGreaterThanOrEqual(main.right - 1);
    // 通高：上到标签栏那一行，下到状态栏
    expect(term.top).toBeLessThanOrEqual(tabs.top + 1);
    expect(term.bottom).toBeGreaterThanOrEqual(status.top - 1);
    // 换这个布局图的就是竖向空间 —— 它得比吸底那 280px 高得多
    expect(term.height).toBeGreaterThan(500);
    // 正文没有被压没
    expect(main.width).toBeGreaterThan(320);
    // 这是从窗口顶边通到底边的结构分栏。若只圆左边两个角、贴窗的右边保持
    // 方角，整块会明显向编辑区鼓出；四角归零才左右平衡。
    const style = getComputedStyle(document.querySelector<HTMLElement>(".term")!);
    expect(style.borderTopLeftRadius).toBe("0px");
    expect(style.borderTopRightRadius).toBe("0px");
    expect(style.borderBottomLeftRadius).toBe("0px");
    expect(style.borderBottomRightRadius).toBe("0px");
  });

  it("切换停靠不重建终端 —— 那等于把跑着的 AI 任务杀掉", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    expect(opened).toBe(1);
    const host = document.querySelector(".term-host");

    await act(async () => {
      document.querySelector<HTMLElement>('[aria-label="把终端靠右竖排"]')!.click();
      await settle(400);
    });

    expect(document.querySelector(".app")?.className).toContain("term-right");
    expect(closed, "切个方向就把 shell 杀了").toBe(0);
    expect(opened, "切个方向就重开了一个 shell").toBe(1);
    // 同一个 DOM 节点换了网格区域，xterm 实例原样留着
    expect(document.querySelector(".term-host")).toBe(host);
    expect(box(".term")!.left).toBeGreaterThanOrEqual(box(".main")!.right - 1);
  });

  it("两个方向各记各的尺寸", async () => {
    localStorage.setItem("verso.termOpen", "1");
    localStorage.setItem("verso.termHeight", "300");
    localStorage.setItem("verso.termWidth", "520");
    await mount();
    expect(Math.round(box(".term")!.height)).toBe(300);

    await act(async () => {
      document.querySelector<HTMLElement>('[aria-label="把终端靠右竖排"]')!.click();
      await settle(400);
    });
    expect(Math.round(box(".term")!.width)).toBe(520);
  });

  it("最大化只占编辑区，恢复后回到原来的停靠位置且不重建终端", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    expect(opened).toBe(1);
    const host = document.querySelector(".term-host");

    await act(async () => {
      document.querySelector<HTMLElement>('[aria-label="最大化到编辑区"]')!.click();
      await settle(400);
    });

    const term = box(".term")!;
    const main = box(".main")!;
    expect(document.querySelector(".app")?.className).toContain("term-maximized");
    expect(Math.abs(term.left - main.left)).toBeLessThan(2);
    expect(Math.abs(term.top - main.top)).toBeLessThan(2);
    expect(Math.abs(term.width - main.width)).toBeLessThan(2);
    expect(Math.abs(term.height - main.height)).toBeLessThan(2);
    expect(document.querySelector(".term-host")).toBe(host);
    expect(opened).toBe(1);
    expect(closed).toBe(0);

    await act(async () => {
      document.querySelector<HTMLElement>('[aria-label="恢复终端原来的布局"]')!.click();
      await settle(400);
    });
    expect(document.querySelector(".app")?.className).not.toContain("term-maximized");
    expect(box(".term")!.top).toBeGreaterThan(box(".main")!.top);
    expect(document.querySelector(".term-host")).toBe(host);
    expect(opened).toBe(1);
    expect(closed).toBe(0);
  });

  it("窄屏强制吸底，但不改存下来的偏好", async () => {
    localStorage.setItem("verso.termOpen", "1");
    localStorage.setItem("verso.termDock", "right");
    await page.viewport(NARROW.w, NARROW.h);
    await mount();

    expect(document.querySelector(".app")?.className).not.toContain("term-right");
    expect(box(".term")!.top).toBeGreaterThan(box(".main")!.top);
    // 没有「靠右」这个选项时，那个按钮也不该在
    expect(document.querySelector('[aria-label="把终端靠右竖排"]')).toBeNull();
    // 偏好原样留着 —— 窗口拉宽回来，靠右还在
    expect(localStorage.getItem("verso.termDock")).toBe("right");
  });
});

describe("把上下文发给终端（§7.6）", () => {
  it("按下快捷键，PTY 收到的是带前缀的相对路径", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    written = [];

    await hotkey("k", { ctrlKey: true, altKey: true });

    expect(written.join("")).toBe("@甲.md ");
  });

  it("终端没开就先开，起来之后再把攒着的补发过去", async () => {
    await mount();
    expect(document.querySelector(".term")).toBeNull();

    await hotkey("k", { ctrlKey: true, altKey: true });
    await act(async () => settle(700));

    expect(document.querySelector(".term")).not.toBeNull();
    // 关键是这条：等 PTY 的那几十毫秒里按下的键不能被吞掉
    expect(written.join("")).toContain("@甲.md ");
  });

  it("没选中东西时说一声，不往终端里塞个空引用", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    written = [];

    await hotkey("K", { ctrlKey: true, altKey: true, shiftKey: true });

    expect(document.body.textContent).toContain("没有选中内容");
    expect(written.join("")).toBe("");
  });

  /**
   * 送完一次焦点就在终端里（`term.focus()`）。而「终端里键盘归 shell」那条
   * 规则如果连这个键也挡掉，想再送第二篇就得先点回正文 —— 等于把这个功能
   * 刚省下的那一步又加了回来。
   */
  it("焦点已经在终端里时，还能接着再送一篇", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    written = [];

    const inside =
      document.querySelector<HTMLElement>(".term .xterm-helper-textarea") ??
      document.querySelector<HTMLElement>(".term-host")!;
    await hotkeyOn(inside, "k", { ctrlKey: true, altKey: true });

    expect(written.join("")).toContain("@甲.md ");
  });

  it("焦点在侧栏里也送得出去 —— 发的是「当前这篇」，不是「光标那一处」", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    written = [];

    await hotkeyOn(document.querySelector<HTMLElement>(".tree-label")!, "k", {
      ctrlKey: true,
      altKey: true,
    });

    expect(written.join("")).toContain("@甲.md ");
  });

  it("终端里别的快捷键仍然归 shell", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();

    const inside =
      document.querySelector<HTMLElement>(".term .xterm-helper-textarea") ??
      document.querySelector<HTMLElement>(".term-host")!;
    await hotkeyOn(inside, "p", { ctrlKey: true });
    expect(document.querySelector(".overlay"), "Ctrl+P 被界面截走了").toBeNull();

    // 对照：同一个键在正文那边照常打开快速跳转
    await hotkey("p", { ctrlKey: true });
    expect(document.querySelector(".overlay")).not.toBeNull();
  });

  /**
   * 两次真出过的事故：PowerShell 提示符下那一行被 shell 执行（ParserError）；
   * Codex 的 TUI 里那一行被当成整条消息发了出去。xterm 的 `paste()` 不管对面
   * 开没开括号粘贴模式，都会把 `\n` 转成 `\r` —— 而 `\r` 两边都当「执行」。
   *
   * 这里量的是**进 PTY 的字节**：无论送什么，字节流里一个 `\r`/`\n` 都不许有。
   */
  it("进 PTY 的字节里一个回车都没有 —— 谁在对面都一样", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    written = [];

    await act(async () => {
      sendToTerminal("@项目/Latent.md\nMSE 对 joint 有激励，\n但只有约 0.5%");
      await settle(200);
    });

    const sent = written.join("");
    expect(sent).toContain("@项目/Latent.md");
    expect(sent).toContain("但只有约 0.5%");
    expect(/[\r\n]/.test(sent), "有换行进了 shell —— 那等于替用户按了回车").toBe(false);
  });

  it("送过去的是上下文不是指令 —— 末尾不能带回车（§7.5）", async () => {
    localStorage.setItem("verso.termOpen", "1");
    await mount();
    written = [];

    await hotkey("k", { ctrlKey: true, altKey: true });

    const sent = written.join("");
    expect(sent.endsWith("\r")).toBe(false);
    expect(sent.endsWith("\n")).toBe(false);
  });
});
