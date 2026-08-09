/**
 * 文档树里**依赖真实几何**的那一半 —— 在真实 Chromium 里跑。
 *
 * 拖放分区（上下各 25% 是调顺序、中间 50% 是移进去当子文档）算的是
 * `getBoundingClientRect().height`。happy-dom 里这个高度恒为 0，比值成了
 * `0/0 = NaN`，`r < 0.25` 和 `r > 0.75` 双双为假 —— 于是**每一次拖放都会
 * 被判成「移进去」，而测试全绿**。这正是 AGENTS.md 里说的假阴性。
 *
 * `reorderSiblings` 那些纯函数归 `lib/treeSort.test.ts`（纯 Node）。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tree } from "../../../src/ui/Tree";
import type { TreeNode } from "../../../src/core/types";
import "../../../src/ui/styles.css";

const roots: Root[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) r.unmount();
  document.body.innerHTML = "";
});

function doc(name: string, children: TreeNode[] = []): TreeNode {
  return {
    name,
    path: `${name}.md`,
    kind: "document",
    childDir: children.length ? name : null,
    children,
    order: null,
    created: null,
    updated: null,
  };
}

const NODES = [doc("甲"), doc("乙"), doc("丙")];

type Reorder = (movedPath: string, targetPath: string, place: "before" | "after") => void;

function mount(onReorder: Reorder) {
  const host = document.createElement("div");
  // 侧栏宽度：行太窄会换行，行高一变分区比例就不是想验的那个了
  host.style.width = "260px";
  document.body.appendChild(host);

  const onMove = vi.fn();
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <Tree
        nodes={NODES}
        activePath={null}
        onOpen={() => {}}
        onAddChild={() => {}}
        onMenu={() => {}}
        onMove={onMove}
        onReorder={onReorder}
        onRenameSubmit={() => {}}
        onRenameCancel={() => {}}
      />,
    );
  });
  return { host, onMove };
}

/** 行元素。`.tree-row` 的顺序就是 NODES 的顺序 */
function row(host: HTMLElement, i: number): HTMLElement {
  return host.querySelectorAll<HTMLElement>(".tree-row")[i];
}

/**
 * 拖一个路径到某一行的某个高度上。`ratio` 是行内的相对位置（0=顶，1=底）。
 *
 * jsdom/浏览器里 React 的合成拖放事件拿不到真的 DataTransfer，这里自己造一个
 * 最小实现 —— 只需要 `types` / `getData` / `setData` / `dropEffect` 四样。
 */
function dragTo(target: HTMLElement, srcPath: string, ratio: number) {
  const box = target.getBoundingClientRect();
  expect(box.height, "行高为 0 就说明没有真实布局，这个测试白测").toBeGreaterThan(0);

  const store = new Map([["text/verso-path", srcPath]]);
  const dataTransfer = {
    types: [...store.keys()],
    getData: (t: string) => store.get(t) ?? "",
    setData: (t: string, v: string) => void store.set(t, v),
    dropEffect: "none",
    effectAllowed: "move",
  };
  const clientY = box.top + box.height * ratio;

  const fire = (type: string) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { dataTransfer, clientY, clientX: box.left + 20 });
    act(() => {
      target.dispatchEvent(e);
    });
  };
  fire("dragover");
  fire("drop");
}

describe("拖放分区", () => {
  it("上四分之一 = 插到前面", () => {
    const onReorder = vi.fn();
    const { host, onMove } = mount(onReorder);
    dragTo(row(host, 1), "丙.md", 0.1);
    expect(onReorder).toHaveBeenCalledWith("丙.md", "乙.md", "before");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("下四分之一 = 插到后面", () => {
    const onReorder = vi.fn();
    const { host, onMove } = mount(onReorder);
    dragTo(row(host, 1), "甲.md", 0.9);
    expect(onReorder).toHaveBeenCalledWith("甲.md", "乙.md", "after");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("中间一半 = 移进去当子文档", () => {
    const onReorder = vi.fn();
    const { host, onMove } = mount(onReorder);
    dragTo(row(host, 1), "甲.md", 0.5);
    expect(onMove).toHaveBeenCalledWith("甲.md", "乙.md");
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("拖到自己身上是无操作", () => {
    const onReorder = vi.fn();
    const { host, onMove } = mount(onReorder);
    dragTo(row(host, 1), "乙.md", 0.1);
    expect(onReorder).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("落点提示", () => {
  // 三种落点得看得出区别，否则用户根本不知道松手会发生什么
  it("三种落点各有各的 class", () => {
    const onReorder = vi.fn();
    const { host } = mount(onReorder);
    const target = row(host, 1);

    const hover = (ratio: number) => {
      const box = target.getBoundingClientRect();
      const store = new Map([["text/verso-path", "甲.md"]]);
      const e = new Event("dragover", { bubbles: true, cancelable: true });
      Object.assign(e, {
        dataTransfer: { types: [...store.keys()], getData: () => "甲.md", dropEffect: "none" },
        clientY: box.top + box.height * ratio,
        clientX: box.left + 20,
      });
      act(() => {
        target.dispatchEvent(e);
      });
      return target.className;
    };

    expect(hover(0.1)).toContain("is-drop-before");
    expect(hover(0.9)).toContain("is-drop-after");
    expect(hover(0.5)).toContain("is-drop-target");
  });

  it("收起的节点在树里当成没有子文档，但要说清楚收了几篇", () => {
    const child = doc("子一");
    const parent = { ...doc("项目", [child, doc("子二")]), collapsed: true };
    const host = document.createElement("div");
    host.style.width = "260px";
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => {
      root.render(
        <Tree
          nodes={[parent]}
          activePath={null}
          onOpen={() => {}}
          onAddChild={() => {}}
          onMenu={() => {}}
          onMove={() => {}}
          onReorder={() => {}}
          onRenameSubmit={() => {}}
          onRenameCancel={() => {}}
        />,
      );
    });

    // 顶层默认展开（depth === 0），但这一篇收起了：子文档一行都不该出现
    expect(host.querySelectorAll(".tree-row")).toHaveLength(1);
    // 展开箭头也不该有 —— 点了什么都不会发生的箭头比没有箭头更糟
    expect(host.querySelector(".tree-twisty")?.className).toContain("is-empty");
    // 「没有子文档」和「被收起来了」不能长得一样
    expect(host.querySelector(".tree-collapsed")?.textContent).toBe("2");
  });
});
