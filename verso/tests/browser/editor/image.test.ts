/**
 * 图片渲染与拖拽改尺寸 —— 在真实 Chromium 里跑。
 *
 * 纯 Node 验不了：live preview 的 decoration 要等语法树解析完（AGENTS.md
 * 「database 视图的解析时序」），`<img>` 的加载与 `getBoundingClientRect`
 * 更是只有真布局才有。
 */
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensions } from "../../../src/editor";
import { setImageResolver } from "../../../src/editor/image";
import { pastedMathText } from "../../../src/editor/mathDelimiters";
import { installAttachmentDrop } from "../../../src/editor/paste";
import "../../../src/ui/styles.css";

/** 1×1 的透明 PNG。用 data URL 就不必依赖 Tauri 的 asset 协议 */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  setImageResolver(null);
  document.body.innerHTML = "";
});

function mount(doc: string) {
  setImageResolver((target) => (target.endsWith(".png") ? PIXEL : null));
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    doc,
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

const settle = () => new Promise((r) => setTimeout(r, 400));
const img = (v: EditorView) => v.dom.querySelector<HTMLImageElement>(".cm-img img");

describe("图片", () => {
  it("`![[图.png]]` 渲染成图，光标不在的时候", async () => {
    const view = mount("正文\n\n![[attachments/图.png]]\n\n后面\n");
    await settle();
    expect(img(view)).not.toBeNull();
    expect(img(view)!.src).toBe(PIXEL);
    // 源码被替换掉了
    expect(view.dom.textContent).not.toContain("![[attachments/图.png]]");
  });

  it("光标进去就退回源码 —— 那是唯一能改到它的机会", async () => {
    // 前面垫两行：光标默认在 0，`![[]]` 放文首会被判成「光标碰到了」，
    // 那时本来就该显示源码
    const view = mount("正文\n\n![[图.png]]\n");
    await settle();
    expect(img(view)).not.toBeNull();

    view.dispatch({ selection: { anchor: 8 } });
    await settle();
    expect(img(view)).toBeNull();
    expect(view.dom.textContent).toContain("![[图.png]]");
  });

  it("`|300` 是宽度，写在源码里所以跟着文件走", async () => {
    const view = mount("正文\n\n![[图.png|300]]\n");
    await settle();
    expect(img(view)!.style.width).toBe("300px");
  });

  it("不是图片的嵌入仍然当链接，不去渲染", async () => {
    const view = mount("正文\n\n![[另一篇笔记]]\n");
    await settle();
    expect(img(view)).toBeNull();
    expect(view.dom.textContent).toContain("另一篇笔记");
  });

  it("解析不出 URL 时不渲染 —— 没打开 vault 的场合", async () => {
    setImageResolver(() => null);
    const view = mount("![[图.png]]\n");
    setImageResolver(() => null);
    await settle();
    expect(img(view)).toBeNull();
  });

  it("拖右边缘改宽度，改动写回源码", async () => {
    const view = mount("正文\n\n![[图.png]]\n");
    await settle();

    const handle = view.dom.querySelector<HTMLElement>(".cm-img-handle")!;
    const start = img(view)!.getBoundingClientRect();
    // pointer 而不是 mouse —— 实现听的是 pointer 事件（触屏也要能拖，
    // 见 image.ts 的注释）
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: start.right }));
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: start.right + 120 }),
    );
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await settle();

    // 宽度进了文件，不是界面上的临时状态
    const doc = view.state.doc.toString();
    expect(doc).toMatch(/!\[\[图\.png\|\d+\]\]/);
    const w = Number(/\|(\d+)\]\]/.exec(doc)![1]);
    expect(w).toBeGreaterThan(start.width + 100);

    // 再拖一次是改那个数字，不是又追加一个
    expect(doc.match(/\|/g)).toHaveLength(1);
  });
});

