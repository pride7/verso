import type { NoteContent, NoteMeta, NoteRef, PropDef, PropSchema } from "./types";

export type ProjectKind = "progress" | "experiment" | "question" | "decision" | "resource";
export type ProjectItemKind = Exclude<ProjectKind, "progress">;

export interface ProjectItem {
  path: string;
  /**
   * 笔记的 ULID。**它就是创建时间** —— ULID 前 10 个字符是毫秒时间戳，
   * 按字典序排就是按创建顺序排。§2.3 起 Verso 不再往 frontmatter 里写
   * `created`，所以这是唯一一个「不会因为改了一个字就变」的时间。
   */
  id: string | null;
  title: string;
  /** 所属分类名，也是同名目录名。分类可增删，所以这里存名字而不是固定枚举。 */
  section: string;
  /** 分类名命中内置四类时的类型；自定义分类没有，只影响模板与状态默认值。 */
  kind: ProjectItemKind | null;
  status: string;
  summary: string;
  /** 置顶。写在这条记录自己的 frontmatter 里，跟着文件走。 */
  pinned: boolean;
  mtimeMs: number;
}

export interface ProjectProgress {
  at: string;
  text: string;
}

export interface ProjectOverview {
  status: string;
  summary: string;
  next: string;
  blocker: string;
  items: ProjectItem[];
  progress: ProjectProgress[];
}

export interface ProjectApi {
  readNote(path: string): Promise<NoteContent>;
  createNote(parentDoc: string | null, title: string): Promise<NoteMeta>;
  writeNote(path: string, body: string): Promise<number>;
  propSet(path: string, key: string, value: string | null): Promise<void>;
  propSchema(): Promise<PropSchema>;
  propDefSet(key: string, def: PropDef): Promise<void>;
}

const CATEGORY: Record<ProjectItemKind, string> = {
  experiment: "实验",
  question: "问题",
  decision: "决策",
  resource: "资料",
};

const DEFAULT_STATUS: Record<ProjectItemKind, string> = {
  experiment: "进行中",
  question: "待解决",
  decision: "已决定",
  resource: "已收录",
};

export type ProjectStatusKind = ProjectItemKind | "project";

/** 项目总览和普通属性条共用的状态词表；顺序也是 UI 的稳定顺序。 */
export const PROJECT_STATUS_DEFAULTS: Record<ProjectStatusKind, string[]> = {
  project: ["筹备中", "进行中", "已暂停", "已完成", "已归档"],
  experiment: ["计划中", "进行中", "已暂停", "已完成", "已归档"],
  question: ["待解决", "研究中", "已解决", "已搁置"],
  decision: ["待决定", "已决定", "已废弃"],
  resource: ["待整理", "已收录", "已归档"],
};

/** 一个状态处在事情的哪一段。四档语义色就按这个分（§2.10 / §6.2）。 */
export type StatusTone = "todo" | "active" | "blocked" | "done" | "archived";

/**
 * 状态词按**词形**归档，不查一张固定的表。
 *
 * `status` 是可以现场新增的（§2.10），用户写的「复现中」「待复核」也必须落到
 * 正确的一档 —— 查表的话自定义状态会全部退成同一个中性块，那这套颜色就只对
 * 内置词表有效，而内置词表恰恰是最不需要帮助的那部分。
 *
 * 顺序有意义：「已暂停」既带「已」也不是完成态，必须先被 blocked 认走；
 * 「计划中」以「中」结尾却还没开始，必须先被 todo 认走。
 */
const TONE_RULES: [StatusTone, RegExp][] = [
  ["archived", /^(已)?(归档|废弃|作废|放弃|取消|过期)$/],
  // 「等外部数据」「等复现」是卡住了，不是还没开始 —— 所以 `^等` 排在 `^待` 前面
  ["blocked", /(暂停|搁置|阻塞|受阻|卡住|阻碍)|^等/],
  ["done", /^(已)?(完成|解决|决定|收录|关闭|发布|通过|确认|接受|结束)$/],
  ["todo", /^(待|计划|筹备|未|想法|排期|草稿)/],
  ["active", /(中|进行|推进|复现)$/],
];

