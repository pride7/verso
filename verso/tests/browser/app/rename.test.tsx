/**
 * 新建文档 → 就地改名。
 *
 * 纯 Node 给不出答案的是**焦点和选区**：`focus()` / `select()` 要有真正的
 * 输入框和文档焦点才谈得上，happy-dom 里 `document.activeElement` 和
 * `selectionStart` 都只是摆设，怎么写都「通过」。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { NoteContent, NoteRef, TreeNode, VaultInfo, ViewResult } from "../../../src/core/types";

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

/** 后端建出来的那篇会被加进这里，下一次 `tree()` 就能看见 */
let tree: TreeNode[] = [doc("甲", "甲.md")];
let workspace = { tabs: [] as string[], active: 0, pinnedCount: 0 };
let bodies: Record<string, string> = {};
let viewResult: ViewResult = { columns: [], rows: [], view: "table", groupBy: null, properties: [] };

const createUntitled = vi.fn(async () => {
  tree = [...tree, doc("未命名", "未命名.md")];
  return { path: "未命名.md", id: "x", title: "未命名" };
});
const renameNote = vi.fn(async (path: string, title: string) => {
  const next = `${title}.md`;
  tree = tree.map((n) => (n.path === path ? doc(title, next) : n));
  return next;
});

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: null }),
    openVault: async () => VAULT,
    tree: async () => tree,
    listNotes: async () => tree.map((n) => ({ path: n.path, name: n.name })) as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: path,
        title: path,
        frontmatter: {},
        frontmatterText: "",
        body: bodies[path] ?? "",
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "x.md", id: "x", title: "x" }),
    createUntitled: () => createUntitled(),
    renameNote: (p: string, t: string) => renameNote(p, t),
    moveNote: async () => "",
    deleteNote: async () => {},
    search: async () => [],
    backlinks: async () => [],
    allTags: async () => [],
    notesByTag: async () => [],
    viewQuery: async () => viewResult,
    propSet: async () => {},
    propRename: async () => {},
    propSchema: async () => ({}),
    propDefSet: async () => {},
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
    workspaceGet: async () => workspace,
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

beforeEach(() => {
  localStorage.clear();
  tree = [doc("甲", "甲.md")];
  workspace = { tabs: [], active: 0, pinnedCount: 0 };
  bodies = {};
  viewResult = { columns: [], rows: [], view: "table", groupBy: null, properties: [] };
  createUntitled.mockClear();
  renameNote.mockClear();
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

const input = () => document.querySelector<HTMLInputElement>(".tree-rename");
const names = () =>
  [...document.querySelectorAll<HTMLElement>(".tree-label")].map((b) => b.textContent);

/** 侧栏头部那个「新建文档」 */
async function clickNew() {
  const btn = document.querySelector<HTMLElement>('.side-act[aria-label="新建文档"]')!;
  await act(async () => {
    btn.click();
    await settle(400);
  });
}

async function type(el: HTMLInputElement, v: string) {
  await act(async () => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(30);
  });
}

async function key(el: HTMLElement, k: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    await settle(300);
  });
}

