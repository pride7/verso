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

/** 平台能力开关（目录选择器、终端…）。视口归 page.viewport 管，这个归它管 */
let mobileFlag = false;

/** 容器目录里现有的仓库（§2.1）。手机上的列表来自磁盘，不是「打开过的」 */
let LOCAL_VAULTS: { root: string; name: string; available: boolean; shared: boolean }[] = [
  { root: "/storage/emulated/0/Verso/默认", name: "默认", available: true, shared: false },
  { root: "/storage/emulated/0/Verso/工作", name: "工作", available: true, shared: false },
];

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => mobileFlag,
    localVaults: async () => LOCAL_VAULTS,
    createLocalVault: async (name: string) => ({
      root: `/storage/emulated/0/Verso/${name}`,
      name,
      createdRepo: true,
      createdGitignore: true,
      renamedBranch: false,
    }),
    recentVaults: async () => LOCAL_VAULTS,
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
    propDefSet: async () => {},
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
  pickCloneFolder: async () => null,
}));

const { default: App } = await import("../../../src/app/App");

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
  mobileFlag = false;
  // headless Chromium 报的是 `hover: hover`，尺寸令牌那一套在这里不会自己
  // 生效。真机上由 main.tsx 按指针能力**同步**打上（编辑器第一帧就要读它
  // 决定抢不抢焦点），这里补一份，否则量到的是「桌面尺寸的手机」
  document.documentElement.dataset.touch = "on";
  await page.viewport(PHONE.w, PHONE.h);
});

afterEach(async () => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.touch;
  // 视口是整个浏览器实例共享的，不还原会污染同一次运行里后跑的文件
  await page.viewport(1440, 900);
});

const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();

/**
 * 打开底部导航的「更多」面板，并点里面某一项。
 *
 * 窄屏上动作组不在条上（一行排不下），传 `"更多"` 就是只把面板打开不点。
 */
