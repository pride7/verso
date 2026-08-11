/**
 * 草稿箱在文档树里的行为。DESIGN.md §4.7.1
 *
 * 一句话：**草稿箱自己的主视图就是卡片界面**，从文档树点开它就该看见卡片，
 * 而不是一篇写着 `type: scratch` 的 Markdown —— 和 `type: project` 的笔记
 * 打开就进总览是同一条规则。
 *
 * 它也**不从文档树里藏起来**（模板那种藏法是给一整个目录用的，草稿箱只有
 * 一篇）。留在树里，改名、移动、删除、翻历史才有路可走。
 *
 * 必须是 browser 测试：测的是 App 装好之后「点这一行会看见什么」，纯 Node
 * 里连编辑器都建不起来。
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

const tree: TreeNode[] = [doc("甲", "甲.md"), doc("草稿箱", "草稿箱.md")];

const bodies: Record<string, string> = {
  "甲.md": "普通正文\n",
  "草稿箱.md": ["- 验证核心假设", "  - 找三篇相关论文", "- 可能的问题"].join("\n"),
};
/** 只有草稿箱带 `type: scratch` —— 这一条正是整个规则的判据 */
const fronts: Record<string, Record<string, unknown>> = {
  "草稿箱.md": { type: "scratch" },
};

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "甲.md" }),
    openVault: async () => VAULT,
    tree: async () => tree,
    listNotes: async () => tree.map((n) => ({ path: n.path, name: n.name })) as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: null,
        title: path.replace(/\.md$/, "").split("/").pop()!,
        frontmatter: fronts[path] ?? {},
        frontmatterText: fronts[path] ? "type: scratch\n" : null,
        body: bodies[path] ?? "",
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
    // 图标栏那个入口靠它找草稿箱
    viewQuery: async () => ({
      columns: [],
      rows: [{ path: "草稿箱.md" }],
      view: "table",
      groupBy: null,
    }),
    propSet: async () => {},
    propRename: async () => {},
    propSchema: async () => ({}),
    propDefSet: async () => {},
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
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

beforeEach(() => localStorage.clear());

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
    await settle(700);
  });
}

/** 点文档树里那一行。可点的是 `.tree-label`，名字在它里面的 `.tree-name` 上 */
async function clickTree(name: string) {
  const row = [...document.querySelectorAll<HTMLElement>(".tree-label")].find(
    (el) => el.querySelector(".tree-name")?.textContent?.trim() === name,
  );
  expect(row, `文档树里没有「${name}」这一行`).toBeTruthy();
  await act(async () => {
    row!.click();
    await settle(600);
  });
}

describe("草稿箱在文档树里", () => {
  it("留在树里，没被藏起来", () => {
    // 模板那种藏法是给一整个目录用的：几十个文件会把真正的笔记挤下去。
    // 草稿箱只有一篇，藏了反而没地方给它改名、挪位置、翻历史
    expect(tree.some((node) => node.path === "草稿箱.md")).toBe(true);
  });

  it("从树里点开就是卡片界面，不是一篇 Markdown", async () => {
    await mountApp();
    expect(document.querySelector(".scratchpad"), "一开始打开的是普通笔记").toBeNull();

    await clickTree("草稿箱");
    expect(
      document.querySelector(".scratchpad"),
      "点开草稿箱看到的应该是卡片界面 —— 和 type: project 打开就进总览是同一条规则",
    ).toBeTruthy();
  });

  it("再点普通笔记就回到正文，卡片视图不会跟着跑", async () => {
    await mountApp();
    await clickTree("草稿箱");
    expect(document.querySelector(".scratchpad")).toBeTruthy();

    await clickTree("甲");
    expect(
      document.querySelector(".scratchpad"),
      "卡片视图泄漏到了普通笔记上 —— 按类型判断正是为了防这个",
    ).toBeNull();
  });

  it("头部那个「正文」按钮仍然能切回原始 Markdown", async () => {
    await mountApp();
    await clickTree("草稿箱");
    const back = [...document.querySelectorAll<HTMLElement>(".scratch-head button")].find((el) =>
      el.textContent?.includes("正文"),
    );
    expect(back, "草稿台头部应该有一个回正文的出口").toBeTruthy();
    await act(async () => {
      back!.click();
      await settle(400);
    });
    expect(document.querySelector(".scratchpad"), "点了「正文」应当退出卡片界面").toBeNull();
  });
});
