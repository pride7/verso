/**
 * 打印视图与打印样式表。
 *
 * 这里能验的和不能验的要分清楚：
 *
 * - **能验**：内容真的进了 DOM（这正是「不能直接打印编辑器」的理由 ——
 *   CodeMirror 只渲染视口）、portal 挂在 body 下、屏幕上不可见、
 *   `onReady` 一定会来。
 * - **不能验**：按下去之后系统打印对话框长什么样、分页断在哪一行。
 *   headless 里没有打印机也没有纸。
 *
 * 所以分页那部分照 AGENTS.md 的先例**钉声明**（`pageScroll.test.tsx` 钉的
 * 是 `overscroll-behavior` 而不是行为）：从 CSSOM 里读出 `@media print`
 * 那几条关键规则，确认它们还在。删掉其中任何一条，PDF 就是废的，而屏幕上
 * 一切正常 —— 这类回归只有钉声明拦得住。
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../../src/ui/styles.css";
import { renderMarkdown } from "../../../src/editor/exportHtml";
import { PrintView } from "../../../src/ui/PrintView";

let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

const LAYOUT = { fontSize: 11, margin: 22 };

function mount(html: string, onReady = () => {}) {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <PrintView
      title="线性代数"
      fileName="线性代数"
      html={html}
      layout={LAYOUT}
      onReady={onReady}
    />,
  );
}

/**
 * `@media print` 里的所有样式规则，摊平成一张表。
 *
 * 这里面只该有**隔离与分页** —— 排版规则住在外面（见 `docRules`），因为
 * 打印对话框里那张预览纸要和纸上用同一份。
 */
function printRules(): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨源样式表读不了，跳过
    }
    for (const rule of [...rules]) {
      if (rule instanceof CSSMediaRule && rule.conditionText.includes("print")) {
        for (const inner of [...rule.cssRules]) {
          if (inner instanceof CSSStyleRule) out.push(inner);
        }
      }
    }
  }
  return out;
}

/** `@media` 之外的顶层规则 —— 屏幕预览和纸共用的那一份排版 */
function docRules(): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...rules]) {
      if (rule instanceof CSSStyleRule) out.push(rule);
    }
  }
  return out;
}

/** 排版规则里，选择器完全等于 `selector` 的那一条 */
function docRule(selector: string): CSSStyleRule | undefined {
  return docRules().find((r) => r.selectorText === selector);
}

/** 打印规则里，选择器含 `selectorPart` 的那一条上，某个属性的值 */
function printDecl(selectorPart: string, prop: string): string {
  const rule = printRules().find((r) => r.selectorText.includes(selectorPart));
  return rule?.style.getPropertyValue(prop) ?? "";
}

/**
 * 选择器**完全等于** `selector` 的那一条。
 *
 * 合并规则（`.print-doc th, .print-doc td`）会被 `includes` 抢先命中，
 * 而它和单独的 `.print-doc th` 上写的是两回事。
 */
function exactRule(selector: string): CSSStyleRule | undefined {
  return printRules().find((r) => r.selectorText === selector);
}

describe("打印视图挂在哪", () => {
  it("portal 到 body，不在 #root 里 —— 隐藏界面那条规则才不依赖 App 的结构", async () => {
    mount("<p>正文</p>");
    await vi.waitFor(() => expect(document.querySelector(".print-doc")).not.toBeNull());
    const doc = document.querySelector(".print-doc")!;
    expect(doc.parentElement).toBe(document.body);
    expect(document.querySelector("#root .print-doc")).toBeNull();
  });

  it("屏幕上不显示 —— 只有打印时才现身", async () => {
    mount("<p>正文</p>");
    await vi.waitFor(() => expect(document.querySelector(".print-doc")).not.toBeNull());
    const doc = document.querySelector(".print-doc")!;
    expect(getComputedStyle(doc).display).toBe("none");
  });

  it("标题排在正文前面", async () => {
    mount("<p>正文</p>");
    await vi.waitFor(() => expect(document.querySelector(".print-doc-title")).not.toBeNull());
    expect(document.querySelector(".print-doc-title")?.textContent).toBe("线性代数");
  });
});

describe("存 PDF 时的默认文件名", () => {
  it("打印期间把 document.title 换成笔记名 —— 否则每篇都存成 Verso.pdf", async () => {
    const before = document.title;
    mount("<p>正文</p>");
    await vi.waitFor(() => expect(document.title).toBe("线性代数"));
    expect(before).not.toBe("线性代数");
  });

  it("打印视图撤掉之后还原", async () => {
    const before = document.title;
    mount("<p>正文</p>");
    await vi.waitFor(() => expect(document.title).toBe("线性代数"));
    root?.unmount();
    root = null;
    expect(document.title).toBe(before);
  });
});

describe("整篇都在 DOM 里", () => {
  it("长文档一段不少 —— 这正是不能直接打印编辑器的理由", async () => {
    // CodeMirror 只渲染视口，两百段里屏幕外的那些根本不在 DOM 里。
    // 导出这条路必须整篇都在
    const src = Array.from({ length: 200 }, (_, i) => `第 ${i} 段。`).join("\n\n");
    mount(renderMarkdown(src));
    await vi.waitFor(() => expect(document.querySelector(".print-doc")).not.toBeNull());
    const doc = document.querySelector(".print-doc")!;
    expect(doc.querySelectorAll("p")).toHaveLength(200);
    expect(doc.textContent).toContain("第 199 段。");
  });

  it("公式渲染成 KaTeX，不是一串源码", async () => {
    mount(renderMarkdown("$$\nA = U \\Sigma V^{\\mathsf{T}}\n$$\n"));
    await vi.waitFor(() => expect(document.querySelector(".print-doc .katex")).not.toBeNull());
    expect(document.querySelector(".print-doc")?.textContent).not.toContain("$$");
  });
});

