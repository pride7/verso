/**
 * 视觉工作台。
 *
 * 改 UI 不能靠想象。但**不能截屏幕** —— 抓屏会拍到作者屏幕上任何东西
 * （AGENTS.md 里记着那次事故）。Playwright 起的是独立的 headless Chromium，
 * 只画自己那一页，既能看见效果又碰不到别的窗口。
 *
 * 跑法：`pnpm test:browser -- visual`，产物在 `src/__shots__/`。
 * 这不是断言型测试，是给人看的 —— 所以只有一条"画得出来"的兜底断言，
 * 真正的价值在生成的 PNG 上。
 */
import { page } from "vitest/browser";
import { EditorView } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, SearchHit, TreeNode, VaultInfo } from "../../../src/core/types";

// ---------------------------------------------------------------- 假数据
//
// 内容有意做得像真的：中英混排、长短不一的标题、几层嵌套。
// 用 "笔记1/笔记2" 这种占位符看不出排版问题 —— 而排版问题正是要看的东西。

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const node = (
  name: string,
  path: string,
  children: TreeNode[] = [],
  kind: "document" | "folder" = "document",
): TreeNode => ({
  name,
  path,
  kind,
  children,
  childDir: children.length ? path.replace(/\.md$/, "") : null,
  order: null,
  created: null,
  updated: null,
});

const TREE: TreeNode[] = [
  node("templates", "templates.md", [
    node("会议纪要", "templates/会议纪要.md"),
    node("日记", "templates/日记.md"),
    node("读书笔记", "templates/读书笔记.md"),
  ]),
  node("数学", "数学.md", [
    node("线性代数", "数学/线性代数.md", [
      node("奇异值分解", "数学/线性代数/奇异值分解.md"),
      node("特征值与特征向量", "数学/线性代数/特征值与特征向量.md"),
    ]),
    node("泛函分析", "数学/泛函分析.md"),
  ]),
  node("论文", "论文.md", [
    node("Attention Is All You Need", "论文/Attention Is All You Need.md"),
    node("奇异值分解的数值方法", "论文/奇异值分解的数值方法.md"),
    node("一篇还没开始读的", "论文/一篇还没开始读的.md"),
  ]),
  node("日志", "日志.md"),
];

const NOTE_BODY = `# 论文清单

这就是 §2.6 说的「页面级 database」——数据来源是每篇笔记的 frontmatter，
底下仍然只是一堆 \`.md\` 文件。**点单元格可以直接改**，改动会写回那篇笔记。

任意矩阵 $A \\in \\mathbb{R}^{m \\times n}$ 都可以分解为

$$
A = U \\Sigma V^{\\mathsf{T}}
$$

其中 $U$ 的列是 [[特征值与特征向量|左奇异向量]]。标签：#线性代数 #矩阵分解

> [!note] 提示
> callout 用来放旁注，不打断正文的阅读节奏。

> [!warning]
> 奇异值接近零时，直接求逆会放大误差。

> [!tip] 实践建议
> 用 Golub–Kahan 双对角化，数值上稳定得多。

> 普通引用不该和 callout 长一样 —— 它只有一条灰色竖线。
> 引用可以有第二行。

| 敲这些 | 应当得到 |
|---|---|
| \`//\` | 分式，光标在分子 |
| \`xsr\` | 上标平方 |
| \`pmat3x3\` | 3×3 矩阵骨架 |

## 代码

\`\`\`rust
fn main() {
    println!("围栏代码块现在有圆角底色了");
}
\`\`\`

## 待办

- [ ] 补齐数值稳定性那一节
- [x] 整理参考文献
- [ ] 把 Golub–Kahan 双对角化那一段重写一遍：先说清楚为什么直接求逆会放大误差，再给数值例子
`;

const NOTE: NoteContent = {
  path: "论文.md",
  id: "01J8XKQ2M4N7P9R3T5V8W1Y2Z0",
  title: "论文",
  frontmatter: { tags: ["索引页"], status: "整理中" },
  frontmatterText: "tags:\n  - 索引页\nstatus: 整理中\n",
  body: NOTE_BODY,
  mtimeMs: 0,
};

const NOTES: NoteRef[] = [
  // 模板面板从笔记清单里挑（§4.6），所以这几条要在
  { path: "templates/会议纪要.md", name: "会议纪要" },
  { path: "templates/日记.md", name: "日记" },
  { path: "templates/读书笔记.md", name: "读书笔记" },
  { path: "数学/线性代数.md", name: "线性代数" },
  { path: "数学/线性代数/奇异值分解.md", name: "奇异值分解" },
  { path: "论文/Attention Is All You Need.md", name: "Attention Is All You Need" },
];

