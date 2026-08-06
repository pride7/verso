import { describe, expect, it } from "vitest";

import {
  ancestorLines,
  COL_GAP,
  displayRoot,
  editAddChild,
  editAddSibling,
  editMove,
  editRemove,
  editText,
  editToggleTask,
  flatten,
  findNode,
  layout,
  nodeKeyMap,
  parseMindmap,
  subtreeSize,
  type Edit,
  type MindNode,
} from "./mindmap";

const DOC = [
  "开头一段引言。", // 1
  "", // 2
  "## 方法", // 3
  "", // 4
  "- 甲", // 5
  "  - 甲一", // 6
  "  - 甲二", // 7
  "- 乙", // 8
  "", // 9
  "## 结论", // 10
  "", // 11
  "- [ ] 补齐那一节", // 12
  "- [x] 整理参考文献", // 13
].join("\n");

const tree = () => parseMindmap(DOC, "论文");

/** 把一次编辑套用到正文上，方便断言结果 */
function apply(body: string, edit: Edit): string {
  const lines = body.split("\n");
  const insert = edit.insert === "" && edit.fromLine <= edit.toLine ? [] : [edit.insert];
  lines.splice(edit.fromLine - 1, Math.max(0, edit.toLine - edit.fromLine + 1), ...insert);
  return lines.join("\n");
}

describe("解析", () => {
  it("根是笔记本身，标题挂在它下面", () => {
    const r = tree();
    expect(r.text).toBe("论文");
    expect(r.kind).toBe("root");
    expect(r.children.map((c) => c.text)).toEqual(["方法", "结论"]);
  });

  it("列表挂在最近的标题下，按缩进嵌套", () => {
    const 方法 = tree().children[0];
    expect(方法.children.map((c) => c.text)).toEqual(["甲", "乙"]);
    expect(方法.children[0].children.map((c) => c.text)).toEqual(["甲一", "甲二"]);
  });

  it("任务项认得出勾没勾", () => {
    const 结论 = tree().children[1];
    expect(结论.children.map((c) => [c.kind, c.done])).toEqual([
      ["task", false],
      ["task", true],
    ]);
    // 显示文字里不该带 `[ ]`
    expect(结论.children[0].text).toBe("补齐那一节");
  });

  it("行号对得上 —— 点节点要能跳回正文那一行", () => {
    expect(findNode(tree(), 5)!.text).toBe("甲");
    expect(findNode(tree(), 13)!.text).toBe("整理参考文献");
  });

  it("行内标记去掉，只留人读的部分", () => {
    const r = parseMindmap("- 见 [[线性代数|它]] 和 **重点** 与 `code`", "x");
    expect(r.children[0].text).toBe("见 它 和 重点 与 code");
  });

  it("代码块里的 # 和 - 不是结构", () => {
    const r = parseMindmap(["## 真标题", "", "```md", "# 假标题", "- 假列表", "```"].join("\n"), "x");
    expect(flatten(r).map((n) => n.text)).toEqual(["x", "真标题"]);
  });

  it("Tab 缩进和空格缩进都认", () => {
    const r = parseMindmap(["- 甲", "\t- 甲一"].join("\n"), "x");
    expect(r.children[0].children[0].text).toBe("甲一");
  });

  it("子树的结束行含所有后代", () => {
    const 方法 = tree().children[0];
    expect(方法.line).toBe(3);
    // 方法这一支到「乙」为止（第 8 行）
    expect(方法.endLine).toBe(8);
  });

  it("空文档只有一个根", () => {
    expect(flatten(parseMindmap("", "空笔记"))).toHaveLength(1);
  });
});

/**
 * 画哪个当根。文件名和正文里唯一的一级标题说的是同一件事，
 * 画成两级就白占一列（见 `displayRoot`）
 */
