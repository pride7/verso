/**
 * ACP 客户端（§7.8）。对面是一个只会收发行的假 agent。
 *
 * 消息的形状照抄真机上抓到的：Claude 的适配器（claude-agent-acp）回的
 * `initialize`、它发来的 `session/request_permission`。
 */
import { describe, expect, it } from "vitest";

import { AcpConnection, AcpError, type PermissionRequest } from "../../../src/core/acp";

function setup(onPermission?: (r: PermissionRequest) => Promise<{ outcome: "cancelled" } | { outcome: "selected"; optionId: string }>) {
  const sent: Record<string, unknown>[] = [];
  const updates: unknown[] = [];
  const conn = new AcpConnection((line) => void sent.push(JSON.parse(line)), {
    onUpdate: (n) => updates.push(n),
    onPermission: onPermission ?? (async () => ({ outcome: "cancelled" })),
  });
  const reply = (id: unknown, result: unknown) => conn.receive(JSON.stringify({ jsonrpc: "2.0", id, result }));
  return { conn, sent, updates, reply };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("请求与回音配对", () => {
  it("initialize 报的是协议 1、不接管文件和终端", async () => {
    const { conn, sent, reply } = setup();
    const p = conn.initialize("0.8.54");
    expect(sent[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "verso", version: "0.8.54" },
      },
    });
    reply(1, { protocolVersion: 1, agentInfo: { name: "@zed-industries/claude-agent-acp", title: "Claude Agent" } });
    await expect(p).resolves.toMatchObject({ agentInfo: { title: "Claude Agent" } });
  });

  it("回音乱序到也各归各", async () => {
    const { conn, reply } = setup();
    const a = conn.call("a", {});
    const b = conn.call("b", {});
    reply(2, "B");
    reply(1, "A");
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });

  it("出错时把 data 里的真正原因带出来", async () => {
    const { conn } = setup();
    const p = conn.newSession("D:\\Notes");
    // 真机上的样子：message 只有一句 Internal error，原因在 data.details
    conn.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "Internal error", data: { details: "Query closed before response received" } },
      }),
    );
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AcpError);
    expect((err as AcpError).detail).toBe("Internal error：Query closed before response received");
  });

  it("进程没了：还在等的请求全部失败，之后的也不再挂起", async () => {
    const { conn } = setup();
    const p = conn.call("session/prompt", {});
    conn.close(new Error("AI 进程已经退出"));
    await expect(p).rejects.toThrow("AI 进程已经退出");
    await expect(conn.call("x", {})).rejects.toThrow("AI 进程已经退出");
  });

  it("不是 JSON 的行（agent 往 stdout 打的日志）直接跳过，不搞挂连接", async () => {
    const { conn, reply } = setup();
    const p = conn.call("a", {});
    conn.receive("Debugger attached.");
    conn.receive("");
    reply(1, "ok");
    await expect(p).resolves.toBe("ok");
  });
});

describe("agent 发过来的", () => {
  it("session/update 交给 onUpdate", () => {
    const { conn, updates } = setup();
    const n = { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "pong" } } };
    conn.receive(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: n }));
    expect(updates).toEqual([n]);
  });

  it("许可请求：等人回答，再用同一个 id 回给它", async () => {
    let ask: PermissionRequest | null = null;
    let answer: (v: { outcome: "selected"; optionId: string }) => void = () => {};
    const { conn, sent } = setup(
      (r) =>
        new Promise((resolve) => {
          ask = r;
          answer = resolve;
        }),
    );
    // 注意 id 是 0 —— 适配器的第一个请求就是 0，拿它当「没有 id」就会把许可吞掉
    conn.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "session/request_permission",
        params: {
          sessionId: "s",
          toolCall: { toolCallId: "t1", title: "Write hello.txt", kind: "edit" },
          options: [
            { kind: "allow_always", name: "Always Allow", optionId: "allow_always" },
            { kind: "allow_once", name: "Allow", optionId: "allow" },
            { kind: "reject_once", name: "Reject", optionId: "reject" },
          ],
        },
      }),
    );
    await tick();
    expect(ask!.toolCall.title).toBe("Write hello.txt");
    expect(sent).toEqual([]);
    answer({ outcome: "selected", optionId: "allow" });
    await tick();
    expect(sent).toEqual([{ jsonrpc: "2.0", id: 0, result: { outcome: { outcome: "selected", optionId: "allow" } } }]);
  });

  it("我们没声明的能力（读文件、开终端）回「没有这个方法」，不让它干等", async () => {
    const { conn, sent } = setup();
    conn.receive(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: { path: "/x" } }));
    await tick();
    expect(sent[0]).toMatchObject({ id: 7, error: { code: -32601 } });
  });
});
