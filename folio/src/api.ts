import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import type { NoteContent, NoteMeta, NoteRef, TreeNode, VaultInfo } from "./types";

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
  statNote: (path: string) => call<number>("note_stat", { path }),

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
};

/** PTY 输出。`data` 是 base64 的原始字节，交给 xterm 自己解 UTF-8。 */
export const onPtyData = (cb: (e: { id: string; data: string }) => void): Promise<UnlistenFn> =>
  listen<{ id: string; data: string }>("pty:data", (ev) => cb(ev.payload));

export const onPtyExit = (cb: (e: { id: string }) => void): Promise<UnlistenFn> =>
  listen<{ id: string }>("pty:exit", (ev) => cb(ev.payload));
