/**
 * database 视图在**编辑器里**能不能点、能不能改 —— 真实 Chromium。
 *
 * 组件自己单独挂起来当然能点。真正会坏的是它作为 CM6 widget 长在
 * contentEditable 里面的时候：编辑器会抢焦点、会把点击当成移动光标，
 * 表现就是「点单元格毫无反应」。这一层只有把真的 EditorView 建起来才验得到
 * （AGENTS.md「什么时候必须写 browser 测试」）。
 */
import { EditorView } from "@codemirror/view";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const propSet = vi.fn(async () => {});
const createNote = vi.fn(async () => ({ path: "论文/丙.md", id: null, title: "丙" }));
/** 加一行不再问名字，直接建一篇「未命名」再就地改（和文档树一致） */
const createUntitled = vi.fn(async (_parent: string | null) => {
  // 后端建完之后，下一次 viewQuery 就该看得见这一行 —— 就地改名要改的
  // 正是它，行不出现的话输入框根本没地方挂
  viewMock = { ...viewMock, rows: [...viewMock.rows, NEW_ROW] };
  return { path: NEW_ROW.path, id: null, title: NEW_ROW.title };
});
const renameNote = vi.fn(async (_path: string, _title: string) => "论文/丙.md");
const NEW_ROW = { path: "论文/未命名.md", title: "未命名", props: {} };
const propDefSet = vi.fn(async () => {});
/** 每条测试自己决定 schema —— 没声明类型时单元格是文本框（推断类型） */
let schemaMock: Record<string, { type: string; options?: string[] }> = {};
const DEFAULT_VIEW = {
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
};
let viewMock: {
  columns: string[];
  rows: { path: string; title: string; props: Record<string, string> }[];
  view: string;
  groupBy: string | null;
  properties: { key: string; type: string }[];
} = DEFAULT_VIEW;
const propRenameAll = vi.fn(async () => 3);

/**
 * 确认框走 `lib/dialog` 而不是 `window.confirm` —— 见 `noGlobalDialog.test.ts`。
 * 这里必须 mock：真的那个要发 Tauri IPC，浏览器里没有。
 */
const confirmMock = vi.fn(async (_message: string) => true);
vi.mock("../lib/dialog", () => ({ confirm: (m: string) => confirmMock(m) }));

