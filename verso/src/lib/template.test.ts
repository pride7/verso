import { describe, expect, it } from "vitest";

import { expandTemplate, formatWith, pickTemplates } from "./template";

const NOW = new Date(2026, 7, 1, 9, 5, 3); // 2026-08-01 09:05:03 本地时间
const ctx = (over: Partial<Parameters<typeof expandTemplate>[1]> = {}) => ({
  title: "会议纪要",
  path: "工作/会议纪要.md",
  selection: "",
  now: NOW,
  ...over,
});

describe("formatWith", () => {
  it("常用 token", () => {
    expect(formatWith(NOW, "YYYY-MM-DD")).toBe("2026-08-01");
    expect(formatWith(NOW, "HH:mm:ss")).toBe("09:05:03");
    expect(formatWith(NOW, "YY/M/D H:m")).toBe("26/8/1 9:5");
  });

  it("中文格式串直接能用 —— 非 token 的字符原样留着", () => {
    expect(formatWith(NOW, "YYYY年M月D日")).toBe("2026年8月1日");
  });

  it("长 token 优先，否则 YYYY 会被 YY 啃掉两位", () => {
    expect(formatWith(NOW, "YYYY")).toBe("2026");
    expect(formatWith(NOW, "YYYYMMDD")).toBe("20260801");
  });
});

describe("expandTemplate", () => {
  it("基本变量", () => {
    const r = expandTemplate("# {{title}}\n\n{{date}} {{time}}\n路径：{{path}}", ctx());
    expect(r.text).toBe("# 会议纪要\n\n2026-08-01 09:05\n路径：工作/会议纪要.md");
    expect(r.cursor).toBeNull();
  });

  it("带格式的日期", () => {
    expect(expandTemplate("{{date:YYYY年M月D日}}", ctx()).text).toBe("2026年8月1日");
    expect(expandTemplate("{{time:HH点mm分}}", ctx()).text).toBe("09点05分");
  });

  it("{{cursor}} 不留下字符，只报位置", () => {
    const r = expandTemplate("## 待办\n- {{cursor}}\n\n## 备注", ctx());
    expect(r.text).toBe("## 待办\n- \n\n## 备注");
    expect(r.cursor).toBe("## 待办\n- ".length);
  });

  it("写了两个 {{cursor}} 只认第一个，第二个原样留着", () => {
    // 光标只有一个。悄悄吃掉第二个的话，用户不知道自己写错了
    const r = expandTemplate("a{{cursor}}b{{cursor}}c", ctx());
    expect(r.text).toBe("ab{{cursor}}c");
    expect(r.cursor).toBe(1);
  });

  it("{{selection}} 拿的是插入时选中的文字", () => {
    const r = expandTemplate("> [!note]\n> {{selection}}", ctx({ selection: "要点" }));
    expect(r.text).toBe("> [!note]\n> 要点");
  });

  it("认不出来的变量原样留着，不替换成空", () => {
    // 从别处抄来的模板会有 Templater 的写法。替换成空 = 少了一块还不知道少在哪
    const r = expandTemplate("{{tp.file.title}} 和 {{未知}}", ctx());
    expect(r.text).toBe("{{tp.file.title}} 和 {{未知}}");
  });

  it("空格容错：{{ title }} 也认", () => {
    expect(expandTemplate("{{ title }}", ctx()).text).toBe("会议纪要");
  });

  it("没有变量的模板原样返回", () => {
    const src = "就是一段普通正文\n\n- 甲\n- 乙\n";
    expect(expandTemplate(src, ctx()).text).toBe(src);
  });
});

describe("pickTemplates", () => {
  const notes = [
    { path: "templates/日记.md", name: "日记" },
    { path: "templates/会议/纪要.md", name: "纪要" },
    { path: "论文/甲.md", name: "甲" },
    { path: "templates-旧/乙.md", name: "乙" },
  ];

  it("只收模板目录下的，且不误伤前缀相同的目录", () => {
    const t = pickTemplates(notes, "templates");
    expect(t.map((x) => x.path)).toEqual(["templates/会议/纪要.md", "templates/日记.md"]);
  });

  it("名字保留子目录 —— 模板一多就是靠目录分类的", () => {
    expect(pickTemplates(notes, "templates").map((x) => x.name)).toContain("会议/纪要");
  });

  it("填成 `templates/` 或 `/templates` 都认", () => {
    for (const dir of ["templates/", "/templates", " templates "]) {
      expect(pickTemplates(notes, dir)).toHaveLength(2);
    }
  });

  it("目录设成空就是一个都没有", () => {
    expect(pickTemplates(notes, "")).toEqual([]);
  });
});