/**
 * 每一档的人话名字。新增状态时当场显示它会落到哪一档 —— 分档规则是按词形
 * 猜的，猜错了用户得看得见，而不是建完之后自己去数颜色。
 */
export const STATUS_TONE_LABEL: Record<StatusTone, string> = {
  todo: "还没开始",
  active: "正在推进",
  blocked: "卡住了",
  done: "有结论了",
  archived: "已经收场",
};

/** 未知状态一律当「还没开始」处理：中性块最不会误导人。 */
export function statusTone(status: string): StatusTone {
  const value = status.trim();
  if (!value) return "todo";
  return TONE_RULES.find(([, pattern]) => pattern.test(value))?.[0] ?? "todo";
}

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export function isProjectStatusKind(kind: unknown): kind is ProjectStatusKind {
  return typeof kind === "string" && kind in PROJECT_STATUS_DEFAULTS;
}

const ALL_BUILT_IN = () => unique(Object.values(PROJECT_STATUS_DEFAULTS).flat());

/**
 * 当前文档类型对应的固定选项在前，自定义选项在后；总览和属性条都用这一顺序。
 *
 * 内置那几个也要**先在词表里还留着**才出现 —— 状态可以删（见下），删掉的
 * 不能因为这里写死了一份而又冒出来。词表整个是空的（老 vault、或 schema
 * 读不出来）才用内置那份兜底。
 */
export function projectStatusOptions(kind: unknown, schemaOptions: string[]): string[] {
  const known = unique(schemaOptions);
  if (!isProjectStatusKind(kind)) return known;
  if (!known.length) return [...PROJECT_STATUS_DEFAULTS[kind]];
  const builtIn = ALL_BUILT_IN();
  const mine = PROJECT_STATUS_DEFAULTS[kind].filter((value) => known.includes(value));
  return unique([...mine, ...known.filter((value) => !builtIn.includes(value))]);
}

/**
 * `status` 是 vault 级单选属性。项目创建和总览都走这里，避免专用页面是菜单、
 * 回到普通属性条却又退化成文本框。
 *
 * **内置词表只在第一次播种。** 每次打开都并回内置那几个的话，「删掉一个状态」
 * 这件事永远做不到 —— 下次打开它就回来了，而用户完全不知道是谁加的。播过种
 * 之后词表就以文件里那份为准，和 `sections` 一个道理（§2.10）。
 *
 * 「播过种」的判据是词表里**还剩至少一个内置状态**。没有额外的标记位可存
 * （`PropDef` 只有类型和选项），所以把五个内置的全删光会被当成没播过种、
 * 下次打开重新给一份 —— 那时用户手上一个状态都没有，给回默认反而是对的。
 *
 * `extra` 只有用户**明确添加**新状态时才传。传「这篇笔记现在的值」会让删掉的
 * 状态被一篇还没改过的旧笔记带回来。
 */
export async function ensureProjectStatusSchema(
  api: Pick<ProjectApi, "propSchema" | "propDefSet">,
  extra: string[] = [],
): Promise<string[]> {
  const schema = await api.propSchema();
  const current = schema.status;
  const existing = unique(current?.options ?? []);
  const seeded = current?.type === "select" && existing.some((option) => ALL_BUILT_IN().includes(option));
  const options = unique(seeded ? [...existing, ...extra] : [...ALL_BUILT_IN(), ...existing, ...extra]);
  if (current?.type !== "select" || JSON.stringify(existing) !== JSON.stringify(options)) {
    await api.propDefSet("status", { type: "select", options });
  }
  return options;
}

/**
 * 从词表里去掉一个状态。**不动任何笔记** —— 已经用着它的记录仍写着那个词，
 * 在自己那一行里照常显示。词表是菜单，不是数据；删菜单项不该改用户的文件
 * （和「删掉一个分类不删任何文档」同一条，§2.10）。
 */
