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
let frontmatter: Record<string, unknown> = {};
let projectRows: { path: string; title: string; props: Record<string, string> }[] = [];

const writeNote = vi.fn(async (_path: string, _body: string) => 0);
const propSet = vi.fn(async (_path: string, key: string, value: string | null) => {
  if (value === null) {
    const next = { ...frontmatter };
    delete next[key];
    frontmatter = next;
  } else {
    frontmatter = { ...frontmatter, [key]: value };
  }
});

/**
 * 确认框走 `lib/dialog` 而不是 `window.confirm` —— 见 `noGlobalDialog.test.ts`。
 * 这里必须 mock：真的那个要发 Tauri IPC，浏览器里没有。
 */
const confirmMock = vi.fn(async (_message: string) => true);
vi.mock("./lib/dialog", () => ({ confirm: (m: string) => confirmMock(m) }));

vi.mock("./api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "论文.md" }),
    openVault: async () => VAULT,
    tree: async () => [doc("论文", "论文.md")],
    listNotes: async () => [{ path: "论文.md", name: "论文" }] as NoteRef[],
    readNote: async () =>
      ({
        path: "论文.md",
        id: null,
        title: "论文",
        frontmatter,
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
    viewQuery: async () => ({ columns: [], rows: projectRows, view: "table", groupBy: null, properties: [] }),
    propSet: (path: string, key: string, value: string | null) => propSet(path, key, value),
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
  onBackendNotice: async () => () => {},
  onVaultChanged: async () => () => {},
  onAppClosing: async () => () => {},
  onPtyData: async () => () => {},
  onPtyExit: async () => () => {},
  pickVaultFolder: async () => null,
  pickCloneFolder: async () => null,
}));

const { default: App } = await import("./App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  writeNote.mockClear();
  propSet.mockClear();
  body = BODY;
  frontmatter = {};
  projectRows = [];
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
    await settle(600);
  });
}

async function open() {
  await mountApp();
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
  const input = document.querySelector<HTMLTextAreaElement>(".mm-input")!;
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

describe("项目默认视图", () => {
  it("打开项目文档直接进入总览，仍可主动回到 Markdown", async () => {
    frontmatter = { type: "project", status: "进行中" };
    await mountApp();
    expect(document.querySelector(".project-dashboard")).not.toBeNull();
    await click(document.querySelector('.project-icon-btn[aria-label="编辑项目正文"]')!);
    expect(document.querySelector(".project-dashboard")).toBeNull();
    expect(document.querySelector(".editor-host")).not.toBeNull();
  });

  it("左侧项目入口打开跨项目中心，而不是把当前笔记强行设为项目", async () => {
    await mountApp();
    expect(document.querySelector(".project-center")).toBeNull();
    await click(document.querySelector('.rail-btn[aria-label="项目中心"]')!);
    expect(document.querySelector(".project-center")).not.toBeNull();
    expect(frontmatter.type).toBeUndefined();
    await click(document.querySelector('.project-center-head button[aria-label="返回当前笔记"]')!);
    expect(document.querySelector(".project-center")).toBeNull();
  });

  it("项目中心快捷键可以随时打开和关闭", async () => {
    await mountApp();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, altKey: true, bubbles: true }));
      await settle(120);
    });
    expect(document.querySelector(".project-center")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, altKey: true, bubbles: true }));
      await settle(120);
    });
    expect(document.querySelector(".project-center")).toBeNull();
  });

  it("点击当前标签对应的项目卡片也会真正进入单项目总览", async () => {
    frontmatter = { type: "project", status: "进行中" };
    projectRows = [{ path: "论文.md", title: "论文", props: { status: "进行中", summary: "当前结论" } }];
    await mountApp();
    await click(document.querySelector('.rail-btn[aria-label="项目中心"]')!);
    expect(document.querySelector(".project-center")).not.toBeNull();
    await click(document.querySelector(".project-center-card")!);
    expect(document.querySelector(".project-center")).toBeNull();
    expect(document.querySelector(".project-dashboard")).not.toBeNull();
  });

  it("项目中心可以把当前普通笔记原地设为项目", async () => {
    await mountApp();
    await click(document.querySelector('.rail-btn[aria-label="项目中心"]')!);
    await click([...document.querySelectorAll(".project-center-head button")].find((button) => button.textContent === "将当前笔记设为项目")!);
    expect(frontmatter.type).toBe("project");
    expect(document.querySelector(".project-center")).toBeNull();
    expect(document.querySelector(".project-dashboard")).not.toBeNull();
  });
});

