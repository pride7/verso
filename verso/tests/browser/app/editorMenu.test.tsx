/**
 * 正文里的右键菜单。DESIGN.md §4.10
 *
 * 为什么要走 App 整条链路：菜单是**编辑器报坐标、App 弹菜单、菜单再回过头
 * 改编辑器**（和文档图标那条链路同一个路子）。三段各自都对、接起来不动的
 * 情况完全可能 —— 比如菜单开着时选区已经被点没了，那么「加粗」加到的是
 * 一个空选区。
 *
 * 而且 `posAtCoords` 要真实布局：纯 Node 里它永远返回 null。
 */
import { EditorView } from "@codemirror/view";
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

const NOTE = "甲.md";
/** 磁盘上的正文。写回去的那一份也存这儿，断言直接读它 */
let saved = "";
let body = "";

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

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: NOTE }),
    openVault: async () => VAULT,
    tree: async () => [doc("甲", NOTE)],
    listNotes: async () => [{ path: NOTE, name: "甲" }] as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: null,
        title: "甲",
        frontmatter: {},
        frontmatterText: null,
        body,
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: async (_path: string, text: string) => {
      saved = text;
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
    propDefSet: async () => {},
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
    workspaceGet: async () => ({ tabs: [NOTE], active: 0, pinnedCount: 0 }),
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
  body = "第一行正文\n\n第二行正文\n";
  saved = "";
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

const menu = () => document.querySelector<HTMLElement>(".ctx");
const items = () => [...document.querySelectorAll<HTMLButtonElement>(".ctx button")];
const item = (label: string) => items().find((b) => b.textContent?.startsWith(label));

/** 展开二级菜单（文本格式 / 段落设置 / 插入），返回里面那几条 */
async function openSub(label: string) {
  await act(async () => {
    item(label)!.click();
    await settle(120);
  });
  const sub = document.querySelector<HTMLElement>(".ctx-sub");
  expect(sub, `「${label}」没展开`).not.toBeNull();
  return [...sub!.querySelectorAll<HTMLButtonElement>("button")];
}

/** 展开二级菜单并点里面那一条 */
async function clickSub(parent: string, label: string) {
  const rows = await openSub(parent);
  const hit = rows.find((b) => b.textContent?.startsWith(label))!;
  expect(hit, `「${parent}」里没有「${label}」`).toBeTruthy();
  await act(async () => {
    hit.click();
    await settle(400);
  });
}

/** 等自动保存把正文落盘 */
const flush = () => act(async () => void (await settle(1200)));

/** 在正文里某个字上按右键 */
async function rightClickAt(text: string) {
  const line = [...document.querySelectorAll<HTMLElement>(".cm-line")].find((l) =>
    l.textContent?.includes(text),
  )!;
  const box = line.getBoundingClientRect();
  await act(async () => {
    line.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 8,
        clientY: box.top + box.height / 2,
      }),
    );
    await settle(120);
  });
}

/**
 * 选中第一行的前三个字。
 *
 * 直接派发一次 CM6 的选区更新，不去模拟按住鼠标拖 —— 这个文件要验的是
 * 菜单，不是选区怎么产生的。`findFromDOM` 是 CM6 给的正路。
 */
function selectHead(n = 3) {
  const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
  view.dispatch({ selection: { anchor: 0, head: n } });
}

