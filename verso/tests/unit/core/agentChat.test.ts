/**
 * 把 `session/update` 流折成对话记录（§7.8）。
 *
 * 用的更新照抄真机：Claude 的适配器改一个文件时，先发一条什么都没有的
 * `tool_call`（标题只有「Write」），再发一条带上路径和 diff 的
 * `tool_call_update`，最后一条只改状态。
 */
import { describe, expect, it } from "vitest";

import type { ConfigOption, SessionUpdate } from "../../../src/core/acp";
import {
  parseQuotaText,
  quotaName,
  quotaPercent,
  rateLimitOf,
  absFileUri,
  attachmentBlock,
  looksLikeText,
  applyUpdate,
  configChoices,
  configToRestore,
  effortControl,
  joinModel,
  shortCount,
  splitModel,
  variantEfforts,
  conversationRows,
  conversationTitle,
  fileUri,
  newConversation,
  relativeToVault,
  type ChatEntry,
} from "../../../src/core/agentChat";

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

describe("对话列表", () => {
  const conv = (id: string, updatedAt: number, entries: ChatEntry[] = [], title: string | null = null) => ({
    ...newConversation(id, updatedAt, title),
    entries,
  });
  const said = (text: string): ChatEntry[] => [{ kind: "user", text, context: [] }];

  it("名字：agent 给的标题优先，没有就取第一句话的第一行", () => {
    expect(conversationTitle({ title: "整理清单", entries: said("随便") })).toBe("整理清单");
    expect(conversationTitle({ title: null, entries: said("第一行\n第二行") })).toBe("第一行");
    expect(conversationTitle({ title: null, entries: [] })).toBe("新对话");
    expect(conversationTitle({ title: null, entries: said("字".repeat(40)) })).toBe(`${"字".repeat(30)}…`);
  });

  it("开着的和以前的合在一起，新的在前；两边都有的只留开着的那份", () => {
    const rows = conversationRows(
      [conv("a", 3000, said("开着的")), conv("b", 1000, said("也开着"))],
      [
        { sessionId: "b", cwd: "/v", title: "旧标题", updatedAt: new Date(9000).toISOString() },
        { sessionId: "c", cwd: "/v", title: "以前的", updatedAt: new Date(2000).toISOString() },
      ],
      "a",
    );
    expect(rows.map((r) => [r.id, r.title, r.open])).toEqual([
      ["a", "开着的", true],
      ["c", "以前的", false],
      ["b", "也开着", true],
    ]);
  });

  it("点出来还没说过话的空白对话不列，当前这个除外", () => {
    const rows = conversationRows([conv("a", 1, []), conv("b", 2, [])], [], "b");
    expect(rows.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("可调配置", () => {
  const model: ConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "opus",
    options: [
      { value: "opus", name: "Opus" },
      { value: "sonnet", name: "Sonnet" },
    ],
  };
  const mode: ConfigOption = {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "bypassPermissions", name: "Bypass" },
    ],
  };

  it("分组的选项摊平，组名带着", () => {
    const grouped: ConfigOption = {
      ...model,
      options: [
        { group: "a", name: "Anthropic", options: [{ value: "opus", name: "Opus" }] },
        { group: "o", name: "OpenAI", options: [{ value: "gpt", name: "GPT" }] },
      ],
    } as ConfigOption;
    expect(configChoices(grouped).map((c) => [c.group, c.value])).toEqual([
      ["Anthropic", "opus"],
      ["OpenAI", "gpt"],
    ]);
  });

  it("只补模型这类：记住的值还在选项里、和现在的不一样才补", () => {
    expect(configToRestore([model, mode], { model: "sonnet", mode: "bypassPermissions" })).toEqual([
      { id: "model", value: "sonnet" },
    ]);
    // 已经是了
    expect(configToRestore([model], { model: "opus" })).toEqual([]);
    // 那个模型下架了
    expect(configToRestore([model], { model: "claude-2" })).toEqual([]);
    // 什么都没记过
    expect(configToRestore([model], {})).toEqual([]);
  });
});

describe("思考强度", () => {
  const variants = ["gpt-6.1-sol", "gpt-5.5/high", "gpt-5.5/low", "gpt-5.5/xhigh", "gpt-5.5/medium", "gpt-5.4/low"];

  it("拆、排、拼", () => {
    expect(splitModel("gpt-5.5/high")).toEqual({ base: "gpt-5.5", effort: "high" });
    expect(splitModel("opus")).toEqual({ base: "opus", effort: null });
    expect(variantEfforts("gpt-5.5", variants)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(joinModel("gpt-5.5", "xhigh", variants)).toBe("gpt-5.5/xhigh");
    // 新模型上没有这一档：退到「中」，再没有就用基础名
    expect(joinModel("gpt-5.4", "high", variants)).toBe("gpt-5.4");
    expect(joinModel("gpt-5.5", "max", variants)).toBe("gpt-5.5/medium");
    expect(joinModel("gpt-6.1-sol", "high", variants)).toBe("gpt-6.1-sol");
  });

  const model = (currentValue: string): ConfigOption => ({
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: [{ value: "gpt-5.5", name: "GPT-5.5" }],
  });

  it("按优先级认：标准的那一项 > 编在模型名里 > 开对话时传入", () => {
    const thought: ConfigOption = {
      id: "effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [{ value: "high", name: "High" }],
    };
    const base = { ...newConversation("s", 0), variants };
    expect(effortControl({ ...base, config: [thought, model("gpt-5.5/high")] }, true)?.kind).toBe("config");
    expect(effortControl({ ...base, config: [model("gpt-5.5/high")] }, true)).toMatchObject({
      kind: "variant",
      base: "gpt-5.5",
      current: "high",
    });
    expect(effortControl({ ...newConversation("s", 0), effort: "max" }, true)).toMatchObject({ kind: "meta", current: "max" });
    expect(effortControl(newConversation("s", 0), false)).toBeNull();
  });

  it("Codex 记住的模型带着强度，也能补回去", () => {
    expect(configToRestore([model("gpt-5.5")], { model: "gpt-5.5/high" }, variants)).toEqual([
      { id: "model", value: "gpt-5.5/high" },
    ]);
  });

  it("数字短写", () => {
    expect(shortCount(950)).toBe("950");
    expect(shortCount(25109)).toBe("25k");
    expect(shortCount(1_000_000)).toBe("1M");
    expect(shortCount(1_500_000)).toBe("1.5M");
  });
});

describe("附件", () => {
  it("本机路径换成 file URI：盘符不编码、空格和中文编码", () => {
    expect(absFileUri(String.raw`C:\Users\x\论文 草稿.pdf`)).toBe(
      "file:///C:/Users/x/%E8%AE%BA%E6%96%87%20%E8%8D%89%E7%A8%BF.pdf",
    );
    expect(absFileUri("/home/a/b c.txt")).toBe("file:///home/a/b%20c.txt");
  });

  it("四种附件四种送法", () => {
    expect(attachmentBlock({ kind: "path", path: "/a/x.pdf", name: "x.pdf" }, "/v")).toEqual({
      type: "resource_link",
      uri: "file:///a/x.pdf",
      name: "x.pdf",
    });
    expect(attachmentBlock({ kind: "note", rel: "甲.md" }, "/v")).toMatchObject({ type: "resource_link", name: "甲.md" });
    expect(attachmentBlock({ kind: "image", name: "a.png", mimeType: "image/png", data: "AAA" }, "/v")).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "AAA",
    });
    expect(attachmentBlock({ kind: "text", name: "a.csv", mimeType: "text/csv", text: "1,2" }, "/v")).toMatchObject({
      type: "resource",
      resource: { text: "1,2", mimeType: "text/csv" },
    });
  });

  it("哪些按文本带上：看 MIME，MIME 空着就看扩展名", () => {
    expect(looksLikeText("a.bin", "text/plain")).toBe(true);
    expect(looksLikeText("数据.csv", "")).toBe(true);
    expect(looksLikeText("x.py", "")).toBe(true);
    expect(looksLikeText("x.pdf", "application/pdf")).toBe(false);
    expect(looksLikeText("x.zip", "")).toBe(false);
  });
});

describe("额度", () => {
  it("从私有字段里认出来，认不出就是 null", () => {
    expect(rateLimitOf({ "_claude/rateLimit": { status: "allowed", utilization: 0.5 } })).toMatchObject({ status: "allowed" });
    expect(rateLimitOf({ other: 1 })).toBeNull();
    expect(rateLimitOf(null)).toBeNull();
  });

  it("百分比：比例和百分数都认", () => {
    expect(quotaPercent({ status: "allowed", utilization: 0.345 })).toBe(35);
    expect(quotaPercent({ status: "allowed", utilization: 81 })).toBe(81);
    expect(quotaPercent({ status: "allowed" })).toBeNull();
  });
});

describe("从命令输出里认额度", () => {
  it("Claude 的 /usage：写的是已用", () => {
    const md = [
      "**5-hour limit** — **0%** · Resets Oct 15, 1:20 AM EDT",
      "`░░░░`",
      "**Weekly · all models** — **70%** · Resets Oct 15, 1:00 AM EDT",
      "**Weekly · Fable** — **0%** · Resets Oct 15, 1:00 AM EDT",
      "| Cost | API time |",
    ].join("\n");
    expect(parseQuotaText(md)).toEqual([
      { name: "5 小时", used: 0, resets: "Oct 15, 1:20 AM EDT" },
      { name: "每周（全部模型）", used: 70, resets: "Oct 15, 1:00 AM EDT" },
      { name: "每周（Fable）", used: 0, resets: "Oct 15, 1:00 AM EDT" },
    ]);
  });

  it("Codex 的 /status：写的是还剩多少", () => {
    const md = [
      "**Model:** gpt-6.1-sol[xhigh]  ",
      "**Context window:** data not available yet  ",
      "**codex 5h limit:** 80% left (resets 13:05)  ",
      "**codex Weekly limit:** 99% left (resets 04:46 on 10月20日)  ",
      "**codex Credits:** 0",
    ].join("\n");
    expect(parseQuotaText(md)).toEqual([
      { name: "5 小时", used: 20, resets: "13:05" },
      { name: "每周", used: 1, resets: "04:46 on 10月20日" },
    ]);
  });

  it("认不出的不瞎认", () => {
    expect(parseQuotaText("**Token usage:** 12%\n随便一段话 — 50%")).toEqual([]);
  });

  it("窗口名字", () => {
    expect(quotaName("5-hour limit")).toBe("5 小时");
    expect(quotaName("codex 5h limit")).toBe("5 小时");
    expect(quotaName("Weekly · all models")).toBe("每周（全部模型）");
    expect(quotaName("Monthly limit")).toBe("Monthly");
  });
});
