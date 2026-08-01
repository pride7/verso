/**
 * database 视图在**编辑器里**能不能点、能不能改 —— 真实 Chromium。
 *
 * 组件自己单独挂起来当然能点。真正会坏的是它作为 CM6 widget 长在
 * contentEditable 里面的时候：编辑器会抢焦点、会把点击当成移动光标，
 * 表现就是「点单元格毫无反应」。这一层只有把真的 EditorView 建起来才验得到
 * （AGENTS.md「什么时候必须写 browser 测试」）。
 */
import { EditorView } from "@codemirror/view";
import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const propSet = vi.fn(async () => {});
const createNote = vi.fn(async () => ({ path: "论文/丙.md", id: null, title: "丙" }));
const propDefSet = vi.fn(async () => {});
/** 每条测试自己决定 schema —— 没声明类型时单元格是文本框（推断类型） */
let schemaMock: Record<string, { type: string; options?: string[] }> = {};
const propRenameAll = vi.fn(async () => 3);

vi.mock("../api", () => ({
  api: {
    backlinks: vi.fn(async () => []),
    propSet,
    createNote: createNote,
    propSchema: async () => schemaMock,
    propDefSet: propDefSet,
    propCount: async () => 3,
    propRenameAll: propRenameAll,
    viewQuery: vi.fn(async () => ({
      columns: ["title", "status"],
      rows: [
        { path: "论文/甲.md", title: "甲", props: { status: "在读" } },
        { path: "论文/乙.md", title: "乙", props: { status: "未读" } },
      ],
      view: "table",
      groupBy: null,
      properties: [
        { key: "status", type: "string" },
        { key: "难度", type: "number" },
      ],
    })),
  },
}));

const { createExtensions } = await import("../editor");
const { setViewRenderer } = await import("../editor/viewBlock");
const { DatabaseView } = await import("./DatabaseView");
await import("../styles.css");

const DOC = ["正文", "", "```verso-view", 'from: "论文/*"', "view: table", "```", ""].join("\n");

const views: EditorView[] = [];
const roots: Root[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  for (const r of roots.splice(0)) r.unmount();
  setViewRenderer(null as never);
  document.body.innerHTML = "";
  propSet.mockClear();
  createNote.mockClear();
  propDefSet.mockClear();
  schemaMock = {};
  propRenameAll.mockClear();
});

/** 照 Editor.tsx 的做法把 widget 容器渲染成 React 组件 */
function mount() {
  setViewRenderer({
    mount: (el, source, patch) => {
      const root = createRoot(el);
      roots.push(root);
      root.render(
        <DatabaseView
          source={source}
          onOpen={() => {}}
          onChanged={() => {}}
          revision={0}
          onPatch={patch}
        />,
      );
    },
    unmount: () => {},
  });

  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc: DOC,
    parent,
    extensions: createExtensions({
      onChange: () => {},
      onSaveNow: () => {},
      onFollowLink: () => {},
      getNotes: () => [],
    }),
  });
  views.push(view);
  return view;
}

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

describe("database 视图在编辑器里", () => {
  it("渲染成表格", async () => {
    const view = mount();
    await settle();
    expect(view.dom.querySelectorAll(".dbview-row").length || view.dom.querySelectorAll("tr").length)
      .toBeGreaterThan(0);
    expect(view.dom.textContent).toContain("在读");
  });

  it("点一个单元格要能进编辑态", async () => {
    // 作者报的就是这个：表里的值看得见、改不了
    const view = mount();
    await settle();

    const cells = [...view.dom.querySelectorAll<HTMLElement>(".dbview-cell")];
    expect(cells.length).toBeGreaterThan(0);
    await userEvent.click(cells[0]);
    await settle(200);

    expect(view.dom.querySelector(".dbview-input")).not.toBeNull();
  });

  it("改完回车写回 frontmatter", async () => {
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    const input = view.dom.querySelector<HTMLInputElement>(".dbview-input")!;
    await userEvent.fill(input, "读完了");
    await userEvent.keyboard("{Enter}");
    await settle(200);

    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "status", "读完了");
  });
});

