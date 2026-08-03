import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import type {
  Backlink,
  CommitInfo,
  FileChange,
  FileDiff,
  GitStatus,
  HistoryEntry,
  IndexStats,
  NoteContent,
  NoteMeta,
  NoteRef,
  RemoteInfo,
  SearchHit,
  SyncOutcome,
  TreeNode,
  VaultInfo,
  PropDef,
  PropSchema,
  ViewResult,
} from "./types";
import type { Settings } from "./settings";
import type { TabState } from "./lib/tabs";

/** 与 Rust 的 `workspace::Workspace` 对应 —— 字段名和 `TabState` 一致 */
type Workspace = TabState;

/** Rust 侧把所有错误序列化成字符串，这里统一转成 Error 对象。 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : String(e));
  }
}

export async function pickVaultFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title: "选择 vault 目录" });
  return typeof picked === "string" ? picked : null;
}

export const api = {
  openVault: (path: string) => call<VaultInfo>("vault_open", { path }),
  /** 启动时自动重开上次的 vault 与笔记；目录没了就返回 null */
  reopenLastVault: () =>
    call<{ vault: VaultInfo; lastNote: string | null } | null>("vault_reopen_last"),
  tree: () => call<TreeNode[]>("tree_list"),
  readNote: (path: string) => call<NoteContent>("note_read", { path }),
  /** 返回写入后的 mtime */
  writeNote: (path: string, body: string) => call<number>("note_write", { path, body }),
  createNote: (parentDoc: string | null, title: string) =>
    call<NoteMeta>("note_create", { parentDoc, title }),
  /**
   * 建一篇「未命名」。名字由后端定（同目录下重名会往后编号），
   * 建完前端就地改名 —— 不弹窗先问名字
   */
  createUntitled: (parentDoc: string | null) =>
    call<NoteMeta>("note_create_untitled", { parentDoc }),
  statNote: (path: string) => call<number>("note_stat", { path }),
  /**
   * 粘贴板里的图片落盘到 `attachments/`，返回 vault 相对路径。
   * `data` 是 base64 —— IPC 传大字节数组极慢。
   */
  writeAttachment: (name: string, data: string) =>
    call<string>("attachment_write", { name, data }),
  /**
   * 源码模式里手改 frontmatter。只换 frontmatter，正文由 `writeNote` 各写各的。
   * YAML 解析不过会抛错，那时文件没被动过。返回写入后的 mtime。
   */
  writeFrontmatter: (path: string, yaml: string) =>
    call<number>("frontmatter_write", { path, yaml }),

  /** 全量清单，快速切换器在本地做模糊匹配 */
  listNotes: () => call<NoteRef[]>("note_list"),

  /** 返回改名后的新路径 */
  renameNote: (path: string, title: string) => call<string>("note_rename", { path, title }),
  /** 返回移动后的新路径。`newParentDoc` 为 null 表示移到 vault 根 */
  moveNote: (path: string, newParentDoc: string | null) =>
    call<string>("note_move", { path, newParentDoc }),
  deleteNote: (path: string, withChildren: boolean) =>
    call<void>("note_delete", { path, withChildren }),

  /** §7.3 方案 A：调起**系统**终端（独立窗口） */
  openTerminal: (path: string | null) => call<void>("open_terminal", { path }),

  // —— §7.3 方案 B：内嵌终端面板 ——
  /** 返回 pty id。`path` 为 null 时用 vault 根目录 */
  ptyOpen: (cols: number, rows: number, path: string | null) =>
    call<string>("pty_open", { cols, rows, path }),
  ptyWrite: (id: string, data: string) => call<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) =>
    call<void>("pty_resize", { id, cols, rows }),
  ptyClose: (id: string) => call<void>("pty_close", { id }),
  ptyActiveCount: () => call<number>("pty_active_count"),

  // —— §2.5 索引 ——
  /** 全文搜索。≥3 字符走 FTS，更短的在 Rust 侧退回 LIKE */
  search: (query: string, limit?: number) => call<SearchHit[]>("search", { query, limit }),
  backlinks: (path: string) => call<Backlink[]>("backlinks", { path }),
  /** 指向不存在笔记的链接，用来发现打错的名字 */
  danglingLinks: () => call<[string, string][]>("dangling_links"),
  allTags: () => call<[string, number][]>("all_tags"),
  /** 带某个标签的笔记，含嵌套子标签 */
  notesByTag: (tag: string) => call<NoteRef[]>("notes_by_tag", { tag }),
  rebuildIndex: () => call<IndexStats>("index_rebuild"),

  // —— §2.6 database 视图 ——
  /** 执行一个 verso-view 代码块，`source` 是块里的原文 */
  viewQuery: (source: string) => call<ViewResult>("view_query", { source }),
  /** 改写 frontmatter 属性。`value` 为 null 表示删除 */
  propSet: (path: string, key: string, value: string | null) =>
    call<void>("prop_set", { path, key, value }),
  /** 属性 schema（类型、单选的选项）。存在 vault 根的 `.verso-props.json` */
  propSchema: () => call<PropSchema>("prop_schema"),
  /** `def` 为 null = 删掉这条定义，回到按值推断 */
  propDefSet: (key: string, def: PropDef | null) => call<void>("prop_def_set", { key, def }),
  /** 一个属性出现在多少篇笔记里。重命名前要拿它问用户 */
  propCount: (key: string) => call<number>("prop_count", { key }),
  /** **全库**重命名一个属性，返回改了多少篇。调之前必须先确认过 */
  propRenameAll: (from: string, to: string) => call<number>("prop_rename_all", { from, to }),
  /** 属性改名。保留原值和原位置 —— 不是删旧建新 */
  propRename: (path: string, from: string, to: string) =>
    call<void>("prop_rename", { path, from, to }),
  /**
   * 记下一组兄弟的手动次序。`parent` 是它们的父目录（根目录传空串），
   * `paths` 要是**完整的一组**，不是只有被拖的那一个
   */
  reorder: (parent: string, paths: string[]) => call<void>("notes_reorder", { parent, paths }),

  // —— §2.8 本地版本历史 ——
  /** 仓库有多少改动。不是 git 仓库时返回 `enabled: false`，不报错 */
  gitStatus: () => call<GitStatus>("git_status"),
  /** 提交全部改动。没有改动时返回 null，不产生空提交 */
  gitCommit: (message?: string) => call<CommitInfo | null>("git_commit", { message }),
  /** 最近的若干次提交，新的在前 */
  gitHistory: (limit?: number) => call<HistoryEntry[]>("git_history", { limit }),
  /** 当前还没记进版本历史的文件 */
  gitWorkingChanges: () => call<FileChange[]>("git_working_changes"),
  /** 当前工作区，或某次历史记录里一篇文件的逐行差异 */
  gitDiffFile: (path: string, commit?: string) =>
    call<FileDiff>("git_diff_file", { path, commit }),
  /** 撤销某个文件尚未记录的改动；新文件会被删除 */
  gitDiscardFile: (path: string) => call<void>("git_discard_file", { path }),
  /** 把某篇笔记回退到某一版。**回退前会先把当前状态记一个版本** */
  gitRestoreFile: (commit: string, path: string) =>
    call<void>("git_restore_file", { commit, path }),

  // —— §2.8 远端同步 ——
  /** 当前配的远端。没配过时 `url` 是 null */
  syncRemoteGet: () => call<RemoteInfo>("sync_remote_get"),
  /** 配远端。空串 = 不要远端了 */
  syncRemoteSet: (url: string) => call<RemoteInfo>("sync_remote_set", { url }),
  /** 存/删这个远端的令牌。**只进系统钥匙串** */
  syncTokenSet: (url: string, token: string) => call<null>("sync_token_set", { url, token }),
  /** 存过令牌没有。**有意没有「读令牌」** —— 传给前端就等于印在日志里 */
  syncTokenHas: (url: string) => call<boolean>("sync_token_has", { url }),
  /** 同步一次：提交 → 取远端 → 接到一起 → 推上去 */
  vaultSync: () => call<SyncOutcome>("vault_sync"),

  /**
   * 手机上没有目录选择器，欢迎页那个按钮走这条：Rust 自己挑一个能用的位置
   * （共享存储优先，退回 App 私有目录）。**失败会抛，且抛的是人话** ——
   * 手机上那句错误是唯一能看到原因的地方
   */
  openDefaultVault: () => call<VaultInfo>("vault_open_default"),
  /** 这是不是手机。欢迎页据此决定那个按钮该干什么 */
  isMobile: () => call<boolean>("platform_is_mobile"),

  /** 收尾做完了，可以真的关窗了。见 `onAppClosing` */
  closeNow: () => call<null>("close_now"),

  // —— §2.1 每个 vault 的界面状态：标签页 ——
  /** 读不出来返回空。这份状态丢了只是少开几个页签，见 workspace.rs */
  workspaceGet: () => call<Workspace>("workspace_get"),
  workspaceSet: (ws: Workspace) => call<void>("workspace_set", { ws }),

  // —— §6 用户设置 ——
  getSettings: () => call<Settings>("settings_get"),
  /** 返回 Rust 侧夹紧之后的值 —— 存进去的和界面上显示的必须是同一份 */
  setSettings: (settings: Settings) => call<Settings>("settings_set", { settings }),
};