describe("什么时候可以按下打印", () => {
  it("没有图片时 onReady 会来", async () => {
    const onReady = vi.fn();
    mount(renderMarkdown("# 标题\n\n正文。"), onReady);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it("图片加载失败也照样来 —— 卡住不弹对话框比缺一张图更糟", async () => {
    const onReady = vi.fn();
    // 连不上的地址：error 事件会来，load 不会
    mount('<p><img src="http://127.0.0.1:1/never.png" alt="x" /></p>', onReady);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 5000 });
  });

  it("只调一次 —— 弹两次打印对话框是最烦人的一种 bug", async () => {
    const onReady = vi.fn();
    mount(renderMarkdown("正文。"), onReady);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 200));
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});

/**
 * 下面这些是**声明**，不是行为。删掉任何一条，屏幕上一切正常而 PDF 是废的，
 * 所以它们值得被单独钉住。
 */
describe("打印样式表还在", () => {
  it("解开外壳的 overflow:hidden —— 不解开的话内容被裁成一页", () => {
    expect(printDecl("#root", "overflow")).toBe("visible");
    expect(printDecl("#root", "height")).toBe("auto");
  });

  it("界面其余部分整个不打印", () => {
    expect(printDecl(":not(.print-doc)", "display")).toBe("none");
  });

  it("打印文档本身显示出来", () => {
    expect(exactRule("body > .print-doc")?.style.display).toBe("block");
  });

  it("纸是白的 —— 勾了「打印背景图形」不该得到一整页主题底色", () => {
    expect(printDecl("#root", "background")).toContain("255, 255, 255");
  });
});

/**
 * 排版规则**不在** `@media print` 里，因为打印对话框那张预览纸要和纸上共用
 * 同一份。写在 print 里的话，预览就成了另一套样式渲染出来的示意图。
 */
describe("排版规则屏幕与纸共用", () => {
  it("排版住在 @media print 外面", () => {
    expect(docRule(".print-doc")).toBeDefined();
    // 里面只该剩隔离与分页
    expect(printRules().find((r) => r.selectorText === ".print-doc")).toBeUndefined();
  });

  it("墨色写死，不跟主题走 —— 深色主题下正文接近白色，打在纸上就是空白", () => {
    expect(docRule(".print-doc")?.style.color).toBe("rgb(26, 26, 26)");
  });

  it("字号走变量，对话框改一下预览和纸一起变", () => {
    expect(docRule(".print-doc")?.style.fontSize).toContain("--print-font");
  });

  it("版心只由页边距决定 —— 再设 max-width 就是两个机制打架", () => {
    expect(docRule(".print-doc")?.style.getPropertyValue("max-width")).toBe("");
  });

  it("段距明显大于行距，否则段落分不出来", () => {
    const lineHeight = Number(docRule(".print-doc")?.style.lineHeight);
    // `0.85em` 里的 em 是当前字号，行距是 lineHeight × 字号 —— 直接比这两个系数
    const gap = parseFloat(docRule(".print-doc p")?.style.marginBottom ?? "0");
    expect(gap).toBeGreaterThan(0.5);
    expect(lineHeight).toBeLessThan(1.8);
  });

  it("表格自己写行高 —— 继承正文行距的话四行表格能撑掉小半页", () => {
    expect(Number(docRule(".print-doc table")?.style.lineHeight)).toBeLessThan(1.5);
  });

  it("表格不画竖线，横线只留三条", () => {
    const cell = docRule(".print-doc th, .print-doc td");
    // `border` 简写在四条边不一致时序列化成空串，只能查长属性
    expect(cell?.style.borderLeftStyle).toBe("none");
    expect(cell?.style.borderTopStyle).toBe("none");
    expect(cell?.style.getPropertyValue("border-bottom")).toContain("solid");
    expect(docRule(".print-doc thead th")?.style.borderTopStyle).toBe("solid");
  });

  it("中文表头不许折行 —— CJK 能在任意字符断开，会被压成一字一行的竖条", () => {
    expect(docRule(".print-doc th")?.style.whiteSpace).toBe("nowrap");
  });
});

describe("分页控制还在", () => {

  it("公式块不许被拦腰切断", () => {
    expect(printDecl(".math-block", "break-inside")).toBe("avoid");
  });

  it("表格跨页时表头每页重印", () => {
    expect(printDecl("thead", "display")).toBe("table-header-group");
    expect(printDecl(".print-doc tr", "break-inside")).toBe("avoid");
  });

  it("标题不许落在页脚", () => {
    expect(printDecl(".print-doc h1", "break-after")).toBe("avoid");
  });

  it("长代码块可以断，但不留三行以内的零头", () => {
    expect(printDecl(".print-doc pre", "break-inside")).toBe("auto");
    expect(printDecl(".print-doc pre", "orphans")).toBe("3");
  });
});
