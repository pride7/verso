/**
 * 窄屏布局。DESIGN.md §1.2 / §6.1
 *
 * 这一层量的是**几何关系**，不是类名：侧栏是不是盖在正文上、正文有没有被
 * 挤没、点开一篇之后抽屉收没收。类名对着而布局错了的话，看起来仍然是老样子
 * —— 而在 390px 的屏上那意味着完全没法用。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { page } from "vitest/browser";
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

vi.mock("./api", () => ({
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
        body: "正文，够长一点，好看出正文列有没有被挤没。\n",
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
}));

const { default: App } = await import("./App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

/** 手机竖屏。iPhone 14 / 多数安卓旗舰都在这个尺寸附近 */
const PHONE = { w: 390, h: 844 };

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

beforeEach(async () => {
  localStorage.clear();
  await page.viewport(PHONE.w, PHONE.h);
});

afterEach(async () => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  // 视口是整个浏览器实例共享的，不还原会污染同一次运行里后跑的文件
  await page.viewport(1440, 900);
});

const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();

describe("手机竖屏下的布局", () => {
  it("看一眼：抽屉开着 / 关着", async () => {
    await mount();
    await page.screenshot({ path: "__shots__/20-phone-drawer.png" });
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    await page.screenshot({ path: "__shots__/21-phone-reading.png" });
  });

  it("侧栏是盖上去的，正文仍然占满剩下的宽度", async () => {
    await mount();
    const side = box(".sidebar")!;
    const main = box(".main")!;

    // 盖在上面：两者横向有重叠。挤在一起的话 main 会从 side 的右边才开始
    expect(side.right).toBeGreaterThan(main.left);
    // 正文列至少要有大半个屏 —— 挤成一条就等于没法读
    expect(main.width).toBeGreaterThan(PHONE.w * 0.7);
    // 抽屉自己也得留一条正文出来，那是关掉它的唯一出口
    expect(side.right).toBeLessThan(PHONE.w);
  });

  /**
   * **抽屉要真的铺满整屏高。**
   *
   * 之前只量了横向（左右重不重叠、宽度够不够），于是漏掉了一个真机上
   * 致命的 bug：`grid-area: sidebar` 没解掉，绝对定位的包含块变成一个
   * 零高的隐式网格区域，抽屉整个掉到视口下面去了 —— DOM 里在、类名对、
   * position 和 z-index 全对，只有量高度才看得出来。
   */
  it("抽屉铺满整屏高，里面的行点得到", async () => {
    await mount();
    const app = box(".app")!;
    const side = box(".sidebar")!;
    expect(side.height).toBeGreaterThan(app.height * 0.9);
    expect(side.top).toBeLessThan(app.top + 2);

    // 而且里面的行要真的在屏幕上、点得到
    const label = document.querySelector<HTMLElement>(".tree-label")!;
    const r = label.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(PHONE.h);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    expect(hit && label.contains(hit), "点在文件名上，碰到的却是别的东西").toBe(true);
  });

  it("点开一篇之后抽屉自己收起来", async () => {
    await mount();
    expect(box(".sidebar")).toBeTruthy();
    expect(document.querySelector(".app")?.className).toContain("is-narrow");

    await act(async () => {
      // 点的是 `.tree-label` 那个按钮，不是整行 —— 行本身只是容器
      [...document.querySelectorAll<HTMLElement>(".tree-label")]
        .find((r) => r.textContent?.includes("乙"))!
        .click();
      await settle(400);
    });
    expect(document.querySelector(".sidebar"), "点完还得再手动关一次的话，那一下就白点了").toBeNull();
  });

  /**
   * **抽屉开着时，图标栏必须还能点。** 它是手机上唯一的导航。
   *
   * 用 `elementFromPoint` 做真正的命中测试，而不是查 z-index 或类名 ——
   * 遮罩盖住图标栏时，那一竖排图标**看得见、点下去却只是关掉抽屉**，
   * 截图上一模一样，只有命中测试能发现。
   */
  it("抽屉开着的时候，图标栏照样点得到", async () => {
    await mount();
    expect(document.querySelector(".sidebar-scrim")).toBeTruthy();

    const btn = document.querySelector<HTMLElement>('.rail-btn[aria-label="搜索"]')!;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    expect(hit?.closest(".rail-btn"), "点到的是遮罩，不是图标栏").toBe(btn);
  });

  /** 抽屉再宽也得留一条正文出来 —— 那是关掉它最直接的入口 */
  it("抽屉旁边留得下一根手指", async () => {
    await mount();
    const side = document.querySelector(".sidebar")!.getBoundingClientRect();
    expect(PHONE.w - side.right).toBeGreaterThanOrEqual(48);
  });

  it("点正文那一条（遮罩）也能关掉抽屉", async () => {
    await mount();
    expect(document.querySelector(".sidebar-scrim")).toBeTruthy();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(200);
    });
    expect(document.querySelector(".sidebar")).toBeNull();
    expect(document.querySelector(".sidebar-scrim")).toBeNull();
  });

  /**
   * §6.1 移动那一列：满宽减 20px 边距（桌面上是 24）。
   *
   * **量出来的值，不是查类名。** 而且要一起验「正文和面包屑还对着」——
   * 这一处的内边距是和 `.editor-host` 的 -26px 外边距配对的，只改一边
   * 就会让正文比标题往左错出去几像素，那种错位一眼看不出、但满屏都不对劲
   */
  it("正文边距收窄，而且仍然和面包屑对齐", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    expect(getComputedStyle(document.querySelector(".editor")!).paddingLeft).toBe("20px");

    const crumb = document.querySelector(".breadcrumb")!.getBoundingClientRect();
    const text = document.querySelector(".cm-line")!.getBoundingClientRect();
    expect(Math.abs(text.left - crumb.left)).toBeLessThan(2);
  });

  it("界面没有横向溢出 —— 一滑就跑偏是移动端最招人烦的毛病", async () => {
    await mount();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(PHONE.w);
    const app = box(".app")!;
    expect(app.right).toBeLessThanOrEqual(PHONE.w + 0.5);
  });

  it("设置面板在窄屏改成横向分类，设置项上下排列", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="设置"]')!.click();
      await settle(300);
    });

    const modal = box(".settings")!;
    const tabs = box(".settings-tabs")!;
    const row = box(".set-row")!;
    const label = box(".set-label")!;
    const control = box(".set-control")!;

    expect(modal.left).toBeGreaterThanOrEqual(0);
    expect(modal.right).toBeLessThanOrEqual(PHONE.w);
    expect(tabs.height).toBeLessThan(56);
    expect(row.right).toBeLessThanOrEqual(modal.right);
    expect(control.top).toBeGreaterThanOrEqual(label.bottom);
  });

  it("回到宽屏，侧栏变回占一列的样子", async () => {
    await mount();
    await act(async () => {
      await page.viewport(1440, 900);
      await settle(300);
    });
    const side = box(".sidebar")!;
    const main = box(".main")!;
    expect(side.right).toBeLessThanOrEqual(main.left + 0.5);
    expect(document.querySelector(".sidebar-scrim"), "宽屏上不该有遮罩").toBeNull();
  });
});

