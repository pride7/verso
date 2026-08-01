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
  /** 把早期版本建出来的空仓库从 master 迁到了 main */
  renamedBranch: boolean;
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

export interface SearchHit {
  path: string;
  title: string;
  /** 命中上下文，已用 <mark> 标出。两条搜索路径产出的格式一致 */
  snippet: string;
}

export interface Backlink {
  path: string;
  title: string;
  /** 相对正文的行号，1 起算 */
  line: number;
  /** 出处那一行的原文 */
  context: string;
}

/** §2.6 database 视图的一行 */
export interface ViewRow {
  path: string;
  title: string;
  /** 只含视图点名的列 */
  props: Record<string, string>;
}

export interface ViewResult {
  rows: ViewRow[];
  columns: string[];
  view: string;
  groupBy: string | null;
}

export interface IndexStats {
  notes: number;
  links: number;
  tags: number;
  elapsedMs: number;
}
