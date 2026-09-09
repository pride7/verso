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
/** 按路径给 frontmatter。项目笔记（`type: project`）打开时的主视图是项目总览 */
let fronts: Record<string, Record<string, unknown>> = {};
let viewResult: ViewResult = { columns: [], rows: [], view: "table", groupBy: null, properties: [] };

const createUntitled = vi.fn(async () => {
  tree = [...tree, doc("未命名", "未命名.md")];
  return { path: "未命名.md", id: "x", title: "未命名" };
});
const renameNote = vi.fn(async (path: string, title: string) => {
  const next = `${title}.md`;
  tree = tree.map((n) => (n.path === path ? doc(title, next) : n));
  // 改完名，下一次查询就该给出新名字。少了这一句，「视图会不会重查」
  // 那条测试无论重不重查都是绿的
  viewResult = {
    ...viewResult,
    rows: viewResult.rows.map((r) => (r.path === path ? { ...r, path: next, title } : r)),
  };
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
        frontmatter: fronts[path] ?? {},
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
  pickImageSavePath: async () => null,
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
  fronts = {};
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

/** 正文上方那个标题的改名框（§4.12）。新建和 F2 都落在这里 */
const input = () => document.querySelector<HTMLInputElement>(".doc-title-input");
/** 侧栏里那个。两个不能同时开着 */
const treeInput = () => document.querySelector<HTMLInputElement>(".tree-rename");
const title = () => document.querySelector<HTMLElement>(".doc-title");
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
  it("建出来就叫「未命名」，光标落在正文上方的标题上并且全选", async () => {
    await mountApp();
    await clickNew();

    // 关键：**没有**弹过窗问名字
    expect(createUntitled).toHaveBeenCalledTimes(1);

    const el = input();
    expect(el, "正文上方该出现一个改名输入框").not.toBeNull();
    expect(el!.value).toBe("未命名");
    expect(document.activeElement, "焦点要在输入框里").toBe(el);
    // 全选，所以直接敲字就是换名字，不必先手动选一遍
    expect([el!.selectionStart, el!.selectionEnd]).toEqual([0, "未命名".length]);
    // 树里那个不能同时开着：两个输入框抢焦点，先失焦的会按「确定」提交，
    // 人看到的是改名框一闪就没了
    expect(treeInput(), "侧栏里不该同时也开一个").toBeNull();
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

/**
 * §4.12 正文上方的标题。
 *
 * 纯 Node 给不出答案的还是**焦点**：这一组的关键在「回车之后光标去了哪儿」，
 * 而那要有真正的输入框、真正的 CodeMirror 和真正的文档焦点才谈得上。
 */
describe("正文上方的标题", () => {
  /** 打开树里的第一篇 */
  async function open(name: string) {
    const row = [...document.querySelectorAll<HTMLElement>(".tree-label")].find(
      (b) => b.textContent === name,
    )!;
    await act(async () => {
      row.click();
      await settle(400);
    });
  }

  it("标题写的是文件名，面包屑不再重复它", async () => {
    tree = [
      { ...doc("数学", "数学.md"), childDir: "数学", children: [doc("线性代数", "数学/线性代数.md")] },
    ];
    await mountApp();
    await open("线性代数");

    expect(title()?.textContent).toBe("线性代数");
    // 面包屑只剩祖先。两处都写的话同一个名字会连着出现两次
    const crumbs = [...document.querySelectorAll(".breadcrumb-link")].map((b) => b.textContent);
    expect(crumbs).toEqual(["数学"]);
  });

  /**
   * **量出来的值，不是查类名**（同 mobile 那条）。标题、改名框、正文三者的
   * 字必须起在同一条竖线上：差几个像素一眼看不出来，但满屏都不对劲；而点一下
   * 标题就跳一下，是能看出来的那种。
   */
  it("标题、改名框、正文的字起在同一条竖线上", async () => {
    bodies["甲.md"] = "正文\n";
    await mountApp();
    await open("甲");

    /** 内容盒的左边 = 字真正开始的地方 */
    const textLeft = (el: Element) =>
      el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
    const line = textLeft(document.querySelector(".cm-line")!);
    expect(Math.abs(textLeft(title()!) - line)).toBeLessThan(1);

    await act(async () => {
      title()!.click();
      await settle(120);
    });
    expect(Math.abs(textLeft(input()!) - line)).toBeLessThan(1);
    // 右边同样对齐 —— 负外边距不能让输入框戳出正文那一栏
    expect(
      Math.abs(
        input()!.getBoundingClientRect().right -
          document.querySelector(".cm-content")!.getBoundingClientRect().right,
      ),
    ).toBeLessThan(1);
  });

  it("点一下标题就地改名，回车之后光标进正文", async () => {
    bodies["甲.md"] = "正文\n";
    await mountApp();
    await open("甲");
    expect(input(), "平时不该有输入框").toBeNull();

    await act(async () => {
      title()!.click();
      await settle(120);
    });
    const el = input();
    expect(el, "点标题要原地变成输入框").not.toBeNull();
    expect(el!.value).toBe("甲");
    expect(document.activeElement).toBe(el);

    await type(el!, "线性代数");
    await key(el!, "Enter");
    await act(async () => {
      await settle(400);
    });

    expect(renameNote).toHaveBeenCalledWith("甲.md", "线性代数");
    expect(title()?.textContent).toBe("线性代数");
    // 回车 = 名字定了，接着写 —— 光标必须落回正文，不能停在半空
    expect(
      document.activeElement?.classList.contains("cm-content"),
      "回车之后焦点该在正文里",
    ).toBe(true);
  });

  it("Esc 放弃改名，名字不变，焦点也回正文", async () => {
    await mountApp();
    await open("甲");
    await act(async () => {
      title()!.click();
      await settle(120);
    });
    await type(input()!, "还没想好");
    await key(input()!, "Escape");

    expect(renameNote).not.toHaveBeenCalled();
    expect(title()?.textContent).toBe("甲");
    expect(document.activeElement?.classList.contains("cm-content")).toBe(true);
  });

  /**
   * F2 改的一定是当前打开的这篇，所以输入框长在标题上 —— 眼睛正看着那儿。
   * 侧栏是开着的，这一条同时钉住「不会两个一起开」。
   */
  it("F2 落在标题上，不落在树里", async () => {
    await mountApp();
    await open("甲");
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }),
      );
      await settle(200);
    });

    expect(input(), "F2 该把标题切进改名态").not.toBeNull();
    expect(treeInput()).toBeNull();
  });

  /**
   * 项目笔记打开时的主视图**就是**项目总览，正文连同标题一起被盖住。
   * 那时候还把改名框放在标题上，等于放在一个看不见的地方。
   */
  it("标题被项目总览盖住时，改名框退回树里", async () => {
    fronts["甲.md"] = { type: "project" };
    await mountApp();
    await open("甲");
    expect(document.querySelector(".project-dashboard"), "该是项目总览").not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }),
      );
      await settle(200);
    });

    expect(treeInput(), "改名框要长在树里").not.toBeNull();
    expect(input()).toBeNull();
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

  /**
   * 作者报的那个：改完名视图不动，要切到别的笔记再切回来才是新的。
   *
   * 那一下不是刷新是**重建**（视图是 widget 里的另一棵 React 树）。真正的
   * 原因有两个，这条把两个一起钉住：改名要发出「内容变了」这个信号
   * （`refresh()` 现在自己发），而那棵树要收得到它（模块级订阅）。
   * 见 DESIGN.md §2.6。
   */
  it("改完名字，视图当场就是新名字 —— 不必切走再切回来", async () => {
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
    const title = () => document.querySelector<HTMLElement>(".dbv-list-title");
    expect(title()!.textContent).toBe("MoE");

    await act(async () => {
      title()!.dispatchEvent(new MouseEvent("contextmenu", {
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
    await act(async () => {
      rename!.click();
      await settle(100);
    });
    const listInput = document.querySelector<HTMLInputElement>(".dbv-list .dbview-rename")!;
    await userEvent.fill(listInput, "MoE 专家模型");
    await key(listInput, "Enter");
    // 改名是一趟后端往返，等它落地
    await act(async () => {
      await settle(500);
    });

    // 这一行没有换过笔记，编辑器和 widget 都还是原来那个
    expect(title()!.textContent).toBe("MoE 专家模型");
  });
});
