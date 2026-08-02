/**
 * 思维导图接进 App 之后还成不成立。DESIGN.md §4.7
 *
 * 解析、布局、算改动都在 `lib/mindmap.test.ts` 里用纯函数测干净了。这一层
 * 只测一件事，但它是整个功能的命脉：**在图上动一下，正文真的跟着变**——
 * 那条路要经过 CM6 的 dispatch，纯 Node 里根本走不到。
 */
import { userEvent } from "vitest/browser";
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

/** 每条测试自己决定这篇笔记的正文（日志那几条要不同的起点） */
let body = BODY;

const writeNote = vi.fn(async (_path: string, _body: string) => 0);

/**
 * 确认框走 `lib/dialog` 而不是 `window.confirm` —— 见 `noGlobalDialog.test.ts`。
 * 这里必须 mock：真的那个要发 Tauri IPC，浏览器里没有。
 */
const confirmMock = vi.fn(async (_message: string) => true);
vi.mock("./lib/dialog", () => ({ confirm: (m: string) => confirmMock(m) }));

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
        body,
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
  onAppClosing: async () => () => {},
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
  body = BODY;
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
    confirmMock.mockResolvedValue(true);
    await click(node("甲")!.querySelector(".mm-label")!);
    await key("Delete");

    expect(confirmMock).toHaveBeenCalled();
    const text = await saved();
    expect(text).not.toContain("- 甲");
    expect(text).not.toContain("甲一");
    // 邻居不能被牵连
    expect(text).toContain("- 乙");
    expect(text).toContain("## 结论");
  });

  it("确认框点取消就什么都不做", async () => {
    await open();
    confirmMock.mockResolvedValue(false);
    await click(node("甲")!.querySelector(".mm-label")!);
    await key("Delete");
    // 什么都没改 = 什么都不会存盘
    await act(async () => {
      await settle(1100);
    });
    expect(writeNote).not.toHaveBeenCalled();
    expect(texts()).toContain("甲一");
    confirmMock.mockResolvedValue(true);
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

/**
 * 项目日志（§2.10）。和思维导图共用同一条改动路径（`replaceLines`），
 * 所以放在一起测 —— 这一层验的是「记一条进展」真的落到了文件里。
 */
describe("项目日志", () => {
  async function run(label: string) {
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
      await settle(200);
    });
    const item = [...document.querySelectorAll<HTMLElement>(".palette-list button")].find(
      (b) => b.querySelector(".palette-label")?.textContent === label,
    )!;
    expect(item, `命令面板里该有「${label}」`).toBeTruthy();
    await act(async () => {
      item.click();
      await settle(300);
    });
  }

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

  const LF = String.fromCharCode(10);

  it("已经有记录时，新的插在最前面 —— 打开第一眼就是最新状态", async () => {
    body = ["项目描述。", "", "## 2026-07-28 09:10", "", "初步方案定了。"].join(LF);
    await mount();
    await run("记一条进展");
    const lines = (await saved()).split(LF);

    expect(lines[0]).toBe("项目描述。");
    expect(lines[2]).toMatch(/^## \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // 旧记录原样留在下面
    expect(lines[4]).toBe("## 2026-07-28 09:10");
  });

  it("一条记录都没有时排在正文末尾 —— 上面是项目描述", async () => {
    await mount();
    await run("记一条进展");
    const out = await saved();
    const lines = out.split(LF);

    expect(lines[lines.length - 2]).toMatch(/^## \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // 原有内容一行都没少
    expect(out).toContain("## 方法");
    expect(out).toContain("  - 甲一");
  });

  it("插完光标就在标题下面 —— 下一个动作永远是开始写", async () => {
    body = ["## 2026-07-28 09:10", "", "初步方案定了。"].join(LF);
    await mount();
    await run("记一条进展");
    await act(async () => {
      await userEvent.keyboard("跑通了");
      await settle(200);
    });
    const lines = (await saved()).split(LF);
    expect(lines[0]).toMatch(/^## \d{4}/);
    expect(lines[1]).toBe("跑通了");
  });
  it("打开笔记时自动折叠旧记录，只留最近三条展开", async () => {
    // 「文档写太长就看不到最新状态」正是这个功能存在的理由
    const entry = (d: number) => ["## 2026-08-0" + d + " 09:00", "", "第 " + d + " 天做的事", ""];
    // 新的在上面，和「记一条进展」插入的方向一致
    body = [entry(5), entry(4), entry(3), entry(2), entry(1)].flat().join(LF);
    await mount();
    await act(async () => {
      await settle(700);
    });

    const shown = document.querySelector<HTMLElement>(".cm-content")!.innerText;
    // 最近三条（5、4、3）的内容看得见
    for (const d of [5, 4, 3]) expect(shown).toContain("第 " + d + " 天做的事");
    // 更旧的两条被折起来了 —— 标题还在，内容收走
    for (const d of [2, 1]) expect(shown).not.toContain("第 " + d + " 天做的事");
    expect(shown).toContain("2026-08-01 09:00");
    expect(document.querySelectorAll(".cm-fold-placeholder")).toHaveLength(2);
  });
});