const HITS: SearchHit[] = [
  {
    path: "数学/线性代数/奇异值分解.md",
    title: "奇异值分解",
    snippet: "任意<mark>矩阵</mark>都可以分解为三个矩阵的乘积，这是数值线性代数里最有用的工具",
  },
  {
    path: "数学/线性代数.md",
    title: "线性代数",
    snippet: "<mark>矩阵</mark>分解的入口。见奇异值分解与特征值",
  },
  {
    path: "论文/奇异值分解的数值方法.md",
    title: "奇异值分解的数值方法",
    snippet: "Golub–Kahan 双对角化是实践中最常用的<mark>矩阵</mark>算法",
  },
];

/**
 * 主题不能靠在 beforeEach 里打 data-theme —— App 挂载后 `useSettings` 会按
 * 设置重新刷一遍，"跟随系统"时它会把属性删掉，深色那张就又变回浅色了。
 * 必须从设置这一层给，走的才是真实路径。
 */
let theme: "light" | "dark" = "light";

/** 开着哪些标签。标签栏那一张要预先摆几个才看得出效果 */
let workspace: { tabs: string[]; active: number; pinnedCount: number } = {
  tabs: [],
  active: 0,
  pinnedCount: 0,
};

/** 平台能力开关（终端、目录选择器…）。手机那几张要它为真才拍得准 */
let mobileFlag = false;

vi.mock("../../../src/host/api", () => ({
  api: {
    isMobile: async () => mobileFlag,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "论文.md" }),
    openVault: async () => VAULT,
    tree: async () => TREE,
    listNotes: async () => NOTES,
    readNote: async () => NOTE,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "新文档.md", id: "x", title: "新文档" }),
    renameNote: async () => "",
    moveNote: async () => "",
    deleteNote: async () => {},
    search: async () => HITS,
    backlinks: async () => [
      { path: "数学/线性代数.md", title: "线性代数", line: 7, context: "见 [[论文]] 里的清单" },
    ],
    allTags: async () => [
      ["线性代数", 6],
      ["论文/已读", 4],
      ["论文/在读", 2],
      ["矩阵分解", 3],
      ["索引页", 1],
    ],
    notesByTag: async () => NOTES,
    viewQuery: async () => ({
      columns: ["title", "作者", "status", "难度"],
      rows: [
        {
          path: "论文/奇异值分解的数值方法.md",
          values: { title: "奇异值分解的数值方法", 作者: "Golub", status: "在读", 难度: "5" },
        },
        {
          path: "论文/Attention Is All You Need.md",
          values: { title: "Attention Is All You Need", 作者: "Vaswani 等", status: "已读", 难度: "4" },
        },
        {
          path: "论文/一篇还没开始读的.md",
          values: { title: "一篇还没开始读的", 作者: "张三", status: "未读", 难度: "2" },
        },
      ],
      view: "table",
    }),
    propSet: async () => {},
    gitStatus: async () => ({
      enabled: true,
      added: 1,
      modified: 2,
      deleted: 0,
      dirty: 3,
      lastMessage: "更新「线性代数」",
      lastAt: Math.floor(Date.now() / 1000) - 900,
    }),
    gitCommit: async () => null,
    gitIdentityGet: async () => ({ name: "pride7", email: "pride7@example.com" }),
    gitIdentitySet: async (name: string, email: string) => ({ name, email }),
    // 作者字段不能省：`isOwnEntry` 要用它区分「我改的」和「别人改的」，
    // 缺了会直接把 HistoryView 抛崩（而崩了只表现为那个面板不见了）
    gitHistory: async () => [
      {
        id: "a1",
        message: "更新「线性代数」",
        detail: "",
        authorName: "pride7",
        authorEmail: "pride7@example.com",
        at: Math.floor(Date.now() / 1000) - 900,
        files: [{ path: "数学/线性代数.md", kind: "modified" }],
        additions: 12,
        deletions: 3,
      },
      {
        id: "a2",
        message: "新增「奇异值分解」「特征值」",
        detail: "",
        authorName: "同组的另一个人",
        authorEmail: "her@example.com",
        at: Math.floor(Date.now() / 1000) - 7200,
        files: [
          { path: "数学/线性代数/奇异值分解.md", kind: "added" },
          { path: "数学/线性代数/特征值.md", kind: "added" },
        ],
        additions: 88,
        deletions: 0,
      },
    ],
    syncRemoteGet: async () => ({
      url: "https://github.com/pride7/notes.git",
      branch: "main",
      needsToken: true,
    }),
    syncTokenHas: async () => true,
    syncRemoteSet: async (url: string) => ({ url, branch: "main", needsToken: true }),
    syncTokenSet: async () => null,
    githubAccount: async () => ({ login: "pride7" }),
    githubConnect: async () => ({ login: "pride7" }),
    githubDisconnect: async () => {},
    vaultSync: async () => ({ committed: null, pulled: 0, pushed: 0, conflicts: [] }),
    workspaceGet: async () => workspace,
    workspaceSet: async () => {},
    getSettings: async () => ({ theme }),
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

