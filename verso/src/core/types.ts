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
  /**
   * frontmatter 里的 `collapsed`：在文档树里**不展开**它。
   *
   * 一个项目/知识库笔记底下可能有几十篇子文档，它们在树里铺开只会把别的
   * 全挤下去 —— 而那些内容本来就该从它自己的页面（总览、database 视图）
   * 进去。收起之后树上只留一行。
   */
  collapsed?: boolean;
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

/** 应用配置里记录的仓库入口；目录本身仍是唯一真源。 */
export interface RecentVault {
  root: string;
  name: string;
  /** false 表示目录被移动、重命名或当前不可访问；保留条目让用户自己处理。 */
  available: boolean;
  /** 这个入口属于共享区；底层仍是可独立使用的 Markdown + Git 目录。 */
  shared: boolean;
}

/** 创建共享空间前，后端按节点子树与真实文件引用给出的精确清单。 */
export interface SharePreview {
  note: string;
  /** 主文档与同名目录里的全部子文档。 */
  documents: string[];
  /** 同名目录中随项目迁移的其他普通文件。 */
  files: string[];
  attachments: string[];
  /** 这些笔记只被正文链接，不会跟着共享。 */
  linkedNotes: string[];
}

export interface GitHubAccount {
  login: string;
}

/** GitHub App 设备授权的短期会话。access token 永远不会来到前端。 */
export interface GitHubDeviceAuthorization {
  /** 只在这次授权轮询中使用，页面关闭后即丢弃。 */
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** GitHub 要求的最小轮询间隔（秒）。 */
  interval: number;
  expiresIn: number;
}

/** 一次 Device Flow 轮询的无敏感结果。 */
export interface GitHubDevicePoll {
  account: GitHubAccount | null;
  /** GitHub 要求额外等待的秒数；只在限流时非零。 */
  retryAfter: number;
}

export interface SharedSpaceInfo {
  root: string;
  name: string;
  /** 上次由 Verso 邀请的成员；远端权限仍是最终事实。 */
  members: string[];
  /** 由分享动作加入这个空间的顶层内容节点。 */
  entries: string[];
  /** 用于高级托管服务管理；凭据永远不在这里。 */
  remote: string | null;
}

export interface SharedSpaceAccess {
  /** 已经拥有仓库访问权的协作者。 */
  members: string[];
  /** 已收到邀请、但尚未接受的人。 */
  pending: string[];
  github: boolean;
  /** GitHub 返回的实时结果；false 时 members 只是离线缓存。 */
  verified: boolean;
  warning: string | null;
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
  /** 摘要下面的完整说明 */
  detail: string;
  authorName: string;
  authorEmail: string | null;
  /** unix 秒 */
  at: number;
  files: FileChange[];
  additions: number;
  deletions: number;
}

export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted" | "renamed";
}

export interface DiffLine {
  kind: "context" | "added" | "deleted";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/** §2.8 一篇文件在当前工作区或某次历史记录里的变化 */
export interface FileDiff {
  path: string;
  kind: FileChange["kind"];
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
}

export interface CommitInfo {
  id: string;
  message: string;
  files: number;
}

/** 提交署名。存在 vault 仓库级 git 配置里，跟着 vault 走 */
export interface GitIdentity {
  /** null = 没配过（生效的是本机全局配置，再没有就是「Verso」） */
  name: string | null;
  email: string | null;
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

/** 一篇撞上冲突的笔记，两边完整内容都带上 —— 冲突 UI 靠它画对比、拼定稿 */
export interface ConflictFile {
  path: string;
  /** 两边分叉前的共同版本；语义合并靠它判断每个属性由谁修改 */
  base: string | null;
  /** 本地当前的样子。本地删了这篇、或不是文本时为 null */
  local: string | null;
  /** 远端那一版。远端删了这篇时为 null */
  remote: string | null;
  /** 最近一次真正改到这条路径的提交；旧版后端可能没有 */
  localChange?: ConflictChange | null;
  remoteChange?: ConflictChange | null;
}

export interface ConflictChange {
  author: string;
  timestamp: number;
}

/** 冲突 UI 的一条定稿。content 为 null = 接受删除 */
export interface SyncResolution {
  path: string;
  content: string | null;
}

/** 一次同步的结果 */
export interface SyncOutcome {
  /** 这次顺手提交掉的本地改动 */
  committed: CommitInfo | null;
  pulled: number;
  pushed: number;
  /** **非空就意味着这次同步什么都没做** */
  conflicts: ConflictFile[];
}

export interface SuggestionFile {
  path: string;
  previousPath: string | null;
  kind: "added" | "modified" | "deleted" | "renamed";
}

export interface Suggestion {
  id: string;
  title: string;
  authorName: string;
  authorEmail: string | null;
  at: number;
  files: SuggestionFile[];
  additions: number;
  deletions: number;
}

export interface ReviewOutcome {
  done: boolean;
  conflicts: ConflictFile[];
  warning: string | null;
}

export interface IndexStats {
  notes: number;
  links: number;
  tags: number;
  elapsedMs: number;
}
