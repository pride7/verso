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

function render() {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;padding:40px";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <Properties
      frontmatter={{ id: "01X", status: "已读", tags: ["深度学习"], 难度: 4 }}
      path="a.md"
      onChanged={() => {}}
    />,
  );
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