describe("图的根", () => {
  const rootOf = (body: string, title = "recount") => displayRoot(parseMindmap(body, title));

  it("只有一个一级标题时，是它当根，笔记名让位", () => {
    const r = rootOf(["# Errors Are Evidence", "", "## 1 项目逻辑", "", "## 2 写作逻辑"].join("\n"));
    expect(r.text).toBe("Errors Are Evidence");
    expect(r.kind).toBe("heading");
    // 让位之后层级少一级：三层变两层
    expect(r.children.map((c) => c.text)).toEqual(["1 项目逻辑", "2 写作逻辑"]);
  });

  it("顶层有两个标题时，笔记名回来兜住它们", () => {
    const r = rootOf(["## 方法", "", "## 结论"].join("\n"));
    expect(r.text).toBe("recount");
    expect(r.kind).toBe("root");
  });

  it("一级标题前面还有散落的列表时不收 —— 收了那些列表就没人管了", () => {
    const r = rootOf(["- 先记一笔", "", "# 正文标题", "", "## 一节"].join("\n"));
    expect(r.kind).toBe("root");
    expect(r.children.map((c) => c.text)).toEqual(["先记一笔", "正文标题"]);
  });

  it("唯一的顶层节点是列表时不收 —— 一条要点当不了整篇的题目", () => {
    expect(rootOf("- 就一条").kind).toBe("root");
  });

  it("空文档还是笔记名", () => {
    expect(rootOf("").text).toBe("recount");
  });

  it("让位之后那个根是正文里的真行 —— 能改字、能删", () => {
    // 合成的根不行（改名走文档树），所以这一条决定了菜单里那几项能不能用
    const r = rootOf(["# 题目", "", "## 一节"].join("\n"));
    expect(r.line).toBe(1);
    expect(r.prefix).toBe("# ");
  });
});

describe("改文字", () => {
  it("前缀原样保留", () => {
    const 方法 = tree().children[0];
    expect(apply(DOC, editText(方法, "新方法"))).toContain("## 新方法");
    const 甲一 = findNode(tree(), 6)!;
    expect(apply(DOC, editText(甲一, "改过"))).toContain("  - 改过");
  });

  it("任务项改字不影响勾选状态", () => {
    const done = findNode(tree(), 13)!;
    expect(apply(DOC, editText(done, "已经整理完"))).toContain("- [x] 已经整理完");
  });
});

describe("加节点", () => {
  it("加子节点照抄第一个子节点的前缀", () => {
    // 「方法」下面已经是列表，新的一条也该是列表
    const 方法 = tree().children[0];
    const { edit, line } = editAddChild(方法, "丙");
    const out = apply(DOC, edit);
    expect(out.split("\n")[line - 1]).toBe("- 丙");
    // 插在整棵子树之后，不是紧贴着标题
    expect(line).toBe(9);
  });

  it("没有子节点的标题，子节点是下一级标题 —— 从空笔记搭骨架这条路要通", () => {
    const r = parseMindmap("# 一级", "x");
    const { edit } = editAddChild(r.children[0], "二级");
    expect(apply("# 一级", edit)).toContain("## 二级");
  });

  it("根节点下面加的是一级标题", () => {
    const { edit } = editAddChild(parseMindmap("", "空"), "开头");
    expect(apply("", edit)).toContain("# 开头");
  });

  it("列表的子节点缩进深一级", () => {
    const 乙 = findNode(tree(), 8)!;
    const { edit, line } = editAddChild(乙, "乙一");
    expect(apply(DOC, edit).split("\n")[line - 1]).toBe("  - 乙一");
  });

  it("加兄弟节点用它自己的前缀，插在它子树之后", () => {
    const 甲 = findNode(tree(), 5)!;
    const { edit, line } = editAddSibling(甲, "丙");
    // 甲的子树到第 7 行，所以新的一条在第 8 行
    expect(line).toBe(8);
    expect(apply(DOC, edit).split("\n")[7]).toBe("- 丙");
  });

  it("新建的任务项一律是没做完的", () => {
    const done = findNode(tree(), 13)!;
    const { edit, line } = editAddSibling(done, "还有一件");
    expect(apply(DOC, edit).split("\n")[line - 1]).toBe("- [ ] 还有一件");
  });
});

