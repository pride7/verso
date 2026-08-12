/**
 * 大纲里**依赖真实布局**的那一半 —— 在真实 Chromium 里跑。
 *
 * `parseHeadings` 那些纯函数归 `lib/outline.test.ts`（纯 Node）。这里验的是
 * 纯 Node 一定给假阴性的三件事：
 *
 * 1. `topLine()` 要的是 CM6 的**高度图**。没有布局引擎时所有行高都是 0，
 *    不管滚到哪它都会说「第 1 行」，测试照样通过。
 * 2. 编辑器自己不滚，滚的是外面那个容器（styles.css「编辑区」一节）。
 *    `scrollParent` 找得对不对，只有真的能滚的元素才验得出来。
 * 3. 浮动目录的展开是纯 CSS 的 `:hover`，得有层叠和计算样式。
 */
import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/host/api", () => ({
  api: { backlinks: vi.fn(async () => []) },
}));

import { activeHeading, parseHeadings } from "../../../src/core/outline";
import { Editor, type EditorHandle } from "../../../src/ui/Editor";
import { OutlineFloat, OutlineView } from "../../../src/ui/Outline";
import "../../../src/ui/styles.css";

const roots: Root[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) r.unmount();
  document.body.innerHTML = "";
});

/** 五节，每节都长到超过一屏 —— 短文档滚不动，什么也验不出来 */
const DOC = [1, 2, 3, 4, 5]
  .map((n) => [`## 第 ${n} 节`, ...Array.from({ length: 30 }, (_, i) => `正文 ${n}-${i}`)].join("\n"))
  .join("\n\n");

const HEADINGS = parseHeadings(DOC);

/** 复刻 App 的布局：编辑器不滚，外面的 .main 滚 */
function mountEditor() {
  const scroller = document.createElement("div");
  scroller.className = "main";
  scroller.style.height = "400px";
  scroller.style.overflowY = "auto";
  document.body.appendChild(scroller);

  const handleRef: { current: EditorHandle | null } = { current: null };
  const root = createRoot(scroller);
  roots.push(root);
  root.render(
    <Editor
      note={{
        path: "长文.md",
        id: null,
        title: "长文",
        frontmatter: {},
        frontmatterText: null,
        body: DOC,
        mtimeMs: 0,
      }}
      onChange={() => {}}
      onSaveNow={() => {}}
      onFollowLink={() => {}}
      getNotes={() => []}
      breadcrumb={[]}
      onNavigate={() => {}}
      onRenameNote={() => {}}
      handleRef={handleRef}
      revision={0}
      onNoteChanged={() => {}}
      customSnippets=""
      sourceMode={false}
      onSaveFrontmatter={async () => {}}
      onSaveAttachment={async () => "attachments/x.png"}
      imageSrc={() => null}
      onError={() => {}}
    />,
  );
  return { scroller, handleRef };
}

const settle = () => new Promise((r) => setTimeout(r, 300));

describe("大纲跳转与当前位置", () => {
  it("五节都被认出来了", () => {
    expect(HEADINGS).toHaveLength(5);
    expect(HEADINGS[2].text).toBe("第 3 节");
  });

  it("gotoLine 把标题顶到上沿，topLine 立刻认出它", async () => {
    const { scroller, handleRef } = mountEditor();
    await settle();

    expect(handleRef.current).not.toBeNull();
    expect(handleRef.current!.topLine()).toBe(1);

    handleRef.current!.gotoLine(HEADINGS[3].line);
    await settle();

    // 容器真的滚了 —— 这一条挂掉说明 scrollParent 找错了元素
    expect(scroller.scrollTop).toBeGreaterThan(0);
    // 顶上来的正是那一行（留了 12px 空隙，允许差一行）
    expect(handleRef.current!.topLine()).toBeGreaterThanOrEqual(HEADINGS[3].line - 1);
    expect(activeHeading(HEADINGS, handleRef.current!.topLine())).toBe(3);
  });

  it("滚回顶部时当前节回到第一条", async () => {
    const { scroller, handleRef } = mountEditor();
    await settle();
    handleRef.current!.gotoLine(HEADINGS[4].line);
    await settle();
    expect(activeHeading(HEADINGS, handleRef.current!.topLine())).toBe(4);

    scroller.scrollTop = 0;
    await settle();
    expect(activeHeading(HEADINGS, handleRef.current!.topLine())).toBe(0);
  });
});