describe("正文里的右键菜单（§4.10）", () => {
  it("右键弹出来的是 Verso 的菜单，而且拦掉了 webview 自带那个", async () => {
    await mountApp();
    const line = [...document.querySelectorAll<HTMLElement>(".cm-line")][0];
    const box = line.getBoundingClientRect();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 8,
      clientY: box.top + 4,
    });
    await act(async () => {
      line.dispatchEvent(event);
      await settle(120);
    });

    expect(menu(), "右键什么都没弹 = 用户看到的是浏览器那个菜单").not.toBeNull();
    // 不 preventDefault 的话，webview 自带的菜单会盖在我们这个上面
    expect(event.defaultPrevented).toBe(true);
  });

  it("一级是三个二级菜单加剪贴板，没选东西时剪切复制点不动", async () => {
    await mountApp();
    await rightClickAt("第一行");

    const labels = items().map((b) => b.textContent);
    for (const want of ["文本格式", "段落设置", "插入", "剪切", "复制", "粘贴", "全选"]) {
      expect(labels.some((l) => l?.startsWith(want)), `菜单里没有「${want}」`).toBe(true);
    }
    expect(item("剪切")!.disabled, "没选东西还能剪切？").toBe(true);
    expect(item("复制")!.disabled).toBe(true);
    expect(item("粘贴")!.disabled, "粘贴不依赖选区").toBe(false);
  });

  it("「文本格式」里五种行内格式都在，右边标着当前键位", async () => {
    await mountApp();
    await rightClickAt("第一行");
    const rows = await openSub("文本格式");
    expect(rows.map((button) => {
      const clone = button.cloneNode(true) as HTMLElement;
      clone.querySelector(".ctx-key")?.remove();
      return clone.textContent;
    })).toEqual([
      "加粗",
      "斜体",
      "行内代码",
      "高亮",
      "删除线",
    ]);
    // 键位从命令表现取 —— 用户改过之后这里显示的必须是他那一套（§6.6）
    expect(rows[0].querySelector(".ctx-key")?.textContent).toContain("B");
  });

  /** 「插入」直接复用 `/` 菜单那张表：两处是同一件事，各维护一份迟早分叉 */
  it("「插入」列的就是 / 菜单那些条目", async () => {
    await mountApp();
    await rightClickAt("第一行");
    const rows = (await openSub("插入")).map((b) => b.textContent);
    for (const want of ["表格", "代码块", "块级公式", "分隔线", "插入模板"]) {
      expect(rows.some((l) => l?.startsWith(want)), `插入里没有「${want}」`).toBe(true);
    }
  });

  it("「插入 → 表格」把一张空表插在光标处", async () => {
    await mountApp();
    await rightClickAt("第一行");
    await clickSub("插入", "表格");
    await flush();
    expect(saved).toContain("|---|---|");
  });

  it("「段落设置 → 引用」把这一行变成引用，再点一次变回去", async () => {
    await mountApp();
    await rightClickAt("第二行");
    await clickSub("段落设置", "引用");
    await flush();
    expect(saved.split("\n")[2]).toBe("> 第二行正文");

    await rightClickAt("第二行");
    await clickSub("段落设置", "引用");
    await flush();
    expect(saved.split("\n")[2], "同一种再点一次该变回正文").toBe("第二行正文");
  });

  it("「段落设置 → 二级标题」换掉的是已有的行首标记，不是叠上去", async () => {
    body = "# 本来是一级\n";
    await mountApp();
    await rightClickAt("本来是一级");
    await clickSub("段落设置", "二级标题");
    await flush();
    expect(saved.split("\n")[0]).toBe("## 本来是一级");
  });

  /**
   * 这条是这个文件存在的理由：菜单开着的时候选区**必须还在**。
   * 中间任何一步把光标挪掉，加粗就加到一个空位置上，表现是「点了没反应」。
   */
  it("点「加粗」把选中的那几个字包起来", async () => {
    await mountApp();
    await act(async () => {
      selectHead(3);
      await settle(60);
    });
    await rightClickAt("第一行");
    await clickSub("文本格式", "加粗");

    expect(document.querySelector(".ctx"), "点完要关掉").toBeNull();
    // 落盘的那一份才是真的（自动保存走的是同一条路）
    await flush();
    expect(saved.startsWith("**第一行**")).toBe(true);
  });

  it("右键点在别处会把光标挪过去 —— 命令作用在刚点的地方", async () => {
    await mountApp();
    await rightClickAt("第二行");
    await clickSub("文本格式", "加粗");
    await flush();
    // 没选东西时加粗插一对 `**` 并把光标放中间，插在**第二行**开头
    expect(saved.split("\n")[2].startsWith("**")).toBe(true);
    expect(saved.split("\n")[0]).toBe("第一行正文");
  });

  it("光标不在表格里就不列表格那几条", async () => {
    await mountApp();
    await rightClickAt("第一行");
    expect(item("在下面插一行"), "这几条只在表格里才有意义").toBeUndefined();
  });

  it("光标在表格里时才列出插行插列", async () => {
    body = ["| 甲 | 乙 |", "|---|---|", "| 1 | 2 |", ""].join("\n");
    await mountApp();
    // 源码模式下表格不会被渲染成 widget，右键能点到真正的那一行
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="更多"]')?.click();
      await settle(150);
    });
    const src = [...document.querySelectorAll<HTMLElement>(".rail-sheet-item")].find(
      (b) => b.getAttribute("aria-label") === "源码模式",
    );
    if (src) {
      await act(async () => {
        src.click();
        await settle(300);
      });
    }
    await rightClickAt("甲");

    expect(item("在下面插一行"), "光标在表格里，这几条就该出现").toBeTruthy();
    await act(async () => {
      item("在下面插一行")!.click();
      await settle(400);
    });
    await act(async () => {
      await settle(1200);
    });
    expect(saved.split("\n").length).toBeGreaterThan(4);
  });

  /**
   * **每一条都要有图标。** 一列纯文字的菜单要逐行读，带图标之后眼睛能直接
   * 跳到要找的那条（§6.3，`.dbview-menu` 早就是这么做的）。
   *
   * 而且**要量宽度，不能只断言 svg 在**：一个定尺寸的按钮里 padding 没清
   * 干净，图标会被压成零宽 —— DOM 里在、类名对、`querySelector` 找得到，
   * 截图上就是个空框（AGENTS.md 里那条 13×13 的勾选框）。
   */
  it("菜单每一条都带图标，而且真的画出来了", async () => {
    await mountApp();
    await rightClickAt("第一行");

    for (const b of items()) {
      const svg = b.querySelector("svg");
      expect(svg, `「${b.textContent}」没有图标`).not.toBeNull();
      const box = svg!.getBoundingClientRect();
      expect(box.width, `「${b.textContent}」的图标被压成零宽`).toBeGreaterThan(8);
      expect(box.height).toBeGreaterThan(8);
      // 图标在字的左边，不是右边（右边那个位置留给快捷键提示）
      expect(box.left).toBeLessThan(b.getBoundingClientRect().left + 24);
    }
  });

  it("文档树的右键菜单同样每条都带图标", async () => {
    await mountApp();
    const row = document.querySelector<HTMLElement>(".tree-row")!;
    const box = row.getBoundingClientRect();
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: box.left + 20,
          clientY: box.top + 8,
        }),
      );
      await settle(120);
    });

    const rows = items();
    expect(rows.length).toBeGreaterThan(4);
    for (const b of rows) {
      const svg = b.querySelector("svg");
      expect(svg, `「${b.textContent}」没有图标`).not.toBeNull();
      expect(svg!.getBoundingClientRect().width).toBeGreaterThan(8);
    }
  });

  it("点空白处菜单就关", async () => {
    await mountApp();
    await rightClickAt("第一行");
    expect(menu()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await settle(120);
    });
    expect(menu()).toBeNull();
  });

  it("菜单不会长到窗口外面去", async () => {
    await mountApp();
    // 贴着右下角点：菜单从这里往右下长的话，一半在屏幕外
    const line = [...document.querySelectorAll<HTMLElement>(".cm-line")][0];
    await act(async () => {
      line.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: window.innerWidth - 4,
          clientY: window.innerHeight - 4,
        }),
      );
      await settle(150);
    });

    const box = menu()!.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
  });
});

describe("公式定界符命令", () => {
  it("命令面板一键转换整篇里的 LaTeX 定界符", async () => {
    body = "第一 \\(x+1\\)，第二 \\[y^2\\]。";
    await mountApp();

    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
      await settle(120);
    });
    const command = [...document.querySelectorAll<HTMLButtonElement>(".palette-list button")].find(
      (button) => button.querySelector(".palette-label")?.textContent === "转换 LaTeX 公式定界符",
    );
    expect(command, "命令面板里没有公式定界符转换").toBeTruthy();

    await act(async () => {
      command!.click();
      await settle(120);
    });
    await flush();

    expect(saved).toBe("第一 $x+1$，第二 $$y^2$$。");
    expect(document.body.textContent).toContain("已转换 2 个公式");
  });
});