vi.mock("../api", () => ({
  api: {
    backlinks: vi.fn(async () => []),
    propSet,
    createNote: createNote,
    createUntitled: (parent: string | null) => createUntitled(parent),
    renameNote: (path: string, title: string) => renameNote(path, title),
    propSchema: async () => schemaMock,
    propDefSet: propDefSet,
    propCount: async () => 3,
    propRenameAll: propRenameAll,
    viewQuery: vi.fn(async () => viewMock),
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
  createUntitled.mockClear();
  renameNote.mockClear();
  propDefSet.mockClear();
  schemaMock = {};
  viewMock = DEFAULT_VIEW;
  propRenameAll.mockClear();
  opened.length = 0;
  coverAsked.length = 0;
});

/** 被点开过哪些笔记。每条测试自己清 */
const opened: string[] = [];
/** 画廊问过哪些封面路径 */
const coverAsked: string[] = [];
/** 1×1 的透明 PNG。**必须是真能加载的** —— 加载失败的封面会退回占位块，
    那正是「封面文件不在了」的正常行为，用假 URL 会把它当成 bug 测出来 */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 照 Editor.tsx 的做法把 widget 容器渲染成 React 组件 */
function mount(spec?: string, imageSrc?: (t: string) => string | null) {
  setViewRenderer({
    mount: (el, source, patch) => {
      const root = createRoot(el);
      roots.push(root);
      root.render(
        <DatabaseView
          source={source}
          onOpen={(p) => opened.push(p)}
          onChanged={() => {}}
          revision={0}
          onPatch={patch}
          // 画廊的封面：真实的解析器在 App 里，这里只记下它问的是哪个路径
          imageSrc={(t) => {
            coverAsked.push(t);
            return imageSrc ? imageSrc(t) : PIXEL;
          }}
        />,
      );
    },
    unmount: () => {},
  });

  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc: spec ? ["正文", "", "```verso-view", spec, "```", ""].join("\n") : DOC,
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

  /** 打开某一列的菜单，点里面某一项 */
  async function menu(view: EditorView, col: string, item: string) {
    await userEvent.click(th(view, col));
    await settle(200);
    const hit = [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
      b.textContent?.includes(item),
    )!;
    expect(hit, `这一列的菜单里该有「${item}」`).toBeTruthy();
    await userEvent.click(hit);
    await settle();
  }

  /**
   * **点列头开菜单，不直接排序。**
   *
   * 点一下就改文件的设计，误触的代价是一次真实的改动；而且排序之外的操作
   * 会被迫全塞进一个 `⋮` 里。思源、Notion 都是点列头开菜单。
   */
  it("点列头开的是菜单，不是直接排序", async () => {
    const view = mount();
    await settle();

    await userEvent.click(th(view, "status"));
    await settle(200);
    expect(view.dom.querySelector(".dbview-menu"), "该弹出这一列的菜单").not.toBeNull();
    expect(view.state.doc.toString(), "只是打开菜单，不该动文件").not.toContain("sort:");
  });

  it("菜单里选升序/降序，改的是代码块 —— 排序跟着 .md 走，不是界面状态", async () => {
    const view = mount();
    await settle();

    await menu(view, "status", "升序");
    expect(view.state.doc.toString()).toContain("sort: status");

    await menu(view, "status", "降序");
    expect(view.state.doc.toString()).toContain("sort: status desc");
    // 仍然只有一行 sort
    expect(view.state.doc.toString().match(/sort:/g)).toHaveLength(1);

    // 「取消排序」只在这一列正排着的时候出现
    await menu(view, "status", "取消排序");
    expect(view.state.doc.toString()).not.toContain("sort:");
  });

  it("排序不动代码块里别的行 —— 那些是用户自己排的", async () => {
    const view = mount();
    await settle();
    await menu(view, "status", "升序");
    const doc = view.state.doc.toString();
    expect(doc).toContain('from: "论文/*"');
    expect(doc).toContain("view: table");
  });

  /**
   * **不弹窗问名字**（v0.6.4）。Obsidian、思源都是先把东西建出来再改名 ——
   * 弹窗那一步逼人在什么都还没有的时候先想好名字，而在一张表里加一行时，
   * 名字往往是填完别的格子才定得下来的。
   */
  it("新建一行：直接建，名字在行里就地改", async () => {
    const view = mount();
    await settle();
    const prompt = vi.spyOn(window, "prompt");

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-add")!);
    await settle();

    expect(prompt, "不该再弹窗问名字").not.toHaveBeenCalled();
    // 建完不在表里等于什么都没发生，所以父文档要跟着 `from` 走
    expect(createUntitled).toHaveBeenCalledWith("论文.md");

    // 那一行的标题格变成输入框，而且内容是选中的（打字直接覆盖）
    const input = view.dom.querySelector<HTMLInputElement>(".dbview-rename")!;
    expect(input).toBeTruthy();
    expect(input.value).toBe("未命名");

    input.value = "丙";
    await userEvent.keyboard("{Enter}");
    await settle();
    expect(renameNote).toHaveBeenCalledWith("论文/未命名.md", "丙");
    prompt.mockRestore();
  });

  it("改名框里没改就按回车 = 保留「未命名」，不白跑一次改名", async () => {
    const view = mount();
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-add")!);
    await settle();

    await userEvent.keyboard("{Enter}");
    await settle();
    expect(renameNote).not.toHaveBeenCalled();
    expect(view.dom.querySelector(".dbview-rename"), "回车之后要退出改名态").toBeNull();
  });

  /** Esc = 我就叫「未命名」。**笔记已经建出来了**，取消的只是改名这一步 */
  it("按 Esc 只是不改名，不会把刚建的那篇删掉", async () => {
    const view = mount();
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-add")!);
    await settle();

    await userEvent.keyboard("{Escape}");
    await settle();
    expect(renameNote).not.toHaveBeenCalled();
    expect(createUntitled).toHaveBeenCalledTimes(1);
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
    confirmMock.mockResolvedValue(true);

    const th = [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th);
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
        b.textContent?.includes("重命名"),
      )!,
    );
    await settle();

    // 问过了才改 —— 真在动几十个文件，不该点一下就悄悄发生
    expect(confirmMock).toHaveBeenCalled();
    expect(propRenameAll).toHaveBeenCalledWith("status", "阅读状态");
    // 视图点名的那一列也要跟着改，否则这一列会变成空的
    expect(view.state.doc.toString()).toContain("阅读状态");

    prompt.mockRestore();
  });

  it("确认框点取消就什么都不做", async () => {
    const view = mount();
    await settle();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("阅读状态");
    confirmMock.mockResolvedValue(false);

    const th = [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th);
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
        b.textContent?.includes("重命名"),
      )!,
    );
    await settle();

    expect(propRenameAll).not.toHaveBeenCalled();
    prompt.mockRestore();
    confirmMock.mockResolvedValue(true);
  });

  it("隐藏一列只改 columns，绝不动任何笔记的 frontmatter", async () => {
    // 一次误点就抹掉整个 vault 的某个字段，这种事不能藏在下拉菜单里
    const view = mount();
    await settle();

    const th = [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th);
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
  it("单选：点开就能挑，选一个写回", async () => {
    schemaMock = { status: { type: "select", options: ["未读", "在读", "已读"] } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".optpick-list button")].find((b) =>
        b.textContent?.includes("已读"),
      )!,
    );
    await settle();

    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "status", "已读");
  });

  it("在单元格里就能新建选项 —— 填值那一刻才知道自己要哪个", async () => {
    schemaMock = { status: { type: "select", options: ["未读"] } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    await userEvent.fill(view.dom.querySelector<HTMLInputElement>(".optpick-q")!, "读了一半");
    await settle(100);
    await userEvent.click(view.dom.querySelector<HTMLElement>(".optpick-new")!);
    await settle();

    expect(propDefSet).toHaveBeenCalledWith("status", {
      type: "select",
      options: ["未读", "读了一半"],
    });
    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "status", "读了一半");
  });

  it("当前值一定在列表里 —— 手改过 frontmatter 的值不能被打开面板冲掉", async () => {
    schemaMock = { status: { type: "select", options: ["未读", "已读"] } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    const labels = [...view.dom.querySelectorAll(".optpick-list button")].map((b) => b.textContent);
    expect(labels.some((t) => t?.includes("在读"))).toBe(true);
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

    const th = [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((t) =>
      t.textContent?.includes("status"),
    )!;
    await userEvent.click(th);
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

describe("在单元格里现建选项（§2.6）", () => {
  it("单选列一个选项都没有时，输入就能新建并选上", async () => {
    // 填值那一刻才是知道自己需要哪个选项的时刻 —— 先去列头菜单配好再回来
    // 填，是这类表格最烦人的地方
    schemaMock = { status: { type: "select" } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    await userEvent.fill(view.dom.querySelector<HTMLInputElement>(".optpick-q")!, "读完了");
    await settle(100);
    await userEvent.click(view.dom.querySelector<HTMLElement>(".optpick-new")!);
    await settle();

    // 选项进 schema，值进那篇笔记
    expect(propDefSet).toHaveBeenCalledWith("status", { type: "select", options: ["读完了"] });
    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "status", "读完了");
  });

  it("回车等于点「新建」", async () => {
    schemaMock = { status: { type: "select", options: ["未读"] } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    await userEvent.fill(view.dom.querySelector<HTMLInputElement>(".optpick-q")!, "在读中");
    await userEvent.keyboard("{Enter}");
    await settle();

    expect(propDefSet).toHaveBeenCalledWith("status", {
      type: "select",
      options: ["未读", "在读中"],
    });
  });

  it("当前值即使不在选项表里也列出来 —— 手改过的 frontmatter 不能被冲掉", async () => {
    schemaMock = { status: { type: "select", options: ["未读", "已读"] } };
    const view = mount();
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-cell")!);
    await settle(200);
    const labels = [...view.dom.querySelectorAll(".optpick-list .dbview-tag")].map(
      (t) => t.textContent,
    );
    expect(labels).toContain("在读");
  });
});

describe("文件自己的时间（内置列）", () => {
  it("创建/更新时间显示成日期，而且改不了", async () => {
    // 它们不在 frontmatter 里（§2.3 起不往笔记里写），摆一个改不动的输入框
    // 比不给输入框更让人困惑
    viewMock = {
      columns: ["title", "created"],
      rows: [
        {
          path: "论文/甲.md",
          title: "甲",
          props: { created: "2026-06-06T21:04:11+08:00" },
        },
      ],
      view: "table",
      groupBy: null,
      properties: [{ key: "created", type: "date" }],
    };
    const view = mount();
    await settle();

    const cell = view.dom.querySelector<HTMLElement>(".dbview-ro")!;
    expect(cell.textContent).toBe("2026-06-06");
    // 完整时刻留在 title 里，要比对到分秒时还能看
    expect(cell.getAttribute("title")).toContain("21:04:11");

    await userEvent.click(cell);
    await settle(200);
    expect(view.dom.querySelector(".dbview-input")).toBeNull();
    expect(propSet).not.toHaveBeenCalled();
  });
});

describe("表格宽度（§2.6）", () => {
  const widths = (view: EditorView) => {
    const box = view.dom.querySelector<HTMLElement>(".dbview")!;
    return {
      box: box.getBoundingClientRect().width,
      bar: view.dom.querySelector<HTMLElement>(".dbview-bar")!.getBoundingClientRect().width,
      table: view.dom.querySelector<HTMLElement>(".dbview-table")!.getBoundingClientRect().width,
      avail: box.parentElement!.getBoundingClientRect().width,
    };
  };

  it("默认按内容宽，不铺满 —— 三列的小表格拉满正文栏中间是一片空白", async () => {
    const view = mount();
    await settle();
    const w = widths(view);
    expect(w.box).toBeLessThan(w.avail - 20);
  });

  it("顶栏和表格同宽 —— 否则「新建」会飘在表格右边好远的地方", async () => {
    // 作者报的就是这个。收缩必须发生在**外框**那一层，只缩表格的话
    // 顶栏还是通栏的
    const view = mount();
    await settle();
    const w = widths(view);
    expect(Math.abs(w.bar - w.table)).toBeLessThan(2);
  });

  it("`width: full` 才铺满，而且是「至少铺满」不是「压进去」", async () => {
    // 用 width:100% 的话，长标题会被压成一排省略号 —— 作者要的是
    // 「仅针对显示得下的」
    const view = mount('from: "论文/*"\nview: table\nwidth: full');
    await settle();
    const w = widths(view);
    expect(w.box).toBeGreaterThanOrEqual(w.avail - 1);
    expect(Math.abs(w.bar - w.table)).toBeLessThan(2);
  });
});

describe("看板（§2.6）", () => {
  const BOARD = 'from: "论文/*"\nview: board\ngroup-by: status';

  function boardMock() {
    viewMock = {
      columns: ["title", "status", "作者"],
      rows: [
        { path: "论文/甲.md", title: "甲", props: { status: "在读", 作者: "Golub" } },
        { path: "论文/乙.md", title: "乙", props: { status: "未读", 作者: "张三" } },
        { path: "论文/丙.md", title: "丙", props: {} },
      ],
      view: "board",
      groupBy: "status",
      properties: [{ key: "status", type: "string" }],
    };
    schemaMock = { status: { type: "select", options: ["未读", "在读", "已读"] } };
  }

  it("按 schema 里的选项顺序列出所有列，空列也在", async () => {
    // 「未读/在读/已读」是有先后的；按出现次序排会让看板每次刷新换个样子，
    // 而空列消失意味着你没法把卡片拖进一个还没人用的状态
    boardMock();
    const view = mount(BOARD);
    await settle();

    const cols = [...view.dom.querySelectorAll(".dbview-col-head .dbview-tag")].map(
      (t) => t.textContent,
    );
    expect(cols.slice(0, 3)).toEqual(["未读", "在读", "已读"]);
    // 没写这个属性的落进「未设置」
    expect(cols).toContain("（未设置）");
  });

  it("拖到另一列 = 改那篇笔记的分组属性", async () => {
    boardMock();
    const view = mount(BOARD);
    await settle();

    const card = [...view.dom.querySelectorAll<HTMLElement>(".dbview-card")].find((c) =>
      c.textContent?.includes("甲"),
    )!;
    const target = [...view.dom.querySelectorAll<HTMLElement>(".dbview-col")].find((c) =>
      c.querySelector(".dbview-tag")?.textContent === "已读",
    )!;

    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await settle();

    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "status", "已读");
  });

  it("拖回原来那一列什么都不做 —— 别为一次没有变化的拖动改文件", async () => {
    boardMock();
    const view = mount(BOARD);
    await settle();

    const card = [...view.dom.querySelectorAll<HTMLElement>(".dbview-card")].find((c) =>
      c.textContent?.includes("甲"),
    )!;
    const same = [...view.dom.querySelectorAll<HTMLElement>(".dbview-col")].find((c) =>
      c.querySelector(".dbview-tag")?.textContent === "在读",
    )!;

    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    same.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await settle();

    expect(propSet).not.toHaveBeenCalled();
  });

  it("卡片上显示别的属性，但不显示分组那一列（整列都一样）", async () => {
    boardMock();
    const view = mount(BOARD);
    await settle();

    const card = [...view.dom.querySelectorAll<HTMLElement>(".dbview-card")].find((c) =>
      c.textContent?.includes("甲"),
    )!;
    expect(card.textContent).toContain("Golub");
    expect(card.querySelector(".dbview-card-props")?.textContent).not.toContain("status");
  });

  it("在某一列里新建，那一列的值直接写上 —— 否则建完掉进「未设置」", async () => {
    boardMock();
    const view = mount(BOARD);
    await settle();
    const target = [...view.dom.querySelectorAll<HTMLElement>(".dbview-col")].find((c) =>
      c.querySelector(".dbview-tag")?.textContent === "已读",
    )!;
    await userEvent.click(target.querySelector<HTMLElement>(".dbview-col-add")!);
    await settle();

    expect(createUntitled).toHaveBeenCalled();
    expect(propSet).toHaveBeenCalledWith("论文/未命名.md", "status", "已读");
  });
});

// ---------------------------------------------------------------- 另外三种视图

describe("列表视图（§2.6）", () => {
  const SPEC = ['from: "论文/*"', "view: list", "columns: [title, status]"].join("\n");

  function listMock() {
    viewMock = {
      columns: ["title", "status"],
      rows: [
        { path: "论文/甲.md", title: "甲", props: { status: "在读" } },
        { path: "论文/乙.md", title: "乙", props: {} },
      ],
      view: "list",
      groupBy: null,
      properties: [{ key: "status", type: "string" }],
    };
  }

  it("一行一篇，点标题打开那篇", async () => {
    listMock();
    const view = mount(SPEC);
    await settle();

    const items = view.dom.querySelectorAll(".dbv-list > li");
    expect(items).toHaveLength(2);

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbv-list-title")!);
    await settle(100);
    expect(opened).toEqual(["论文/甲.md"]);
  });

  it("空值的属性不画 —— 摆一排「—」只是噪音", async () => {
    listMock();
    const view = mount(SPEC);
    await settle();

    const [first, second] = view.dom.querySelectorAll<HTMLElement>(".dbv-list > li");
    expect(first.textContent).toContain("在读");
    expect(second.querySelector(".dbv-chips")).toBeNull();
  });
});

describe("画廊视图（§2.6）", () => {
  const SPEC = ['from: "论文/*"', "view: gallery", "cover: 封面"].join("\n");

  function galleryMock(cover?: string) {
    viewMock = {
      columns: ["title", "封面", "status"],
      rows: [
        {
          path: "论文/甲.md",
          title: "甲",
          props: { status: "在读", ...(cover ? { 封面: cover } : {}) },
        },
      ],
      view: "gallery",
      groupBy: null,
      properties: [
        { key: "status", type: "string" },
        { key: "封面", type: "string" },
      ],
    };
  }

  it("封面列的路径变成一张图", async () => {
    galleryMock("attachments/图.png");
    const view = mount(SPEC);
    await settle();

    expect(view.dom.querySelector(".dbv-tile-cover img")).toBeTruthy();
    // 解析器拿到的必须是 frontmatter 里那个路径原样
    expect(coverAsked).toContain("attachments/图.png");
  });

  it("顺手写成 ![[图.png]] 也认 —— frontmatter 里这么写其实不生效，但人就是会写", async () => {
    galleryMock("![[图.png]]");
    mount(SPEC);
    await settle();
    expect(coverAsked).toContain("图.png");
  });

  it("没有封面时给占位块，不是碎图标", async () => {
    galleryMock();
    const view = mount(SPEC);
    await settle();
    expect(view.dom.querySelector(".dbv-tile-blank")).not.toBeNull();
    // .cm-widgetBuffer 也是 <img>，所以只在封面那一块里找
    expect(view.dom.querySelector(".dbv-tile-cover img")).toBeNull();
  });

  it("封面文件不在了就退回占位块，不显示碎图标（§4.4 同理）", async () => {
    galleryMock("attachments/没了.png");
    const view = mount(SPEC, () => "data:image/png;base64,坏的");
    await settle();
    expect(view.dom.querySelector(".dbv-tile-blank")).not.toBeNull();
  });

  it("封面那一列不再重复显示成属性 —— 它已经是那张图了", async () => {
    galleryMock("attachments/图.png");
    const view = mount(SPEC);
    await settle();
    expect(view.dom.querySelector(".dbv-chips")?.textContent).not.toContain("封面");
    expect(view.dom.querySelector(".dbv-chips")?.textContent).toContain("在读");
  });
});

describe("日历视图（§2.6）", () => {
  const SPEC = ['from: "论文/*"', "view: calendar", "date-field: 读于"].join("\n");

  function calMock() {
    viewMock = {
      columns: ["title", "读于"],
      rows: [
        { path: "论文/甲.md", title: "甲", props: { 读于: "2026-03-04" } },
        { path: "论文/乙.md", title: "乙", props: { 读于: "2026-03-20T09:00:00+08:00" } },
        { path: "论文/丙.md", title: "丙", props: {} },
      ],
      view: "calendar",
      groupBy: null,
      properties: [{ key: "读于", type: "date" }],
    };
  }

  /** 某一天那一格 */
  const cellOf = (view: EditorView, day: string) =>
    [...view.dom.querySelectorAll<HTMLElement>(".dbv-cal-cell")].find(
      (c) => c.querySelector(".dbv-cal-day")?.textContent === day && !c.classList.contains("is-out"),
    )!;

  it("开在有笔记的那个月，而不是今天", async () => {
    // 日期全在去年的视图开在今天，等于开在一片空白上，看着像坏了
    calMock();
    const view = mount(SPEC);
    await settle();
    expect(view.dom.querySelector(".dbv-cal-title")?.textContent).toBe("2026 年 3 月");
  });

  it("笔记落在自己那一格，RFC3339 和纯日期一视同仁", async () => {
    calMock();
    const view = mount(SPEC);
    await settle();
    expect(cellOf(view, "4").textContent).toContain("甲");
    expect(cellOf(view, "20").textContent).toContain("乙");
  });

  it("没有日期的单独列出来，不是丢掉不显示", async () => {
    calMock();
    const view = mount(SPEC);
    await settle();
    expect(view.dom.querySelector(".dbv-cal-undated")?.textContent).toContain("丙");
  });

  it("翻月", async () => {
    calMock();
    const view = mount(SPEC);
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>('[aria-label="下一月"]')!);
    await settle(100);
    expect(view.dom.querySelector(".dbv-cal-title")?.textContent).toBe("2026 年 4 月");
  });

  it("拖到另一天 = 改那篇笔记的日期属性", async () => {
    calMock();
    const view = mount(SPEC);
    await settle();

    const item = [...view.dom.querySelectorAll<HTMLElement>(".dbv-cal-item")].find((i) =>
      i.textContent?.includes("甲"),
    )!;
    const target = cellOf(view, "11");

    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    target.dispatchEvent(
      new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
    await settle();

    expect(propSet).toHaveBeenCalledWith("论文/甲.md", "读于", "2026-03-11");
  });

  it("按内置的 created 摆时不给拖 —— 那是文件自己的时间，拖了也写不回去", async () => {
    calMock();
    const view = mount(['from: "论文/*"', "view: calendar"].join("\n"));
    await settle();

    const items = view.dom.querySelectorAll<HTMLElement>(".dbv-cal-item");
    for (const i of items) expect(i.draggable).toBe(false);
  });
});

/**
 * 三种新视图的样子。**不是断言型测试**，产物是给人看的 PNG ——
 * 和 `visual.browser.test.tsx` 一个用途，但那边的工作台是整个 App 的场景，
 * 这里只要视图本身，摆一个 App 进去反而看不清。
 */
describe("视觉：三种新视图", () => {
  const shot = async (name: string) => {
    await settle(300);
    await page.screenshot({ path: `__shots__/${name}.png` });
  };

  it("列表 / 画廊 / 日历各来一张", async () => {
    const rows: { path: string; title: string; props: Record<string, string> }[] = [
      { path: "论文/甲.md", title: "奇异值分解的数值方法", props: { status: "在读", 作者: "Golub", 读于: "2026-03-04" } },
      { path: "论文/乙.md", title: "Attention Is All You Need", props: { status: "已读", 作者: "Vaswani 等", 读于: "2026-03-11" } },
      { path: "论文/丙.md", title: "一篇还没开始读的", props: { status: "未读", 作者: "张三" } },
    ];
    const properties = [
      { key: "status", type: "string" },
      { key: "作者", type: "string" },
      { key: "读于", type: "date" },
    ];

    for (const [name, kind, spec] of [
      [
        "19-db-table",
        "table",
        ["view: table", "columns: [title, status, 作者, 读于]", "widths: title=240, status=90, 作者=120, 读于=110"].join("\n"),
      ],
      ["20-db-list", "list", "view: list\ncolumns: [title, status, 作者]"],
      ["21-db-gallery", "gallery", "view: gallery\ncolumns: [title, status, 作者]"],
      ["22-db-calendar", "calendar", "view: calendar\ndate-field: 读于"],
    ] as const) {
      viewMock = { columns: ["title", "status", "作者", "读于"], rows, view: kind, groupBy: null, properties };
      const v = mount(spec);
      // 表格那张顺手把列头菜单打开 —— 菜单里的图标就是靠这张看的。
      // 先等视图渲染出来：mount 之后表格是异步查出来的
      await settle(400);
      if (kind === "table") {
        const th = [...document.querySelectorAll<HTMLElement>(".dbview-th")].find((b) =>
          b.textContent?.includes("status"),
        );
        th?.click();
        await settle(200);
      }
      await shot(name);
      // 画廊塌成一列窄条是最容易复发的毛病（`.dbview` 默认按内容宽），
      // 这里顺手量一下：瓦片不能比声明的最小宽度还窄
      if (kind === "gallery") {
        const tile = document.querySelector(".dbv-tile")!.getBoundingClientRect();
        expect(tile.width).toBeGreaterThanOrEqual(148);
      }
      v.destroy();
      views.pop();
      document.body.innerHTML = "";
    }
    expect(true).toBe(true);
  });
});

describe("列表视图的版式", () => {
  it("属性和标题在同一行，而且在标题右边", async () => {
    // 属性曾经摆在标题下面，一条占两行 —— 而列表存在的理由恰恰是密度
    viewMock = {
      columns: ["title", "status", "作者"],
      rows: [{ path: "论文/甲.md", title: "甲", props: { status: "在读", 作者: "Golub" } }],
      view: "list",
      groupBy: null,
      properties: [
        { key: "status", type: "string" },
        { key: "作者", type: "string" },
      ],
    };
    const v = mount('from: "论文/*"\nview: list\ncolumns: [title, status, 作者]');
    await settle();

    const title = v.dom.querySelector<HTMLElement>(".dbv-list-title")!.getBoundingClientRect();
    const chips = v.dom.querySelector<HTMLElement>(".dbv-chips")!.getBoundingClientRect();

    // 同一行：垂直方向有重叠
    expect(chips.top).toBeLessThan(title.bottom);
    expect(chips.bottom).toBeGreaterThan(title.top);
    // 在右边
    expect(chips.left).toBeGreaterThan(title.left);
  });
});

describe("属性名的中文显示（§2.6）", () => {
  function labelMock() {
    viewMock = {
      columns: ["title", "created"],
      rows: [{ path: "论文/甲.md", title: "甲", props: { created: "2026-03-04" } }],
      view: "table",
      groupBy: null,
      // Rust 侧总会把这两个内置列附在 properties 末尾（见 index/view.rs），
      // 这里照着来，否则「加一列」里根本看不到它们
      properties: [
        { key: "status", type: "string" },
        { key: "tags", type: "list" },
        { key: "created", type: "date" },
        { key: "updated", type: "date" },
      ],
    };
  }

  it("表头显示中文，但排序写回代码块的仍然是原键名", async () => {
    labelMock();
    const view = mount('from: "论文/*"\nview: table\ncolumns: [title, created]');
    await settle();

    const heads = [...view.dom.querySelectorAll(".dbview-th")].map((b) => b.textContent);
    expect(heads).toEqual(["标题", "创建时间"]);

    // **写进文件的必须还是英文。** 中文键一旦进了 .md，笔记就不能拖进
    // 别的软件用了（§0 第 1 条）
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((b) =>
        b.textContent?.includes("创建时间"),
      )!,
    );
    await settle(200);
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu button")].find((b) =>
        b.textContent?.includes("升序"),
      )!,
    );
    await settle();
    expect(view.state.doc.toString()).toContain("sort: created");
    expect(view.state.doc.toString()).not.toContain("创建时间");
  });

  it("「加一列」里也是中文名，加进去的是原键名", async () => {
    labelMock();
    const view = mount('from: "论文/*"\nview: table\ncolumns: [title]');
    await settle();

    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-plus button")!);
    await settle(200);
    const pick = [...view.dom.querySelectorAll<HTMLElement>(".vset-list button")].find((b) =>
      b.textContent?.includes("标签"),
    )!;
    expect(pick, "列表里该显示「标签」而不是 tags").toBeTruthy();
    await userEvent.click(pick);
    await settle();

    expect(view.state.doc.toString()).toContain("columns: [title, tags]");
  });

  it("用户自己起的属性名一个字都不动", async () => {
    labelMock();
    const view = mount('from: "论文/*"\nview: table\ncolumns: [title]');
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-plus button")!);
    await settle(200);
    const names = [...view.dom.querySelectorAll(".vset-list button")].map((b) => b.textContent);
    expect(names.some((n) => n?.includes("status"))).toBe(true);
  });

  it("内置列后面不再缀一句解释 —— 名字本身已经说清楚了", async () => {
    labelMock();
    // 已经显示出来的列不会出现在「加一列」里，所以这里只留 title
    viewMock = { ...viewMock, columns: ["title"] };
    const view = mount(['from: "论文/*"', "view: table", "columns: [title]"].join("\n"));
    await settle();
    await userEvent.click(view.dom.querySelector<HTMLElement>(".dbview-plus button")!);
    await settle(200);

    const row = [...view.dom.querySelectorAll<HTMLElement>(".vset-list button")].find((b) =>
      b.textContent?.includes("创建时间"),
    )!;
    expect(row.textContent?.trim()).toBe("创建时间");

    // 图标和文字之间要留出间距。原来那条规则不是 flex，两者贴在一起
    const icon = row.querySelector("svg")!.getBoundingClientRect();
    const text = row.getBoundingClientRect();
    expect(icon.right).toBeLessThan(text.right);
    expect(getComputedStyle(row).display).toBe("flex");
    expect(parseFloat(getComputedStyle(row).gap)).toBeGreaterThanOrEqual(6);
  });
});

describe("列宽可调（§2.6）", () => {
  const SPEC = ['from: "论文/*"', "view: table", "columns: [title, status]"].join("\n");

  /** 按下某一列的拖杆、拖 dx 像素、松手 */
  async function drag(view: EditorView, col: string, dx: number) {
    const th = [...view.dom.querySelectorAll<HTMLElement>("th[data-col]")].find(
      (t) => t.dataset.col === col,
    )!;
    const handle = th.querySelector<HTMLElement>(".dbview-resize")!;
    const x = handle.getBoundingClientRect().left;
    // pointer 而不是 mouse —— 实现听的是 pointer 事件（触屏也要能拖）
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: x, bubbles: true, cancelable: true }),
    );
    await settle(60);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x + dx, bubbles: true }));
    await settle(60);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await settle(200);
  }

  it("拖完把宽度写回代码块", async () => {
    const view = mount(SPEC);
    await settle();

    const before = view.dom.querySelector<HTMLElement>('th[data-col="title"]')!.getBoundingClientRect().width;
    await drag(view, "title", 80);

    const doc = view.state.doc.toString();
    expect(doc).toMatch(/widths: .*title=\d+/);
    // 真的变宽了，而且大致是拖过的距离
    const after = view.dom.querySelector<HTMLElement>('th[data-col="title"]')!.getBoundingClientRect().width;
    expect(after).toBeGreaterThan(before + 40);
  });

  it("**每一列都记下来** —— 只记被拖的那一列，别的列会在手底下跳一下", async () => {
    const view = mount(SPEC);
    await settle();
    await drag(view, "title", 60);

    const widths = /widths: (.+)/.exec(view.state.doc.toString())![1];
    expect(widths).toContain("title=");
    expect(widths).toContain("status=");
  });

  it("拖动不会顺手把这一列的菜单打开", async () => {
    // 拖杆长在表头按钮旁边，不掐断冒泡的话松手就顺手开了菜单
    const view = mount(SPEC);
    await settle();
    await drag(view, "status", 40);
    expect(view.dom.querySelector(".dbview-menu")).toBeNull();
    expect(view.state.doc.toString()).not.toContain("sort:");
  });

  it("双击复位，回到按内容自适应", async () => {
    const view = mount(SPEC);
    await settle();
    await drag(view, "title", 60);
    expect(view.state.doc.toString()).toContain("widths:");

    const handle = view.dom.querySelector<HTMLElement>('th[data-col="title"] .dbview-resize')!;
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle(200);
    expect(view.state.doc.toString()).not.toContain("widths:");
  });

  it("代码块里写好的宽度，打开就生效", async () => {
    const view = mount([SPEC, "widths: title=260, status=90"].join("\n"));
    await settle();
    const th = view.dom.querySelector<HTMLElement>('th[data-col="title"]')!;
    expect(Math.round(th.getBoundingClientRect().width)).toBe(260);
  });

  it("窄到放不下时截断，不把表撑破", async () => {
    const view = mount([SPEC, "widths: title=70, status=70"].join("\n"));
    await settle();
    const cell = view.dom.querySelector<HTMLElement>(".dbview-link span")!;
    expect(getComputedStyle(cell).textOverflow).toBe("ellipsis");
  });
});