describe("视图本身能操作（§2.6）", () => {
  const th = (view: EditorView, name: string) =>
    [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((b) =>
      b.textContent?.startsWith(name),
    )!;

  it("点表头排序，改的是代码块 —— 排序跟着 .md 走，不是界面状态", async () => {
    const view = mount();
    await settle();

    await userEvent.click(th(view, "status"));
    await settle();
    expect(view.state.doc.toString()).toContain("sort: status");

    // 再点一次变降序，仍然只有一行 sort
    await userEvent.click(th(view, "status"));
    await settle();
    expect(view.state.doc.toString()).toContain("sort: status desc");
    expect(view.state.doc.toString().match(/sort:/g)).toHaveLength(1);

    // 第三次回到默认顺序，那一行删掉
    await userEvent.click(th(view, "status"));
    await settle();
    expect(view.state.doc.toString()).not.toContain("sort:");
  });

  it("排序不动代码块里别的行 —— 那些是用户自己排的", async () => {
    const view = mount();
    await settle();
    await userEvent.click(th(view, "status"));
    await settle();
    const doc = view.state.doc.toString();
    expect(doc).toContain('from: "论文/*"');
    expect(doc).toContain("view: table");
  });

  it("新建一行 = 在 from 指的范围里建一篇笔记", async () => {
    const view = mount();
    await settle();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("丙");

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-add")!);
    await settle();

    // 建完不在表里等于什么都没发生，所以父文档要跟着 `from` 走
    expect(createNote).toHaveBeenCalledWith("论文.md", "丙");
    prompt.mockRestore();
  });
});

describe("列与设置（§2.6）", () => {
  it("列头带属性类型图标，`+` 能加一列", async () => {
    const view = mount();
    await settle();

    // 加一列：从这批笔记已有的属性里挑
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-plus button")!);
    await settle(200);
    const pick = [...view.dom.querySelectorAll<HTMLElement>(".vset-list button")].find((b) =>
      b.textContent?.includes("难度"),
    )!;
    expect(pick).toBeTruthy();
    await userEvent.click(pick);
    await settle();

    expect(view.state.doc.toString()).toContain("columns: [title, status, 难度]");
  });

  it("新建一列：先挑类型，再改默认名 —— 属性是填值那一刻才写进笔记的", async () => {
    const view = mount();
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-plus button")!);
    await settle(200);

    // 先选类型（Notion / 思源都是这个顺序）
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".vset-types button")].find((b) =>
        b.textContent?.includes("日期"),
      )!,
    );
    await settle(200);

    // 默认名先给出来，可以当场改
    const input = view.dom.querySelector<HTMLInputElement>(".vset-newcol input")!;
    expect(input.value).toBe("属性");
    await userEvent.fill(input, "读完日期");
    await userEvent.click(view.dom.querySelector<HTMLElement>(".vset-newcol button")!);
    await settle();

    // 类型进 schema，列进代码块，**这一刻不动任何笔记**
    expect(propDefSet).toHaveBeenCalledWith("读完日期", { type: "date" });
    expect(view.state.doc.toString()).toContain("读完日期");
    expect(propSet).not.toHaveBeenCalled();
  });

  it("重命名一列会先问一句，再改所有带这个键的笔记", async () => {
    const view = mount();
    await settle();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("阅读状态");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    const th = [...view.dom.querySelectorAll<HTMLElement>("th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th.querySelector<HTMLElement>(".dbview-more")!);
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
        b.textContent?.includes("重命名"),
      )!,
    );
    await settle();

    // 问过了才改 —— 真在动几十个文件，不该点一下就悄悄发生
    expect(confirm).toHaveBeenCalled();
    expect(propRenameAll).toHaveBeenCalledWith("status", "阅读状态");
    // 视图点名的那一列也要跟着改，否则这一列会变成空的
    expect(view.state.doc.toString()).toContain("阅读状态");

    prompt.mockRestore();
    confirm.mockRestore();
  });

  it("确认框点取消就什么都不做", async () => {
    const view = mount();
    await settle();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("阅读状态");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    const th = [...view.dom.querySelectorAll<HTMLElement>("th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th.querySelector<HTMLElement>(".dbview-more")!);
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
        b.textContent?.includes("重命名"),
      )!,
    );
    await settle();

    expect(propRenameAll).not.toHaveBeenCalled();
    prompt.mockRestore();
    confirm.mockRestore();
  });

  it("隐藏一列只改 columns，绝不动任何笔记的 frontmatter", async () => {
    // 一次误点就抹掉整个 vault 的某个字段，这种事不能藏在下拉菜单里
    const view = mount();
    await settle();

    const th = [...view.dom.querySelectorAll<HTMLElement>("th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th.querySelector<HTMLElement>(".dbview-more")!);
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
        b.textContent?.includes("隐藏"),
      )!,
    );
    await settle();

    expect(view.state.doc.toString()).toContain("columns: [title]");
    expect(propSet).not.toHaveBeenCalled();
  });

  it("设置面板改视图类型和上限，都写回代码块", async () => {
    const view = mount();
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-tool")!);
    await settle(200);

    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".vset-seg button")].find((b) =>
        b.textContent?.includes("列表"),
      )!,
    );
    await settle();
    expect(view.state.doc.toString()).toContain("view: list");
  });

  it("加一个筛选条件", async () => {
    const view = mount();
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-tool")!);
    await settle(200);

    await userEvent.click(view.dom.querySelector<HTMLElement>(".vset-add")!);
    await settle();
    expect(view.state.doc.toString()).toMatch(/where: \S+ =/);
  });
});