describe("粘贴图片", () => {
  /** 造一个「剪贴板里有张图」的粘贴事件 */
  function pasteImage(view: EditorView, bytes = [1, 2, 3]) {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "", { type: "image/png" }));
    view.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }

  it("落盘之后在光标处插入 `![[]]`", async () => {
    const saved: { name: string; data: string }[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      doc: "开头\n",
      parent,
      extensions: createExtensions({
        onChange: () => {},
        onSaveNow: () => {},
        onFollowLink: () => {},
        getNotes: () => [],
        saveAttachment: async (name, data) => {
          saved.push({ name, data });
          return "attachments/粘贴-1.png";
        },
      }),
    });
    views.push(view);
    // 光标落在「开」和「头」之间
    view.dispatch({ selection: { anchor: 1 } });

    pasteImage(view);
    await settle();

    expect(saved).toHaveLength(1);
    // 剪贴板里的图通常没有文件名，得自己起一个带扩展名的
    expect(saved[0].name).toMatch(/\.png$/);
    expect(saved[0].data.length).toBeGreaterThan(0);
    // 插在光标处，不是行尾也不是文末
    expect(view.state.doc.toString()).toBe("开![[attachments/粘贴-1.png]]头\n");
  });

  it("没接存图回调时不接管粘贴 —— 别把普通粘贴也吃掉", async () => {
    const view = mount("开头\n");
    await settle();
    pasteImage(view);
    await settle();
    expect(view.state.doc.toString()).toBe("开头\n");
  });
});

describe("拖入附件", () => {
  it("拖到编辑器外层空白时，图片用嵌入语法且不会打开成页面", async () => {
    const saved: string[] = [];
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      doc: "正文",
      parent,
      extensions: createExtensions({
        onChange: () => {},
        onSaveNow: () => {},
        onFollowLink: () => {},
        getNotes: () => [],
      }),
    });
    views.push(view);
    const removeDrop = installAttachmentDrop(
      parent,
      view,
      () => async (name) => {
        saved.push(name);
        return `attachments/${name}`;
      },
      () => {},
    );
    view.dispatch({ selection: { anchor: 2 } });

    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1])], "图.png", { type: "image/png" }));
    data.items.add(new File([new Uint8Array([2])], "资料.pdf", { type: "application/pdf" }));
    const event = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
    // 正文很短时，用户实际投到的是宿主的空白，而不是 `.cm-content`。
    parent.dispatchEvent(event);
    await settle();
    removeDrop();

    expect(event.defaultPrevented).toBe(true);
    expect(saved).toEqual(["图.png", "资料.pdf"]);
    expect(view.state.doc.toString()).toBe("正文![[attachments/图.png]]\n[[attachments/资料.pdf]]");
  });

  it("存盘能力暂不可用时也拦住默认导航，并给出提示", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ doc: "正文", parent });
    views.push(view);
    const errors: string[] = [];
    const removeDrop = installAttachmentDrop(parent, view, () => undefined, (m) => errors.push(m));

    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1])], "图.png", { type: "image/png" }));
    const event = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
    parent.dispatchEvent(event);
    removeDrop();

    expect(event.defaultPrevented).toBe(true);
    expect(errors).toEqual(["请先打开仓库，再拖入附件"]);
    expect(view.state.doc.toString()).toBe("正文");
  });
});

describe("粘贴文本里的公式", () => {
  function pasteText(view: EditorView, text: string) {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const event = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  }

  it("自动把 LaTeX 定界符换成 Markdown 定界符", async () => {
    const view = mount("前后");
    view.dispatch({ selection: { anchor: 1 } });
    const event = pasteText(view, String.raw`\(x+1\) 与 \[y^2\]`);
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("前$x+1$ 与 $$y^2$$后");
  });

  it("粘贴内容自己的行内代码不转换", async () => {
    const view = mount("");
    pasteText(view, ["代码 `", String.raw`\(x\)`, "`，公式 ", String.raw`\(y\)`].join(""));
    await settle();
    expect(view.state.doc.toString()).toBe(["代码 `", String.raw`\(x\)`, "`，公式 $y$"].join(""));
  });

  it("光标在代码块里时不接管粘贴", async () => {
    const view = mount("```tex\n\n```\n");
    view.dispatch({ selection: { anchor: 7 } });
    await settle();
    expect(pastedMathText(view.state, String.raw`\(x\)`)).toEqual({
      text: String.raw`\(x\)`,
      count: 0,
    });
  });
});
