/**
 * 整个页面（body）不该能滚 —— `.app` 是 `100vh + overflow:hidden`，
 * 界面本身必须钉死在视口里。
 *
 * **挂载方式很重要**：必须挂进 `#root`、走正常文档流，和 index.html 一样。
 * 之前的诊断把 App 挂在 `position:fixed;inset:0` 的容器里，那样等于给它罩了
 * 一层"绝对不会撑开 body"的壳，这个 bug 会被完整地屏蔽掉。
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lockPageScroll } from "./shell";
import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "./types";

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "test-vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const TREE: TreeNode[] = [
  {
    name: "论文",
    path: "论文.md",
    kind: "document",
    children: [],
    childDir: null,
    order: null,
    created: null,
    updated: null,
  },
];

/** 和作者截图里那篇一样：callout + 代码块 + 引用，内容很短 */
const BODY = `> [!note] 笔记
> asdad

\`\`\`
asdasd
asdasdad
asdasdad
\`\`\`

> sada
`;

const NOTE: NoteContent = {
  path: "论文.md",
  id: "x",
  title: "论文",
  frontmatter: {},
  frontmatterText: "",
  body: BODY,
  mtimeMs: 0,
};

const NOTES: NoteRef[] = [{ path: "论文.md", name: "论文" }];

vi.mock("./api", () => ({
  api: {
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "论文.md" }),
    openVault: async () => VAULT,
    tree: async () => TREE,
    listNotes: async () => NOTES,
    readNote: async () => NOTE,
    writeNote: async () => 0,
    statNote: async () => 0,
    createNote: async () => ({ path: "x.md", id: "x", title: "x" }),
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
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: async () => 0,
    workspaceGet: async () => ({ tabs: [], active: 0 }),
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

let root: Root | null = null;
const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

/** 谁伸到了视口下面。返回「标签.类名 bottom=…」，最靠下的排前面 */
function overflowing(): string[] {
  const vh = document.documentElement.clientHeight;
  const out: { label: string; bottom: number }[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) continue;
    if (r.bottom > vh + 1) {
      const cls = typeof el.className === "string" ? el.className.split(/\s+/)[0] : "";
      out.push({
        label: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""} bottom=${Math.round(r.bottom)}`,
        bottom: r.bottom,
      });
    }
  }
  return out
    .sort((a, b) => b.bottom - a.bottom)
    .slice(0, 12)
    .map((x) => x.label);
}

function mountApp() {
  const host = document.createElement("div");
  host.id = "root"; // styles.css 里 html/body/#root 都是 height:100%
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<App />);
}

describe("页面本身不该能滚", () => {
  it("body 的 scrollHeight 不超过视口", async () => {
    mountApp();
    await settle();

    const de = document.documentElement;
    const over = de.scrollHeight - de.clientHeight;

    expect(
      over,
      `页面能往下滚 ${over}px。伸到视口外面的元素（最靠下的在前）：\n` +
        overflowing().join("\n"),
    ).toBeLessThanOrEqual(1);
  });

  /**
   * 上面那条只说明「此刻没有东西超出视口」，挡不住以后某个浮层多出十几像素。
   * 真正的保险是 `overflow: hidden` 本身 —— 有它在，超出多少都滚不动。
   */
  it("html 和 body 都关掉了滚动", async () => {
    mountApp();
    await settle(300);
    expect(getComputedStyle(document.documentElement).overflowY).toBe("hidden");
    expect(getComputedStyle(document.body).overflowY).toBe("hidden");
  });

  /**
   * 弹性 overscroll（橡皮筋）是**合成器层**的事：它直接平移整个页面再弹回来，
   * `overflow` 和 `scrollTop` 都感知不到，headless 里也复现不出来 —— 所以这里
   * 只能钉住那条声明本身，像 `tauriConfig.test.ts` 钉 `dragDropEnabled` 一样。
   *
   * 删掉它的症状：触控板两指一滑，整个界面连图标栏带状态栏一起晃，边上露白。
   */
  it("关掉了弹性 overscroll", async () => {
    mountApp();
    await settle(300);
    expect(getComputedStyle(document.documentElement).overscrollBehaviorY).toBe("none");
    expect(getComputedStyle(document.documentElement).overscrollBehaviorX).toBe("none");
  });

  /** 编辑区滚到头之后不该把外层带着一起动 */
  it("编辑区不把滚动链传给外层", async () => {
    mountApp();
    await settle(500);
    const main = document.querySelector<HTMLElement>(".main")!;
    expect(getComputedStyle(main).overscrollBehaviorY).toBe("contain");
  });

  /**
   * `overflow:hidden` 只挡用户滚，**挡不住程序滚** —— `scrollIntoView`、
   * 焦点移动都能把文档顶上去，而且顶上去不会自己回来。所以还要有 `lockPageScroll`。
   *
   * 两个方向都要验：作者报的是「往下滑有问题」和「可以右滑」，横向一样会
   * 把图标栏切掉一截。
   */
  it.each([
    ["纵向", "scrollTop"] as const,
    ["横向", "scrollLeft"] as const,
  ])("被程序滚走之后会弹回来（%s）", async (_name, prop) => {
    const stop = lockPageScroll();
    try {
      mountApp();
      await settle(300);

      const big = document.createElement("div");
      big.style.cssText = "position:absolute;top:0;left:0;width:5000px;height:5000px";
      document.querySelector(".app")!.appendChild(big);
      await settle(120);

      const de = document.documentElement;
      de[prop] = 500;
      // scroll 事件是异步派发的，等一帧
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

      expect(de[prop], "页面被顶走之后没弹回来").toBe(0);
    } finally {
      stop();
    }
  });
});
