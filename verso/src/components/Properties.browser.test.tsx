/**
 * 属性条。在真实浏览器里跑 —— 编辑态的框会不会被裁掉是布局问题，
 * 没有布局引擎验不了。
 */
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    propSet: async () => {},
    propRename: async () => {},
  },
}));

const { Properties } = await import("./Properties");

let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

function render(frontmatter: Record<string, unknown> = { id: "01X", status: "已读", tags: ["深度学习"], 难度: 4 }) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;padding:40px";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<Properties frontmatter={frontmatter} path="a.md" onChanged={() => {}} />);
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe("属性条", () => {
  it("内部字段不显示 —— 改掉 id 等于换掉笔记身份", async () => {
    render();
    await tick();
    document.querySelector<HTMLElement>(".props-toggle")!.click();
    await tick();
    const keys = [...document.querySelectorAll(".props-key")].map((e) => e.textContent);
    expect(keys).toEqual(["status", "tags", "难度"]);
  });

  it("点属性名进入改名，点值进入改值", async () => {
    render();
    await tick();
    document.querySelector<HTMLElement>(".props-toggle")!.click();
    await tick();

    document.querySelector<HTMLElement>(".props-key")!.click();
    await tick();
    expect(document.querySelector<HTMLInputElement>(".props-row dt input")?.value).toBe("status");

    // Esc 退出改名，再点值
    document.querySelector<HTMLInputElement>(".props-row dt input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    document.querySelector<HTMLElement>(".props-value")!.click();
    await tick();
    expect(document.querySelector<HTMLInputElement>(".props-row dd input")?.value).toBe("已读");
  });

  // 作者报的：改名时那个蓝框显示不全。dt 上的 overflow:hidden 会把它切掉一圈
  it("改名输入框不能被裁掉", async () => {
    render();
    await tick();
    document.querySelector<HTMLElement>(".props-toggle")!.click();
    await tick();
    document.querySelector<HTMLElement>(".props-key")!.click();
    await tick();

    const dt = document.querySelector<HTMLElement>(".props-row dt")!;
    expect(getComputedStyle(dt).overflow, "dt 不能裁剪，编辑框会被切").toBe("visible");

    // 框要真的有尺寸，而且不比它那一列窄
    const input = document.querySelector<HTMLElement>(".props-row dt input")!;
    const box = input.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(40);
    expect(box.height).toBeGreaterThan(16);
  });

  it("一个属性都没有时折叠态不占位置", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<Properties frontmatter={{ id: "01X" }} path="a.md" onChanged={() => {}} />);
    await tick();
    expect(document.querySelector(".props")).toBeNull();
  });
});

describe("折叠态的那一行", () => {
  it("箭头和标签在同一行 —— 不是箭头单独飘在上面", async () => {
    // 摘要那一块是 flex 盒（要横排标签），而 flex 盒是块级的：外面那个按钮
    // 不是 flex 的话，它会自己另起一行，箭头就孤零零地浮在标签上方
    render();
    await tick();
    const caret = document.querySelector<HTMLElement>(".props-caret")!.getBoundingClientRect();
    const summary = document.querySelector<HTMLElement>(".props-summary")!.getBoundingClientRect();

    expect(caret.top).toBeLessThan(summary.bottom);
    expect(caret.bottom).toBeGreaterThan(summary.top);
    expect(caret.right).toBeLessThanOrEqual(summary.left + 1);
  });

  it("计数不含 tags —— 它已经以标签的样子摆在旁边了", async () => {
    render({ tags: ["测试"] });
    await tick();
    expect(document.querySelector(".props-tag")?.textContent).toBe("#测试");
    // 「#测试　1 个属性」是同一个东西数了两遍
    expect(document.querySelector(".props-count")).toBeNull();
  });

  it("除了 tags 还有别的属性时才计数", async () => {
    render({ tags: ["测试"], status: "已读", 难度: 4 });
    await tick();
    expect(document.querySelector(".props-count")?.textContent).toBe("2 个属性");
  });

  it("空标签不画出来 —— `tags: []` 或者写了个空字符串", async () => {
    render({ tags: ["", "  "], status: "已读" });
    await tick();
    expect(document.querySelector(".props-tag")).toBeNull();
    expect(document.querySelector(".props-count")?.textContent).toBe("1 个属性");
  });
});