/** 让布局稳定下来：解析、KaTeX、database 视图都要一点时间 */
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

async function shot(name: string) {
  await settle();
  await page.screenshot({ path: `__shots__/${name}.png` });
}

let root: Root | null = null;

/** 挂到一个占满视口的容器上 —— App 的布局是 100vh 的 grid */
function render() {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  theme = "light";
  mobileFlag = false;
  workspace = { tabs: [], active: 0, pinnedCount: 0 };
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

/** 点图标栏上的某个按钮。视图切换要走真实交互，不能直接改 state */
function clickRail(label: string) {
  document.querySelector<HTMLElement>(`.rail-btn[aria-label="${label}"]`)?.click();
}

const alive = () => expect(document.querySelector(".app")).not.toBeNull();

describe("视觉工作台", () => {
  it("浅色 · 文档树", async () => {
    render();
    await shot("01-light-tree");
    alive();
  });

  it("深色 · 文档树", async () => {
    theme = "dark";
    render();
    await shot("02-dark-tree");
    alive();
  });

  // 作者报过：标签太挤、× 看不见。这两张就是拿来对着看的
  const TAB_SCENE = {
    tabs: [
      "论文.md",
      "数学/线性代数/奇异值分解.md",
      "论文/奇异值分解的数值方法.md",
      "日志.md",
      "数学/泛函分析.md",
    ],
    active: 2,
    pinnedCount: 1,
  };

  it("浅色 · 标签栏（第一个是固定的）", async () => {
    workspace = TAB_SCENE;
    render();
    await shot("11-light-tabs");
    alive();
  });

  it("深色 · 标签栏（第一个是固定的）", async () => {
    theme = "dark";
    workspace = TAB_SCENE;
    render();
    await shot("12-dark-tabs");
    alive();
  });

  // 这个菜单被报过"太丑"：它当时同时吃到内联的 left 和 .side-menu 的
  // right:0，被拉成横跨半个窗口的白盒子
  it("浅色 · 标签右键菜单", async () => {
    workspace = TAB_SCENE;
    render();
    await settle(700);
    document.querySelectorAll<HTMLElement>(".tab")[0]?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 30 }),
    );
    await shot("13-light-tab-menu");
    alive();
  });

  it("浅色 · 代码块与任务列表", async () => {
    render();
    await settle(700);
    // 这几块在首屏之外，得滚下去才看得见
    const main = document.querySelector<HTMLElement>(".main");
    if (main) main.scrollTop = main.scrollHeight;
    await shot("08-light-blocks");
    alive();
  });

  /** 把代码块滚到编辑区顶端并放大两倍再截。深浅两套各来一张 */
  async function codeZoomShot(name: string) {
    render();
    await settle(700);
    // 行号跟代码差半行、按钮压住第一行代码，这类几像素的偏差整屏看不出来
    document.documentElement.style.zoom = "2";
    // 放大之后按固定像素数滚是不行的，scrollHeight 全变了。
    // `scrollIntoView` 也不行 —— CM6 滚完会重算可视区、重新渲染，
    // 一次就位反而把块甩到屏幕外去了。量一次挪一次，收敛得很快
    // 目标位置按**相对编辑区顶端**算，不按视口像素：`zoom` 之下写死数字对不上。
    //
    // 而且 `getBoundingClientRect` 是缩放后的坐标、`scrollTop` 是缩放前的，
    // 差值要除以缩放倍数再用 —— 直接加会一次冲过头，块被甩到屏幕外
    // （这正是 `scrollIntoView` 在这里也不管用的原因：CM6 滚完还要重算可视区）
    const main = document.querySelector<HTMLElement>(".main")!;
    for (let i = 0; i < 5; i++) {
      const r = document.querySelector(".cm-code")!.getBoundingClientRect();
      const off = r.top - main.getBoundingClientRect().top - 20;
      if (Math.abs(off) < 6) break;
      main.scrollTop += off / 2;
      await settle(150);
    }
    await shot(name);
    document.documentElement.style.zoom = "";
    alive();
  }

  it("浅色 · 代码块放大细节（行号与复制按钮）", async () => {
    await codeZoomShot("08b-light-code-zoom");
  });

  // 高亮的深色配色是单独一套值，只能看着改
  it("深色 · 代码块放大细节", async () => {
    theme = "dark";
    await codeZoomShot("08c-dark-code-zoom");
  });

  it("浅色 · callout 放大细节", async () => {
    render();
    await settle(700);
    // 放大两倍再截 —— 圆角、色条这种几个像素的东西，
    // 在整屏截图里根本分辨不出来，只能放大了看
    document.documentElement.style.zoom = "2";
    const main = document.querySelector<HTMLElement>(".main");
    if (main) main.scrollTop = 700;
    await shot("09-light-callout-zoom");
    document.documentElement.style.zoom = "";
    alive();
  });

  it("浅色 · 表格与引用", async () => {
    render();
    await settle(700);
    document.documentElement.style.zoom = "1.6";
    const main = document.querySelector<HTMLElement>(".main");
    if (main) main.scrollTop = 430;
    // 诊断：App 里到底有没有渲染出引用和表格
    const q = document.querySelectorAll(".cm-quote").length;
    const t = document.querySelectorAll(".cm-table").length;
    const c = document.querySelectorAll(".cm-callout").length;
    expect({ quote: q, table: t, callout: c }).toEqual({ quote: 2, table: 1, callout: 6 });
    // 引用和 callout 用同一套盒模型 —— 只有配色不同。
    // 曾经误判成"引用的样式没生效"，量一下就知道不是
    const qs = getComputedStyle(document.querySelector(".cm-quote")!);
    const cs = getComputedStyle(document.querySelector(".cm-callout")!);
    expect(qs.paddingLeft).toBe(cs.paddingLeft);
    expect(qs.borderLeftWidth).toBe(cs.borderLeftWidth);

    await shot("10-light-table-quote");
    document.documentElement.style.zoom = "";
    alive();
  });

  it("浅色 · 属性条展开", async () => {
    render();
    await settle(700);
    document.querySelector<HTMLElement>(".props-toggle")?.click();
    // 放大看细节 —— 属性表的问题都在几个像素的量级上
    document.documentElement.style.zoom = "2";
    await shot("11-light-props");
    document.documentElement.style.zoom = "";
    alive();
  });

  it("浅色 · 折叠箭头（悬停态）", async () => {
    render();
    await settle(700);
    // 用 :hover 的样式没法在截图里体现，直接把那一行的箭头点亮，
    // 好确认它的位置、大小、和标题的对齐
    const style = document.createElement("style");
    style.textContent = ".cm-fold-arrow { opacity: .5 !important }";
    document.head.appendChild(style);
    document.documentElement.style.zoom = "2";
    const main = document.querySelector<HTMLElement>(".main");
    if (main) main.scrollTop = 0;
    await shot("12-light-fold");
    document.documentElement.style.zoom = "";
    style.remove();
    alive();
  });

  it("浅色 · 搜索", async () => {
    render();
    await settle(400);
    clickRail("搜索");
    const input = document.querySelector<HTMLInputElement>("#verso-search-input");
    if (input) {
      input.value = "矩阵";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await shot("03-light-search");
    alive();
  });

  it("浅色 · 思维导图", async () => {
    render();
    await settle(700);
    document.querySelector<HTMLElement>('.rail-btn[aria-label="思维导图"]')?.click();
    await shot("15-light-mindmap");
    alive();
  });

  it("浅色 · 思维导图的节点菜单", async () => {
    // 触摸屏上这是唯一能拿到全部动作的入口（没有悬停、没有右键），
    // 所以它长什么样、盖住了什么，值得单独看一眼
    render();
    await settle(700);
    document.querySelector<HTMLElement>('.rail-btn[aria-label="思维导图"]')?.click();
    await settle(300);
    const target = [...document.querySelectorAll<HTMLElement>(".mm-node")].find(
      (n) => n.querySelector(".mm-text")?.textContent === "待办",
    );
    // 桌面上开菜单只有右键这一条路（节点上那个 ⋯ 只在没有右键的设备上出现）
    const box = target!.getBoundingClientRect();
    target!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 40,
        clientY: box.bottom - 6,
      }),
    );
    await shot("17-light-mindmap-menu");
    alive();
  });

  it("深色 · 思维导图", async () => {
    theme = "dark";
    render();
    await settle(700);
    document.querySelector<HTMLElement>('.rail-btn[aria-label="思维导图"]')?.click();
    await shot("16-dark-mindmap");
    alive();
  });

  it("浅色 · 版本历史", async () => {
    render();
    await settle(700);
    clickRail("动态");
    await settle(300);
    // 展开第一条，看得到动了哪几篇
    document.querySelector<HTMLElement>(".hist-head")?.click();
    await shot("17-light-history");
    alive();
  });

  it("浅色 · 模板面板", async () => {
    render();
    await settle(600);
    clickRail("模板");
    await shot("14-light-templates");
    alive();
  });

  it("浅色 · 标签", async () => {
    render();
    await settle(400);
    clickRail("标签");
    await settle(300);
    document.querySelector<HTMLElement>(".tag-label")?.click();
    await shot("04-light-tags");
    alive();
  });

  it("深色 · 命令面板", async () => {
    theme = "dark";
    render();
    await settle(400);
    clickRail("命令面板");
    await shot("05-dark-palette");
    alive();
  });

  it("浅色 · / 命令菜单", async () => {
    render();
    await settle(600);
    // 用 EditorView.findFromDOM 拿到真实的编辑器实例，走真实输入路径 ——
    // 补全面板只有在真的敲了字符之后才会弹
    const dom = document.querySelector<HTMLElement>(".cm-editor");
    const cm = dom && EditorView.findFromDOM(dom);
    expect(cm, "没找到编辑器实例").not.toBeNull();
    cm!.focus();
    const at = cm!.state.doc.length;
    cm!.dispatch({ changes: { from: at, insert: "\n" }, selection: { anchor: at + 1 } });
    cm!.dispatch({
      changes: { from: at + 1, insert: "/" },
      selection: { anchor: at + 2 },
      userEvent: "input.type",
    });
    await shot("07-light-slash");
    alive();
  });

  it("浅色 · 设置", async () => {
    render();
    await settle(400);
    clickRail("设置");
    await shot("06-light-settings");
    alive();
  });

  it("浅色 · 同步设置", async () => {
    render();
    await settle(400);
    clickRail("设置");
    await settle(200);
    [...document.querySelectorAll<HTMLElement>(".settings-tabs button")]
      .find((b) => b.textContent === "同步与共享")!
      .click();
    await shot("18-light-sync");
    alive();
  });
});

