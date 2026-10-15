/**
 * ACP（Agent Client Protocol）的客户端一侧。DESIGN.md §7.8
 *
 * AI 会话面板和 agent 之间说的就是这个：JSON-RPC 2.0，一行一条，走 agent
 * 进程的 stdin / stdout。进程由宿主起（`host/agent.ts` → Rust），这里只管
 * 「一行进来、一行出去」之间的事 —— 请求配对、通知分发、替 agent 向用户要
 * 许可。不碰任何宿主 API，所以和 `core/` 里别的东西一样能搬到别的端。
 *
 * 类型只写了用得到的那一部分，字段名照抄协议（agentclientprotocol.com 的
 * v1 schema）。没有拿官方 SDK 当依赖：它要连 zod 一起装进来，而我们需要的
 * 只是几十行类型和一个请求表。
 */

/** 协议主版本。`initialize` 时报给对面，对面回它支持的那一版 */
export const PROTOCOL_VERSION = 1;

// ------------------------------------------------------------------ 内容

export interface TextContent {
  type: "text";
  text: string;
}

/** 指向一个文件，不带内容 —— agent 自己去读 */
export interface ResourceLink {
  type: "resource_link";
  uri: string;
  name: string;
  mimeType?: string | null;
}

/** 带着内容的文件或片段。选区走这个：那段文字可能还没存盘 */
export interface EmbeddedResource {
  type: "resource";
  resource: { uri: string; text: string; mimeType?: string | null };
}

export type ContentBlock =
  | TextContent
  | ResourceLink
  | EmbeddedResource
  | { type: "image" | "audio"; [k: string]: unknown };

// ------------------------------------------------------------------ 工具调用

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolCallContent =
  | { type: "content"; content: ContentBlock }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

/** `tool_call` 带全量字段；`tool_call_update` 只带变了的那几个 */
export interface ToolCallFields {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  content?: ToolCallContent[] | null;
  locations?: { path: string; line?: number | null }[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface PlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export type SessionUpdate =
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: ContentBlock }
  | ({ sessionUpdate: "tool_call" } & ToolCallFields)
  | ({ sessionUpdate: "tool_call_update" } & ToolCallFields)
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "config_option_update"; configOptions: ConfigOption[] }
  | ({ sessionUpdate: "usage_update" } & Usage)
  // 其余种类（可用命令、用量、压缩上下文…）面板眼下不显示，原样放过
  | { sessionUpdate: string; [k: string]: unknown };

export interface SessionNotification {
  sessionId: string;
  update: SessionUpdate;
}

// ------------------------------------------------------------------ 会话

export interface SessionMode {
  id: string;
  name: string;
  description?: string | null;
}

/** 下拉里的一项 */
export interface ConfigChoice {
  value: string;
  name: string;
  description?: string | null;
}

/**
 * 会话的一项可调配置（模型、思考强度、权限模式…）。协议里的新写法：agent
 * 把能调的东西连同当前值一起报上来，客户端照着画控件，不必认识每一家的私有
 * 字段。`options` 可能按组给（`{ group, name, options }`）。
 */
export type ConfigOption = {
  id: string;
  name: string;
  description?: string | null;
  /** "mode" | "model" | "model_config" | "thought_level" | 别的 */
  category?: string | null;
} & (
  | {
      type: "select";
      currentValue: string;
      options: ConfigChoice[] | { group: string; name: string; options: ConfigChoice[] }[];
    }
  | { type: "boolean"; currentValue: boolean }
);

export interface NewSessionResult {
  sessionId: string;
  /** 旧写法，只有权限模式。agent 给了 `configOptions` 时以那份为准 */
  modes?: { currentModeId: string; availableModes: SessionMode[] } | null;
  configOptions?: ConfigOption[] | null;
  /**
   * 旧写法的模型列表（协议里标着 unstable）。只拿它做一件事：Codex 把思考强度
   * 编在模型名里（`gpt-5.5/high`），而 `configOptions` 只列基础模型 —— 有哪些
   * 强度可选，只有这份列得出来
   */
  models?: { currentModelId: string; availableModels: { modelId: string; name: string }[] } | null;
}

/** `usage_update`：上下文用了多少、这个对话花了多少 */
export interface Usage {
  used: number;
  size: number;
  cost?: { amount: number; currency: string } | null;
}

/** 开会话、接回会话时附带的私有选项（ACP 的 `_meta`） */
export type SessionMeta = Record<string, unknown>;

/** `session/list` 里的一条：以前的一次对话 */
export interface SessionInfo {
  sessionId: string;
  cwd: string;
  title?: string | null;
  /** ISO 8601 */
  updatedAt?: string | null;
}

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export interface InitializeResult {
  protocolVersion: number;
  agentInfo?: { name: string; title?: string | null; version?: string } | null;
  agentCapabilities?: {
    /** 能用 `session/load` 接着以前的对话（会把历史整段重放一遍） */
    loadSession?: boolean;
    /** `list` 在 = 能用 `session/list` 列出以前的对话；`close` 在 = 能关掉一个 */
    sessionCapabilities?: { list?: object | null; close?: object | null; delete?: object | null } | null;
    /** 各家的私有声明。Claude 的适配器在这里放 `claudeCode` */
    _meta?: Record<string, unknown> | null;
  } | null;
  authMethods?: { id: string; name: string; description?: string | null }[];
}

// ------------------------------------------------------------------ 许可

export type PermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionKind;
}

export interface PermissionRequest {
  sessionId: string;
  toolCall: ToolCallFields;
  options: PermissionOption[];
}

export type PermissionOutcome = { outcome: "cancelled" } | { outcome: "selected"; optionId: string };

