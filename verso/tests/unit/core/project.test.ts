import { describe, expect, it } from "vitest";

import {
  captureProjectEntry,
  DEFAULT_SECTIONS,
  loadProjectOverview,
  parseProgress,
  projectDocumentTemplate,
  projectSections,
  ensureProjectStatusSchema,
  prepareItemMove,
  projectStatusOptions,
  removeProjectStatus,
  sectionNameError,
  setProjectPinned,
  setProjectSections,
  sortProjectItems,
  statusTone,
  type ProjectApi,
  type ProjectItem,
} from "../../../src/core/project";
import type { NoteContent, NoteMeta, PropSchema } from "../../../src/core/types";

function note(path: string, frontmatter: Record<string, unknown> = {}, body = "", mtimeMs = 1): NoteContent {
  return { path, id: null, title: path.split("/").pop()!.replace(/\.md$/, ""), frontmatter, frontmatterText: null, body, mtimeMs };
}

describe("项目记录", () => {
  it("日期日志按普通 Markdown 标题解析", () => {
    expect(parseProgress("## 2026-08-06 09:30\n\n完成基线。\n\n## 2026-08-05 18:00\n\n开始。\n")).toEqual([
      { at: "2026-08-06 09:30", text: "完成基线。" },
      { at: "2026-08-05 18:00", text: "开始。" },
    ]);
  });

  it("总览只收同名目录里的结构化记录，并按更新时间排列", async () => {
    const project = note("重建实验.md", { type: "project", status: "进行中", summary: "先验证数据。" });
    const disk = new Map([
      ["重建实验/实验/A.md", note("重建实验/实验/A.md", { type: "experiment", status: "进行中" }, "第一轮", 2)],
      ["重建实验/问题/B.md", note("重建实验/问题/B.md", { type: "question", status: "待解决", summary: "指标异常" }, "", 3)],
      ["重建实验/进展.md", note("重建实验/进展.md", { type: "project-log" }, "## 2026-08-06 10:00\n\n跑完。")],
      ["别的项目/实验/C.md", note("别的项目/实验/C.md", { type: "experiment" })],
    ]);
    const result = await loadProjectOverview(
      { readNote: async (path) => disk.get(path)! },
      project,
      [...disk.keys()].map((path) => ({ path, name: path })),
    );
    expect(result.items.map((item) => item.title)).toEqual(["B", "A"]);
    expect(result.items[1].summary).toBe("第一轮");
    expect(result.progress[0].text).toBe("跑完。");
  });

  it("分类记录自动建分类首页和子文档，正文与属性仍写进普通 Markdown", async () => {
    const created: string[] = [];
    const writes: [string, string][] = [];
    const props: [string, string, string | null][] = [];
    const defs: unknown[] = [];
    const api: ProjectApi = {
      readNote: async (path) => note(path),
      createNote: async (parent, title): Promise<NoteMeta> => {
        const path = parent ? `${parent.replace(/\.md$/, "")}/${title}.md` : `${title}.md`;
        created.push(path);
        return { path, title, id: null };
      },
      writeNote: async (path, body) => { writes.push([path, body]); return 1; },
      propSet: async (path, key, value) => { props.push([path, key, value]); },
      propSchema: async () => ({}),
      propDefSet: async (_key, def) => { defs.push(def); },
    };
    const path = await captureProjectEntry(api, "项目.md", { section: "实验", title: "消融", content: "去掉路由后下降 3%。", useTemplate: true });
    expect(path).toBe("项目/实验/消融.md");
    expect(created).toEqual(["项目/实验.md", "项目/实验/消融.md"]);
    expect(writes[0][0]).toBe(path);
    expect(writes[0][1]).toContain("## 目标与假设");
    expect(writes[0][1]).not.toContain("去掉路由后下降 3%。");
    expect(writes[0][1]).toContain("## 观察与结果");
    expect(props).toContainEqual([path, "type", "experiment"]);
    expect(props).toContainEqual([path, "summary", "去掉路由后下降 3%。"]);
    expect(defs).toContainEqual(expect.objectContaining({ type: "select" }));
  });

  it("复杂记录允许只有标题，正文得到可删改的轻量模板", async () => {
    expect(projectDocumentTemplate("question")).toContain("## 背景与已知事实");
    expect(projectDocumentTemplate("decision")).toContain("## 证据与权衡");
    expect(projectDocumentTemplate("resource")).toContain("## 与项目的关系");
  });

  it("新研究文档默认不强加模板", async () => {
    const writes: string[] = [];
    const props: [string, string, string | null][] = [];
    const api: ProjectApi = {
      readNote: async (path) => note(path),
      createNote: async (parent, title) => ({ path: `${parent!.replace(/\.md$/, "")}/${title}.md`, title, id: null }),
      writeNote: async (_path, body) => { writes.push(body); return 1; },
      propSet: async (path, key, value) => { props.push([path, key, value]); },
      propSchema: async () => ({}),
      propDefSet: async () => {},
    };
    await captureProjectEntry(api, "项目.md", { section: "问题", title: "为什么", content: "一句摘要" });
    expect(writes[0]).toBe("");
    expect(props).toContainEqual(["项目/问题/为什么.md", "summary", "一句摘要"]);
  });
});

