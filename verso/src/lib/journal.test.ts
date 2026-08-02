import { describe, expect, it } from "vitest";

import { foldTargets, journalEntries, journalInsert, stampOf, type JournalEdit } from "./journal";

const NOW = new Date(2026, 7, 1, 14, 30);

/** 照 `EditorHandle.replaceLines` 的语义把一次改动套用到正文上 */
function apply(body: string, e: JournalEdit): string {
  const lines = body === "" ? [] : body.split("\n");
  const added = e.insert.split("\n");
  // 纯插入（fromLine > toLine）：把这几行插在第 toLine 行之后
  if (e.fromLine > e.toLine) lines.splice(e.toLine, 0, ...added.slice(0, -1), ...(added[added.length - 1] ? [added[added.length - 1]] : [""]));
  else lines.splice(e.fromLine - 1, e.toLine - e.fromLine + 1, ...added);
  return lines.join("\n");
}

const PROJECT = [
  "这个项目要复现 SVD 那篇。", // 1
  "", // 2
  "## 2026-07-28 09:10", // 3
  "", // 4
  "初步方案定了。", // 5
].join("\n");

describe("认出日志条目", () => {
  it("标题文字以日期开头就算", () => {
    const e = journalEntries(PROJECT);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ line: 3, level: 2, stamp: "2026-07-28 09:10" });
  });

  it("日期后面跟着别的字也认", () => {
    const e = journalEntries("### 2026-08-01 跑通了 baseline");
    expect(e[0].stamp).toBe("2026-08-01 跑通了 baseline");
    // 没写时刻的补 00:00，才能和带时刻的一起排序
    expect(e[0].sortKey).toBe("2026-08-01 00:00");
  });

  it("普通标题不是日志条目", () => {
    expect(journalEntries("## 方法\n## 结论")).toEqual([]);
  });

  it("代码块里的日期标题是内容不是记录", () => {
    const body = ["## 2026-08-01 10:00", "", "```md", "## 2026-01-01 00:00", "```"].join("\n");
    expect(journalEntries(body)).toHaveLength(1);
  });
});

describe("记一条进展", () => {
  it("插在已有记录的最前面，层级跟着它走", () => {
    const out = apply(PROJECT, journalInsert(PROJECT, NOW));
    const lines = out.split("\n");
    expect(lines[0]).toBe("这个项目要复现 SVD 那篇。");
    expect(lines[2]).toBe("## 2026-08-01 14:30");
    // 新记录和旧记录之间要有空行，否则两个标题会黏在一起
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("## 2026-07-28 09:10");
  });

  it("层级照抄已有记录 —— 用 ### 记的人不该被改成 ##", () => {
    const body = "### 2026-07-28 09:10\n\n甲\n";
    expect(apply(body, journalInsert(body, NOW)).split("\n")[0]).toBe("### 2026-08-01 14:30");
  });

  it("一条记录都没有时插在正文末尾，前面空一行", () => {
    const body = "项目描述。\n";
    const lines = apply(body, journalInsert(body, NOW)).split("\n");
    expect(lines[0]).toBe("项目描述。");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("## 2026-08-01 14:30");
  });

  it("空笔记里就是第一行", () => {
    const e = journalInsert("", NOW);
    expect(apply("", e).split("\n")[0]).toBe("## 2026-08-01 14:30");
    expect(e.cursorLine).toBe(2);
  });

  it("光标落在标题下面那个空行上 —— 插完就能直接写", () => {
    const e = journalInsert(PROJECT, NOW);
    const lines = apply(PROJECT, e).split("\n");
    expect(lines[e.cursorLine - 1]).toBe("");
    // 上一行正是刚插进去的标题
    expect(lines[e.cursorLine - 2]).toBe("## 2026-08-01 14:30");
  });

  it("时间戳只到分钟", () => {
    expect(stampOf(new Date(2026, 0, 9, 8, 5, 59))).toBe("2026-01-09 08:05");
  });
});

describe("只看最新：该折叠哪几条", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => `## 2026-08-${String(n - i).padStart(2, "0")} 09:00\n\n第 ${i} 条\n`).join("\n");

  it("保留最近 keep 条，其余折叠", () => {
    const body = many(5);
    const targets = foldTargets(body, 2);
    const lines = journalEntries(body).map((e) => e.line);
    // 前两条（也就是日期最新的两条）不在折叠名单里
    expect(targets).not.toContain(lines[0]);
    expect(targets).not.toContain(lines[1]);
    expect(targets).toHaveLength(3);
  });

  it("按时间戳算而不是按位置 —— 有人会把时间线整理成正序", () => {
    const body = ["## 2026-01-01 09:00", "旧", "", "## 2026-08-01 09:00", "新"].join("\n");
    // 最新的那条在**下面**，该被留着展开的是它
    expect(foldTargets(body, 1)).toEqual([1]);
  });

  it("条目太少就不折叠 —— 把唯一的内容收起来等于开了一片空白", () => {
    expect(foldTargets(many(1), 3)).toEqual([]);
    expect(foldTargets(many(3), 3)).toEqual([]);
  });

  it("keep 为 0 表示关掉这个行为", () => {
    expect(foldTargets(many(9), 0)).toEqual([]);
  });

  it("没有日志条目的普通笔记不受影响", () => {
    expect(foldTargets("## 方法\n\n## 结论\n", 3)).toEqual([]);
  });
});
