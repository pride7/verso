/**
 * 打印对话框。
 *
 * 这里钉的是**预览必须和打印吃同一份东西**：同一个 `composePrintHtml`、同一份
 * 排版 CSS、同一组版式变量。预览和结果对不上的预览比没有预览更糟 —— 而这种
 * 漂移不会有任何报错，只会在纸印出来的时候才发现。
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../../src/ui/styles.css";
import {
  composePrintHtml,
  PrintDialog,
  type PrintOptions,
  type PrintSource,
} from "../../../src/ui/PrintDialog";
import type { ViewResult } from "../../../src/core/types";

let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

const VIEW: ViewResult = {
  rows: [{ path: "a.md", title: "论文甲", props: { status: "在读" } }],
  columns: ["status"],
  view: "table",
  groupBy: null,
  properties: [],
};

const SOURCE: PrintSource = {
  title: "线性代数",
  parts: [
    { title: "线性代数", body: "正文一句。\n\n```verso-view\nfrom: 论文\n```\n", depth: 0 },
    { title: "特征值", body: "## 子文档里的二级标题\n\n子文档正文。", depth: 1 },
  ],
  views: new Map([["from: 论文", VIEW]]),
  mermaid: new Map(),
  resolveImage: () => null,
};

const OPTIONS: PrintOptions = {
  fontSize: 11,
  margin: 22,
  title: true,
  children: false,
  viewResults: true,
};

function mount(options: PrintOptions, handlers: Partial<{
    onPrint: () => void;
    onExportImage: (mode: "copy" | "save") => Promise<void>;
    onClose: () => void;
  }> = {}) {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <PrintDialog
      source={SOURCE}
      options={options}
      onChange={() => {}}
      onPrint={handlers.onPrint ?? (() => {})}
      onExportImage={handlers.onExportImage ?? (async () => {})}
      onClose={handlers.onClose ?? (() => {})}
    />,
  );
}

const page = () => document.querySelector(".print-page") as HTMLElement | null;

describe("拼装内容", () => {
  it("默认只印本篇", () => {
    const html = composePrintHtml(SOURCE, OPTIONS);
    expect(html).toContain("正文一句");
    expect(html).not.toContain("子文档正文");
  });

  it("勾上「同时打印子文档」之后接在后面，标题整体下移一级", () => {
    const html = composePrintHtml(SOURCE, { ...OPTIONS, children: true });
    expect(html).toContain("子文档正文");
    // 子文档自己的标题占一行 h2（depth 1 + 1）
    expect(html).toContain("<h2>特征值</h2>");
    // 它正文里的 `##` 被降成 h3 —— 否则和父文档的二级标题平起平坐
    expect(html).toContain("<h3");
    expect(html).toContain("子文档里的二级标题");
  });

  it("视图印查询结果", () => {
    const html = composePrintHtml(SOURCE, OPTIONS);
    expect(html).toContain("论文甲");
    expect(html).toContain("<th>名称</th>");
    expect(html).not.toContain("dbview-placeholder");
  });

  it("关掉之后只留占位说明，不把 YAML 印到纸上", () => {
    const html = composePrintHtml(SOURCE, { ...OPTIONS, viewResults: false });
    expect(html).toContain("dbview-placeholder");
    expect(html).not.toContain("论文甲");
    expect(html).not.toContain("from: 论文");
  });

  it("子文档标题一样要转义", () => {
    const html = composePrintHtml(
      { ...SOURCE, parts: [SOURCE.parts[0], { title: "<script>x</script>", body: "", depth: 1 }] },
      { ...OPTIONS, children: true },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("预览", () => {
  it("那张纸上就是要印的内容", async () => {
    mount(OPTIONS);
    await vi.waitFor(() => expect(page()).not.toBeNull());
    expect(page()?.textContent).toContain("正文一句");
    expect(page()?.textContent).toContain("论文甲");
  });

  it("预览里的 .print-doc 是显示出来的 —— 挂在 body 下的那份才隐藏", async () => {
    mount(OPTIONS);
    await vi.waitFor(() => expect(page()).not.toBeNull());
    const doc = page()?.querySelector(".print-doc") as HTMLElement;
    expect(getComputedStyle(doc).display).toBe("block");
  });

  it("版式变量落到那张纸上 —— 页边距就是它的 padding", async () => {
    mount({ ...OPTIONS, margin: 14, fontSize: 12.5 });
    await vi.waitFor(() => expect(page()).not.toBeNull());
    expect(page()?.style.getPropertyValue("--print-margin-side")).toBe("14mm");
    expect(page()?.style.getPropertyValue("--print-font")).toBe("12.5pt");
    // 变量真的被 CSS 吃到了，不只是挂在那儿
    expect(getComputedStyle(page()!).paddingLeft).toBe(getComputedStyle(page()!).paddingRight);
  });

  it("不印标题时预览里也没有", async () => {
    mount({ ...OPTIONS, title: false });
    await vi.waitFor(() => expect(page()).not.toBeNull());
    expect(page()?.querySelector(".print-doc-title")).toBeNull();
  });
});

describe("操作", () => {
  it("选项文案统一使用打印、显示和包含", async () => {
    mount(OPTIONS);
    await vi.waitFor(() => expect(document.querySelector(".print-options")).not.toBeNull());
    const text = document.querySelector(".print-options")?.textContent ?? "";
    expect(text).toContain("打印内容");
    expect(text).toContain("在第一页显示笔记标题");
    expect(text).toContain("同时打印子文档");
    expect(text).toContain("打印 database 视图结果");
    expect(text).not.toContain("印出");
    expect(text).not.toContain("关掉");
  });

  it("没有子文档时那一条勾选框是禁用的，并说明原因", async () => {
    const host = document.createElement("div");
    host.id = "root";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <PrintDialog
        source={{ ...SOURCE, parts: [SOURCE.parts[0]] }}
        options={OPTIONS}
        onChange={() => {}}
        onPrint={() => {}}
        onExportImage={async () => {}}
        onClose={() => {}}
      />,
    );
    await vi.waitFor(() => expect(document.querySelector(".print-options")).not.toBeNull());
    const boxes = [...document.querySelectorAll<HTMLInputElement>(".print-check input")];
    const children = boxes[1];
    expect(children.disabled).toBe(true);
    expect(children.closest(".print-check")?.textContent).toContain("当前笔记没有子文档");
  });

  it("「打印…」把控制权交回 App", async () => {
    const onPrint = vi.fn();
    mount(OPTIONS, { onPrint });
    await vi.waitFor(() => expect(document.querySelector(".print-dialog-foot")).not.toBeNull());
    const btn = [...document.querySelectorAll<HTMLButtonElement>(".print-dialog-foot button")].find(
      (b) => b.textContent?.includes("打印"),
    );
    btn?.click();
    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  /**
   * 渲染一张长图要几百毫秒到几秒（等字体、内联整份样式表）。这中间按钮必须
   * 显得在忙 —— 否则用户会以为没点上，再点一次，于是同一张图渲染两遍。
   */
  it("导出图片期间两个按钮都锁住，完事再放开", async () => {
    let release: (() => void) | null = null;
    const onExportImage = vi.fn(
      () => new Promise<void>((done) => (release = done)),
    );
    mount(OPTIONS, { onExportImage });
    await vi.waitFor(() => expect(document.querySelector(".print-image-actions")).not.toBeNull());

    const buttons = () => [
      ...document.querySelectorAll<HTMLButtonElement>(".print-image-actions button"),
    ];
    expect(buttons().map((b) => b.textContent)).toEqual(["复制到剪贴板", "保存为文件…"]);

    buttons()[0].click();
    await vi.waitFor(() => expect(buttons()[0].textContent).toBe("正在渲染…"));
    expect(buttons().every((b) => b.disabled), "另一个按钮也该锁住").toBe(true);

    // 忙着的时候再点，不该多发一次
    buttons()[1].click();
    expect(onExportImage).toHaveBeenCalledTimes(1);
    expect(onExportImage).toHaveBeenCalledWith("copy");

    release!();
    await vi.waitFor(() => expect(buttons()[0].disabled).toBe(false));
    expect(buttons()[0].textContent).toBe("复制到剪贴板");
  });

  it("「保存为文件…」走的是另一条", async () => {
    const onExportImage = vi.fn(async () => {});
    mount(OPTIONS, { onExportImage });
    await vi.waitFor(() => expect(document.querySelector(".print-image-actions")).not.toBeNull());
    document.querySelectorAll<HTMLButtonElement>(".print-image-actions button")[1].click();
    expect(onExportImage).toHaveBeenCalledWith("save");
  });

  it("Esc 关掉", async () => {
    const onClose = vi.fn();
    mount(OPTIONS, { onClose });
    await vi.waitFor(() => expect(document.querySelector(".print-dialog")).not.toBeNull());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
