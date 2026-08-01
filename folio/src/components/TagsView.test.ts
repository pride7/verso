import { describe, expect, it } from "vitest";

import { buildTagTree } from "./TagsView";

/** 只看结构，不看计数 —— 断言写起来短一些 */
const shape = (nodes: ReturnType<typeof buildTagTree>): unknown =>
  nodes.map((n) => (n.children.length ? { [n.name]: shape(n.children) } : n.name));

describe("标签树", () => {
  it("平级标签原样列出", () => {
    expect(shape(buildTagTree([["数学", 3], ["论文", 2]]))).toEqual(["数学", "论文"]);
  });

  it("按 / 拆成层级，只显示本层名字", () => {
    expect(shape(buildTagTree([["项目/写作", 1]]))).toEqual([{ 项目: ["写作"] }]);
  });

  // 关键一条：`#项目/写作` 存在不代表 `#项目` 存在。索引里只有完整字符串，
  // 中间层必须按需补出来，否则整棵树会只剩一个长名字
  it("父标签不存在时也要补出中间层", () => {
    const tree = buildTagTree([["a/b/c", 1]]);
    expect(shape(tree)).toEqual([{ a: [{ b: ["c"] }] }]);
    expect(tree[0].count).toBe(0); // 补出来的层自己没有笔记
    expect(tree[0].children[0].children[0].count).toBe(1);
  });

  it("父标签自己也有笔记时计数不丢", () => {
    const tree = buildTagTree([
      ["项目", 5],
      ["项目/写作", 2],
    ]);
    expect(tree[0].count).toBe(5);
    expect(tree[0].children[0].count).toBe(2);
  });

  it("补出来的父层随后拿到真实计数", () => {
    // 顺序反过来：先见到子标签、补出父层，再见到父标签本身
    const tree = buildTagTree([
      ["项目/写作", 2],
      ["项目", 5],
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].count).toBe(5);
  });

  it("笔记多的排前面，同数按名字", () => {
    expect(shape(buildTagTree([["乙", 1], ["甲", 9], ["丙", 1]]))).toEqual(["甲", "丙", "乙"]);
  });

  it("同名但不同父的标签互不干扰", () => {
    const tree = buildTagTree([
      ["数学/笔记", 1],
      ["论文/笔记", 1],
    ]);
    // 两个父层都是补出来的（计数 0），所以按拼音排：论(lùn) 在 数(shù) 前
    expect(shape(tree)).toEqual([{ 论文: ["笔记"] }, { 数学: ["笔记"] }]);
  });

  it("空清单不炸", () => {
    expect(buildTagTree([])).toEqual([]);
  });
});
