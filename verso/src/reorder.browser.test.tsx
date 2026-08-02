/**
 * 拖拽排序的整条链路 —— 从落点判定一直到 `notes_reorder` 的实参。
 *
 * 为什么非得在真浏览器里跑：落点分区（上下 25% / 中间 50%）算的是
 * `getBoundingClientRect().height`。happy-dom 里这个高度恒为 0，比值成了
 * `NaN`，两个区间判断双双为假 —— **每一次拖放都会被判成「移进去」，
 * 而所有断言照样通过**。这个假阴性正好把要验的东西全放过去。
 *
 * 组件层面的分区判定在 `components/Tree.browser.test.tsx`；这里验的是
 * App 那一层：默认按名称排的时候拖一下会发生什么。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "./types";

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const node = (name: string, path: string, children: TreeNode[] = []): TreeNode => ({
  name,
  path,
  kind: "document",
  children,
  childDir: children.length ? path.replace(/\.md$/, "") : null,
  order: null,
  created: null,
  updated: null,
});

/**
 * 有意让磁盘顺序和字母序不一致 —— 「按名称排」这一档必须真的在起作用，
 * 否则「起点是屏幕上的顺序」这条断言就验不出东西
 */
const TREE: TreeNode[] = [
  node("论文", "论文.md", [
    node("奇异值分解的数值方法", "论文/奇异值分解的数值方法.md"),
    node("一篇还没开始读的", "论文/一篇还没开始读的.md"),
    node("Attention Is All You Need", "论文/Attention Is All You Need.md"),
  ]),
  node("数学", "数学.md", [node("公式手感盲测", "数学/公式手感盲测.md")]),
];

const NOTES: NoteRef[] = [{ path: "论文.md", name: "论文" }];

const NOTE: NoteContent = {
  path: "论文.md",
  id: "x",
  title: "论文",
  frontmatter: {},
  frontmatterText: "",
  body: "# 论文\n",
  mtimeMs: 0,
};

const reorder = vi.fn(async (_parent: string, _paths: string[]) => {});
const moveNote = vi.fn(async (path: string, parent: string | null) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return parent ? `${parent.replace(/\.md$/, "")}/${name}` : name;
});
const setSettings = vi.fn(async (s: Record<string, unknown>) => s);
let saved: Record<string, unknown> = { treeSort: "name" };

vi.mock("./api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: null }),
    openVault: async () => VAULT,
    tree: async () => TREE,
    listNotes: async () => NOTES,
    readNote: async () => NOTE,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "新文档.md", id: "x", title: "新文档" }),
    renameNote: async () => "",
    moveNote: (p: string, parent: string | null) => moveNote(p, parent),
    deleteNote: async () => {},
    search: async () => [],
    backlinks: async () => [],
    allTags: async () => [],
    notesByTag: async () => [],
    viewQuery: async () => ({ columns: [], rows: [], view: "table" }),
    propSet: async () => {},
    propRename: async () => {},
    reorder: (parent: string, paths: string[]) => reorder(parent, paths),
    workspaceGet: async () => ({ tabs: [], active: 0 }),
    workspaceSet: async () => {},
    getSettings: async () => saved,
    setSettings: (s: Record<string, unknown>) => setSettings(s),
    openTerminal: async () => {},
    rebuildIndex: async () => ({}),
    ptyOpen: async () => "1",
    ptyWrite: async () => {},
    ptyResize: async () => {},
    ptyClose: async () => {},
  },
  onVaultChanged: async () => () => {},
  onAppClosing: async () => () => {},
  onPtyData: async () => () => {},
  onPtyExit: async () => () => {},
  pickVaultFolder: async () => null,
}));

const { default: App } = await import("./App");

// 没有这行，React 会说「当前环境不支持 act(...)」，然后放任状态更新在断言
// 之后才落地 —— 测试变成时序赌博
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  reorder.mockClear();
  moveNote.mockClear();
  setSettings.mockClear();
  saved = { treeSort: "name" };
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

async function mountApp() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App />);
    await settle(400);
  });
}

/** 按可见文字找树里的一行 */
function rowOf(label: string): HTMLElement {
  const btn = [...document.querySelectorAll<HTMLElement>(".tree-label")].find(
    (b) => b.textContent === label,
  );
  if (!btn) throw new Error(`树里没有「${label}」，实际有：${labels().join(" / ")}`);
  return btn.closest(".tree-row") as HTMLElement;
}