describe("项目分类", () => {
  it("没写 sections 用默认四类，写了就完全以文件里那份为准", () => {
    expect(projectSections(note("项目.md", { type: "project" }))).toEqual([...DEFAULT_SECTIONS]);
    expect(projectSections(note("项目.md", { sections: ["实验", "复现"] }))).toEqual(["实验", "复现"]);
    // 别的编辑器里手写成一行也认；「进展」是日志，永远不算分类
    expect(projectSections(note("项目.md", { sections: "实验、问题, 进展" }))).toEqual(["实验", "问题"]);
    // 空表 = 明确一个分类都不要，不能退回默认四类
    expect(projectSections(note("项目.md", { sections: [] }))).toEqual([]);
  });

  it("删掉的分类只是不再进总览，文件仍在磁盘上", async () => {
    const project = note("项目.md", { type: "project", sections: ["实验", "复现"] });
    const disk = new Map([
      ["项目/实验/A.md", note("项目/实验/A.md", { type: "experiment", status: "进行中" }, "", 3)],
      ["项目/复现/B.md", note("项目/复现/B.md", { type: "复现", status: "进行中" }, "", 2)],
      // 「资料」已经被删出分类表，它的文档还在，但不该再出现在总览里
      ["项目/资料/C.md", note("项目/资料/C.md", { type: "resource" }, "", 1)],
      // 记录自己的子文档不单独成条
      ["项目/实验/A/细节.md", note("项目/实验/A/细节.md", {}, "", 4)],
    ]);
    const result = await loadProjectOverview(
      { readNote: async (path) => disk.get(path)! },
      project,
      [...disk.keys()].map((path) => ({ path, name: path })),
    );
    expect(result.items.map((item) => [item.title, item.section, item.kind])).toEqual([
      ["A", "实验", "experiment"],
      ["B", "复现", null],
    ]);
  });

  it("自定义分类照样建目录和文档，只是没有内置模板", async () => {
    const props: [string, string, string | null][] = [];
    const writes: string[] = [];
    const api: ProjectApi = {
      readNote: async (path) => note(path),
      createNote: async (parent, title) => ({ path: `${parent!.replace(/\.md$/, "")}/${title}.md`, title, id: null }),
      writeNote: async (_path, body) => { writes.push(body); return 1; },
      propSet: async (path, key, value) => { props.push([path, key, value]); },
      propSchema: async () => ({}),
      propDefSet: async () => {},
    };
    const path = await captureProjectEntry(api, "项目.md", { section: "复现", title: "复现 baseline", content: "", useTemplate: true });
    expect(path).toBe("项目/复现/复现 baseline.md");
    expect(writes[0]).toBe("");
    expect(props).toContainEqual([path, "type", "复现"]);
    // 建记录往往就是开始做的时刻，默认「进行中」省掉创建后再改一次。
    expect(props).toContainEqual([path, "status", "进行中"]);
  });

  it("分类表落成 frontmatter 里的列表，而不是一行逗号串", async () => {
    const props: [string, string, string | null][] = [];
    const defs: [string, unknown][] = [];
    const written = await setProjectSections(
      {
        propSet: async (path, key, value) => { props.push([path, key, value]); },
        propDefSet: async (key, def) => { defs.push([key, def]); },
      },
      "项目.md",
      ["实验", "实验", "复现", "进展"],
    );
    expect(written).toEqual(["实验", "复现"]);
    expect(defs).toContainEqual(["sections", { type: "multi" }]);
    expect(props).toContainEqual(["项目.md", "sections", "实验、复现"]);
  });

  it("分类名要能当目录名，也要能塞进列表", () => {
    expect(sectionNameError("复现", ["实验"])).toBeNull();
    expect(sectionNameError("  ", [])).toBe("先写分类名");
    expect(sectionNameError("实验", ["实验"])).toBe("已经有同名分类了");
    expect(sectionNameError("进展", [])).toContain("项目日志");
    expect(sectionNameError("会议/纪要", [])).toContain("不能有");
    expect(sectionNameError("实验、问题", [])).toContain("不能有");
  });
});