describe("删节点", () => {
  it("连同子树一起删", () => {
    const 甲 = findNode(tree(), 5)!;
    expect(subtreeSize(甲)).toBe(3);
    const out = apply(DOC, editRemove(甲));
    expect(out).not.toContain("- 甲");
    expect(out).not.toContain("甲一");
    // 别的分支不能被牵连
    expect(out).toContain("- 乙");
    expect(out).toContain("## 结论");
  });
});

describe("勾任务", () => {
  it("勾上和取消都只动那一行", () => {
    const todo = findNode(tree(), 12)!;
    expect(apply(DOC, editToggleTask(todo)!)).toContain("- [x] 补齐那一节");
    const done = findNode(tree(), 13)!;
    expect(apply(DOC, editToggleTask(done)!)).toContain("- [ ] 整理参考文献");
  });

  it("普通列表项没有勾选这回事", () => {
    expect(editToggleTask(findNode(tree(), 5)!)).toBeNull();
  });
});

describe("节点身份与路径", () => {
  it("上方插入普通正文后，节点身份不跟着行号漂移", () => {
    const before = tree();
    const after = parseMindmap(`多一段引言。\n${DOC}`, "论文");
    const beforeNode = flatten(before).find((node) => node.text === "甲一")!;
    const afterNode = flatten(after).find((node) => node.text === "甲一")!;
    expect(afterNode.line).toBe(beforeNode.line + 1);
    expect(nodeKeyMap(after).get(afterNode.line)).toBe(nodeKeyMap(before).get(beforeNode.line));
  });

  it("返回根到选中节点的完整路径", () => {
    expect(ancestorLines(tree(), 6)).toEqual([0, 3, 5, 6]);
    expect(ancestorLines(tree(), 99)).toEqual([]);
  });
});

describe("移动子树", () => {
  it("同级上移时连同后代一起搬走", () => {
    const edit = editMove(DOC, tree(), 8, 5, "before");
    expect(edit).not.toBeNull();
    const out = apply(DOC, edit!);
    expect(out.indexOf("- 乙")).toBeLessThan(out.indexOf("- 甲"));
    expect(out.indexOf("  - 甲一")).toBeGreaterThan(out.indexOf("- 甲"));
  });

  it("列表改父级时只调整整棵子树的缩进", () => {
    const edit = editMove(DOC, tree(), 8, 5, "child");
    const out = apply(DOC, edit!);
    expect(out).toContain("- 甲\n  - 甲一\n  - 甲二\n  - 乙");
  });

  it("标题改父级时同步调整后代标题等级", () => {
    const body = ["## 方法", "### 步骤", "## 结论", "### 限制"].join("\n");
    const root = parseMindmap(body, "论文");
    const edit = editMove(body, root, 3, 1, "child");
    expect(apply(body, edit!)).toBe(["## 方法", "### 步骤", "### 结论", "#### 限制"].join("\n"));
  });

  it("拒绝跨 Markdown 结构和把父节点塞进自己的后代", () => {
    expect(editMove(DOC, tree(), 10, 5, "child")).toBeNull();
    expect(editMove(DOC, tree(), 5, 6, "child")).toBeNull();
    expect(editMove(DOC, tree(), 5, 8, "before")).toBeNull();
  });
});

