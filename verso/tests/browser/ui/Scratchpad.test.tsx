import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { Edit } from "../../../src/core/mindmap";
import { Scratchpad } from "../../../src/ui/Scratchpad";
import "../../../src/ui/styles.css";

let root: Root | null = null;

function apply(body: string, edit: Edit): string {
  const lines = body.split("\n");
  if (edit.fromLine > edit.toLine) lines.splice(edit.toLine, 0, edit.insert);
  else if (!edit.insert) lines.splice(edit.fromLine - 1, edit.toLine - edit.fromLine + 1);
  else lines.splice(edit.fromLine - 1, edit.toLine - edit.fromLine + 1, ...edit.insert.split("\n"));
  return lines.join("\n");
}

function mount(initial: string) {
  const host = document.createElement("div");
  host.style.height = "800px";
  document.body.appendChild(host);
  const promoted = vi.fn();
  root = createRoot(host);
  function Harness() {
    const [body, setBody] = useState(initial);
    return (
      <Scratchpad
        title="草稿箱"
        body={body}
        onEdit={(edit) => setBody((value) => apply(value, edit))}
        onUndo={() => {}}
        onRedo={() => {}}
        onMindmap={() => {}}
        onSource={() => {}}
        onPromote={promoted}
      />
    );
  }
  root.render(<Harness />);
  return { host, promoted };
}

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-touch");
});

describe("结构化草稿台", () => {
  it("顶层想法自动排成卡片，子项仍显示在父项下", async () => {
    mount("- 甲\n  - 甲一\n- 乙");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelectorAll(".scratch-grid > .scratch-branch")).toHaveLength(2);
    expect(document.querySelectorAll(".scratch-children .scratch-card")).toHaveLength(1);
    expect([...document.querySelectorAll<HTMLTextAreaElement>(".scratch-text")].map((area) => area.value))
      .toEqual(["甲", "甲一", "乙"]);
  });

  it("Enter 记下下一条，不需要鼠标定位", async () => {
    mount("- 甲");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const first = document.querySelector<HTMLTextAreaElement>(".scratch-text")!;
    await userEvent.click(first);
    await userEvent.keyboard("{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelectorAll(".scratch-card")).toHaveLength(2);
    expect(document.activeElement).toBe(document.querySelectorAll(".scratch-text")[1]);
  });

  it("选中父卡片后连子树生成正式文档", async () => {
    const { promoted } = mount("- 甲\n  - 甲一\n- 乙");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await userEvent.click(document.querySelectorAll<HTMLElement>('.scratch-select')[0]);
    const button = [...document.querySelectorAll<HTMLButtonElement>(".scratch-toolbar button")]
      .find((candidate) => candidate.textContent?.includes("生成文档"))!;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect(promoted).toHaveBeenCalledWith("- 甲\n  - 甲一");
  });

  it("触摸设备上行内菜单有 32px、展开后的操作项有 44px 命中区", async () => {
    document.documentElement.dataset.touch = "on";
    mount("- 甲\n- 乙");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const more = document.querySelector<HTMLButtonElement>(".scratch-more")!;
    expect(more.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    await userEvent.click(more);
    const items = [...document.querySelectorAll<HTMLButtonElement>(".scratch-menu button")];
    expect(items.length).toBeGreaterThan(4);
    expect(items.every((button) => button.getBoundingClientRect().height >= 44)).toBe(true);
  });
});