describe("状态分档", () => {
  it("内置词表的每一档都分得开", () => {
    expect(["待解决", "待决定", "待整理", "计划中", "筹备中"].map(statusTone))
      .toEqual(["todo", "todo", "todo", "todo", "todo"]);
    expect(["进行中", "研究中"].map(statusTone)).toEqual(["active", "active"]);
    expect(["已暂停", "已搁置"].map(statusTone)).toEqual(["blocked", "blocked"]);
    expect(["已完成", "已解决", "已决定", "已收录"].map(statusTone))
      .toEqual(["done", "done", "done", "done"]);
    expect(["已归档", "已废弃"].map(statusTone)).toEqual(["archived", "archived"]);
  });

  it("自定义状态按词形归档，不靠查表", () => {
    expect(statusTone("复现中")).toBe("active");
    expect(statusTone("待复核")).toBe("todo");
    expect(statusTone("等外部数据")).toBe("blocked");
    // 认不出来的一律当「还没开始」：中性块最不会误导人
    expect(statusTone("重要")).toBe("todo");
    expect(statusTone("")).toBe("todo");
  });
});

describe("状态词表", () => {
  /** 只记下写进去的那一份，够这几条用 */
  const vault = (options: string[] | null) => {
    const writes: string[][] = [];
    return {
      writes,
      api: {
        propSchema: async (): Promise<PropSchema> => (options ? { status: { type: "select", options } } : {}),
        propDefSet: async (_key: string, def: { options?: string[] }) => { writes.push(def.options ?? []); },
      },
    };
  };

  it("第一次打开播种内置词表", async () => {
    const { api, writes } = vault(null);
    const options = await ensureProjectStatusSchema(api);
    // 三档，所有分类共用一套（v0.7.40）
    expect(options).toEqual(["未开始", "进行中", "已完成"]);
    expect(writes).toHaveLength(1);
  });

  it("播过种就不再并回内置那份 —— 否则删掉的状态下次打开又回来", async () => {
    const { api, writes } = vault(["进行中", "已完成", "复现中"]);
    expect(await ensureProjectStatusSchema(api)).toEqual(["进行中", "已完成", "复现中"]);
    // 一个字都没变就不该写文件
    expect(writes).toHaveLength(0);
  });

  it("明确添加的新状态仍然进词表", async () => {
    const { api, writes } = vault(["进行中", "已完成"]);
    expect(await ensureProjectStatusSchema(api, ["待复核"])).toEqual(["进行中", "已完成", "待复核"]);
    expect(writes).toEqual([["进行中", "已完成", "待复核"]]);
  });

  it("删掉一个状态只改词表，不碰任何笔记", async () => {
    const { api, writes } = vault(["进行中", "已暂停", "已完成"]);
    expect(await removeProjectStatus(api, "已暂停")).toEqual(["进行中", "已完成"]);
    expect(writes).toEqual([["进行中", "已完成"]]);
  });

  it("菜单只列词表里还剩的那些，删掉的不会因为内置写死了又冒出来", () => {
    // 「已完成」被删了：菜单里就不该再有它，自定义的排在三档后面
    expect(projectStatusOptions("question", ["未开始", "进行中", "复现中"]))
      .toEqual(["未开始", "进行中", "复现中"]);
    // 词表整个空的（老 vault / schema 读不出来）才用那三档兜底
    expect(projectStatusOptions("question", [])).toEqual(["未开始", "进行中", "已完成"]);
  });

  it("老 vault 里按分类播的那十几个词，一次性收回", async () => {
    const { api, writes } = vault(["待解决", "研究中", "已解决", "进行中", "复现中"]);
    // 我们播的种由我们收回；用户自己加的「复现中」一个字不动
    expect(await ensureProjectStatusSchema(api)).toEqual(["未开始", "进行中", "已完成", "复现中"]);
    expect(writes).toHaveLength(1);

    // 收回过一次就不再动 —— 用户事后自己把「已解决」加回来也不会被二次清掉
    const after = vault(["未开始", "进行中", "已完成", "已解决"]);
    expect(await ensureProjectStatusSchema(after.api)).toEqual([
      "未开始", "进行中", "已完成", "已解决",
    ]);
    expect(after.writes).toHaveLength(0);
  });
});