// ------------------------------------------------------------------ 连接

/** JSON-RPC 的错误。`data` 里常常才是真正的原因（适配器把底层报错塞在那儿） */
export class AcpError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }

  /** 给人看的那一句：`message` 往往只是「Internal error」，原因在 `data` 里 */
  get detail(): string {
    const d = this.data as { details?: unknown; message?: unknown } | undefined;
    const extra =
      typeof d?.details === "string" ? d.details : typeof d?.message === "string" ? d.message : "";
    return extra && extra !== this.message ? `${this.message}：${extra}` : this.message;
  }
}

export interface AcpHandlers {
  onUpdate: (n: SessionNotification) => void;
  /** agent 要动手前来问。必须回一个结果 —— 不回的话它会一直等着 */
  onPermission: (req: PermissionRequest) => Promise<PermissionOutcome>;
}

/** 协议规定的「没有这个方法」。我们没声明读写文件、开终端的能力，那几个都回这个 */
const METHOD_NOT_FOUND = -32601;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class AcpConnection {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed: Error | null = null;

  /** `send` 写出去一行（不含换行）；进来的行交给 `receive` */
  constructor(
    private readonly send: (line: string) => void | Promise<void>,
    private readonly handlers: AcpHandlers,
  ) {}

  /** 宿主每收到一行 stdout 就调一次 */
  receive(line: string): void {
    let msg: {
      id?: number | string | null;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      // 不是 JSON 的行 = agent 往 stdout 打了日志。协议上不该这么做，但真有
      // 人这么干；吞掉总比把整条连接搞挂强
      return;
    }
    if (typeof msg !== "object" || msg === null) return;

    if (msg.method !== undefined) {
      if (msg.id === undefined || msg.id === null) this.notification(msg.method, msg.params);
      else void this.request(msg.id, msg.method, msg.params);
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new AcpError(msg.error.code, msg.error.message, msg.error.data));
    else p.resolve(msg.result);
  }

  /** 进程没了。还在等回音的请求全部失败，免得界面一直转圈 */
  close(reason: Error): void {
    this.closed = reason;
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }

  call<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write({ jsonrpc: "2.0", id, method, params }).catch((e: unknown) => {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closed) return;
    void this.write({ jsonrpc: "2.0", method, params }).catch(() => {});
  }

  // ---- 协议里用到的几个方法，包一层只是为了类型

  initialize(clientVersion: string): Promise<InitializeResult> {
    return this.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      // 不接管读写文件、不替它开终端：agent 用自己的工具直接改 vault 里的
      // `.md`，Verso 的文件监听本来就接得住外部修改（§7.4）
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "verso", title: "Verso", version: clientVersion },
    });
  }

  newSession(cwd: string, meta?: SessionMeta): Promise<NewSessionResult> {
    return this.call("session/new", { cwd, mcpServers: [], ...(meta ? { _meta: meta } : {}) });
  }

  prompt(sessionId: string, prompt: ContentBlock[]): Promise<{ stopReason: StopReason }> {
    return this.call("session/prompt", { sessionId, prompt });
  }

  cancel(sessionId: string): void {
    this.notify("session/cancel", { sessionId });
  }

  /** 以前的对话。只列这个仓库的（`cwd`）—— 别的项目里的对话和这里无关 */
  listSessions(cwd: string): Promise<{ sessions: SessionInfo[] }> {
    return this.call("session/list", { cwd });
  }

  /**
   * 接着以前的一次对话。agent 先把整段历史用 `session/update` 重放一遍，
   * 放完才回这个请求 —— 所以调用之前，接收那些更新的地方就得准备好
   */
  loadSession(
    sessionId: string,
    cwd: string,
    meta?: SessionMeta,
  ): Promise<Omit<NewSessionResult, "sessionId">> {
    return this.call("session/load", { sessionId, cwd, mcpServers: [], ...(meta ? { _meta: meta } : {}) });
  }

  /** 彻底删掉一个对话，连它那边的历史一起。只用在面板自己开的、查额度用的那种 */
  deleteSession(sessionId: string): Promise<unknown> {
    return this.call("session/delete", { sessionId });
  }

  /** 关掉一个对话（agent 那边的进程状态），历史仍记在它那里，之后还能接回 */
  closeSession(sessionId: string): Promise<unknown> {
    return this.call("session/close", { sessionId });
  }

  /** 改一项配置。回来的是改完之后的整份（改模型可能连带改掉别的选项） */
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<{ configOptions?: ConfigOption[] | null }> {
    return this.call(
      "session/set_config_option",
      typeof value === "boolean"
        ? { sessionId, configId, type: "boolean", value }
        : { sessionId, configId, value },
    );
  }

  setMode(sessionId: string, modeId: string): Promise<unknown> {
    return this.call("session/set_mode", { sessionId, modeId });
  }

  // ---- 进来的

  private notification(method: string, params: unknown): void {
    if (method === "session/update") this.handlers.onUpdate(params as SessionNotification);
  }

  private async request(id: number | string, method: string, params: unknown): Promise<void> {
    if (method !== "session/request_permission") {
      await this.write({
        jsonrpc: "2.0",
        id,
        error: { code: METHOD_NOT_FOUND, message: `Verso 不支持 ${method}` },
      }).catch(() => {});
      return;
    }
    let outcome: PermissionOutcome;
    try {
      outcome = await this.handlers.onPermission(params as PermissionRequest);
    } catch {
      outcome = { outcome: "cancelled" };
    }
    await this.write({ jsonrpc: "2.0", id, result: { outcome } }).catch(() => {});
  }

  private async write(msg: object): Promise<void> {
    await this.send(JSON.stringify(msg));
  }
}