/** 外部程序（AI CLI、git、别的编辑器）改了 vault 里的文件（§2.7） */
export const onVaultChanged = (cb: (paths: string[]) => void): Promise<UnlistenFn> =>
  listen<{ paths: string[] }>("vault:changed", (ev) => cb(ev.payload.paths));

/**
 * 窗口要关了，但还没关。
 *
 * Rust 那边拦下了关窗、发来这个事件，然后**只等 5 秒**。收到之后要做的事
 * 就两件：落盘、按设置记一个版本；做完（或者出错）都必须调 `closeNow`，
 * 不然用户得再点一次 X。见 `lib.rs` 的 `on_window_event`。
 */
export const onAppClosing = (cb: () => void): Promise<UnlistenFn> =>
  listen("app:closing", () => cb());

/**
 * 后端那些「不致命但你该知道」的提示：图片作用域没授上、笔记库退到了别的
 * 位置……
 *
 * **以前 Rust 一直在发它，前端从来没人听** —— 于是那些提示等于不存在。
 * 手机上尤其要命：那是唯一能知道「为什么笔记落在别处」的地方。
 */
export const onBackendNotice = (cb: (msg: string) => void): Promise<UnlistenFn> =>
  listen<string>("index:error", (ev) => cb(ev.payload));

/** PTY 输出。`data` 是 base64 的原始字节，交给 xterm 自己解 UTF-8。 */
export const onPtyData = (cb: (e: { id: string; data: string }) => void): Promise<UnlistenFn> =>
  listen<{ id: string; data: string }>("pty:data", (ev) => cb(ev.payload));

export const onPtyExit = (cb: (e: { id: string }) => void): Promise<UnlistenFn> =>
  listen<{ id: string }>("pty:exit", (ev) => cb(ev.payload));