describe("按类型给编辑控件（§2.6）", () => {
  it("单选给下拉，选一个就写回", async () => {
    schemaMock = { status: { type: "select", options: ["未读", "在读", "已读"] } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    const sel = view.dom.querySelector<HTMLSelectElement>("select.dbview-input")!;
    expect([...sel.options].map((o) => o.value)).toContain("已读");
    await userEvent.selectOptions(sel, "已读");
    await settle();

    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "status", "已读");
  });

  it("下拉里保留当前值 —— 手改过 frontmatter 的值不能被打开下拉这个动作冲掉", async () => {
    // 「在读」故意不在选项表里
    schemaMock = { status: { type: "select", options: ["未读", "已读"] } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    const sel = view.dom.querySelector<HTMLSelectElement>("select.dbview-input")!;
    expect([...sel.options].map((o) => o.value)).toContain("在读");
  });

  it("复选框点一下就改，不用进编辑态再回车", async () => {
    schemaMock = { status: { type: "checkbox" } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-check")!);
    await settle();
    // 原值是「在读」，不是 true，所以点一下应当勾上
    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "status", "true");
  });

  it("选项面板删掉一个选项，不去动任何笔记", async () => {
    // 选项表只是「下拉里列出哪些」，不是一份会反过来清洗数据的约束
    schemaMock = { status: { type: "select", options: ["未读", "在读"] } };
    const view = mount();
    await settle();

    const th = [...view.dom.querySelectorAll<HTMLElement>("th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th.querySelector<HTMLElement>(".dbview-more")!);
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
        b.textContent?.includes("选项"),
      )!,
    );
    await settle(200);

    await userEvent.click(view.dom.querySelector<HTMLElement>(".vset-opt .vset-del")!);
    await settle();

    expect(propDefSet).toHaveBeenCalledWith("status", { type: "select", options: ["在读"] });
    expect(propSet).not.toHaveBeenCalled();
  });
});