export async function removeProjectStatus(
  api: Pick<ProjectApi, "propSchema" | "propDefSet">,
  option: string,
): Promise<string[]> {
  const schema = await api.propSchema();
  const current = unique(schema.status?.options ?? ALL_BUILT_IN());
  const options = current.filter((value) => value !== option.trim());
  await api.propDefSet("status", { type: "select", options });
  return options;
}

/** 自定义分类没有内置状态词表，先给这三个常用的，其余仍可从 schema 里选或现场新增。 */
export const SECTION_STATUS_FALLBACK = ["进行中", "已完成", "已归档"];

/** 项目没写 `sections` 时的默认分类（§2.10）。写了就完全以文件里那一份为准。 */
export const DEFAULT_SECTIONS = ["实验", "问题", "决策", "资料"];

/** 分类首页的名字被「进展」占了 —— 那是日志，不是分类。 */
export const PROGRESS_SECTION = "进展";

const KIND_BY_SECTION = new Map<string, ProjectItemKind>(
  (Object.entries(CATEGORY) as [ProjectItemKind, string][]).map(([kind, name]) => [name, kind]),
);

/** 分类名撞上内置四类时沿用它的模板和状态默认值；自定义分类返回 null。 */
export function sectionKind(name: string): ProjectItemKind | null {
  return KIND_BY_SECTION.get(name) ?? null;
}

/**
 * 项目的分类表。**唯一真源是项目笔记 frontmatter 里的 `sections`**（§2.10）——
 * 分类既然可增删，就不能藏在派生数据里，否则换台机器打开就少了几类。
 *
 * 没有这个键 = 还没动过分类，用默认四类；写成空表 = 用户明确一个分类都不要，
 * 两者必须分得开。
 */
export function projectSections(project: NoteContent | null): string[] {
  const raw = project?.frontmatter.sections;
  if (raw === undefined || raw === null) return [...DEFAULT_SECTIONS];
  const names = Array.isArray(raw) ? raw.map(asText) : asText(raw).split(/[、,，]/);
  return unique(names).filter((name) => name !== PROGRESS_SECTION);
}

/** 新分类名不合法时给出人话原因；合法返回 null。 */
export function sectionNameError(name: string, existing: string[]): string | null {
  const value = name.trim();
  if (!value) return "先写分类名";
  // 分类名就是目录名，同时还要能塞进 frontmatter 的列表里（分隔符是「、」和「,」）
  if (/[、,，/\\:*?"<>|]/.test(value)) return "分类名里不能有 、 , / \\ : * ? \" < > |";
  if (value === PROGRESS_SECTION) return "「进展」是项目日志，不能当分类";
  if (existing.some((item) => item === value)) return "已经有同名分类了";
  return null;
}

/**
 * 写回分类表。先把 `sections` 声明成多选，frontmatter 里才会落成 YAML 列表
 * 而不是一行逗号串 —— 后者在别的编辑器里看着像随手写的备注。
 */
export async function setProjectSections(
  api: Pick<ProjectApi, "propSet" | "propDefSet">,
  path: string,
  sections: string[],
): Promise<string[]> {
  const next = unique(sections).filter((name) => name !== PROGRESS_SECTION);
  await api.propDefSet("sections", { type: "multi" });
  await api.propSet(path, "sections", next.join("、"));
  return next;
}

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  progress: "进展",
  experiment: "实验",
  question: "问题",
  decision: "决策",
  resource: "资料",
};

const asText = (value: unknown) => (typeof value === "string" ? value : "");
const stem = (path: string) => path.replace(/\.md$/i, "");

export function isProject(note: NoteContent | null): boolean {
  return note?.frontmatter.type === "project";
}

export async function markAsProject(api: ProjectApi, note: NoteContent): Promise<void> {
  // 不把这篇笔记现在的状态并进词表：那是它自己的值，不是这个 vault 的词汇
  await ensureProjectStatusSchema(api);
  await api.propSet(note.path, "type", "project");
  // 已有 status 可能承载用户自己的词汇，不为了项目模式把它覆盖掉。
  if (!asText(note.frontmatter.status).trim()) await api.propSet(note.path, "status", "进行中");
}

function firstLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean)
    ?.slice(0, 160) ?? "";
}