async function openAction(label: string) {
  await act(async () => {
    document.querySelector<HTMLElement>('.rail-btn[aria-label="更多"]')!.click();
    await settle(200);
  });
  if (label === "更多") return;
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>(".rail-sheet-item")]
      .find((b) => b.getAttribute("aria-label") === label)!
      .click();
    await settle(300);
  });
}

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
  it("抽屉从顶上铺到底部导航，里面的行点得到", async () => {
    await mount();
    const side = box(".sidebar")!;
    const rail = box(".rail")!;
    // 顶到头
    expect(side.top).toBeLessThan(2);
    // 停在底部导航的上沿：铺过去的话，抽屉会压着那排图标
    expect(side.bottom).toBeLessThanOrEqual(rail.top + 1);
    // 但也不能只剩一小截 —— 高度是「量出来」的那类 bug 的唯一现形处
    expect(side.height).toBeGreaterThan(PHONE.h * 0.8);

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
  it("抽屉开着的时候，底部导航照样点得到", async () => {
    await mount();
    expect(document.querySelector(".sidebar-scrim")).toBeTruthy();

    const btn = document.querySelector<HTMLElement>('.rail-btn[aria-label="搜索"]')!;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    expect(hit?.closest(".rail-btn"), "点到的是遮罩，不是导航").toBe(btn);
  });

  /**
   * §6.3「移动 单栏 + 抽屉：编辑区占满……底部工具条固定」。
   *
   * 竖排在手机上要付两笔账：横向白白扣掉 44px，而且整条落在屏幕左上角 ——
   * 单手握持时最够不到的地方。这里量的就是这两笔真的省下来了。
   */
  it("图标栏横在底部，正文用满整屏宽", async () => {
    await mount();
    const rail = box(".rail")!;
    const main = box(".main")!;

    // 横排：宽度铺满，高度只有一条
    expect(rail.width).toBeGreaterThan(PHONE.w * 0.9);
    expect(rail.height).toBeLessThan(70);
    // 落在下半屏，拇指够得到
    expect(rail.top).toBeGreaterThan(PHONE.h * 0.7);
    // 正文不再被左边那一列切掉
    expect(main.left).toBeLessThan(1);
    expect(main.width).toBeGreaterThan(PHONE.w - 1);
  });

  /** 手指的接触面直径约 44px。图标小于这个数就是「看得见点不中」 */
  it("导航上每个图标都够一根手指", async () => {
    await mount();
    for (const btn of document.querySelectorAll<HTMLElement>(".rail-btn")) {
      const r = btn.getBoundingClientRect();
      expect(r.height, `${btn.getAttribute("aria-label")} 太矮`).toBeGreaterThanOrEqual(44);
      expect(r.width, `${btn.getAttribute("aria-label")} 太窄`).toBeGreaterThanOrEqual(44);
    }
  });

  /**
   * 一行排不下十二个图标，动作组收进 `⋯`。要验的是**一个都没丢** ——
   * 收起来和删掉在截图上分不出，而少掉的那个可能是「设置」。
   */
  it("动作组收进「更多」，一个都没少", async () => {
    await mount();
    // 条上只剩视图，动作不在
    expect(document.querySelector('.rail-btn[aria-label="设置"]')).toBeNull();

    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="更多"]')!.click();
      await settle(200);
    });
    const items = [...document.querySelectorAll(".rail-sheet-item")].map((b) =>
      b.getAttribute("aria-label"),
    );
    // 桌面窄窗口上终端还在；手机上它整个不渲染（另有一条测试盯着）
    expect(items).toEqual(["源码模式", "思维导图", "项目中心", "终端", "命令面板", "设置"]);

    // 面板里的行同样要够一根手指
    for (const item of document.querySelectorAll<HTMLElement>(".rail-sheet-item")) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });

  it("「更多」面板不会伸出屏幕", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="更多"]')!.click();
      await settle(200);
    });
    const sheet = box(".rail-sheet")!;
    expect(sheet.left).toBeGreaterThanOrEqual(0);
    expect(sheet.right).toBeLessThanOrEqual(PHONE.w);
    expect(sheet.top).toBeGreaterThanOrEqual(0);
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
    await openAction("设置");

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

  /**
   * 打开一篇笔记**并且点进正文**。
   *
   * 后半步不能省：工具条只在焦点落在正文里时才出现（读一篇笔记不该白让出
   * 一条），而触摸设备上打开笔记不再自动抢焦点 —— 真人这时候也得先点一下
   * 才开始打字。
   */
  async function openNote() {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    await act(async () => {
      document.querySelector<HTMLElement>(".cm-content")!.focus();
      await settle(200);
    });
  }

  it("看一眼：工具条、分页菜单和长按变体", async () => {
    await openNote();
    await page.screenshot({ path: "__shots__/22-phone-mathbar.png" });
    await act(async () => {
      tap(document.querySelector<HTMLElement>(".mathbar-page")!);
      await settle(150);
    });
    await page.screenshot({ path: "__shots__/24-phone-mathbar-pages.png" });
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await settle(150);
    });
    const key = document.querySelector<HTMLElement>('.mathbar-key[aria-label="括号"]')!;
    await act(async () => {
      key.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }),
      );
      await settle(700);
    });
    await page.screenshot({ path: "__shots__/23-phone-mathbar-variants.png" });
  });

  /**
   * **读一篇笔记时那一条不该在。**
   *
   * 它占 76px，390×844 的屏上是一屏的 9%；而读的时候上面那些键一个都用不
   * 上。之前的条件只有「窄屏 + 有打开的笔记」，于是从头到尾都占着。
   */
  it("只在点进正文之后才出现，光读不占那 76px", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    expect(bar(), "还没开始打字就先让出一条").toBeNull();

    await act(async () => {
      document.querySelector<HTMLElement>(".cm-content")!.focus();
      await settle(200);
    });
    expect(bar(), "点进正文之后它得上来").toBeTruthy();

    // 而且要贴在最底下 —— 真机上那条边紧挨着软键盘的上沿（§5.5）
    const rect = box(".mathbar")!;
    expect(rect.bottom).toBeGreaterThanOrEqual(box(".status")!.bottom - 0.5);
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

  /**
   * 点开行首那个胶囊，返回菜单里的页名。
   *
   * 走整套 pointer 事件而不是光 `click()`：菜单是靠 window 上的 pointerdown
   * 关的，少了 `stopPropagation` 就会「按下时先关掉、click 落空」——
   * 只发 click 的话这一类恰好测不出来
   */
  async function openPageMenu() {
    await act(async () => {
      tap(document.querySelector<HTMLElement>(".mathbar-page")!);
      await settle(150);
    });
    return [...document.querySelectorAll(".mathbar-pagemenu button")].map((b) => b.textContent);
  }

  it("用过的符号进「最近」，下次打开还在", async () => {
    await openNote();
    await act(async () => {
      // 用第一页上的键：默认停在「结构」那一页，别的页得先切过去
      tap(keyByName("根式")!);
      await settle(200);
    });
    const tabs = await openPageMenu();
    expect(tabs[0], "「最近」要排在第一个").toBe("最近");

    await act(async () => {
      tap(document.querySelector<HTMLElement>(".mathbar-pagemenu button")!);
      await settle(150);
    });
    expect(keyByName("根式"), "「最近」那一页里应该有它").toBeTruthy();
    // 换完页菜单要自己收起来，否则它挡着下面那一排符号
    expect(document.querySelector(".mathbar-pagemenu")).toBeNull();
    // 存住了：localStorage 里记的是 insert
    expect(localStorage.getItem("verso.mathbar.recent")).toContain("sqrt");
  });

  /**
   * **整条只占一行。**
   *
   * 分页标签原来单占一行，整条 82px；页名平时不需要看见，只有换页时才需要。
   * 手机底部本来就叠着好几条，这 30px 每一次打字都在省
   */
  it("只有一行 —— 页名收进行首那个胶囊里", async () => {
    await openNote();
    expect(box(".mathbar")!.height, "整条不该超过一行键的高度").toBeLessThanOrEqual(56);

    const chip = document.querySelector<HTMLElement>(".mathbar-page")!;
    expect(chip.textContent, "胶囊上写着现在停在哪一页").toContain("结构");
    // 平时不摊开：菜单要点了才有
    expect(document.querySelector(".mathbar-pagemenu")).toBeNull();

    const labels = await openPageMenu();
    expect(labels).toContain("希腊");
    // 胶囊和符号键在同一行上，菜单从上面弹出来，不许把行顶开
    expect(box(".mathbar")!.height).toBeLessThanOrEqual(56);
    expect(box(".mathbar-pagemenu")!.bottom).toBeLessThanOrEqual(box(".mathbar-row")!.top);
  });

  /**
   * 菜单是靠 window 上的 pointerdown 关的，没有盖屏的遮罩 —— 于是换完页
   * 手指往右一挪就是符号，不必先花一下把菜单关掉
   */
  it("菜单开着的时候，符号照样是一下点得到", async () => {
    await openNote();
    await openPageMenu();
    const key = keyByName("分式")!;
    const r = key.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    expect(hit === key || key.contains(hit!), "工具条自己不该被什么东西盖住").toBe(true);

    await act(async () => {
      tap(key);
      await settle(200);
    });
    expect(text()).toContain("\\frac{}{}");
    expect(document.querySelector(".mathbar-pagemenu"), "点了符号，菜单就该收").toBeNull();
  });

  /** 点别处就算了 —— 菜单弹出来之后，下一个动作十有八九是「回去打字」 */
  it("点别处收起分页菜单", async () => {
    await openNote();
    await openPageMenu();
    await act(async () => {
      document.querySelector<HTMLElement>(".cm-content")!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      await settle(150);
    });
    expect(document.querySelector(".mathbar-pagemenu")).toBeNull();
  });
});