describe("新建文档：不弹窗，就地改名", () => {
  it("建出来就叫「未命名」，光标落在名字上并且全选", async () => {
    await mountApp();
    await clickNew();

    // 关键：**没有**弹过窗问名字
    expect(createUntitled).toHaveBeenCalledTimes(1);

    const el = input();
    expect(el, "树里该出现一个改名输入框").not.toBeNull();
    expect(el!.value).toBe("未命名");
    expect(document.activeElement, "焦点要在输入框里").toBe(el);
    // 全选，所以直接敲字就是换名字，不必先手动选一遍
    expect([el!.selectionStart, el!.selectionEnd]).toEqual([0, "未命名".length]);
  });

  it("回车改名", async () => {
    await mountApp();
    await clickNew();
    const el = input()!;
    await type(el, "线性代数");
    await key(el, "Enter");

    expect(renameNote).toHaveBeenCalledWith("未命名.md", "线性代数");
    expect(input(), "改完输入框要收起来").toBeNull();
    expect(names()).toContain("线性代数");
  });

  // 文档已经建出来了，Esc 只是「这个名字我先不改」，不该把它删掉
  it("Esc 放弃改名，但文档留着", async () => {
    await mountApp();
    await clickNew();
    const el = input()!;
    await type(el, "还没想好");
    await key(el, "Escape");

    expect(renameNote).not.toHaveBeenCalled();
    expect(input()).toBeNull();
    expect(names()).toContain("未命名");
  });

  // 改完名点到别处，本意显然是要这个名字 —— 那时候丢掉刚敲的字最让人恼火
  it("失焦按确定处理", async () => {
    await mountApp();
    await clickNew();
    const el = input()!;
    await type(el, "泛函分析");
    // 用真的 `blur()`：React 的 `onBlur` 挂的是会冒泡的 `focusout`，
    // 手工派发一个不冒泡的 `blur` 事件根本到不了它那儿
    await act(async () => {
      el.blur();
      await settle(300);
    });

    expect(renameNote).toHaveBeenCalledWith("未命名.md", "泛函分析");
  });

  // 名字没动就别去调后端 —— 否则会因为「新名字和旧名字一样」收到一句
  // 「已存在同名文档」，而用户什么都没做错
  it("没改名字就不调后端", async () => {
    await mountApp();
    await clickNew();
    await key(input()!, "Enter");
    expect(renameNote).not.toHaveBeenCalled();
  });

  it("空名字当作放弃", async () => {
    await mountApp();
    await clickNew();
    const el = input()!;
    await type(el, "   ");
    await key(el, "Enter");
    expect(renameNote).not.toHaveBeenCalled();
    expect(names()).toContain("未命名");
  });
});

describe("database 视图里改名", () => {
  it("子文档在树中被收起时，仍在当前视图弹输入框并完成改名", async () => {
    const child = doc("MoE", "分类总览/MoE.md");
    tree = [{
      ...doc("分类总览", "分类总览.md"),
      childDir: "分类总览",
      collapsed: true,
      children: [child],
    }];
    workspace = { tabs: ["分类总览.md"], active: 0, pinnedCount: 0 };
    bodies["分类总览.md"] = [
      "# 分类总览",
      "",
      "```verso-view",
      'from: "分类总览/**"',
      "view: list",
      "```",
      "",
    ].join("\n");
    viewResult = {
      columns: ["title"],
      rows: [{ path: child.path, title: child.name, props: {} }],
      view: "list",
      groupBy: null,
      properties: [],
    };

    await mountApp();
    const title = document.querySelector<HTMLElement>(".dbv-list-title");
    expect(title, "列表视图没有渲染出来").not.toBeNull();
    await act(async () => {
      title!.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 240,
        clientY: 240,
      }));
      await settle(100);
    });
    const rename = [...document.querySelectorAll<HTMLButtonElement>(".ctx button")].find(
      (button) => button.textContent?.includes("重命名"),
    );
    expect(rename, "右键菜单没有重命名").not.toBeUndefined();
    await act(async () => {
      rename!.click();
      await settle(100);
    });

    const listInput = document.querySelector<HTMLInputElement>(".dbv-list .dbview-rename");
    expect(listInput, "列表标题没有原位变成输入框").not.toBeNull();
    expect(listInput!.value).toBe("MoE");
    expect(document.activeElement, "焦点没有落进列表改名框").toBe(listInput);
    expect(document.querySelector(".tree-rename"), "不该把折叠树节点切进改名态").toBeNull();

    await userEvent.fill(listInput!, "MoE 专家模型");
    await key(listInput!, "Enter");
    expect(renameNote).toHaveBeenCalledWith(child.path, "MoE 专家模型");
  });
});