describe("布局", () => {
  const place = (root: MindNode, collapsed?: Set<number>) => {
    const l = layout(root, collapsed);
    return new Map(l.nodes.map((p) => [p.node.text, p]));
  };

  it("同一层的 x 相同，深一层往右", () => {
    const m = place(tree());
    expect(m.get("方法")!.x).toBe(m.get("结论")!.x);
    expect(m.get("甲")!.x).toBeGreaterThan(m.get("方法")!.x);
    expect(m.get("论文")!.x).toBe(0);
  });

  it("每个节点可以有自己的宽度，下一列按上一列最宽的节点让位", () => {
    const widths = (line: number) => line === 8 ? 420 : 230; // 只把「乙」拉宽
    const placed = new Map(layout(tree(), new Set(), () => 30, widths).nodes.map((p) => [p.node.text, p]));
    expect(placed.get("乙")!.w).toBe(420);
    expect(placed.get("甲")!.w).toBe(230);
    expect(placed.get("甲一")!.w).toBe(230);
    expect(placed.get("甲一")!.x).toBeGreaterThanOrEqual(placed.get("乙")!.x + 420 + COL_GAP);
  });

  it("父节点落在自己那一簇的正中", () => {
    const m = place(tree());
    const 甲 = m.get("甲")!;
    expect(甲.y).toBeCloseTo((m.get("甲一")!.y + m.get("甲二")!.y) / 2, 5);
  });

  it("兄弟不重叠", () => {
    const l = layout(tree());
    const ys = l.nodes.map((n) => n.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      if (ys[i] !== ys[i - 1]) expect(ys[i] - ys[i - 1]).toBeGreaterThan(0);
    }
    // 叶子之间至少隔开一个节点高
    const leaves = l.nodes.filter((n) => n.node.children.length === 0).map((n) => n.y);
    leaves.sort((a, b) => a - b);
    for (let i = 1; i < leaves.length; i++) {
      expect(leaves[i] - leaves[i - 1]).toBeGreaterThanOrEqual(30);
    }
  });

  it("折叠的分支不占地方", () => {
    const full = layout(tree());
    const folded = layout(tree(), new Set([5])); // 折叠「甲」
    expect(folded.nodes.length).toBe(full.nodes.length - 2);
    expect(folded.height).toBeLessThan(full.height);
    // 折叠的那个自己还在，并且标出来了
    expect(folded.nodes.find((n) => n.node.text === "甲")!.collapsed).toBe(true);
  });

  /**
   * 换行之后节点不再一样高（v0.7.13）。高度由界面量出来喂进来，
   * 这里验的是「拿到不一样的高度之后，位置还对不对」
   */
  describe("高矮不一", () => {
    /** 「甲一」换了行，比别人高一倍 */
    const tall = (line: number) => (line === 6 ? 60 : 30);

    it("高的节点把后面的兄弟顶下去，不重叠", () => {
      const l = layout(tree(), new Set(), tall);
      const byY = [...l.nodes].sort((a, b) => a.y - b.y);
      for (let i = 1; i < byY.length; i++) {
        if (byY[i].x !== byY[i - 1].x) continue; // 只比同一列
        expect(byY[i].y).toBeGreaterThanOrEqual(byY[i - 1].y + byY[i - 1].h);
      }
    });

    it("父节点对齐的是孩子的中线，不是顶边", () => {
      const m = new Map(layout(tree(), new Set(), tall).nodes.map((p) => [p.node.text, p]));
      const 甲 = m.get("甲")!;
      const 甲一 = m.get("甲一")!;
      const 甲二 = m.get("甲二")!;
      const mid = (p: (typeof 甲)) => p.y + p.h / 2;
      expect(mid(甲)).toBeCloseTo((mid(甲一) + mid(甲二)) / 2, 5);
    });

    it("父节点比整簇还高时也不会顶出画布", () => {
      // 一个很高的根 + 一个矮孩子：取中线会算出负的 y
      const r = parseMindmap("- 就一条", "很长很长的标题");
      const l = layout(r, new Set(), (line) => (line === 0 ? 120 : 30));
      expect(Math.min(...l.nodes.map((n) => n.y))).toBe(0);
      expect(l.height).toBe(120);
    });

    it("量不到高度时按一行算 —— 纯函数那条路不受影响", () => {
      expect(layout(tree()).nodes.every((p) => p.h === 30)).toBe(true);
    });
  });

  it("每条连线都是父到子", () => {
    const l = layout(tree());
    for (const { from, to } of l.links) {
      expect(to.depth).toBe(from.depth + 1);
      expect(from.node.children).toContain(to.node);
    }
  });
});