/**
 * 软键盘弹起来时底部让位（§5.5 / §1.2）。
 *
 * 公式条 + 状态栏 + 导航原本一起占着 138px，加上键盘之后，390×844 的屏上
 * 留给正文的只剩两百出头 —— 比底部这堆还少。
 *
 * **判据是「视口真的缩了」，不是「焦点在正文里」。** 那正是这一组要钉住的
 * 东西：焦点没动、键盘自己收了的时候（安卓返回手势、iOS 收起键），两条必须
 * 回来 —— 否则用户手上既没有键盘也没有导航。判定逻辑本身在
 * `lib/keyboard.test.ts` 里穷举过，这里量的是**界面真的让了位**。
 *
 * 真机上是原生 `MainActivity.fitSystemBars()` 给 WebView 加底部内边距，
 * WebView 里表现出来就是可视高度少一截 —— 这里直接把视口压矮来复现。
 */
describe("软键盘弹起来时的底部空间", () => {
  /** 中文键盘（带候选词条）大约这么高 */
  const KEYBOARD = 336;

  async function typing() {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    await act(async () => {
      document.querySelector<HTMLElement>(".cm-content")!.focus();
      await settle(200);
    });
  }

  const raise = async (up: boolean) => {
    await act(async () => {
      await page.viewport(PHONE.w, up ? PHONE.h - KEYBOARD : PHONE.h);
      await settle(300);
    });
  };

  it("看一眼：键盘占掉下半屏之后剩下什么", async () => {
    await typing();
    await raise(true);
    await page.screenshot({ path: "__shots__/25-phone-keyboard.png" });
  });

  it("键盘一上来，导航和状态栏让位，公式条留下", async () => {
    await typing();
    const before = box(".editor")!.height;
    expect(box(".rail")!.height, "键盘还没上来时导航在").toBeGreaterThan(40);

    await raise(true);
    expect(box(".rail")!.height, "导航该让位").toBe(0);
    expect(box(".status")!.height, "状态栏该让位").toBe(0);
    expect(box(".mathbar"), "公式条是打字时唯一有用的那条，不能一起让").toBeTruthy();

    // 让出来的那 86px 要真的落到正文上，而不是被谁悄悄吃掉。
    // 视口自己矮了 336，所以正文净减不该超过 336 - 86
    const after = box(".editor")!.height;
    expect(before - after).toBeLessThan(KEYBOARD - 80);
  });

  /**
   * **这一条是整个改动成立的前提。**
   *
   * 收起软键盘并不一定让正文失焦 —— 认焦点的话，用户会落到「既没有键盘
   * 也没有导航」那一格里，只能靠点别处碰运气
   */
  it("焦点没动、键盘自己收了，两条也要回来", async () => {
    await typing();
    await raise(true);
    expect(box(".rail")!.height).toBe(0);

    // 焦点仍然在正文里，只有视口涨了回来
    expect(document.activeElement?.closest(".cm-editor"), "这一条要在焦点没动的前提下测").toBeTruthy();
    await raise(false);
    expect(box(".rail")!.height, "键盘一收，导航同帧回来").toBeGreaterThan(40);
    expect(box(".status")!.height).toBeGreaterThan(0);
  });

  /** 桌面上把窗口拖矮不是键盘。判据是「缩掉一个键盘那么多」，不是「变矮了」 */
  it("几十像素的收缩不算键盘", async () => {
    await typing();
    await act(async () => {
      await page.viewport(PHONE.w, PHONE.h - 60);
      await settle(300);
    });
    expect(box(".rail")!.height).toBeGreaterThan(40);
  });
});

