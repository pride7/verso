/**
 * 标签页走 App 整条链路。
 *
 * 状态迁移的规则（关了跳到谁、拖动之后当前页是哪个）在 `lib/tabs.test.ts` 里
 * 用纯函数验，那些不需要浏览器。这里验的是纯 Node 给不出答案的三件事：
 *
 * 1. **切回一个标签时，光标和撤销历史还在不在** —— CodeMirror 的 `EditorState`
 *    要真的建出来才谈得上历史，happy-dom 里连 view 都起不来。
 * 2. 中键、Ctrl+点 这些鼠标细节。
 * 3. 标签栏的滚动与「切到看不见的那个要滚进来」。
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

const TREE: TreeNode[] = [doc("甲", "甲.md"), doc("乙", "乙.md"), doc("丙", "丙.md")];

const BODIES: Record<string, string> = {
  "甲.md": "# 甲\n\n甲的正文。\n",
  "乙.md": "# 乙\n\n乙的正文。\n",
  "丙.md": "# 丙\n\n丙的正文。\n",
};

const NOTES: NoteRef[] = TREE.map((n) => ({ path: n.path, name: n.name }));

let saved: Record<string, unknown> = { tabOpen: "new" };
let workspace = { tabs: [] as string[], active: 0 };
const workspaceSet = vi.fn(async (ws: { tabs: string[]; active: number }) => {
  workspace = ws;
});

vi.mock("./api", () => ({
  api: {
    reopenLastVault: async () => ({ vault: VAULT, lastNote: null }),
    openVault: async () => VAULT,
    tree: async () => TREE,
    listNotes: async () => NOTES,
    readNote: async (path: string) =>
      ({
        path,
        id: path,
        title: path,
        frontmatter: {},
        frontmatterText: "",
        body: BODIES[path] ?? "",
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "新.md", id: "x", title: "新" }),
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
    workspaceGet: async () => workspace,
    workspaceSet: (ws: { tabs: string[]; active: number }) => workspaceSet(ws),
    getSettings: async () => saved,
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
const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  saved = { tabOpen: "new" };
  workspace = { tabs: [], active: 0 };
  workspaceSet.mockClear();
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

const tabNames = () =>
  [...document.querySelectorAll<HTMLElement>(".tab-name")].map((e) => e.textContent);
const activeTab = () =>
  document.querySelector<HTMLElement>(".tab.is-active .tab-name")?.textContent ?? null;

function treeItem(name: string): HTMLElement {
  const btn = [...document.querySelectorAll<HTMLElement>(".tree-label")].find(
    (b) => b.textContent === name,
  );
  if (!btn) throw new Error(`树里没有「${name}」`);
  return btn;
}

async function clickTree(name: string, init: MouseEventInit = {}) {
  const el = treeItem(name);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    await settle();
  });
}

/** 中键。走 mouseup —— auxclick 在 WebView2 上不总是派发 */
async function middleClickTree(name: string) {
  const el = treeItem(name);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 1 }));
    await settle();
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settle();
  });
}

/** 切标签走的是 mousedown —— 按下即切，标签栏的常规手感 */
async function pickTab(i: number) {
  const el = document.querySelectorAll<HTMLElement>(".tab")[i];
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    await settle();
  });
}

describe("开与关", () => {
  it("默认每点一个就多一个标签", async () => {
    await mountApp();
    expect(tabNames(), "一开始没有标签").toEqual([]);

    await clickTree("甲");
    await clickTree("乙");
    expect(tabNames()).toEqual(["甲", "乙"]);
    expect(activeTab()).toBe("乙");
  });

  it("再点已经开着的那个是切过去，不会开第二个", async () => {
    await mountApp();
    await clickTree("甲");
    await clickTree("乙");
    await clickTree("甲");
    expect(tabNames()).toEqual(["甲", "乙"]);
    expect(activeTab()).toBe("甲");
  });

  it("设置成「替换当前」时，标签数不涨", async () => {
    saved = { tabOpen: "replace" };
    await mountApp();
    await clickTree("甲");
    await clickTree("乙");
    expect(tabNames()).toEqual(["乙"]);
  });

  // 这两个是「我要开新标签」的明确表态，不该被设置盖掉
  it("替换模式下，Ctrl+点 和中键仍然开新标签", async () => {
    saved = { tabOpen: "replace" };
    await mountApp();
    await clickTree("甲");
    await clickTree("乙", { ctrlKey: true });
    expect(tabNames()).toEqual(["甲", "乙"]);

    await middleClickTree("丙");
    expect(tabNames()).toEqual(["甲", "乙", "丙"]);
  });

  it("点 × 关掉，接班的是右边那个", async () => {
    await mountApp();
    await clickTree("甲");
    await clickTree("乙");
    await clickTree("丙");
    // 切回中间那个再关它
    await pickTab(1);
    expect(activeTab()).toBe("乙");

    await click(document.querySelectorAll(".tab")[1].querySelector(".tab-close")!);
    expect(tabNames()).toEqual(["甲", "丙"]);
    expect(activeTab()).toBe("丙");
  });

  it("关光了标签栏就不见了，正文回到空状态", async () => {
    await mountApp();
    await clickTree("甲");
    await click(document.querySelector(".tab-close")!);
    expect(document.querySelector(".tabbar")).toBeNull();
    expect(document.querySelector(".cm-content")).toBeNull();
  });
});

describe("切回来的时候", () => {
  // 纯 Node 给不出答案的正是这一条：要有真的 EditorState 才谈得上光标和历史
  it("光标、选区、撤销历史都还在", async () => {
    await mountApp();
    await clickTree("甲");

    // 在甲里敲点东西，并把光标停在一个明确的位置
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    content.focus();
    await act(async () => {
      document.execCommand("insertText", false, "改过的内容");
      await settle();
    });
    const typed = document.querySelector<HTMLElement>(".cm-content")!.textContent ?? "";
    expect(typed).toContain("改过的内容");

    await clickTree("乙");
    expect(activeTab()).toBe("乙");
    expect(document.querySelector(".cm-content")?.textContent).toContain("乙的正文");

    await pickTab(0);
    expect(activeTab()).toBe("甲");

    // 撤销一次应当回到没敲之前 —— 历史真的跟着标签活下来了
    const back = document.querySelector<HTMLElement>(".cm-content")!;
    back.focus();
    await act(async () => {
      back.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
    });
    expect(document.querySelector(".cm-content")?.textContent).not.toContain("改过的内容");
  });
});

describe("持久化", () => {
  it("标签一变就写进 workspace", async () => {
    await mountApp();
    await clickTree("甲");
    await clickTree("乙");

    const last = workspaceSet.mock.calls[workspaceSet.mock.calls.length - 1][0];
    expect(last.tabs).toEqual(["甲.md", "乙.md"]);
    expect(last.active).toBe(1);
  });

  it("重启时恢复上次开着的那几个，并停在原来那一页", async () => {
    workspace = { tabs: ["甲.md", "丙.md"], active: 1 };
    await mountApp();
    expect(tabNames()).toEqual(["甲", "丙"]);
    expect(activeTab()).toBe("丙");
    expect(document.querySelector(".cm-content")?.textContent).toContain("丙的正文");
  });
});
