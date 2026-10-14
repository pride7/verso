/**
 * 把 `session/update` 流折成对话记录（§7.8）。
 *
 * 用的更新照抄真机：Claude 的适配器改一个文件时，先发一条什么都没有的
 * `tool_call`（标题只有「Write」），再发一条带上路径和 diff 的
 * `tool_call_update`，最后一条只改状态。
 */
import { describe, expect, it } from "vitest";

import type { SessionUpdate } from "../../../src/core/acp";
import { applyUpdate, fileUri, relativeToVault, type ChatEntry } from "../../../src/core/agentChat";

const fold = (updates: SessionUpdate[]) => updates.reduce<ChatEntry[]>(applyUpdate, []);
const chunk = (text: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

describe("文字", () => {
  it("一句回答的碎片接成一段", () => {
    expect(fold([chunk(""), chunk("I created `hello.txt"), chunk("`.")])).toEqual([
      { kind: "agent", text: "I created `hello.txt`." },
    ]);
  });

  it("中间插进一个工具调用，后面就是新的一段", () => {
    const out = fold([
      chunk("先看看。"),
      { sessionUpdate: "tool_call", toolCallId: "t", title: "Read", kind: "read", status: "pending" },
      chunk("看完了。"),
    ]);
    expect(out.map((e) => e.kind)).toEqual(["agent", "tool", "agent"]);
  });

  it("思考和回答分开放", () => {
    const out = fold([
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "嗯" } },
      chunk("好"),
    ]);
    expect(out).toEqual([
      { kind: "thought", text: "嗯" },
      { kind: "agent", text: "好" },
    ]);
  });
});

describe("工具调用", () => {
  it("按 id 合并：先空着，再补上标题和 diff，最后只改状态", () => {
    const path = "D:\\Notes\\vault\\hello.md";
    const out = fold([
      { sessionUpdate: "tool_call", toolCallId: "toolu_1", title: "Write", kind: "edit", status: "pending", content: [] },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_1",
        title: "Write hello.md",
        kind: "edit",
        content: [{ type: "diff", path, oldText: null, newText: "hi\n" }],
      },
      { sessionUpdate: "tool_call_update", toolCallId: "toolu_1" },
      { sessionUpdate: "tool_call_update", toolCallId: "toolu_1", status: "completed" },
    ]);
    expect(out).toEqual([
      {
        kind: "tool",
        id: "toolu_1",
        title: "Write hello.md",
        toolKind: "edit",
        status: "completed",
        diffs: [{ path, oldText: null, newText: "hi\n" }],
        output: "",
      },
    ]);
  });

  it("文字输出收进 output", () => {
    const out = fold([
      {
        sessionUpdate: "tool_call",
        toolCallId: "t",
        title: "grep",
        kind: "search",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "a.md:3: 命中" } }],
      },
    ]);
    expect(out[0]).toMatchObject({ kind: "tool", output: "a.md:3: 命中" });
  });
});

describe("计划", () => {
  it("每次整份重发，只留最新的一份", () => {
    const out = fold([
      { sessionUpdate: "plan", entries: [{ content: "读", status: "in_progress" }] },
      chunk("…"),
      { sessionUpdate: "plan", entries: [{ content: "读", status: "completed" }, { content: "写", status: "pending" }] },
    ]);
    expect(out.filter((e) => e.kind === "plan")).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "plan",
      entries: [
        { content: "读", status: "completed" },
        { content: "写", status: "pending" },
      ],
    });
  });
});

it("不认识的更新（用量、可用命令…）原样放过", () => {
  const before: ChatEntry[] = [{ kind: "agent", text: "x" }];
  expect(applyUpdate(before, { sessionUpdate: "usage_update", used: 1, size: 2 })).toBe(before);
});

describe("路径", () => {
  it("Windows：不分大小写、不分斜杠方向", () => {
    expect(relativeToVault("D:\\Notes\\vault\\项目\\甲.md", "d:/Notes/vault")).toBe("项目/甲.md");
  });

  it("不在 vault 里的原样返回", () => {
    expect(relativeToVault("C:\\Users\\x\\a.md", "D:\\Notes\\vault")).toBe("C:\\Users\\x\\a.md");
    // 前缀相同但不是同一个目录
    expect(relativeToVault("/home/a/vault2/x.md", "/home/a/vault")).toBe("/home/a/vault2/x.md");
  });

  it("Unix 区分大小写", () => {
    expect(relativeToVault("/home/a/Vault/x.md", "/home/a/vault")).toBe("/home/a/Vault/x.md");
    expect(relativeToVault("/home/a/vault/x.md", "/home/a/vault/")).toBe("x.md");
  });

  it("file URI：盘符不编码，中文和空格编码", () => {
    expect(fileUri("D:\\Notes\\vault", "项目/a b.md")).toBe(
      "file:///D:/Notes/vault/%E9%A1%B9%E7%9B%AE/a%20b.md",
    );
    expect(fileUri("/home/a/vault", "x.md")).toBe("file:///home/a/vault/x.md");
  });
});
