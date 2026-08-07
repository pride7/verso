import type { NoteContent, NoteMeta, NoteRef, PropSchema } from "../types";

export type ProjectKind = "progress" | "experiment" | "question" | "decision" | "resource";

export interface ProjectItem {
  path: string;
  title: string;
  kind: Exclude<ProjectKind, "progress">;
  status: string;
  summary: string;
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
  propDefSet(key: string, def: { type: "select"; options: string[] }): Promise<void>;
}

const CATEGORY: Record<Exclude<ProjectKind, "progress">, string> = {
  experiment: "实验",
  question: "问题",
  decision: "决策",
  resource: "资料",
};

const DEFAULT_STATUS: Record<Exclude<ProjectKind, "progress">, string> = {
  experiment: "进行中",
  question: "待解决",
  decision: "已决定",
  resource: "已收录",
};

export type ProjectStatusKind = Exclude<ProjectKind, "progress"> | "project";

/** 项目总览和普通属性条共用的状态词表；顺序也是 UI 的稳定顺序。 */
export const PROJECT_STATUS_DEFAULTS: Record<ProjectStatusKind, string[]> = {
  project: ["筹备中", "进行中", "已暂停", "已完成", "已归档"],
  experiment: ["计划中", "进行中", "已暂停", "已完成", "已归档"],
  question: ["待解决", "研究中", "已解决", "已搁置"],
  decision: ["待决定", "已决定", "已废弃"],
  resource: ["待整理", "已收录", "已归档"],
};

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export function isProjectStatusKind(kind: unknown): kind is ProjectStatusKind {
  return typeof kind === "string" && kind in PROJECT_STATUS_DEFAULTS;
}

/** 当前文档类型对应的固定选项在前，自定义选项在后；总览和属性条都用这一顺序。 */
export function projectStatusOptions(kind: unknown, schemaOptions: string[]): string[] {
  if (!isProjectStatusKind(kind)) return unique(schemaOptions);
  const builtIn = unique(Object.values(PROJECT_STATUS_DEFAULTS).flat());
  const custom = schemaOptions.filter((value) => !builtIn.includes(value));
  return unique([...PROJECT_STATUS_DEFAULTS[kind], ...custom]);
}

/**
 * `status` 是 vault 级单选属性。项目创建和总览都走这里，避免专用页面是菜单、
 * 回到普通属性条却又退化成文本框。已有自定义选项只合并，不覆盖。
 */
export async function ensureProjectStatusSchema(
  api: Pick<ProjectApi, "propSchema" | "propDefSet">,
  extra: string[] = [],
): Promise<string[]> {
  const schema = await api.propSchema();
  const current = schema.status;
  const options = unique([
    ...Object.values(PROJECT_STATUS_DEFAULTS).flat(),
    ...(current?.options ?? []),
    ...extra,
  ]);
  if (current?.type !== "select" || JSON.stringify(current.options ?? []) !== JSON.stringify(options)) {
    await api.propDefSet("status", { type: "select", options });
  }
  return options;
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
  await ensureProjectStatusSchema(api, [asText(note.frontmatter.status)]);
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
  kind: Exclude<ProjectKind, "progress">,
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

export async function loadProjectOverview(
  api: Pick<ProjectApi, "readNote">,
  project: NoteContent,
  notes: NoteRef[],
): Promise<ProjectOverview> {
  const prefix = `${stem(project.path)}/`;
  const children = notes.filter((note) => note.path.startsWith(prefix));
  const contents = await Promise.all(children.map((note) => api.readNote(note.path)));
  const items = contents
    .flatMap<ProjectItem>((note) => {
      const kind = note.frontmatter.type;
      if (!Object.keys(CATEGORY).includes(String(kind))) return [];
      return [{
        path: note.path,
        title: note.title,
        kind: kind as ProjectItem["kind"],
        status: asText(note.frontmatter.status),
        summary: asText(note.frontmatter.summary) || firstContentLine(note.body),
        mtimeMs: note.mtimeMs,
      }];
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
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
  api: ProjectApi,
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

function localStamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export async function captureProjectEntry(
  api: ProjectApi,
  projectPath: string,
  input: { kind: ProjectKind; title: string; content: string; useTemplate?: boolean },
): Promise<string> {
  const content = input.content.trim();

  if (input.kind === "progress") {
    if (!content) throw new Error("先写一点内容");
    const path = await ensureChild(api, projectPath, "进展", "project-log");
    const note = await api.readNote(path);
    const entry = `## ${localStamp()}\n\n${content}\n\n`;
    await api.writeNote(path, `${entry}${note.body.trimStart()}`);
    return path;
  }

  const baseTitle = input.title.trim();
  if (!baseTitle) throw new Error("先写标题");
  await ensureProjectStatusSchema(api, [DEFAULT_STATUS[input.kind]]);
  const category = CATEGORY[input.kind];
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
  const body = input.useTemplate
    ? projectDocumentTemplate(input.kind)
    : "";
  await api.writeNote(created.path, body);
  await api.propSet(created.path, "type", input.kind);
  await api.propSet(created.path, "status", DEFAULT_STATUS[input.kind]);
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