/**
 * §5.5 公式工具条。
 *
 * 这里验的是**它和编辑器真的接上了**：点一下有没有插进正文、跳转点在不在、
 * `→` 走不走得动。符号表本身在 `lib/mathbar.test.ts` 里穷举过了。
 */
describe("公式工具条", () => {
  const bar = () => document.querySelector(".mathbar");
  const keyByName = (name: string) =>
    document.querySelector<HTMLElement>(`.mathbar-key[aria-label="${name}"]`);
  const text = () => document.querySelector(".cm-content")?.textContent ?? "";

  /** 真机上是手指，这里补一套 pointer 事件 —— 组件监听的是 pointerdown/up */
  function tap(el: HTMLElement) {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
    el.click();
  }

  async function openNote() {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
  }

  it("看一眼：工具条和长按变体", async () => {
    await openNote();
    await page.screenshot({ path: "__shots__/22-phone-mathbar.png" });
    const key = document.querySelector<HTMLElement>('.mathbar-key[aria-label="括号"]')!;
    await act(async () => {
      key.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      await settle(700);
    });
    await page.screenshot({ path: "__shots__/23-phone-mathbar-variants.png" });
  });

  it("窄屏、且打开了笔记时才出现", async () => {
    await openNote();
    expect(bar()).toBeTruthy();

    // 回到宽屏就该收起来：桌面有物理键盘，那才是 snippet 那套的主场
    await act(async () => {
      await page.viewport(1440, 900);
      await settle(300);
    });
    expect(bar(), "桌面上不该占着一条").toBeNull();
  });

  it("点一下就插进正文，光标停在第一个跳转点上", async () => {
    await openNote();
    await act(async () => {
      tap(keyByName("分式")!);
      await settle(200);
    });
    expect(text()).toContain("\\frac{}{}");
  });

  it("`→` 走到下一个跳转点 —— 它替代的就是 Tab", async () => {
    await openNote();
    await act(async () => {
      tap(keyByName("分式")!);
      await settle(200);
    });
    // 在第一个跳转点里打个字，再按 → 跳到第二个、再打一个
    await act(async () => {
      document.querySelector<HTMLElement>(".cm-content")!.focus();
      document.execCommand("insertText", false, "a");
      await settle(120);
    });
    await act(async () => {
      document.querySelector<HTMLElement>('.mathbar-nav button[aria-label="下一个位置"]')!.click();
      await settle(120);
      document.execCommand("insertText", false, "b");
      await settle(120);
    });
    expect(text()).toContain("\\frac{a}{b}");
  });

  it("长按出变体，选一个插它", async () => {
    await openNote();
    const key = keyByName("分式")!;
    await act(async () => {
      key.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      await settle(700);
    });
    const panel = document.querySelector(".mathbar-variants");
    expect(panel, "长按 500ms 之后该弹出变体").toBeTruthy();

    await act(async () => {
      // 松手：长按已经触发过，这一下不该再插一次主符号
      key.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
      await settle(100);
    });
    expect(text()).not.toContain("\\frac");

    await act(async () => {
      document.querySelector<HTMLElement>('.mathbar-variants button[aria-label="偏导"]')!.click();
      await settle(200);
    });
    expect(text()).toContain("\\partial");
    expect(document.querySelector(".mathbar-variants")).toBeNull();
  });

  /**
   * 变体面板挂在被长按那个键的正上方，而靠右边的键长按之后，
   * 面板会**整个伸出屏幕** —— 在 390px 宽的屏上这不是边缘情况，
   * 一行 8 个键里最后两三个都会中招
   */
  it("靠右边的键，变体面板也要整个在屏幕里", async () => {
    await openNote();
    // 先滑到最右边那个键
    const keys = [...document.querySelectorAll<HTMLElement>(".mathbar-key")];
    const last = keys[keys.length - 1];
    document.querySelector(".mathbar-keys")!.scrollLeft = 9999;
    await act(async () => {
      await settle(100);
    });

    // 找一个真的有变体、且此刻在屏幕右侧的键
    const target =
      keys.reverse().find((el) => {
        const r = el.getBoundingClientRect();
        return el.classList.contains("has-more") && r.left > PHONE.w * 0.5;
      }) ?? last;
    await act(async () => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      await settle(700);
    });

    const panel = document.querySelector(".mathbar-variants")!;
    const box = panel.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(PHONE.w);
    // 而且每一个变体都得在里面，一个都不能被挤掉
    const wanted = panel.querySelectorAll("button").length;
    expect(wanted).toBeGreaterThanOrEqual(2);
    for (const b of panel.querySelectorAll("button")) {
      expect(b.getBoundingClientRect().right).toBeLessThanOrEqual(PHONE.w);
    }
  });

  /**
   * 横滑工具条时手指必然在某个键上停留超过 500ms。不取消长按的话，
   * **每滑一次都会弹出一个变体面板** —— 而横滑是这一条上的主要操作
   */
  it("滑动时不触发长按", async () => {
    await openNote();
    const key = keyByName("分式")!;
    await act(async () => {
      key.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      key.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 12 }),
      );
      await settle(700);
    });
    expect(document.querySelector(".mathbar-variants")).toBeNull();
  });

  it("用过的符号进「最近」，下次打开还在", async () => {
    await openNote();
    await act(async () => {
      // 用第一页上的键：默认停在「结构」那一页，别的页得先切过去
      tap(keyByName("根式")!);
      await settle(200);
    });
    const tabs = [...document.querySelectorAll(".mathbar-pages button")].map((b) => b.textContent);
    expect(tabs[0], "「最近」要排在第一个").toBe("最近");

    await act(async () => {
      document.querySelector<HTMLElement>(".mathbar-pages button")!.click();
      await settle(150);
    });
    expect(keyByName("根式"), "「最近」那一页里应该有它").toBeTruthy();
    // 存住了：localStorage 里记的是 insert
    expect(localStorage.getItem("verso.mathbar.recent")).toContain("sqrt");
  });
});