/** 项目总览摘要不该把模板里的空标题或提示语当成真实结论。 */
function firstContentLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("<!--"))
    ?.slice(0, 160) ?? "";
}

export function projectDocumentTemplate(
  kind: ProjectItemKind,
): string {
  const lead = (prompt: string) => `> ${prompt}\n`;
  const templates: Record<typeof kind, string> = {
    experiment: [
      "## 目标与假设",
      lead("这次实验要验证什么？"),
      "## 方法与设置",
      "> 数据、变量、环境和可复现设置",
      "",
      "## 观察与结果",
      "> 结果、图表、异常和原始观察",
      "",
      "## 结论与下一步",
      "> 这说明了什么，接下来要做什么？",
    ].join("\n"),
    question: [
      "## 问题",
      lead("把真正要回答的问题写清楚"),
      "## 背景与已知事实",
      "> 已知证据、约束和相关上下文",
      "",
      "## 已尝试",
      "> 做过什么，为什么没有解决？",
      "",
      "## 当前判断",
      "> 目前最可信的解释",
      "",
      "## 下一步",
      "> 最小的验证动作",
    ].join("\n"),
    decision: [
      "## 要决定什么",
      lead("这项决定要解决什么？"),
      "## 备选方案",
      "> 还有哪些可选路径？",
      "",
      "## 证据与权衡",
      "> 收益、代价、风险与不可逆部分",
      "",
      "## 决定",
      "> 最终选择及理由",
      "",
      "## 影响与复查",
      "> 影响范围，以及何时重新检查",
    ].join("\n"),
    resource: [
      "## 来源",
      lead("论文、数据集、代码或其他来源"),
      "## 关键内容",
      "> 最值得保留的结论、方法或引用",
      "",
      "## 与项目的关系",
      "> 它支持、反驳或补充了什么？",
      "",
      "## 后续使用",
      "> 要在什么地方继续使用它？",
    ].join("\n"),
  };
  return `${templates[kind].trim()}\n`;
}

