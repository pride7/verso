/** 与 src-tauri/src/vault 的 Rust 结构一一对应。改一边记得改另一边。 */

export type NodeKind = "document" | "folder";

export interface TreeNode {
  /** 显示名，不含 .md 后缀 */
  name: string;
  /** vault 相对路径。document 指向 X.md，folder 指向 X/ */
  path: string;
  kind: NodeKind;
  /** 同名文件夹路径，仅当该 document 有子文档时有值 */
  childDir: string | null;
  children: TreeNode[];
}

export interface VaultInfo {
  root: string;
  name: string;
  createdRepo: boolean;
  createdGitignore: boolean;
}

export interface NoteContent {
  path: string;
  id: string | null;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mtimeMs: number;
}

export interface NoteMeta {
  path: string;
  id: string;
  title: string;
}

/** 快速切换器用的轻量条目 */
export interface NoteRef {
  path: string;
  name: string;
}