/**
 * §7.3：移动端没有可用的 PTY，终端的一切入口都不该出现 ——
 * 摆一个点了没反应（或弹一个空面板）的按钮比没有更糟。
 */
describe("移动端没有终端", () => {
  it("终端按钮不渲染，桌面存下的「面板开着」状态也不生效", async () => {
    mobileFlag = true;
    // 模拟桌面上开过终端留下的偏好
    localStorage.setItem("verso.termOpen", "1");
    await mount();

    await openAction("更多");
    expect(document.querySelector('[aria-label="终端"]')).toBeNull();
    expect(document.querySelector(".term")).toBeNull();
    // 只是这次不生效，不把桌面的偏好覆盖掉
    expect(localStorage.getItem("verso.termOpen")).toBe("1");
  });

  it("不是手机时终端按钮还在", async () => {
    await mount();
    await openAction("更多");
    expect(document.querySelector('[aria-label="终端"]')).not.toBeNull();
  });
});

/**
 * 手机上的思维导图（§4.7）。
 *
 * 导图在手机上是**没有键盘、没有右键、没有滚轮**的：加同级靠 Enter、改字靠
 * 双击、缩放靠滚轮 —— 三条路在那边一条都不存在。这里量的是补上的那些入口
 * 真的在屏幕上、真的点得到，而不是「类名对着」。
 */
