/**
 * 对比页上「把这一处改回去」（§2.8）。
 *
 * 组装那一半在 Rust 里穷举过了（`partial_revert_tests`）。这一层要验的是
 * **界面交出去的坐标对不对**：
 *
 * - 左右对照把一处「改了一行」拆成左右两格，而它在 diff 里是两条
 *   （删掉的 + 加上的）—— 少交一条，撤销之后会留下半行
 * - 按钮是**按「处」给的**，不是按行：中间隔着上下文的两段是两件事
 *
 * 这两件都要真实布局才排得出来（`splitRows` 之后行和 diff 行不再一一对应）。
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileDiff } from "../../../src/core/types";

/**
 * 第一个 hunk 里有**两处**改动，中间隔着一行上下文；第二个 hunk 一处。
 * 这样能一起验「按处分组」和「一个 hunk 里的第二处坐标不串位」。
 */
const DIFF: FileDiff = {
  path: "甲.md",
  kind: "modified",
  additions: 3,
  deletions: 1,
  binary: false,
  hunks: [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "标题" },
        { kind: "deleted", oldLine: 2, newLine: null, text: "旧的一行" },
        { kind: "added", oldLine: null, newLine: 2, text: "新的一行" },
        { kind: "context", oldLine: 3, newLine: 3, text: "中间" },
        { kind: "added", oldLine: null, newLine: 4, text: "又加的一行" },
      ],
    },
    {
      oldStart: 20,
      oldLines: 1,
      newStart: 21,
      newLines: 2,
      lines: [
        { kind: "context", oldLine: 20, newLine: 21, text: "末尾" },
        { kind: "added", oldLine: null, newLine: 22, text: "补的一行" },
      ],
    },
  ],
};

vi.mock("../../../src/host/api", () => ({
  api: { gitDiffFile: async () => DIFF },
}));

const { DiffView, blockHeads } = await import("../../../src/ui/DiffView");
await import("../../../src/ui/styles.css");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const reverted: [number, number][][] = [];

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  reverted.length = 0;
});

async function mount(canRevert = true) {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <DiffView
        selection={{ path: "甲.md", commit: null, label: "当前改动" }}
        revision={0}
        onClose={() => {}}
        onRevertLines={
          canRevert
            ? async (lines) => {
                reverted.push(lines);
              }
            : undefined
        }
      />,
    );
    await settle(200);
  });
}

/** 左右对照那一栏里的撤销按钮，从上到下 */
const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>(".diff-split .diff-revert-here"),
];

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await settle();
  });
}

describe("把这一处改回去（§2.8）", () => {
  it("看历史版本时没有这个按钮 —— 那一版已经是记下来的事实", async () => {
    await mount(false);
    expect(document.querySelector(".diff-revert-here")).toBeNull();
  });

  it("一处改动一个按钮，不是一行一个", async () => {
    await mount();
    // 第一个 hunk 两处、第二个一处
    expect(buttons()).toHaveLength(3);
  });

  /**
   * 这条是这个文件存在的理由：「改了一行」在界面上是一行，在 diff 里是两条。
   * 只交一条上去的话，撤销之后旧行回来了、新行还留着（或者反过来）。
   */
  it("点第一处，交上去的是删掉的和加上的两条", async () => {
    await mount();
    await click(buttons()[0]);
    expect(reverted).toHaveLength(1);
    expect([...reverted[0]].sort()).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it("同一个 hunk 里的第二处，坐标不串到第一处上", async () => {
    await mount();
    await click(buttons()[1]);
    expect(reverted[0]).toEqual([[0, 4]]);
  });

  it("第二个 hunk 那一处带的是它自己的 hunk 序号", async () => {
    await mount();
    await click(buttons()[2]);
    expect(reverted[0]).toEqual([[1, 1]]);
  });

  it("按钮画在两栏中间那条缝上", async () => {
    await mount();
    const row = buttons()[0].closest(".diff-split-row")!.getBoundingClientRect();
    const box = buttons()[0].getBoundingClientRect();
    const middle = row.left + row.width / 2;
    expect(Math.abs(box.left + box.width / 2 - middle)).toBeLessThan(2);
  });

  it("撤销进行中时按钮点不动 —— 连点两下会拿同一份坐标算两次", async () => {
    await mount();
    let release: (() => void) | null = null;
    root!.render(
      <DiffView
        selection={{ path: "甲.md", commit: null, label: "当前改动" }}
        revision={0}
        onClose={() => {}}
        onRevertLines={() => new Promise<void>((r) => (release = r))}
      />,
    );
    await act(async () => {
      await settle(200);
    });
    await click(buttons()[0]);
    expect(buttons()[0].disabled).toBe(true);
    await act(async () => {
      release?.();
      await settle();
    });
    expect(buttons()[0].disabled).toBe(false);
  });
});

describe("按「处」分组", () => {
  it("连着的算一处，隔了上下文就是两处", () => {
    const kinds = ["context", "added", "added", "context", "deleted", "context"];
    const heads = blockHeads(kinds, (k, i) => (k === "context" ? [] : [[0, i]]));
    expect([...heads.keys()]).toEqual([1, 4]);
    expect(heads.get(1)).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(heads.get(4)).toEqual([[0, 4]]);
  });

  it("整段都是改动时只有一处", () => {
    const kinds = ["deleted", "added"];
    const heads = blockHeads(kinds, (_, i) => [[0, i]]);
    expect([...heads.keys()]).toEqual([0]);
    expect(heads.get(0)).toHaveLength(2);
  });
});
