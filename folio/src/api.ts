import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { NoteContent, NoteMeta, TreeNode, VaultInfo } from "./types";

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
  /** 启动时自动重开上次的 vault；目录没了就返回 null */
  reopenLastVault: () => call<VaultInfo | null>("vault_reopen_last"),
  tree: () => call<TreeNode[]>("tree_list"),
  readNote: (path: string) => call<NoteContent>("note_read", { path }),
  /** 返回写入后的 mtime */
  writeNote: (path: string, body: string) => call<number>("note_write", { path, body }),
  createNote: (parentDoc: string | null, title: string) =>
    call<NoteMeta>("note_create", { parentDoc, title }),
  statNote: (path: string) => call<number>("note_stat", { path }),
};