function labels(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".tree-label")].map((b) => b.textContent ?? "");
}

/** `ratio` 是行内的相对高度：0 顶、1 底 */
async function dragTo(target: HTMLElement, srcPath: string, ratio: number) {
  const box = target.getBoundingClientRect();
  expect(box.height, "行高为 0 就说明没有真实布局，这个测试白测").toBeGreaterThan(0);

  const store = new Map([["text/verso-path", srcPath]]);
  const dataTransfer = {
    types: [...store.keys()],
    getData: (t: string) => store.get(t) ?? "",
    setData: (t: string, v: string) => void store.set(t, v),
    dropEffect: "none",
    effectAllowed: "move",
  };
  const clientY = box.top + box.height * ratio;

  for (const type of ["dragover", "drop"]) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { dataTransfer, clientY, clientX: box.left + 20 });
    await act(async () => {
      target.dispatchEvent(e);
      await settle();
    });
  }
}

describe("拖一下就能排", () => {
  // 这是这次改动的全部意义：默认是「名称 A→Z」，以前在这个模式下 onReorder
  // 根本不往下传，拖了毫无反应 —— 得先自己找到下拉框选「手动排序」
  it("默认按名称排时，拖动直接生效，并自动切到手动排序", async () => {
    await mountApp();
    // 先钉住「屏幕上是什么顺序」。zh 排序里西文排在中文之后，而磁盘顺序又是
    // 另一个样子 —— 不写死这一行，下面那个期望值看起来就像是猜的
    expect(labels()).toEqual([
      "论文",
      "奇异值分解的数值方法",
      "一篇还没开始读的",
      "Attention Is All You Need",
      "数学",
      "公式手感盲测",
    ]);

    await dragTo(rowOf("一篇还没开始读的"), "论文/Attention Is All You Need.md", 0.1);

    expect(reorder).toHaveBeenCalledTimes(1);
    const [parent, paths] = reorder.mock.calls[0];
    expect(parent).toBe("论文");
    // 起点是**屏幕上**的顺序而不是磁盘顺序：把 Attention 从末尾拎出来，
    // 插到「一篇还没开始读的」前面，其余两个的相对位置一点不动
    expect(paths).toEqual([
      "论文/奇异值分解的数值方法.md",
      "论文/Attention Is All You Need.md",
      "论文/一篇还没开始读的.md",
    ]);

    expect(setSettings).toHaveBeenCalled();
    const calls = setSettings.mock.calls;
    const last = calls[calls.length - 1][0] as { treeSort: string };
    expect(last.treeSort).toBe("manual");
  });

  it("切过去之后会说一声，不是静悄悄改掉下拉框", async () => {
    await mountApp();
    await dragTo(rowOf("一篇还没开始读的"), "论文/Attention Is All You Need.md", 0.9);
    expect(document.body.textContent).toContain("已切换到手动排序");
  });

  it("已经是手动排序时不再重复切、也不提示", async () => {
    saved = { treeSort: "manual" };
    await mountApp();
    await dragTo(rowOf("一篇还没开始读的"), "论文/Attention Is All You Need.md", 0.1);

    expect(reorder).toHaveBeenCalledTimes(1);
    expect(setSettings).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("已切换到手动排序");
  });

  // 行已经高亮着「插到这里」，只因为来源在别的目录就什么都不做，
  // 是最难受的一种失败 —— 用户不知道自己做错了什么
  it("跨目录拖到边缘：先移过去，再排到那个位置", async () => {
    await mountApp();
    await dragTo(rowOf("一篇还没开始读的"), "数学/公式手感盲测.md", 0.1);

    expect(moveNote).toHaveBeenCalledWith("数学/公式手感盲测.md", "论文.md");
    const [parent, paths] = reorder.mock.calls[0];
    expect(parent).toBe("论文");
    expect(paths).toEqual([
      "论文/奇异值分解的数值方法.md",
      "论文/公式手感盲测.md",
      "论文/一篇还没开始读的.md",
      "论文/Attention Is All You Need.md",
    ]);
  });

  it("拖到行中间仍然是「移进去当子文档」，不是调顺序", async () => {
    await mountApp();
    await dragTo(rowOf("一篇还没开始读的"), "数学/公式手感盲测.md", 0.5);

    expect(moveNote).toHaveBeenCalledWith("数学/公式手感盲测.md", "论文/一篇还没开始读的.md");
    expect(reorder).not.toHaveBeenCalled();
  });
});