export function parseProgress(body: string): ProjectProgress[] {
  const matches = [...body.matchAll(/^##\s+(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*$\r?\n([\s\S]*?)(?=^##\s+\d{4}-\d{2}-\d{2}|\s*$)/gm)];
  return matches.map((match) => ({
    at: match[1],
    text: match[2].trim(),
  }));
}

/**
 * `pinned` 声明成 checkbox 之后写进去的是真正的 YAML 布尔；但旧文件、或者
 * 用户自己在别的编辑器里写的，也可能是 `pinned: "true"`。两种都认。
 */
function isPinned(value: unknown): boolean {
  return value === true || asText(value).trim() === "true";
}

/** 有结论的那两档：排在没结论的后面 */
const SETTLED = new Set<StatusTone>(["done", "archived"]);

/**
 * 排序规则：**置顶 → 还没结束的 → 创建时间（新的在前）**。就地排序，
 * 两处清单共用这一份。
 *
 * ## 为什么不按最近改动
 *
 * 改一个状态就是改那篇笔记的 frontmatter，文件的修改时间跟着变 —— 于是
 * 「把某条标成已解决」的结果是它**跳到了最上面**，而那正是你刚处理完、
 * 最不需要再看见的一条。按修改时间排，等于让「碰过它」压过「它要紧吗」。
 *
 * ## 为什么创建时间取自 ULID
 *
 * §2.3 起 Verso 不往 frontmatter 里写 `created`，而文件系统的创建时间在
 * 同步之后并不可靠。ULID 的前 10 个字符就是毫秒时间戳，字典序即时间序 ——
 * 它是这里唯一一个不会因为改了一个字就变的时间。没有 id 的笔记（别的编辑器
 * 建的）退回按修改时间比，至少同一组内部是稳定的。
 *
 * 「最重要」和「最近」也是两回事：每类只露三条（§2.10 的硬上限），不给一条
 * 手动置顶的路，最要紧的那条只要几天没动就沉到「查看全部」后面去了。
 */
export function sortProjectItems(items: ProjectItem[]): ProjectItem[] {
  const settled = (item: ProjectItem) => Number(SETTLED.has(statusTone(item.status)));
  return items.sort((a, b) => {
    const byPin = Number(b.pinned) - Number(a.pinned);
    if (byPin) return byPin;
    const byPhase = settled(a) - settled(b);
    if (byPhase) return byPhase;
    const ida = a.id ?? "";
    const idb = b.id ?? "";
    if (ida !== idb && (ida || idb)) return idb < ida ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });
}

/**
 * 置顶／取消置顶。先把 `pinned` 声明成 checkbox，frontmatter 里才会落成
 * `pinned: true` 而不是字符串 `"true"` —— 后者在 database 视图的条件里
 * 和真布尔不是一回事。取消就把这一行整个删掉，不留 `pinned: false` 当垃圾。
 */
export async function setProjectPinned(
  api: Pick<ProjectApi, "propSet" | "propDefSet">,
  path: string,
  pinned: boolean,
): Promise<void> {
  await api.propDefSet("pinned", { type: "checkbox" });
  await api.propSet(path, "pinned", pinned ? "true" : null);
}

/**
 * 一篇笔记属于哪个分类。**先看它在哪个分类目录下**，因为用户可以在文档树里
 * 直接搬动这些文件；`type` 只作为退路，认早先建的、或被挪出目录的记录。
 *
 * 分类被删掉之后它下面的文件仍留在磁盘上（那是用户的数据），但不再进总览 ——
 * 所以两条路都要求分类名还在表里。
 */
function itemSection(note: NoteContent, prefix: string, sections: string[]): string | null {
  const rel = note.path.slice(prefix.length);
  const slash = rel.indexOf("/");
  // 只认分类目录的直属子文档；再深一层是某条记录自己的子文档，不该单独列出来
  const folder = slash > 0 && rel.indexOf("/", slash + 1) < 0 ? rel.slice(0, slash) : "";
  if (folder && sections.includes(folder)) return folder;
  const type = asText(note.frontmatter.type);
  const byType = type in CATEGORY ? CATEGORY[type as ProjectItemKind] : type;
  return byType && sections.includes(byType) ? byType : null;
}

export async function loadProjectOverview(
  api: Pick<ProjectApi, "readNote">,
  project: NoteContent,
  notes: NoteRef[],
): Promise<ProjectOverview> {
  const prefix = `${stem(project.path)}/`;
  const sections = projectSections(project);
  const children = notes.filter((note) => note.path.startsWith(prefix));
  const contents = await Promise.all(children.map((note) => api.readNote(note.path)));
  const items = contents
    .flatMap<ProjectItem>((note) => {
      const section = itemSection(note, prefix, sections);
      if (!section) return [];
      return [{
        path: note.path,
        id: note.id,
        title: note.title,
        section,
        kind: sectionKind(section),
        status: asText(note.frontmatter.status),
        summary: asText(note.frontmatter.summary) || firstContentLine(note.body),
        pinned: isPinned(note.frontmatter.pinned),
        mtimeMs: note.mtimeMs,
      }];
    });
  sortProjectItems(items);
  const progressNote = contents.find((note) => note.frontmatter.type === "project-log");

  return {
    status: asText(project.frontmatter.status) || "进行中",
    summary: asText(project.frontmatter.summary),
    next: asText(project.frontmatter.next),
    blocker: asText(project.frontmatter.blocker),
    items,
    progress: progressNote ? parseProgress(progressNote.body) : [],
  };
}

async function ensureChild(
  api: Pick<ProjectApi, "createNote" | "propSet">,
  parent: string,
  title: string,
  type: string,
): Promise<string> {
  const expected = `${stem(parent)}/${title}.md`;
  try {
    const created = await api.createNote(parent, title);
    await api.propSet(created.path, "type", type);
    return created.path;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("已存在同名文档")) throw error;
    // 旧文件可能是用户早先手建的；既然现在明确把它用作项目分类，就补上标记。
    await api.propSet(expected, "type", type);
    return expected;
  }
}

/**
 * 把一条记录挪到另一个分类。分类就是目录（§2.10），所以这是一次**真正的文件
 * 移动** —— 不是改个标签。
 *
 * 这里只做移动之前必须先办好的两件事，真正的移动交给上层：它还要跟着改
 * 打开中的标签页路径、修手排顺序（和改名同一条路，§2.1）。
 *
 * 1. **目标分类首页可能还不存在。** 分类是在项目笔记的 `sections` 里声明的，
 *    一条记录都没建过的分类在磁盘上没有对应目录
 * 2. **`type` 要跟着分类走。** 不改的话，移到「问题」底下的那篇仍写着
 *    `type: decision`，database 视图里 `where type = "decision"` 还会把它捞出来
 *
 * 返回目标分类首页的路径 —— 也就是移动时要给的那个父文档。
 */
export async function prepareItemMove(
  api: Pick<ProjectApi, "createNote" | "propSet">,
  projectPath: string,
  itemPath: string,
  section: string,
): Promise<string> {
  const target = await ensureChild(api, projectPath, section, "project-section");
  await api.propSet(itemPath, "type", sectionKind(section) ?? section);
  return target;
}

function localStamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * `section` 为 null 表示记一条进展；否则是分类名（可以是用户自建的）。
 */
export async function captureProjectEntry(
  api: ProjectApi,
  projectPath: string,
  input: { section: string | null; title: string; content: string; useTemplate?: boolean },
): Promise<string> {
  const content = input.content.trim();

  if (input.section === null) {
    if (!content) throw new Error("先写一点内容");
    const path = await ensureChild(api, projectPath, PROGRESS_SECTION, "project-log");
    const note = await api.readNote(path);
    const entry = `## ${localStamp()}\n\n${content}\n\n`;
    await api.writeNote(path, `${entry}${note.body.trimStart()}`);
    return path;
  }

  const baseTitle = input.title.trim();
  if (!baseTitle) throw new Error("先写标题");
  const category = input.section.trim();
  const kind = sectionKind(category);
  const status = kind ? DEFAULT_STATUS[kind] : SECTION_STATUS_FALLBACK[0];
  await ensureProjectStatusSchema(api);
  const categoryPath = await ensureChild(api, projectPath, category, "project-section");
  let created: NoteMeta | null = null;
  for (let n = 1; n < 100; n += 1) {
    const title = n === 1 ? baseTitle : `${baseTitle} ${n}`;
    try {
      created = await api.createNote(categoryPath, title);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("已存在同名文档")) throw error;
    }
  }
  if (!created) throw new Error("同名记录太多，请换一个标题");
  // 自定义分类没有建议结构；勾选框在界面上也不会出现
  const body = input.useTemplate && kind ? projectDocumentTemplate(kind) : "";
  await api.writeNote(created.path, body);
  // 自定义分类就用分类名当 type，记录被搬走之后自己仍说得清是什么
  await api.propSet(created.path, "type", kind ?? category);
  await api.propSet(created.path, "status", status);
  if (content) await api.propSet(created.path, "summary", firstLine(content));
  return created.path;
}

export async function updateProjectSnapshot(
  api: Pick<ProjectApi, "propSet">,
  path: string,
  input: Pick<ProjectOverview, "status" | "summary" | "next" | "blocker">,
): Promise<void> {
  // propSet 每次都读整篇再写回；并发会互相覆盖，必须串行。
  for (const [key, value] of Object.entries(input) as [keyof typeof input, string][]) {
    await api.propSet(path, key, value.trim() || null);
  }
}