describe("列头菜单里该有什么", () => {
  it("宽度复位只在这一列真调过宽时出现", async () => {
    const view = mount(['from: "论文/*"', "view: table", "columns: [title, status]"].join("\n"));
    await settle();

    const open = async () => {
      await userEvent.click(
        [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((b) =>
          b.textContent?.includes("status"),
        )!,
      );
      await settle(200);
      return [...view.dom.querySelectorAll(".dbview-menu button")].map((b) => b.textContent);
    };

    expect((await open()).some((t) => t?.includes("宽度复位"))).toBe(false);

    // 关菜单。**不能点表格里的任何地方** —— 那会把光标送进代码块，
    // 整个视图立刻退回源码（live preview 的规则），表就没了
    window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle(150);

    const handle = view.dom.querySelector<HTMLElement>('th[data-col="status"] .dbview-resize')!;
    const x = handle.getBoundingClientRect().left;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: x, bubbles: true, cancelable: true }),
    );
    // 按下和移动之间必须让一拍：监听器是在 effect 里挂的，同一拍里发出去的
    // pointermove 还没人接
    await settle(60);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x + 50, bubbles: true }));
    await settle(60);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await settle(250);

    expect((await open()).some((t) => t?.includes("宽度复位"))).toBe(true);
  });

  it("「取消排序」只在这一列正排着的时候出现", async () => {
    const view = mount(['from: "论文/*"', "view: table", "sort: status", "columns: [title, status]"].join("\n"));
    await settle();

    const items = async (col: string) => {
      await userEvent.click(
        [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((b) =>
          b.textContent?.includes(col),
        )!,
      );
      await settle(200);
      return [...view.dom.querySelectorAll(".dbview-menu button")].map((b) => b.textContent);
    };

    expect((await items("status")).some((t) => t?.includes("取消排序"))).toBe(true);
    // 没在排序的那一列不该有 —— 常驻一条会让人以为哪儿正排着
    expect((await items("标题")).some((t) => t?.includes("取消排序"))).toBe(false);
  });
});

