import { describe, expect, it } from "vitest";

import {
  closeOthers,
  closePath,
  closeTab,
  dropSubtree,
  EMPTY_TABS,
  gotoTab,
  moveTab,
  openTab,
  renameTab,
  stepTab,
  tabLabels,
  type TabState,
} from "./tabs";

const st = (tabs: string[], active = 0): TabState => ({ tabs, active });

describe("打开", () => {
  it("空的时候开第一个", () => {
    expect(openTab(EMPTY_TABS, "甲.md", "new")).toEqual(st(["甲.md"]));
  });

  // 这一版没有分屏，同一个文件出现两次只会让人分不清改的是哪个
  it("已经开着就切过去，不开第二个", () => {
    const s = st(["甲.md", "乙.md", "丙.md"], 0);
    expect(openTab(s, "丙.md", "new")).toEqual(st(["甲.md", "乙.md", "丙.md"], 2));
    expect(openTab(s, "丙.md", "replace")).toEqual(st(["甲.md", "乙.md", "丙.md"], 2));
  });

  // 从一篇笔记点进它的链接时，新页紧挨着来源，读完关掉就回到原处
  it("新标签插在当前页右边，不是队尾", () => {
    const s = st(["甲.md", "乙.md", "丙.md"], 0);
    expect(openTab(s, "新.md", "new")).toEqual(st(["甲.md", "新.md", "乙.md", "丙.md"], 1));
  });

  it("替换模式换掉当前那个，标签数不变", () => {
    const s = st(["甲.md", "乙.md"], 1);
    expect(openTab(s, "新.md", "replace")).toEqual(st(["甲.md", "新.md"], 1));
  });
});

describe("关闭", () => {
  const s = st(["甲.md", "乙.md", "丙.md"], 1);

  // 总是往左找的话，「从左往右挨个关」会变成每关一次就跳回开头
  it("关当前页时接班的是右边那个", () => {
    expect(closeTab(s, 1)).toEqual(st(["甲.md", "丙.md"], 1));
  });

  it("关最后一个时往左退", () => {
    expect(closeTab(st(["甲.md", "乙.md"], 1), 1)).toEqual(st(["甲.md"], 0));
  });

  it("关左边的，当前页跟着往前挪一格 —— 看的还是同一篇", () => {
    expect(closeTab(s, 0)).toEqual(st(["乙.md", "丙.md"], 0));
  });

  it("关右边的，当前页不动", () => {
    expect(closeTab(s, 2)).toEqual(st(["甲.md", "乙.md"], 1));
  });

  it("关光了回到空", () => {
    expect(closeTab(st(["甲.md"], 0), 0)).toEqual(EMPTY_TABS);
  });

  it("没开着的路径，关它是无操作", () => {
    expect(closePath(s, "别处.md")).toBe(s);
  });

  it("只留这一个", () => {
    expect(closeOthers(s, 2)).toEqual(st(["丙.md"], 0));
  });
});

describe("拖动重排", () => {
  const s = st(["甲.md", "乙.md", "丙.md", "丁.md"], 1);

  it("往后挪", () => {
    expect(moveTab(s, 0, 2).tabs).toEqual(["乙.md", "丙.md", "甲.md", "丁.md"]);
  });

  it("往前挪", () => {
    expect(moveTab(s, 3, 0).tabs).toEqual(["丁.md", "甲.md", "乙.md", "丙.md"]);
  });

  // 拖动是在整理标签栏，不是在换页
  it("当前页跟着它的路径走，不跟下标", () => {
    const out = moveTab(s, 0, 3);
    expect(out.tabs[out.active]).toBe("乙.md");
  });

  it("拖到原地是无操作", () => {
    expect(moveTab(s, 1, 1)).toBe(s);
  });
});

describe("键盘切换", () => {
  const s = st(["甲.md", "乙.md", "丙.md"], 2);

  it("循环", () => {
    expect(stepTab(s, 1).active).toBe(0);
    expect(stepTab(st(["甲.md", "乙.md", "丙.md"], 0), -1).active).toBe(2);
  });

  it("没有标签时不动", () => {
    expect(stepTab(EMPTY_TABS, 1)).toBe(EMPTY_TABS);
  });

  // Ctrl+9 的常见约定：跳到最后一个，而不是什么都不做
  it("跳到第 n 个，超出范围就去最后一个", () => {
    expect(gotoTab(s, 0).active).toBe(0);
    expect(gotoTab(s, 8).active).toBe(2);
  });
});

describe("跟着文件走", () => {
  // 重命名一个有子文档的节点时，整棵子树的路径都变了。只换那一条的话，
  // 子树里开着的标签会全部指向不存在的文件
  it("重命名连子树一起修", () => {
    const s = st(["数学.md", "数学/线代.md", "别的.md"], 1);
    expect(renameTab(s, "数学.md", "Math.md").tabs).toEqual([
      "Math.md",
      "Math/线代.md",
      "别的.md",
    ]);
  });

  it("删除连子树一起去掉", () => {
    const s = st(["数学.md", "数学/线代.md", "别的.md"], 0);
    expect(dropSubtree(s, "数学.md")).toEqual(st(["别的.md"], 0));
  });

  it("删的不是当前页时，当前页还是原来那篇", () => {
    const s = st(["甲.md", "乙.md", "丙.md"], 2);
    const out = dropSubtree(s, "甲.md");
    expect(out.tabs[out.active]).toBe("丙.md");
  });

  it("全删光回到空", () => {
    expect(dropSubtree(st(["数学.md", "数学/线代.md"], 0), "数学.md")).toEqual(EMPTY_TABS);
  });
});

describe("标签上的名字", () => {
  it("去掉目录和扩展名", () => {
    expect(tabLabels(["数学/线性代数.md", "论文.md"])).toEqual(["线性代数", "论文"]);
  });

  // 一堆同名的「索引」排在一起，标签栏就等于没有
  it("重名的补一段父目录，其余保持干净", () => {
    expect(tabLabels(["数学/索引.md", "论文/索引.md", "日志.md"])).toEqual([
      "数学/索引",
      "论文/索引",
      "日志",
    ]);
  });
});
