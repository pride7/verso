import { describe, expect, it } from "vitest";

import {
  captureProjectEntry,
  DEFAULT_SECTIONS,
  loadProjectOverview,
  parseProgress,
  projectDocumentTemplate,
  projectSections,
  sectionNameError,
  setProjectSections,
  type ProjectApi,
} from "./project";
import type { NoteContent, NoteMeta } from "../types";

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