describe("置顶与换分类", () => {
  it("置顶的排前面，其余仍按最近改动", async () => {
    const project = note("项目.md", { type: "project" });
    const disk = new Map([
      ["项目/实验/新的.md", note("项目/实验/新的.md", { type: "experiment" }, "", 30)],
      ["项目/实验/旧的.md", note("项目/实验/旧的.md", { type: "experiment", pinned: true }, "", 10)],
      ["项目/实验/中间.md", note("项目/实验/中间.md", { type: "experiment" }, "", 20)],
    ]);
    const result = await loadProjectOverview(
      { readNote: async (path) => disk.get(path)! },
      project,
      [...disk.keys()].map((path) => ({ path, name: path })),
    );
    expect(result.items.map((item) => item.title)).toEqual(["旧的", "新的", "中间"]);
    expect(result.items[0].pinned).toBe(true);
  });

  it("置顶压过一切，其次是「还没结束的」，最后才按创建时间", () => {
    const row = (title: string, extra: Partial<ProjectItem>): ProjectItem => ({
      path: `${title}.md`, id: null, title, section: "实验", kind: null,
      status: "", summary: "", pinned: false, mtimeMs: 0, ...extra,
    });
    const rows = [
      row("已完成的", { status: "已完成", id: "01F" }),
      row("刚建的", { status: "进行中", id: "01E" }),
      row("很早建的", { status: "待解决", id: "01A" }),
      row("置顶但已完成", { status: "已完成", id: "01B", pinned: true }),
    ];
    expect(sortProjectItems([...rows]).map((r) => r.title)).toEqual([
      "置顶但已完成", "刚建的", "很早建的", "已完成的",
    ]);
  });

  it("改状态不该让一条跳到最前面 —— 那正是按修改时间排的毛病", () => {
    const base = (title: string, id: string, status: string, mtimeMs: number): ProjectItem => ({
      path: `${title}.md`, id, title, section: "问题", kind: "question",
      status, summary: "", pinned: false, mtimeMs,
    });
    // 「乙」刚被改过状态，所以它的 mtime 最新
    const rows = [
      base("甲", "01A", "待解决", 1),
      base("乙", "01B", "研究中", 999),
      base("丙", "01C", "待解决", 2),
    ];
    // 创建时间新的在前，而不是刚改过的在前
    expect(sortProjectItems([...rows]).map((r) => r.title)).toEqual(["丙", "乙", "甲"]);
  });

  it("置顶先把 pinned 声明成 checkbox，取消则整行删掉", async () => {
    const defs: [string, unknown][] = [];
    const props: [string, string, string | null][] = [];
    const api = {
      propSet: async (path: string, key: string, value: string | null) => { props.push([path, key, value]); },
      propDefSet: async (key: string, def: unknown) => { defs.push([key, def]); },
    };
    await setProjectPinned(api, "项目/实验/甲.md", true);
    await setProjectPinned(api, "项目/实验/甲.md", false);
    expect(defs).toEqual([["pinned", { type: "checkbox" }], ["pinned", { type: "checkbox" }]]);
    expect(props).toEqual([
      ["项目/实验/甲.md", "pinned", "true"],
      ["项目/实验/甲.md", "pinned", null],
    ]);
  });

  it("换分类要先建出目标分类首页，并把 type 一起改掉", async () => {
    const created: [string | null, string][] = [];
    const props: [string, string, string | null][] = [];
    const target = await prepareItemMove(
      {
        createNote: async (parent, title) => { created.push([parent, title]); return { path: `${parent!.replace(/\.md$/, "")}/${title}.md`, title, id: null }; },
        propSet: async (path, key, value) => { props.push([path, key, value]); },
      },
      "项目.md",
      "项目/决策/某项决定.md",
      "问题",
    );
    expect(target).toBe("项目/问题.md");
    expect(created).toEqual([["项目.md", "问题"]]);
    // type 不跟着改的话，database 视图里 `where type = "decision"` 还会把它捞出来
    expect(props).toContainEqual(["项目/决策/某项决定.md", "type", "question"]);
  });

  it("自定义分类用分类名当 type", async () => {
    const props: [string, string, string | null][] = [];
    await prepareItemMove(
      {
        createNote: async (parent, title) => ({ path: `${parent!.replace(/\.md$/, "")}/${title}.md`, title, id: null }),
        propSet: async (path, key, value) => { props.push([path, key, value]); },
      },
      "项目.md",
      "项目/实验/甲.md",
      "复现",
    );
    expect(props).toContainEqual(["项目/实验/甲.md", "type", "复现"]);
  });
});