/**
 * 定宽表格里最容易复发的两个毛病，都是「看起来像功能坏了」而 DOM 完全正常。
 */
describe("定宽表格不能把东西裁掉", () => {
  const SIZED = [
    'from: "论文/*"',
    "view: table",
    "columns: [title, status]",
    "widths: title=90, status=70",
  ].join("\n");

  it("列头菜单不能被 th 裁掉 —— 裁了就等于「点列头没反应」", async () => {
    const view = mount(SIZED);
    await settle();

    const th = view.dom.querySelector<HTMLElement>('th[data-col="status"]')!;
    await userEvent.click(th.querySelector<HTMLElement>(".dbview-th")!);
    await settle(200);

    const menu = view.dom.querySelector<HTMLElement>(".dbview-menu")!;
    expect(menu, "菜单该开出来").not.toBeNull();

    // **只能钉声明。** 裁剪不改变 getBoundingClientRect —— 菜单被 overflow
    // 裁没了的时候，几何量出来和正常时一模一样，只有人眼看得出来
    expect(getComputedStyle(th).overflow).not.toBe("hidden");
    // 菜单确实挂在 th 外面（所以上面那条才要紧）
    expect(menu.getBoundingClientRect().bottom).toBeGreaterThan(
      th.getBoundingClientRect().bottom,
    );

    // 而且它是 fixed 的：外面那层横向滚动容器同样会纵向裁，
    // absolute 的菜单一长就被切掉下半截
    expect(getComputedStyle(menu).position).toBe("fixed");
    const scroll = view.dom.querySelector<HTMLElement>(".dbview-scroll")!;
    expect(menu.getBoundingClientRect().bottom).toBeGreaterThan(
      scroll.getBoundingClientRect().bottom,
    );
  });

  it("窄列里标题截断而不是断成两行", async () => {
    const view = mount(SIZED);
    await settle();

    const link = view.dom.querySelector<HTMLElement>(".dbview-link")!;
    const icon = link.querySelector("svg")!.getBoundingClientRect();
    const text = link.querySelector("span")!.getBoundingClientRect();

    // 图标和文字在同一行：断行的话文字会整个跑到图标下面去
    expect(text.top).toBeLessThan(icon.bottom);
    expect(getComputedStyle(link.querySelector("span")!).textOverflow).toBe("ellipsis");
  });
});

