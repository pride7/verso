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

vi.mock("../api", () => ({
  api: {
    backlinks: vi.fn(async () => []),
    propSet,
    createNote: createNote,
    viewQuery: vi.fn(async () => ({
      columns: ["title", "status"],
      rows: [
        { path: "论文/甲.md", title: "甲", props: { status: "在读" } },
        { path: "论文/乙.md", title: "乙", props: { status: "未读" } },
      ],
      view: "table",
      groupBy: null,
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
