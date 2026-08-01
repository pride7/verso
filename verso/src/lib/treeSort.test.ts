import { describe, expect, it } from "vitest";

import { naturalCmp, reorderSiblings, sortTree } from "./treeSort";
import type { TreeNode } from "../types";

function node(name: string, extra: Partial<TreeNode> = {}): TreeNode {
  return {
    name,
    path: `${name}.md`,
    kind: "document",
    childDir: null,
    children: [],
    order: null,
    created: null,
    updated: null,
    ...extra,
  };
}

const names = (nodes: TreeNode[]) => nodes.map((n) => n.name);

describe("自然序", () => {
  // 笔记名里带编号很常见。纯字典序会把「第10章」排在「第2章」前面，
  // 那样排出来完全没法看
  it("数字按大小排，不按字典序", () => {
    expect(naturalCmp("第2章", "第10章")).toBeLessThan(0);
    expect(naturalCmp("a10", "a9")).toBeGreaterThan(0);
  });

  it("中文按拼音", () => {
    expect(naturalCmp("阿", "波")).toBeLessThan(0);
  });
});

describe("按规则排序", () => {
  const nodes = [
    node("乙", { created: "2026-01-02T00:00:00+08:00", updated: "2026-03-01T00:00:00+08:00" }),
    node("甲", { created: "2026-01-03T00:00:00+08:00", updated: "2026-02-01T00:00:00+08:00" }),
    node("丙", { created: "2026-01-01T00:00:00+08:00", updated: "2026-04-01T00:00:00+08:00" }),
  ];

  it("名称升序 / 降序", () => {
    expect(names(sortTree(nodes, "name"))).toEqual(["丙", "甲", "乙"]);
    expect(names(sortTree(nodes, "name-desc"))).toEqual(["乙", "甲", "丙"]);
  });

  it("最近创建 / 最近修改都是新的在前", () => {
    expect(names(sortTree(nodes, "created"))).toEqual(["甲", "乙", "丙"]);
    expect(names(sortTree(nodes, "updated"))).toEqual(["丙", "乙", "甲"]);
  });

  it("缺时间的排最后，而不是被当成 1970 年排最前", () => {
    const withMissing = [...nodes, node("无时间")];
    const sorted = names(sortTree(withMissing, "created"));
    expect(sorted[sorted.length - 1]).toBe("无时间");
  });

  it("不改原数组 —— 树是 React 状态，就地改会认不出变化", () => {
    const before = names(nodes);
    sortTree(nodes, "name-desc");
    expect(names(nodes)).toEqual(before);
  });

  it("子节点也一起排", () => {
    const tree = [node("父", { children: [node("乙"), node("甲")] })];
    expect(names(sortTree(tree, "name")[0].children)).toEqual(["甲", "乙"]);
  });
});

describe("手动排序", () => {
  it("按 order 从小到大", () => {
    const nodes = [node("丙", { order: 3 }), node("甲", { order: 1 }), node("乙", { order: 2 })];
    expect(names(sortTree(nodes, "manual"))).toEqual(["甲", "乙", "丙"]);
  });

  // 新建的笔记没有 order。让它们插在已排好的中间的话，每新建一篇
  // 手排的顺序看起来就乱一次
  it("没排过的沉到底部，并按名字排", () => {
    const nodes = [node("新乙"), node("丙", { order: 2 }), node("新甲"), node("甲", { order: 1 })];
    expect(names(sortTree(nodes, "manual"))).toEqual(["甲", "丙", "新甲", "新乙"]);
  });
});

describe("拖拽重排", () => {
  const sibs = [node("甲"), node("乙"), node("丙"), node("丁")];

  it("放到某一项之前", () => {
    expect(reorderSiblings(sibs, "丁.md", "乙.md", "before")).toEqual([
      "甲.md",
      "丁.md",
      "乙.md",
      "丙.md",
    ]);
  });

  it("放到某一项之后", () => {
    expect(reorderSiblings(sibs, "甲.md", "丙.md", "after")).toEqual([
      "乙.md",
      "丙.md",
      "甲.md",
      "丁.md",
    ]);
  });

  it("往前挪时目标位置要按**移走之后**的清单算", () => {
    // 把「丁」放到「甲」之前：先摘掉丁，再插到 index 0
    expect(reorderSiblings(sibs, "丁.md", "甲.md", "before")).toEqual([
      "丁.md",
      "甲.md",
      "乙.md",
      "丙.md",
    ]);
  });

  it("拖到自己身上是无操作", () => {
    expect(reorderSiblings(sibs, "乙.md", "乙.md", "before")).toEqual(sibs.map((n) => n.path));
  });

  it("目标不在这一组里就不动", () => {
    expect(reorderSiblings(sibs, "甲.md", "别处.md", "after")).toEqual(sibs.map((n) => n.path));
  });

  // 返回整组而不是只返回被移动的那一个：原来大家可能都没有 order，
  // 或者 order 有重复、有空洞，整组重编号才能保证结果稳定
  it("返回的是完整的兄弟清单", () => {
    expect(reorderSiblings(sibs, "甲.md", "丙.md", "after")).toHaveLength(4);
  });
});