describe("侧栏大纲", () => {
  const headings = parseHeadings("# 总论\n\n## 方法\n\n### 实验\n\n## 结论");

  function mountOutline(activeIndex = 1) {
    const host = document.createElement("div");
    host.style.width = "252px";
    document.body.appendChild(host);
    const picked: number[] = [];
    const root = createRoot(host);
    roots.push(root);
    root.render(
      <OutlineView
        headings={headings}
        activeIndex={activeIndex}
        onPick={(h) => picked.push(h.line)}
      />,
    );
    return { host, picked };
  }

  it("用紧凑圆点显示真实标题等级", async () => {
    const { host } = mountOutline();
    await settle();

    const levels = [...host.querySelectorAll<HTMLElement>(".outline-level")];
    expect(levels.map((level) => level.textContent)).toEqual(["1", "2", "3", "2"]);
    expect(levels[0].getBoundingClientRect().width).toBeLessThanOrEqual(18);
    expect(host.querySelector<HTMLElement>(".outline-row")!.getBoundingClientRect().height)
      .toBeLessThanOrEqual(30);
    expect(host.querySelector<HTMLButtonElement>(".outline-row")!.title).toBe("H1 · 总论");
  });

  it("保留层级缩进、当前位置与点击跳转", async () => {
    const { host, picked } = mountOutline(2);
    await settle();

    const rows = [...host.querySelectorAll<HTMLButtonElement>(".outline-row")];
    expect(rows.map((row) => row.style.getPropertyValue("--outline-indent")))
      .toEqual(["0px", "12px", "24px", "12px"]);
    expect(rows.map((row) => Number.parseFloat(getComputedStyle(row).paddingLeft)))
      .toEqual([7, 19, 31, 19]);
    expect(host.querySelectorAll(".outline-row.is-active")).toHaveLength(1);
    await userEvent.click(rows[3]);
    expect(picked).toEqual([headings[3].line]);
  });

  it("标题里的行内公式渲染成 KaTeX，错误公式也不会弄丢目录项", async () => {
    const formulas = parseHeadings([
      "# 项目总览",
      "## $\\widehat p_{k,m}$",
      "## $\\operatorname{TV}_k$",
      "## $\\Udots$",
    ].join("\n"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    root.render(<OutlineView headings={formulas} activeIndex={0} onPick={() => {}} />);
    await settle();

    const labels = host.querySelectorAll<HTMLElement>(".outline-text");
    expect(labels).toHaveLength(4);
    expect(host.querySelectorAll(".outline-text .katex")).toHaveLength(3);
    expect(labels[1].querySelector(".katex-html")!.textContent).not.toContain("\\widehat");
    expect(labels[2].querySelector(".katex-html")!.textContent).not.toContain("\\operatorname");
    // throwOnError:false 会由 KaTeX 用错误色保留原命令，目录项不能因此消失
    expect(labels[3].querySelector(".katex-html")!.textContent).toContain("\\Udots");
  });
});

describe("浮动目录", () => {
  function mountFloat(activeIndex = 1) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const picked: number[] = [];
    const root = createRoot(host);
    roots.push(root);
    root.render(
      <OutlineFloat
        headings={HEADINGS}
        activeIndex={activeIndex}
        onPick={(h) => picked.push(h.line)}
      />,
    );
    return { host, picked };
  }

  it("靠上摆，而且给滚动条让出位置", async () => {
    // 两条都是作者报回来的：居中会和正在读的那一行抢位置；压在滚动条上
    // 既看着脏，想拖滚动条时也会先碰到目录。它俩只有真布局验得出来
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0";
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    root.render(
      <div className="app">
        <main className="main">
          <div style={{ height: 3000 }} />
        </main>
        <OutlineFloat headings={HEADINGS} activeIndex={0} onPick={() => {}} />
      </div>,
    );
    await settle();

    const main = host.querySelector<HTMLElement>(".main")!.getBoundingClientRect();
    const list = host.querySelector<HTMLElement>(".toc-list")!.getBoundingClientRect();
    // 滚动条轨道是 11px（styles.css 的 ::-webkit-scrollbar）
    expect(main.right - list.right).toBeGreaterThanOrEqual(11);
    // 落在上半屏，不是垂直居中
    expect(list.top).toBeLessThan(main.top + main.height * 0.35);
  });

  it("收起时只有短横线，标题文字宽度为 0", async () => {
    const { host } = mountFloat();
    await settle();
    const items = host.querySelectorAll<HTMLElement>(".toc-item");
    expect(items).toHaveLength(5);

    const label = host.querySelector<HTMLElement>(".toc-label")!;
    const dash = host.querySelector<HTMLElement>(".toc-dash")!;
    expect(label.getBoundingClientRect().width).toBe(0);
    expect(dash.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(host.querySelectorAll(".toc-item.is-active")).toHaveLength(1);
  });

  it("鼠标移上去展开成文字，短横线收掉", async () => {
    const { host, picked } = mountFloat();
    await settle();
    const list = host.querySelector<HTMLElement>(".toc-list")!;

    await userEvent.hover(list);
    await settle();

    const label = host.querySelector<HTMLElement>(".toc-label")!;
    expect(label.getBoundingClientRect().width).toBeGreaterThan(20);
    expect(label.textContent).toBe("第 1 节");
    expect(host.querySelector<HTMLElement>(".toc-dash")!.getBoundingClientRect().width).toBe(0);

    // 展开之后条目要能点得到 —— 容器是 pointer-events:none，
    // 忘了在列表上开回来的话这一下就点不中
    await userEvent.click(host.querySelectorAll(".toc-item")[2]);
    expect(picked).toEqual([HEADINGS[2].line]);
  });

  it("展开后同样渲染标题里的公式", async () => {
    const headings = parseHeadings("# 总览\n## $E = mc^2$");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    root.render(<OutlineFloat headings={headings} activeIndex={0} onPick={() => {}} />);
    await settle();

    expect(host.querySelectorAll(".toc-label .katex")).toHaveLength(1);
    expect(host.querySelectorAll<HTMLElement>(".toc-label")[1].textContent).not.toContain("$E");
  });
});
