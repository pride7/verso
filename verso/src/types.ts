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
  /** frontmatter 里的 `order`，手动排序用。没排过则为 null */
  order: number | null;
  created: string | null;
  updated: string | null;
  /**
   * frontmatter 里的 `icon` —— 一个字符（通常是 emoji）。没设过则为 null。
   *
   * 可选是为了让一堆只关心别的行为的测试夹具不必每个都补一行；Rust 侧
   * 永远给这个字段（`Option<String>` → `null`）
   */
  icon?: string | null;
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
  /**
   * frontmatter 在文件里的**原文**（两道 `---` 之间那段，不含 `---` 本身）。
   * 没有 frontmatter 时是 null。源码模式要给人看的是这个，不是上面那个
   * 解析完的映射 —— 解析会丢掉键序、缩进和注释。
   */
  frontmatterText: string | null;
  body: string;
  mtimeMs: number;
}

export interface NoteMeta {
  path: string;
  /** 新建的笔记没有 id —— frontmatter 里有什么全由用户决定（§2.3） */
  id: string | null;
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
  /** 这批笔记身上出现过的全部属性。列头图标、「加一列」的候选都来自它 */
  properties: PropMeta[];
}

/** 用户指定的属性类型。存在 vault 根的 `.verso-props.json`（见 vault/schema.rs） */
export type PropType = "text" | "number" | "date" | "checkbox" | "select" | "multi" | "url";

export interface PropDef {
  type: PropType | null;
  /** 单选 / 多选的候选值 */
  options?: string[];
}

/** 属性名 → 定义 */
export type PropSchema = Record<string, PropDef>;

export interface PropMeta {
  key: string;
  type: "string" | "number" | "bool" | "date" | "list";
}

/** §2.8 仓库现在的样子。和 Rust 的 `vault::git::GitStatus` 一一对应 */
export interface GitStatus {
  /** 是不是个能用的 git 仓库。用户手动删掉 `.git` 之后就不是了 */
  enabled: boolean;
  added: number;
  modified: number;
  deleted: number;
  /** 三者之和 —— 状态栏显示的就是它 */
  dirty: number;
  lastMessage: string | null;
  /** unix 秒 */
  lastAt: number | null;
}

/** §2.8 历史里的一次提交 */
export interface HistoryEntry {
  id: string;
  /** 摘要那一行 */
  message: string;
  /** unix 秒 */
  at: number;
  files: FileChange[];
}

export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted" | "renamed";
}

export interface CommitInfo {
  id: string;
  message: string;
  files: number;
}

/** §2.8 当前配的远端。和 Rust 的 `vault::sync::RemoteInfo` 一一对应 */
export interface RemoteInfo {
  /** 没配过时是 null */
  url: string | null;
  /** 同步只管当前这一个分支 */
  branch: string;
  /** https 要令牌；本地路径不要 */
  needsToken: boolean;
}

/** 一次同步的结果 */
export interface SyncOutcome {
  /** 这次顺手提交掉的本地改动 */
  committed: CommitInfo | null;
  pulled: number;
  pushed: number;
  /** **非空就意味着这次同步什么都没做** */
  conflicts: string[];
}

export interface IndexStats {
  notes: number;
  links: number;
  tags: number;
  elapsedMs: number;
}
