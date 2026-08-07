import { describe, expect, it } from "vitest";

import {
  captureProjectEntry,
  loadProjectOverview,
  parseProgress,
  projectDocumentTemplate,
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
    const api: ProjectApi = {
      readNote: async (path) => note(path),
      createNote: async (parent, title): Promise<NoteMeta> => {
        const path = parent ? `${parent.replace(/\.md$/, "")}/${title}.md` : `${title}.md`;
        created.push(path);
        return { path, title, id: null };
      },
      writeNote: async (path, body) => { writes.push([path, body]); return 1; },
      propSet: async (path, key, value) => { props.push([path, key, value]); },
    };
    const path = await captureProjectEntry(api, "项目.md", { kind: "experiment", title: "消融", content: "去掉路由后下降 3%。", useTemplate: true });
    expect(path).toBe("项目/实验/消融.md");
    expect(created).toEqual(["项目/实验.md", "项目/实验/消融.md"]);
    expect(writes[0][0]).toBe(path);
    expect(writes[0][1]).toContain("## 目标与假设");
    expect(writes[0][1]).toContain("去掉路由后下降 3%。");
    expect(writes[0][1]).toContain("## 观察与结果");
    expect(props).toContainEqual([path, "type", "experiment"]);
  });

  it("复杂记录允许只有标题，正文得到可删改的轻量模板", async () => {
    expect(projectDocumentTemplate("question")).toContain("## 背景与已知事实");
    expect(projectDocumentTemplate("decision")).toContain("## 证据与权衡");
    expect(projectDocumentTemplate("resource")).toContain("## 与项目的关系");
  });

  it("新研究文档默认不强加模板", async () => {
    const writes: string[] = [];
    const api: ProjectApi = {
      readNote: async (path) => note(path),
      createNote: async (parent, title) => ({ path: `${parent!.replace(/\.md$/, "")}/${title}.md`, title, id: null }),
      writeNote: async (_path, body) => { writes.push(body); return 1; },
      propSet: async () => {},
    };
    await captureProjectEntry(api, "项目.md", { kind: "question", title: "为什么", content: "一句摘要" });
    expect(writes[0]).toBe("一句摘要\n");
    expect(writes[0]).not.toContain("## ");
  });
});