describe("手机上的思维导图", () => {
  async function openMap() {
    mobileFlag = true;
    await mount();
    // 手机上一开始抽屉是开着的，它盖住整片正文（连带导图）。先收起来，
    // 这也正是真人进导图前的那一步
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(200);
    });
    await openAction("思维导图");
  }

  it("工具条没被标题和提示挤出屏幕", async () => {
    await openMap();
    const tools = box(".mm-tools")!;
    expect(tools.right).toBeLessThanOrEqual(PHONE.w + 1);
    expect(tools.left).toBeGreaterThan(0);
    // 按钮一个都不能被压扁 —— 「适应」被挤成竖排的两个字就是这么发现的
    const bar = box(".mm-bar")!;
    for (const b of document.querySelectorAll<HTMLElement>(".mm-tools button")) {
      const r = b.getBoundingClientRect();
      expect(r.width).toBeGreaterThan(10);
      expect(r.height, "按钮换行了").toBeLessThan(bar.height);
    }
  });

  it("节点上的 ⋯ 在屏幕里，而且点下去碰到的就是它", async () => {
    await openMap();
    const btn = document.querySelector<HTMLElement>('.mm-acts button[aria-label="更多动作"]')!;
    expect(btn, "每个节点都该有这个入口").not.toBeNull();
    const r = btn.getBoundingClientRect();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(PHONE.h);
    // 「看得见却点不动」只有命中测试抓得到（AGENTS.md 里那两种成因）
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    expect(hit && btn.contains(hit), "点在 ⋯ 上，碰到的却是别的东西").toBe(true);
  });

  it("菜单整个在屏幕里 —— 靠边的节点也不例外", async () => {
    await openMap();
    await act(async () => {
      document.querySelector<HTMLElement>('.mm-acts button[aria-label="更多动作"]')!.click();
      await settle(150);
    });
    const menu = box(".mm-menu")!;
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(PHONE.w);
    expect(menu.top).toBeGreaterThanOrEqual(0);
    expect(menu.bottom).toBeLessThanOrEqual(PHONE.h);
    await page.screenshot({ path: "__shots__/26-phone-mindmap-menu.png" });
  });

  it("单指拖背景能平移 —— 手机上这是唯一的平移方式", async () => {
    await openMap();
    const layer = document.querySelector<HTMLElement>(".mm-layer")!;
    const before = layer.style.transform;
    const canvas = document.querySelector<HTMLElement>(".mm-canvas")!;
    const at = (type: string, x: number, y: number) =>
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });

    await act(async () => {
      canvas.dispatchEvent(at("pointerdown", 100, 500));
      window.dispatchEvent(at("pointermove", 160, 540));
      window.dispatchEvent(at("pointerup", 160, 540));
      await settle(80);
    });
    expect(layer.style.transform).not.toBe(before);
  });
});


/**
 * 点击目标的尺寸。DESIGN.md §1.2 铁律 2「不能假设有鼠标」。
 *
 * **一条一条量，不查类名。** 尺寸是最容易在改别的东西时被顺手改小的一类
 * 属性，而小了不报错 —— 只是手指点十次中七次，用的人说不清哪里不对，只
 * 觉得"这软件在手机上不好使"。
 *
 * 44px 是手指接触面的直径（Apple HIG 与 Material 取的同一个数）。嵌在行里
 * 的次要图标按 32 算：它们挤在已有的一行里，撑到 44 会把那一行整个顶开。
 */