/* ==========================================================================
   手机竖屏（390×844）

   桌面那一组看不出移动端的问题：一屏 1440px 上什么都放得下，而真正的毛病
   —— 面板被裁、按钮点不到、横向溢出 —— 只在窄屏上才现形。
   ========================================================================== */

const PHONE = { w: 390, h: 844 };

describe("视觉工作台 · 手机竖屏", () => {
  beforeEach(async () => {
    mobileFlag = true;
    // headless Chromium 报的是 `hover: hover`，媒体查询那条路在这里永远不
    // 成立 —— 真机上由 main.tsx 按指针能力同步打上，这里手工补一份，
    // 否则拍到的是「桌面尺寸的手机」，量什么都不作数
    document.documentElement.dataset.touch = "on";
    await page.viewport(PHONE.w, PHONE.h);
  });

  afterEach(async () => {
    delete document.documentElement.dataset.touch;
    // 视口是整个浏览器实例共享的，不还原会污染后面跑的文件
    await page.viewport(1440, 900);
  });

  /**
   * 点动作组里的某一项。横排导航上它们不在条上，收在 `⋯` 弹出的面板里
   * （见 ActivityBar），所以要先点开那个面板
   */
  async function clickAction(label: string) {
    document.querySelector<HTMLElement>('.rail-btn[aria-label="更多"]')!.click();
    await settle(200);
    [...document.querySelectorAll<HTMLElement>(".rail-sheet-item")]
      .find((b) => b.getAttribute("aria-label") === label)
      ?.click();
    await settle(300);
  }

  /** 抽屉默认开着，多数场景要先关掉它才看得到正文 */
  async function closeDrawer() {
    document.querySelector<HTMLElement>(".sidebar-scrim")?.click();
    await settle(300);
  }

  it("手机 · 文档树抽屉", async () => {
    render();
    await shot("m01-phone-tree");
    alive();
  });

  it("手机 · 正文阅读", async () => {
    render();
    await settle(700);
    await closeDrawer();
    await shot("m02-phone-reading");
    alive();
  });

  it("手机 · 标签栏", async () => {
    workspace = {
      tabs: ["论文.md", "数学/线性代数/奇异值分解.md", "论文/奇异值分解的数值方法.md", "日志.md"],
      active: 2,
      pinnedCount: 1,
    };
    render();
    await settle(700);
    await closeDrawer();
    await shot("m03-phone-tabs");
    alive();
  });

  it("手机 · 属性条展开", async () => {
    render();
    await settle(700);
    await closeDrawer();
    document.querySelector<HTMLElement>(".props-toggle")?.click();
    await shot("m04-phone-props");
    alive();
  });

  /** 表格和代码块是最容易在窄屏上横向溢出的两样东西 */
  it("手机 · 表格与代码块", async () => {
    render();
    await settle(900);
    await closeDrawer();
    const main = document.querySelector<HTMLElement>(".main")!;
    const table = document.querySelector<HTMLElement>(".cm-table");
    if (table) {
      main.scrollTop +=
        table.getBoundingClientRect().top - main.getBoundingClientRect().top - 12;
    }
    await shot("m05-phone-table");
    alive();
  });

  it("手机 · 设置", async () => {
    render();
    await settle(600);
    await clickAction("设置");
    await shot("m06-phone-settings");
    alive();
  });

  it("手机 · 命令面板", async () => {
    render();
    await settle(600);
    await clickAction("命令面板");
    await shot("m07-phone-palette");
    alive();
  });

  it("手机 · 更多面板", async () => {
    render();
    await settle(600);
    await closeDrawer();
    document.querySelector<HTMLElement>('.rail-btn[aria-label="更多"]')!.click();
    await shot("m14-phone-more");
    alive();
  });

  it("手机 · 搜索", async () => {
    render();
    await settle(500);
    clickRail("搜索");
    const input = document.querySelector<HTMLInputElement>("#verso-search-input");
    if (input) {
      input.value = "矩阵";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await shot("m08-phone-search");
    alive();
  });

  it("手机 · 动态与历史", async () => {
    render();
    await settle(700);
    clickRail("动态");
    await settle(300);
    document.querySelector<HTMLElement>(".hist-head")?.click();
    await shot("m09-phone-history");
    alive();
  });

  it("手机 · 文档树右键菜单", async () => {
    render();
    await settle(700);
    const row = document.querySelectorAll<HTMLElement>(".tree-row")[1];
    const r = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 60,
        clientY: r.top + 10,
      }),
    );
    await shot("m10-phone-tree-menu");
    alive();
  });

  it("手机 · 思维导图", async () => {
    render();
    await settle(700);
    await closeDrawer();
    await clickAction("思维导图");
    await shot("m11-phone-mindmap");
    alive();
  });

  /**
   * **桌面窗口被拖窄**，不是手机：布局跟着视口走（底部导航照样出现），
   * 但指针还是鼠标，尺寸不该被撑大。作者要亲眼看这次改动，最省事的一条路
   * 就是把窗口拖窄 —— 那条路上看到的就是这一张。
   */
  it("窄窗口（有鼠标，不是手机）", async () => {
    delete document.documentElement.dataset.touch;
    mobileFlag = false;
    render();
    await settle(700);
    await closeDrawer();
    await shot("m15-narrow-desktop");
    alive();
  });

  /** 作者报「太紧凑」的就是这一张：窄窗口 + 鼠标时，面板的行高一度塌成 17px */
  it("窄窗口 · 「更多」面板（鼠标）", async () => {
    delete document.documentElement.dataset.touch;
    mobileFlag = false;
    render();
    await settle(700);
    await closeDrawer();
    document.querySelector<HTMLElement>('.rail-btn[aria-label="更多"]')!.click();
    await shot("m16-narrow-more-mouse");
    alive();
  });

  it("手机 · 标签", async () => {
    render();
    await settle(500);
    clickRail("标签");
    await settle(300);
    document.querySelector<HTMLElement>(".tag-label")?.click();
    await shot("m13-phone-tags");
    alive();
  });
});



