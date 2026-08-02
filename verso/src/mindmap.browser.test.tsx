/**
 * 思维导图接进 App 之后还成不成立。DESIGN.md §4.7
 *
 * 解析、布局、算改动都在 `lib/mindmap.test.ts` 里用纯函数测干净了。这一层
 * 只测一件事，但它是整个功能的命脉：**在图上动一下，正文真的跟着变**——
 * 那条路要经过 CM6 的 dispatch，纯 Node 里根本走不到。
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

const BODY = ["## 方法", "", "- 甲", "  - 甲一", "- 乙", "", "## 结论", "", "- 收尾"].join("\n");

const writeNote = vi.fn(async (_path: string, _body: string) => 0);

vi.mock("./api", () => ({
  api: {
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "论文.md" }),
    openVault: async () => VAULT,
    tree: async () => [doc("论文", "论文.md")],
    listNotes: async () => [{ path: "论文.md", name: "论文" }] as NoteRef[],
    readNote: async () =>
      ({
        path: "论文.md",
        id: null,
        title: "论文",
        frontmatter: {},
        frontmatterText: null,
        body: BODY,
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: (p: string, b: string) => writeNote(p, b),
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
    workspaceGet: async () => ({ tabs: ["论文.md"], active: 0, pinnedCount: 0 }),
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
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  writeNote.mockClear();
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

async function open() {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App />);
    await settle(600);
  });
  await act(async () => {
    document.querySelector<HTMLElement>('.rail-btn[aria-label="思维导图"]')!.click();
    await settle(300);
  });
}

/** 图上的一个节点 */
const node = (text: string) =>
  [...document.querySelectorAll<HTMLElement>(".mm-node")].find(
    (n) => n.querySelector(".mm-text")?.textContent === text,
  );

const texts = () =>
  [...document.querySelectorAll<HTMLElement>(".mm-text")].map((t) => t.textContent);

/**
 * 最后一次存盘的正文。
 *
 * **不能读 `.cm-line` 的文字** —— live preview 会把 `- ` 换成圆点、把 `##`
 * 藏起来，读到的是渲染结果而不是 Markdown。存下去的那份才是真的，顺带还
 * 验到了「在图上改一下会自动保存」这条路。
 */
async function saved(): Promise<string> {
  // 自动保存是停手 800ms 之后
  await act(async () => {
    await settle(1100);
  });
  const calls = writeNote.mock.calls;
  expect(calls.length, "改完该有一次保存").toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

/**
 * 往编辑框里打字然后回车。
 *
 * **打字和回车必须分两拍。** 挤在同一个事件循环里的话，keydown 的处理函数
 * 读到的还是上一次渲染时的草稿（React 还没来得及重渲染），提交下去的就是
 * 改之前的文字 —— 真人打字不会这么快，但测试会。
 */
async function typeAndEnter(text: string) {
  const input = document.querySelector<HTMLInputElement>(".mm-input")!;
  expect(input, "该有一个编辑框").not.toBeNull();
  await act(async () => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(80);
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle(300);
  });
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
    await settle(150);
  });
}

async function key(k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    document
      .querySelector(".mindmap")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
    await settle(200);
  });
}

describe("思维导图", () => {
  it("根是笔记本身，标题和列表都进图", async () => {
    await open();
    expect(document.querySelector(".mindmap")).not.toBeNull();
    // 根 + 两个标题 + 四个列表项。**不比顺序** —— 横向树里节点的 DOM 次序
    // 和视觉次序本来就不一样（父节点落在自己那一簇的中间）
    expect(new Set(texts())).toEqual(
      new Set(["论文", "方法", "甲", "甲一", "乙", "结论", "收尾"]),
    );
  });

  it("双击改字 → 正文那一行真的变了，前缀还在", async () => {
    await open();
    const 甲一 = node("甲一")!;
    await act(async () => {
      甲一.querySelector<HTMLElement>(".mm-label")!.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      );
      await settle(150);
    });

    expect(document.querySelector<HTMLInputElement>(".mm-input")!.value).toBe("甲一");
    await typeAndEnter("甲之一");

    // 缩进和 `- ` 一个都没丢
    expect(await saved()).toContain("  - 甲之一");
    expect(texts()).toContain("甲之一");
  });

  it("Tab 加子节点，插在整棵子树之后", async () => {
    await open();
    await click(node("甲")!.querySelector(".mm-label")!);
    await key("Tab");

    // 新节点自动进编辑态 —— 加完还要自己去图上找它在哪就没法用了
    expect(document.querySelector(".mm-input"), "新节点该直接可输入").not.toBeNull();
    await typeAndEnter("甲二");

    const lines = (await saved()).split("\n");
    // 照第一个子节点的缩进走，并且落在「甲一」后面而不是紧贴着「甲」
    expect(lines[3]).toBe("  - 甲一");
    expect(lines[4]).toBe("  - 甲二");
  });

  it("Enter 加同级节点", async () => {
    await open();
    await click(node("乙")!.querySelector(".mm-label")!);
    await key("Enter");
    await typeAndEnter("丙");
    expect(await saved()).toContain("- 丙");
    expect(texts()).toContain("丙");
  });

  it("删节点连子树一起删，删之前会问一句", async () => {
    await open();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await click(node("甲")!.querySelector(".mm-label")!);
    await key("Delete");

    expect(confirm).toHaveBeenCalled();
    const text = await saved();
    expect(text).not.toContain("- 甲");
    expect(text).not.toContain("甲一");
    // 邻居不能被牵连
    expect(text).toContain("- 乙");
    expect(text).toContain("## 结论");
    confirm.mockRestore();
  });

  it("确认框点取消就什么都不做", async () => {
    await open();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click(node("甲")!.querySelector(".mm-label")!);
    await key("Delete");
    // 什么都没改 = 什么都不会存盘
    await act(async () => {
      await settle(1100);
    });
    expect(writeNote).not.toHaveBeenCalled();
    expect(texts()).toContain("甲一");
    confirm.mockRestore();
  });

  it("折叠一支，它底下的就不占地方了", async () => {
    await open();
    await click(node("甲")!.querySelector(".mm-fold")!);
    expect(texts()).not.toContain("甲一");
    // 折叠钮上显示还藏着几个
    expect(node("甲")!.querySelector(".mm-fold")!.textContent).toBe("1");
  });

  it("Esc 回到正文", async () => {
    await open();
    await key("Escape");
    expect(document.querySelector(".mindmap")).toBeNull();
    expect(document.querySelector(".cm-content")).not.toBeNull();
  });

  it("导图里的 F2 不会跑去给文档树改名", async () => {
    // 全局命令表里 F2 是「重命名」。导图整片盖住正文，这时候按 F2
    // 应当是改节点的字 —— 而不是在看不见的侧栏里打开一个改名框
    await open();
    await click(node("乙")!.querySelector(".mm-label")!);
    await key("F2");
    expect(document.querySelector(".mm-input")).not.toBeNull();
    expect(document.querySelector(".tree-rename")).toBeNull();
  });
});