describe("手机上的点击目标", () => {
  const FINGER = 44;
  /**
   * 行内的次要图标：够到 32 就行，撑到 44 会把所在的那一行整个顶开。
   *
   * 按**祖先**判定，不只看元素自己的 class —— 分段控件里的按钮身上只有
   * `is-on`，类名在外面那层 `.segmented` 上。
   */
  const SECONDARY =
    ".tab-close, .tab-new, .tree-add, .crumb-icon, .props-toggle," +
    " .side-act, .status-git, .backlinks-head, .mathbar-pages, .hist-restore," +
    " .dbview-edit, .modal-close, .set-reset, .set-reset-all, .segmented, .swatches," +
    " [class^='cm-'], [class*=' cm-']";

  /**
   * 形状不是方的那几个，逐个写明白 —— 用一条正则糊成「次要图标」会把
   * 「为什么可以这么窄」这件事一起糊掉。
   *
   * 折叠三角：**横向每一像素都要乘以树的层数**（每层都跟着往右让），所以
   * 收到 22；纵向铺满 44px 的行高补回来。一个 22×44 的条形命中区面积和
   * 32×32 相当，而且手指在树里是竖着扫的，纵向的余量更有用。
   */
  const SHAPES: [string, number, number][] = [[".tree-twisty", 22, 44]];

  /**
   * **量的是命中区，不是盒子。**
   *
   * `getBoundingClientRect()` 只给边框盒 —— 主题色那排圆点用一个透明的
   * `::after` 往外扩了命中区（圆本身必须保持 22px，否则一排颜色高低不齐），
   * 边框盒还是 22，量出来是假阴性。反过来，一个盒子够大但被别的东西盖住，
   * 量尺寸同样看不出来。
   *
   * 所以真的去点：以元素中心为心画一个 min×min 的方框，四个角都要落回这个
   * 元素身上。
   */
  const at = (el: HTMLElement, x: number, y: number) => {
    if (x < 0 || y < 0 || x > PHONE.w || y > PHONE.h) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };

  function probe(el: HTMLElement, w: number, h: number) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // 中心都点不到 = 这会儿它被浮层盖着（抽屉、命令面板…），本来就不该点得到，
    // 不在这一轮的范围里。不先过这一关的话，开着弹窗时满屏元素全会被误报
    if (!at(el, cx, cy)) return "covered";
    // 横向滚动条里滚出去了一半的东西（设置的分类栏、标签条）：那不是尺寸
    // 问题，滑一下就整个露出来。按现在露出来的这一截去量只会误报
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ov = getComputedStyle(p).overflowX;
      if (ov !== "auto" && ov !== "scroll") continue;
      const pr = p.getBoundingClientRect();
      if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5) return "clipped";
      break;
    }
    const dx = w / 2 - 1;
    const dy = h / 2 - 1;
    const ok =
      at(el, cx - dx, cy - dy) && at(el, cx + dx, cy - dy) &&
      at(el, cx - dx, cy + dy) && at(el, cx + dx, cy + dy);
    return ok ? "ok" : "small";
  }

  /** 屏幕上现在点得着的东西，够不着的挑出来 */
  function tooSmall() {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, [role=button], a")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const shape = SHAPES.find(([sel]) => el.closest(sel));
      const [w, h] = shape
        ? [shape[1], shape[2]]
        : el.closest(SECONDARY)
          ? [32, 32]
          : [FINGER, FINGER];
      if (probe(el, w, h) !== "small") continue;
      bad.push(
        `${Math.round(r.width)}x${Math.round(r.height)} (要 ${w}x${h}) ` +
          `${el.className} ${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 10) ?? ""}`,
      );
    }
    return bad;
  }

  it("抽屉里的每一行都够得着", async () => {
    await mount();
    expect(tooSmall()).toEqual([]);
  });

  it("正文那一屏上的每个入口都够得着", async () => {
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>(".sidebar-scrim")!.click();
      await settle(300);
    });
    expect(tooSmall()).toEqual([]);
  });

  it("右键菜单的每一条都够得着 —— 它是手指唯一拿得到全部动作的地方", async () => {
    await mount();
    const row = document.querySelectorAll<HTMLElement>(".tree-row")[0];
    const r = row.getBoundingClientRect();
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: r.left + 40,
          clientY: r.top + 8,
        }),
      );
      await settle(200);
    });
    expect(document.querySelector(".ctx"), "菜单没弹出来，这条就白测了").toBeTruthy();
    expect(tooSmall()).toEqual([]);
  });

  it("命令面板的每一条都够得着", async () => {
    await mount();
    await openAction("命令面板");
    expect(document.querySelector(".palette")).toBeTruthy();
    expect(tooSmall()).toEqual([]);
  });

  it("设置面板里的每个控件都够得着", async () => {
    await mount();
    await openAction("设置");
    expect(document.querySelector(".settings")).toBeTruthy();
    expect(tooSmall()).toEqual([]);
  });

  /**
   * **只在窄屏出现的东西要自带尺寸。**
   *
   * `--tap` 跟的是指针，而窄屏跟的是视口 —— 把桌面窗口拖窄的人有鼠标，
   * 令牌是 0，于是「更多」面板的行高塌成 17px。作者第一眼看到的就是这个。
   */
  it("窄窗口 + 鼠标：「更多」面板不会塌成一条缝", async () => {
    delete document.documentElement.dataset.touch;
    await mount();
    await openAction("更多");
    for (const item of document.querySelectorAll<HTMLElement>(".rail-sheet-item")) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(34);
    }
  });

  /** 桌面上不该被撑开 —— 鼠标指针只有一个像素，44px 的行距只会让信息密度掉一半 */
  it("桌面（有鼠标）不受影响：行距还是原来的", async () => {
    delete document.documentElement.dataset.touch;
    await act(async () => {
      await page.viewport(1440, 900);
    });
    await mount();
    const row = box(".tree-row")!;
    expect(row.height).toBeLessThan(34);
  });
});


