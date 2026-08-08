import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SymbolPanel } from "../../../src/ui/SymbolPanel";
import "../../../src/ui/styles.css";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = "";
  localStorage.clear();
});

function mount(customSnippets = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onInsert = vi.fn();
  const root = createRoot(host);
  roots.push(root);
  root.render(
    <SymbolPanel
      customSnippets={customSnippets}
      onInsert={onInsert}
      onClose={() => {}}
    />,
  );
  return { host, onInsert };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

describe("符号面板", () => {
  it("显示 KaTeX 预览，并把原始 tabstop 交给编辑器", async () => {
    const { host, onInsert } = mount();
    await settle();
    const input = host.querySelector<HTMLInputElement>(".modal-input")!;
    await userEvent.fill(input, "分式");
    await settle();

    const row = host.querySelector<HTMLElement>(".sym-item")!;
    expect(row.querySelector(".sym-preview .katex")).not.toBeNull();
    expect(row.querySelector(".sym-latex")!.textContent).toContain("\\frac{}{}");
    await userEvent.click(row);
    expect(onInsert).toHaveBeenCalledWith("\\frac{$0}{$1}$2");
  });

  it("用户自定义符号可以搜索，并覆盖面板里的同名内置项", async () => {
    const custom = JSON.stringify([
      {
        trigger: "sq",
        replacement: "\\sqrt[3]{$0}$1",
        options: "mAw",
        description: "自定义立方根",
      },
    ]);
    const { host, onInsert } = mount(custom);
    await settle();
    await userEvent.fill(host.querySelector<HTMLInputElement>(".modal-input")!, "自定义立方根");
    await settle();

    const rows = host.querySelectorAll<HTMLElement>(".sym-item");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".sym-trigger")!.textContent).toBe("sq");
    await userEvent.click(rows[0]);
    expect(onInsert).toHaveBeenCalledWith("\\sqrt[3]{$0}$1");
  });

  it("不展示离开真实匹配上下文就无法展开的正则片段", async () => {
    const { host } = mount();
    await settle();
    await userEvent.fill(host.querySelector<HTMLInputElement>(".modal-input")!, "标准函数");
    await settle();
    expect(host.querySelectorAll(".sym-item")).toHaveLength(0);
    expect(host.querySelector(".modal-empty")).not.toBeNull();
  });
});