describe("列头菜单的样子", () => {
  it("每一条都带图标 —— 一列纯文字要逐行读", async () => {
    const view = mount(
      ['from: "论文/*"', "view: table", "sort: status", "columns: [title, status]", "widths: title=160, status=90"].join(
        "\n",
      ),
    );
    await settle();
    await userEvent.click(
      [...view.dom.querySelectorAll<HTMLElement>(".dbview-th")].find((b) =>
        b.textContent?.includes("status"),
      )!,
    );
    await settle(200);

    const rows = [...view.dom.querySelectorAll<HTMLElement>(".dbview-menu > li > button")];
    // 升序、降序、取消排序、重命名、宽度复位、隐藏
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows) {
      expect(r.querySelector("svg"), `「${r.textContent}」没有图标`).not.toBeNull();
      // 图标在文字左边，而且留出了间距
      expect(parseFloat(getComputedStyle(r).gap)).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("列宽拖杆的位置", () => {
  it("骑在列的边界上，不是停在列名文字后面", async () => {
    // 拖杆原来挂在 `.dbview-thwrap` 上，而那是个 inline-flex，只有
    // 「图标 + 列名」那么宽 —— 于是它停在文字末尾，和下面的列边界对不上
    const view = mount(
      ['from: "论文/*"', "view: table", "columns: [title, status]", "widths: title=220, status=90"].join("\n"),
    );
    await settle();

    for (const col of ["title", "status"]) {
      const th = view.dom.querySelector<HTMLElement>(`th[data-col="${col}"]`)!;
      const handle = th.querySelector<HTMLElement>(".dbview-resize")!;
      const edge = th.getBoundingClientRect().right;
      const center = handle.getBoundingClientRect().left + handle.getBoundingClientRect().width / 2;
      expect(Math.abs(center - edge), `${col} 的拖杆没骑在列边界上`).toBeLessThan(1.5);
    }
  });
});

describe("表头和下面的单元格对齐", () => {
  it("列头那一块和下面的行等宽、左边对齐", async () => {
    // `th` 的内边距在格子上、`td` 的在里面的按钮上 —— 两边用的不是同一套盒子，
    // 表头那块就只有文字那么宽，hover 底色只包住「标题」两个字
    const view = mount(
      ['from: "论文/*"', "view: table", "columns: [title, status]", "widths: title=220, status=90"].join("\n"),
    );
    await settle();

    const th = view.dom.querySelector<HTMLElement>('th[data-col="title"] .dbview-th')!;
    const cell = view.dom.querySelector<HTMLElement>(".dbview-link")!;
    const a = th.getBoundingClientRect();
    const b = cell.getBoundingClientRect();

    expect(Math.abs(a.left - b.left), "左边没对齐").toBeLessThan(1.5);
    expect(Math.abs(a.width - b.width), "宽度不一样").toBeLessThan(1.5);
  });

  it("列名和下面的标题文字起点一致", async () => {
    const view = mount(
      ['from: "论文/*"', "view: table", "columns: [title, status]", "widths: title=220, status=90"].join("\n"),
    );
    await settle();
    const headIcon = view.dom
      .querySelector<HTMLElement>('th[data-col="title"] .dbview-th svg')!
      .getBoundingClientRect();
    const rowIcon = view.dom.querySelector<HTMLElement>(".dbview-rowicon")!.getBoundingClientRect();
    expect(Math.abs(headIcon.left - rowIcon.left)).toBeLessThan(1.5);
  });
});