/** 进入节点编辑态并改好草稿，但不替用户按确认键。 */
async function draft(nodeText: string, text: string): Promise<HTMLTextAreaElement> {
  await act(async () => {
    node(nodeText)!.querySelector<HTMLElement>(".mm-label")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle(100);
  });
  const input = document.querySelector<HTMLTextAreaElement>(".mm-input")!;
  await act(async () => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(60);
  });
  return input;
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
    await settle(150);
  });
}

/**
 * 在节点上右键 —— **桌面上打开菜单只有这一条路**。节点上那个 `⋯` 只在没有右键
 * 的设备上出现（`.mindmap.is-touch` / `hover: none`），它归 mobile 那份测试管
 */
const menuOf = async (n: HTMLElement) => {
  await act(async () => {
    n.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }),
    );
    await settle(150);
  });
};

const items = () => [...document.querySelectorAll<HTMLElement>(".mm-menu button")].map((b) => b.textContent);

const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>(".mm-menu button")].find((b) => b.textContent === label);

/**
 * 画布的相机。**读的是真实的 `transform`** —— 平移和缩放全靠它，
 * 而这一层正是纯 Node 里给不出答案的（happy-dom 没有布局，box 恒为 0）
 */
function cam(): { x: number; y: number; k: number } {
  const t = document.querySelector<HTMLElement>(".mm-layer")!.style.transform;
  const [, x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(t)!;
  const [, k] = /scale\(([-\d.]+)\)/.exec(t)!;
  return { x: +x, y: +y, k: +k };
}

// 手势一律走 pointer：安卓 WebView 合成的鼠标事件既晚又只有一根手指
const finger = (type: string, id: number, x: number, y: number) =>
  new PointerEvent(type, {
    pointerId: id,
    pointerType: "touch",
    isPrimary: id === 1,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });

async function touch(steps: () => void) {
  await act(async () => {
    steps();
    await settle(60);
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

    expect(document.querySelector<HTMLTextAreaElement>(".mm-input")!.value).toBe("甲一");
    await typeAndEnter("甲之一");

    // 缩进和 `- ` 一个都没丢
    expect(await saved()).toContain("  - 甲之一");
    expect(texts()).toContain("甲之一");
  });

  describe("编辑会话", () => {
    it("点背景确认草稿，轻微手抖不会顺便拖动画布", async () => {
      await open();
      await draft("甲一", "甲之一");
      const canvas = document.querySelector<HTMLElement>(".mm-canvas")!;
      const before = cam();

      await touch(() => canvas.dispatchEvent(finger("pointerdown", 1, 300, 300)));
      await touch(() => window.dispatchEvent(finger("pointermove", 1, 302, 301)));
      await touch(() => window.dispatchEvent(finger("pointerup", 1, 302, 301)));

      expect(document.querySelector(".mm-input"), "点背景后应当退出编辑态").toBeNull();
      expect(cam(), "没有越过拖动阈值时画布不该移动").toEqual(before);
      expect(await saved()).toContain("  - 甲之一");
    });

    it("点另一个节点会先确认当前草稿，再选中目标", async () => {
      await open();
      await draft("甲一", "甲之一");
      await act(async () => {
        await userEvent.click(node("乙")!.querySelector<HTMLElement>(".mm-label")!);
        await settle(180);
      });
      expect(node("乙")!.classList).toContain("is-selected");
      expect(document.querySelector(".mm-input")).toBeNull();
      expect(await saved()).toContain("  - 甲之一");
    });

    it("Esc 取消本次草稿，不把改动写回正文", async () => {
      await open();
      const input = await draft("甲一", "不该保存");
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await settle(180);
      });
      expect(document.querySelector(".mm-input")).toBeNull();
      expect(texts()).toContain("甲一");
      await act(async () => {
        await settle(1050);
      });
      expect(writeNote).not.toHaveBeenCalled();
    });

    it("新建空节点后按 Esc，会撤掉空节点而不是留下一个孤立列表符号", async () => {
      await open();
      await click(node("乙")!.querySelector(".mm-label")!);
      await key("Enter");
      const input = document.querySelector<HTMLTextAreaElement>(".mm-input")!;
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await settle(250);
      });
      expect(document.querySelector(".mm-input")).toBeNull();
      expect(texts().filter((text) => text === "（空）")).toHaveLength(0);
      const out = await saved();
      expect(out).toBe(BODY);
    });

    it("中文输入法选词时的 Enter 不会提前提交", async () => {
      await open();
      const input = await draft("甲一", "仍在组词");
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }));
        await settle(100);
      });
      expect(document.querySelector(".mm-input"), "输入法 Enter 后仍应留在编辑态").toBe(input);
    });

    it("Tab 确认编辑并把焦点留在导图，不跳到顶栏按钮", async () => {
      await open();
      const input = await draft("甲一", "甲之一");
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
        await settle(180);
      });
      expect(document.querySelector(".mm-input")).toBeNull();
      expect(document.activeElement).toBe(document.querySelector(".mindmap"));
      expect(await saved()).toContain("  - 甲之一");
    });

    it("点搜索框会确认草稿，但焦点留在搜索框里", async () => {
      await open();
      await draft("甲一", "甲之一");
      const search = document.querySelector<HTMLInputElement>(".mm-search input")!;
      await act(async () => {
        await userEvent.click(search);
        await settle(180);
      });
      expect(document.activeElement).toBe(search);
      expect(document.querySelector(".mm-input")).toBeNull();
      expect(await saved()).toContain("  - 甲之一");
    });

    it("顶栏按钮上的 Enter 只操作按钮，不冒泡成新增同级节点", async () => {
      await open();
      const zoom = document.querySelector<HTMLElement>('.mm-tools button[aria-label="放大"]')!;
      zoom.focus();
      const before = cam().k;
      await act(async () => {
        await userEvent.keyboard("{Enter}");
        await settle(180);
      });
      expect(cam().k).toBeGreaterThan(before);
      expect(document.querySelector(".mm-input"), "Enter 不该顺便创建节点").toBeNull();
      expect(writeNote).not.toHaveBeenCalled();
    });

    it("编辑框里右键仍是系统文本菜单，不弹节点菜单", async () => {
      await open();
      const input = await draft("甲一", "甲之一");
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      expect(input.dispatchEvent(event), "编辑框右键不应被 preventDefault").toBe(true);
      expect(document.querySelector(".mm-menu")).toBeNull();
      expect(document.querySelector(".mm-input")).toBe(input);
    });
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
    await click(node("甲")!.querySelector(".mm-label")!);
    await key(" ");
    expect(texts()).not.toContain("甲一");
    // 右边缘不再挂按钮，只在节点内部被动提示还藏着几个
    expect(node("甲")!.querySelector(".mm-fold")).toBeNull();
    expect(node("甲")!.querySelector(".mm-collapsed-count")!.textContent).toBe("+1");
  });

  it("折叠数字统计整棵子树，不只算直接孩子", async () => {
    body = ["## 方法", "", "- 甲", "  - 甲一", "    - 甲一甲"].join("\n");
    await open();
    await click(node("甲")!.querySelector(".mm-label")!);
    await key(" ");
    expect(node("甲")!.querySelector(".mm-collapsed-count")!.textContent).toBe("+2");
  });

  it("选中节点时高亮从根到它的路径", async () => {
    await open();
    await click(node("甲一")!.querySelector(".mm-label")!);
    for (const edge of [[0, 1], [1, 3], [3, 4]]) {
      expect(document.querySelector(`.mm-links path[data-from="${edge[0]}"][data-to="${edge[1]}"]`)!.classList)
        .toContain("is-active");
    }
    expect(node("甲一")!.classList).toContain("is-path");
    expect(node("乙")!.classList).not.toContain("is-path");
  });

  it("搜索会展开命中项的折叠祖先，并可用 Enter 逐个定位", async () => {
    await open();
    await click(node("甲")!.querySelector(".mm-label")!);
    await key(" ");
    expect(node("甲一")).toBeUndefined();

    const input = document.querySelector<HTMLInputElement>(".mm-search input")!;
    await act(async () => {
      input.focus();
      await userEvent.keyboard("甲一");
      await settle(200);
    });
    expect(node("甲一"), "搜索时命中项不该继续藏在折叠分支里").toBeTruthy();
    expect(node("甲一")!.classList).toContain("is-search-match");
    expect(node("乙")!.classList).toContain("is-dimmed");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle(120);
    });
    expect(node("甲一")!.classList).toContain("is-selected");

    await act(async () => {
      await userEvent.keyboard("{Control>}a{/Control}{Backspace}");
      await settle(150);
    });
    expect(node("甲一"), "清空搜索后应恢复原来的折叠状态").toBeUndefined();
  });

  it("只看当前分支，随时可以返回全图", async () => {
    await open();
    await menuOf(node("甲")!);
    await click(item("只看这一支")!);
    expect(new Set(texts())).toEqual(new Set(["甲", "甲一"]));
    expect(document.querySelector(".mm-mode-bar")!.textContent).toContain("仅看：甲");
    await click([...document.querySelectorAll<HTMLElement>(".mm-mode-bar button")]
      .find((button) => button.textContent === "显示全部")!);
    expect(texts()).toEqual(expect.arrayContaining(["论文", "方法", "甲", "乙", "结论"]));
  });

  it("单指拖背景 = 平移", async () => {
    await open();
    const canvas = document.querySelector<HTMLElement>(".mm-canvas")!;
    const before = cam();

    await touch(() => canvas.dispatchEvent(finger("pointerdown", 1, 200, 200)));
    await touch(() => window.dispatchEvent(finger("pointermove", 1, 260, 230)));
    await touch(() => window.dispatchEvent(finger("pointerup", 1, 260, 230)));

    expect(cam().x).toBeCloseTo(before.x + 60, 0);
    expect(cam().y).toBeCloseTo(before.y + 30, 0);
    expect(cam().k, "拖动不该改缩放").toBeCloseTo(before.k, 5);
  });

  it("手指按在节点上不会把整张图拖跑", async () => {
    // 节点上的按下要留给点选、双击和那几个按钮。这一条坏掉的表现是
    // 「想点个节点，图先滑走了」—— 桌面上靠 stopPropagation 挡着，
    // 换成 pointer 之后靠的是 closest('.mm-node')
    await open();
    const label = node("乙")!.querySelector<HTMLElement>(".mm-label")!;
    const before = cam();

    await touch(() => label.dispatchEvent(finger("pointerdown", 1, 200, 200)));
    await touch(() => window.dispatchEvent(finger("pointermove", 1, 300, 300)));
    await touch(() => window.dispatchEvent(finger("pointerup", 1, 300, 300)));

    expect(cam()).toEqual(before);
  });

  it("双指捏合 = 缩放", async () => {
    await open();
    const canvas = document.querySelector<HTMLElement>(".mm-canvas")!;
    const before = cam();

    await touch(() => {
      canvas.dispatchEvent(finger("pointerdown", 1, 150, 200));
      canvas.dispatchEvent(finger("pointerdown", 2, 250, 200));
    });
    // 两指之间从 100 撑到 200 —— 放大一倍
    await touch(() => {
      window.dispatchEvent(finger("pointermove", 1, 100, 200));
      window.dispatchEvent(finger("pointermove", 2, 300, 200));
    });
    const zoomed = cam().k;
    await touch(() => {
      window.dispatchEvent(finger("pointerup", 1, 100, 200));
      window.dispatchEvent(finger("pointerup", 2, 300, 200));
    });

    expect(zoomed).toBeCloseTo(Math.min(2.5, before.k * 2), 1);
    // 松手不该让它弹回去
    expect(cam().k).toBeCloseTo(zoomed, 5);
  });

  it("捏合时有一根手指落在节点上，照样是缩放", async () => {
    // 真机上这是常态：两根手指随便落，其中一根压在某个节点上。
    // 漏掉它的话会变成「一根在缩放、一根在平移」，图直接乱飞
    await open();
    const canvas = document.querySelector<HTMLElement>(".mm-canvas")!;
    const label = node("乙")!.querySelector<HTMLElement>(".mm-label")!;
    const before = cam();

    await touch(() => {
      label.dispatchEvent(finger("pointerdown", 1, 150, 200));
      canvas.dispatchEvent(finger("pointerdown", 2, 250, 200));
    });
    await touch(() => {
      window.dispatchEvent(finger("pointermove", 1, 100, 200));
      window.dispatchEvent(finger("pointermove", 2, 300, 200));
    });

    expect(cam().k).toBeGreaterThan(before.k * 1.5);
  });

  it("加减号按钮也能缩放 —— 手机上没有滚轮", async () => {
    await open();
    const before = cam().k;
    await click(document.querySelector('.mm-tools button[aria-label="放大"]')!);
    expect(cam().k).toBeGreaterThan(before);
    await click(document.querySelector('.mm-tools button[aria-label="缩小"]')!);
    expect(cam().k).toBeCloseTo(before, 5);
  });

  it("比例按钮显示真实缩放值，点它回到 100%", async () => {
    await open();
    await click(document.querySelector('.mm-tools button[aria-label="放大"]')!);
    const percent = [...document.querySelectorAll<HTMLElement>(".mm-tools button")]
      .find((button) => button.textContent?.endsWith("%"))!;
    expect(percent.textContent).not.toBe("100%");
    await click(percent);
    expect(cam().k).toBeCloseTo(1, 5);
    expect(percent.textContent).toBe("100%");
  });

  it("选中视口外的节点会把它带回可视区", async () => {
    await open();
    const canvas = document.querySelector<HTMLElement>(".mm-canvas")!;
    await touch(() => canvas.dispatchEvent(finger("pointerdown", 1, 300, 300)));
    await touch(() => window.dispatchEvent(finger("pointermove", 1, -900, -700)));
    await touch(() => window.dispatchEvent(finger("pointerup", 1, -900, -700)));
    await click(node("收尾")!.querySelector(".mm-label")!);
    const box = node("收尾")!.getBoundingClientRect();
    const viewport = canvas.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(viewport.left + 20);
    expect(box.right).toBeLessThanOrEqual(viewport.right - 20);
    expect(box.top).toBeGreaterThanOrEqual(viewport.top + 20);
    expect(box.bottom).toBeLessThanOrEqual(viewport.bottom - 20);
  });

  it("Ctrl+Z / Ctrl+Shift+Z 直接撤销和重做图上的编辑", async () => {
    await open();
    await act(async () => {
      node("甲一")!.querySelector<HTMLElement>(".mm-label")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await settle(80);
    });
    await typeAndEnter("甲之一");
    expect(texts()).toContain("甲之一");
    await key("z", { ctrlKey: true });
    expect(texts()).toContain("甲一");
    await key("z", { ctrlKey: true, shiftKey: true });
    expect(texts()).toContain("甲之一");
  });

  it("导图打开时不再叠着正文的浮动目录", async () => {
    localStorage.setItem("verso.tocFloat", "true");
    await open();
    expect(document.querySelector(".outline-float")).toBeNull();
  });

  it("Esc 回到正文", async () => {
    await open();
    await key("Escape");
    expect(document.querySelector(".mindmap")).toBeNull();
    expect(document.querySelector(".cm-content")).not.toBeNull();
  });

  /**
   * 长条目换行。**只有真实布局引擎知道一行能放几个字** —— 高度是量出来再拿去
   * 排版的（两趟），纯 Node 里量到的恒为 0，排出来的图会全叠在一起而测试全绿
   */
  describe("换行", () => {
    const LONG =
      "把 Golub-Kahan 双对角化那一段重写一遍，先说清楚为什么直接求逆会放大误差，再给一个数值例子";

    it("长条目不再截成一行，节点跟着变高", async () => {
      body = ["## 待办", "", `- ${LONG}`, "- 短的一条"].join("\n");
      await open();

      const long = node(LONG)!;
      expect(long, "文字该原样在图上，不该被截断成 `把 Golub...`").toBeTruthy();
      expect(long.offsetHeight, "换行了就该比一行高").toBeGreaterThan(40);
      expect(node("短的一条")!.offsetHeight).toBeLessThanOrEqual(34);
    });

    it("变高的节点把后面的兄弟顶下去，谁也不压谁", async () => {
      body = ["## 待办", "", `- ${LONG}`, `- ${LONG}`, "- 短的一条"].join("\n");
      await open();

      // 同一列（x 相同）的节点两两不能在竖直方向重叠
      const cols = new Map<number, DOMRect[]>();
      for (const el of document.querySelectorAll<HTMLElement>(".mm-node")) {
        const r = el.getBoundingClientRect();
        const key = Math.round(r.left);
        (cols.get(key) ?? cols.set(key, []).get(key)!).push(r);
      }
      for (const rects of cols.values()) {
        rects.sort((a, b) => a.top - b.top);
        for (let i = 1; i < rects.length; i++) {
          expect(rects[i].top, "同一列的两个节点叠在一起了").toBeGreaterThanOrEqual(
            rects[i - 1].bottom - 0.5,
          );
        }
      }
    });

    it("再长也封顶四行 —— 一整段贴进来不该把图撑成一堵墙", async () => {
      body = ["## 待办", "", `- ${LONG.repeat(4)}`].join("\n");
      await open();
      const long = [...document.querySelectorAll<HTMLElement>(".mm-node")].find((n) =>
        n.querySelector(".mm-text")?.textContent?.startsWith("把 Golub"),
      )!;
      expect(long.offsetHeight).toBeLessThan(110);
    });

    it("连线接的是各自的中线 —— 高矮不一时不能连到框外面", async () => {
      body = ["## 待办", "", `- ${LONG}`].join("\n");
      await open();

      const long = node(LONG)!;
      const path = document.querySelector<SVGPathElement>(".mm-links path")!;
      // SVG 和节点都挂在 `.mm-layer` 上，坐标同一套（`offsetTop` 不受画布缩放影响）
      const end = path.getPointAtLength(path.getTotalLength());
      expect(end.y).toBeCloseTo(long.offsetTop + long.offsetHeight / 2, 0);
      // 按固定高度连的话会落在框的上沿附近，这一条就是钉那个的
      expect(long.offsetHeight).toBeGreaterThan(40);
    });
  });

  /** 节点宽度可以独立拖动，记在这篇笔记的本机视图偏好里（不进文件，§4.7） */
  describe("拖宽度", () => {
    const drag = async (dx: number, text = "乙") => {
      const handle = node(text)!.querySelector<HTMLElement>(".mm-resize")!;
      expect(handle, "每个节点右边缘都该有拖杆").toBeTruthy();
      await act(async () => {
        handle.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            clientX: 500,
            bubbles: true,
            cancelable: true,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointermove", { pointerId: 1, clientX: 500 + dx, bubbles: true }),
        );
        window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
        await settle(120);
      });
    };

    it("拖右边缘，只改变当前节点的宽度", async () => {
      await open();
      const before = new Map(texts().map((text) => [text, node(text!)!.offsetWidth]));
      await drag(120);

      expect(node("乙")!.offsetWidth).toBeGreaterThan(before.get("乙")!);
      for (const [text, width] of before) {
        if (text === "乙") continue;
        expect(node(text!)!.offsetWidth, `拖「乙」不该改动「${text}」`).toBe(width);
      }
    });

    it("拖宽之后连线仍从父节点右边缘出发", async () => {
      await open();
      await drag(120, "论文");

      const parent = node("论文")!;
      const child = node("方法")!;
      const path = document.querySelector<SVGPathElement>('.mm-links path[data-from="0"][data-to="1"]')!;
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(path.getTotalLength());
      expect(start.x, "连线起点钻进父节点里面了").toBeCloseTo(
        parent.offsetLeft + parent.offsetWidth,
        0,
      );
      expect(end.x, "连线终点没有落在子节点左边缘").toBeCloseTo(child.offsetLeft, 0);
    });

    it("节点右边缘中点完整属于拖杆，不再被折叠按钮盖住", async () => {
      await open();
      const parent = node("方法")!;
      const box = parent.getBoundingClientRect();
      const hit = document.elementFromPoint(box.right - 2, box.top + box.height / 2);
      expect(hit?.classList.contains("mm-resize"), "右边缘中点没有命中拖宽把手").toBe(true);
      expect(parent.querySelector(".mm-fold"), "节点边缘不该再出现折叠按钮").toBeNull();
    });

    it("变宽之后列与列不会叠在一起", async () => {
      await open();
      await drag(140);
      const cols = new Map<number, number>();
      for (const el of document.querySelectorAll<HTMLElement>(".mm-node")) {
        cols.set(el.offsetLeft, Math.max(cols.get(el.offsetLeft) ?? 0, el.offsetWidth));
      }
      const xs = [...cols.keys()].sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i], "后一列的左边该在前一列右边之外").toBeGreaterThan(xs[i - 1] + cols.get(xs[i - 1])!);
      }
    });

    it("拖完记在本机，下次打开还是这个宽度", async () => {
      await open();
      await drag(100);
      const wide = node("乙")!.offsetWidth;
      const savedWidths = [...Array(localStorage.length)].map((_, i) => localStorage.key(i))
        .find((key) => key?.startsWith("verso.mindmapNodeWidths:"));
      expect(savedWidths, "该把这篇笔记的节点宽度记在本机").toBeTruthy();

      // 关掉再进来
      await key("Escape");
      await act(async () => {
        document.querySelector<HTMLElement>('.rail-btn[aria-label="思维导图"]')!.click();
        await settle(300);
      });
      expect(node("乙")!.offsetWidth).toBe(wide);
    });

    it("拖太窄会被拦住 —— 窄到放不下两个字就不是「可用」了", async () => {
      await open();
      await drag(-2000);
      expect(node("乙")!.offsetWidth).toBe(150);
    });

    it("双击拖杆复原", async () => {
      await open();
      await drag(120);
      await drag(80, "甲");
      const 甲宽度 = node("甲")!.offsetWidth;
      await act(async () => {
        node("乙")!
          .querySelector<HTMLElement>(".mm-resize")!
          .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await settle(120);
      });
      expect(node("乙")!.offsetWidth).toBe(230);
      expect(node("甲")!.offsetWidth, "复原乙不该顺便复原甲").toBe(甲宽度);
    });
  });

  it("正文只有一个一级标题时，它就是根 —— 不再多套一层笔记名", async () => {
    body = ["# Errors Are Evidence", "", "## 1 项目逻辑", "", "## 2 写作逻辑"].join("\n");
    await open();

    expect(texts()).not.toContain("论文");
    expect(texts()).toEqual(
      expect.arrayContaining(["Errors Are Evidence", "1 项目逻辑", "2 写作逻辑"]),
    );
    // 顶栏仍然写着笔记名，什么都没丢
    expect(document.querySelector(".mm-title")!.textContent).toContain("论文");
    // 画得重的那一个是它
    expect(node("Errors Are Evidence")!.className).toContain("is-top");
  });

  it("让位之后的根是正文里的真行 —— 改得动、删得掉", async () => {
    // 合成的根不行（改名走文档树）。这一条决定了菜单里那几项是不是摆设
    body = ["# 题目", "", "## 一节"].join("\n");
    await open();
    await menuOf(node("题目")!);
    expect(items()).toEqual(expect.arrayContaining(["改字", "删除"]));

    await click(item("改字")!);
    await typeAndEnter("新题目");
    expect(await saved()).toContain("# 新题目");
  });

  it("让位之后 Tab 加的是它的子级 —— 选中不会落在看不见的笔记名上", async () => {
    body = ["# 题目", "", "## 一节"].join("\n");
    await open();
    await key("Tab");
    await typeAndEnter("二节");
    expect((await saved()).split("\n")).toContain("## 二节");
  });

  it("桌面上节点是干净的：没有按钮，只有字", async () => {
    // 一张图几十个节点，每个都挂着一排图标的话，眼睛先看见的是按钮不是内容。
    // 桌面上有右键，那排按钮不该存在（`⋯` 只在没有右键的设备上出现）
    await open();
    const acts = node("乙")!.querySelector<HTMLElement>(".mm-acts")!;
    expect(getComputedStyle(acts).display, "桌面上不该有动作按钮").toBe("none");
    expect(node("方法")!.querySelector(".mm-fold"), "折叠也应该收进右键菜单").toBeNull();
    // 勾选框是例外：它本来就是内容的一部分，而且现在自己就是按钮
    expect(node("乙")!.querySelector(".mm-check")).toBeNull();
  });

  it("任务项的勾选框自己就是按钮，点一下就勾上", async () => {
    body = ["## 待办", "", "- [ ] 补齐那一节"].join("\n");
    await open();
    await click(node("补齐那一节")!.querySelector(".mm-check")!);
    expect(await saved()).toContain("- [x] 补齐那一节");
  });

  it("勾上的任务项：框里有勾，文字带删除线", async () => {
    body = ["## 待办", "", "- [x] 整理参考文献"].join("\n");
    await open();
    const n = node("整理参考文献")!;
    const svg = n.querySelector<SVGElement>(".mm-check svg")!;
    expect(svg, "勾没画出来").not.toBeNull();
    // 在 DOM 里不等于看得见：量一下它真的占了地方、也真的有颜色
    const box = svg.getBoundingClientRect();
    expect(box.width, "勾是零宽的").toBeGreaterThan(6);
    expect(getComputedStyle(svg).color).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(n.querySelector(".mm-text")!).textDecorationLine).toContain("line-through");
  });

  it("勾选框的命中区不许盖住整个节点", async () => {
    // `::after` 撑出来的那圈命中区如果拿 `.mm-node` 当包含块，会盖住一整个节点
    // —— 字点不动、双击改不了，而截图上什么都看不出来
    body = ["## 待办", "", "- [ ] 补齐那一节"].join("\n");
    await open();
    const label = node("补齐那一节")!.querySelector<HTMLElement>(".mm-text")!;
    const r = label.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    expect(label.contains(hit), "点在文字上，碰到的却是勾选框的命中区").toBe(true);
  });

  it("右键菜单里有全部动作", async () => {
    await open();
    await menuOf(node("乙")!);
    expect(items()).toEqual(
      expect.arrayContaining(["改字", "加子级", "加同级", "回到正文这一行", "删除"]),
    );
  });

  it("菜单里的「加同级」等价于 Enter", async () => {
    await open();
    await menuOf(node("乙")!);
    await click(item("加同级")!);
    await typeAndEnter("丙");
    expect(await saved()).toContain("- 丙");
    expect(texts()).toContain("丙");
  });

  it("菜单里的「改字」等价于双击", async () => {
    await open();
    await menuOf(node("甲一")!);
    await click(item("改字")!);
    expect(document.querySelector<HTMLTextAreaElement>(".mm-input")!.value).toBe("甲一");
    await typeAndEnter("甲之一");
    expect(await saved()).toContain("  - 甲之一");
  });

  it("编辑长节点用可长高的多行输入框", async () => {
    await open();
    await menuOf(node("甲一")!);
    await click(item("改字")!);
    const input = document.querySelector<HTMLTextAreaElement>(".mm-input")!;
    expect(input.tagName).toBe("TEXTAREA");
    await act(async () => {
      input.value = "一段足够长的节点内容，编辑时应该随着换行长高，而不是塞进只有一行高的小输入框。".repeat(4);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await settle(100);
    });
    expect(input.offsetHeight).toBeGreaterThan(24);
    expect(input.offsetHeight).toBeLessThanOrEqual(112);
  });

  it("菜单可以同级上移，整棵子树保持在一起", async () => {
    await open();
    await menuOf(node("乙")!);
    await click(item("上移")!);
    const out = await saved();
    expect(out.indexOf("- 乙")).toBeLessThan(out.indexOf("- 甲"));
    expect(out.indexOf("  - 甲一")).toBeGreaterThan(out.indexOf("- 甲"));
  });

  it("触屏等价入口可以选择新父级", async () => {
    await open();
    await menuOf(node("乙")!);
    await click(item("移动到…")!);
    expect(document.querySelector(".mm-mode-bar")!.textContent).toContain("选择「乙」的新父级");
    await click(node("甲")!.querySelector(".mm-label")!);
    expect(await saved()).toContain("- 甲\n  - 甲一\n  - 乙");
  });

  it("桌面可把节点拖到另一节点中间来改父级", async () => {
    await open();
    const source = node("乙")!.querySelector<HTMLElement>(".mm-label")!;
    const target = node("甲")!;
    const transfer = new DataTransfer();
    await act(async () => {
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
      await settle(80);
    });
    const box = target.getBoundingClientRect();
    await act(async () => {
      target.dispatchEvent(new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientY: box.top + box.height / 2,
        dataTransfer: transfer,
      }));
      await settle(80);
    });
    expect(target.classList).toContain("is-drop-child");
    await act(async () => {
      target.dispatchEvent(new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientY: box.top + box.height / 2,
        dataTransfer: transfer,
      }));
      await settle(250);
    });
    expect(await saved()).toContain("- 甲\n  - 甲一\n  - 乙");
  });

  it("菜单里的「删除」照样连子树一起删、照样问一句", async () => {
    await open();
    confirmMock.mockResolvedValue(true);
    await menuOf(node("甲")!);
    await click(item("删除")!);

    expect(confirmMock).toHaveBeenCalled();
    const text = await saved();
    expect(text).not.toContain("甲一");
    expect(text).toContain("- 乙");
  });

  it("根节点的菜单里没有「删除」和「加同级」", async () => {
    // 根是笔记本身。删得掉的话删的是整篇正文，加同级则根本无处可加
    await open();
    await menuOf(node("论文")!);
    const list = items();
    expect(list).toContain("加子级");
    expect(list).not.toContain("删除");
    expect(list).not.toContain("加同级");
  });

  it("菜单开着时 Esc 只关菜单，不退出导图", async () => {
    await open();
    await menuOf(node("乙")!);
    await key("Escape");
    expect(document.querySelector(".mm-menu")).toBeNull();
    expect(document.querySelector(".mindmap"), "导图不该跟着关掉").not.toBeNull();
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