/**
 * 手机上的多仓库切换（§2.1）。
 *
 * 手机上没有目录选择器，所以仓库统一放在一个容器目录里、每个子文件夹一个。
 * 这里验的是**界面这一半**：列表来自磁盘、切得动、能起名新建。容器的迁移、
 * 「什么算一个仓库」那些规则在 Rust 侧 `mobile_vaults.rs` 里穷举过了。
 */
describe("手机上的仓库切换", () => {
  const openMenu = async () => {
    await act(async () => {
      document.querySelector<HTMLElement>(".vault-name")!.click();
      await settle(200);
    });
  };

  it("底部显示当前仓库，点开能看到容器里的全部仓库", async () => {
    mobileFlag = true;
    await mount();
    // 之前手机上这里是一块点不动的静态文字
    const trigger = document.querySelector<HTMLElement>("button.vault-name");
    expect(trigger, "手机上仓库名要能点开").toBeTruthy();

    await openMenu();
    const names = [...document.querySelectorAll(".vault-menu-item")].map((b) =>
      b.querySelector("strong")?.textContent,
    );
    expect(names).toEqual(["默认", "工作"]);
  });

  /**
   * 桌面那三条在容器模型下都不成立：「打开其他文件夹」和「管理空间」都要
   * 一个目录选择器，而手机上没有 —— 留着就是三个按下去没反应的按钮。
   */
  it("手机上不出现要选目录的那几项，换成「新建仓库」", async () => {
    mobileFlag = true;
    await mount();
    await openMenu();
    const actions = [...document.querySelectorAll(".vault-menu-action")].map((b) =>
      b.textContent?.trim(),
    );
    expect(actions).toEqual(["新建仓库…"]);
  });

  /**
   * **就地输入，不用 `window.prompt`。** 安卓 WebView 上它可能根本不弹，
   * 那时「新建仓库」就是个按下去没反应的按钮（M6 清单里那一条）。
   */
  it("新建仓库是就地输入，不弹系统对话框", async () => {
    mobileFlag = true;
    const prompt = vi.spyOn(window, "prompt");
    await mount();
    await openMenu();
    await act(async () => {
      [...document.querySelectorAll<HTMLElement>(".vault-menu-action")]
        .find((b) => b.textContent?.includes("新建仓库"))!
        .click();
      await settle(200);
    });
    const input = document.querySelector<HTMLInputElement>(".vault-new-input");
    expect(input, "该就地长出一个输入框").toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("桌面仍然是「打开其他文件夹」那一套", async () => {
    mobileFlag = false;
    await act(async () => {
      await page.viewport(1440, 900);
    });
    await mount();
    await openMenu();
    const actions = [...document.querySelectorAll(".vault-menu-action")].map((b) =>
      b.textContent?.trim(),
    );
    expect(actions).toEqual(["管理空间…", "打开其他文件夹…", "加入共享空间…"]);
  });
});
