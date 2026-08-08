import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Suggestion } from "../../../src/core/types";
import { ReviewDialog } from "../../../src/ui/ReviewDialog";
import "../../../src/ui/styles.css";

const roots: Root[] = [];
const { reviewSuggestionDiff } = vi.hoisted(() => ({
  reviewSuggestionDiff: vi.fn(async (id: string, path: string) => ({
    path,
    kind: "modified" as const,
    additions: 1,
    deletions: 1,
    binary: false,
    hunks: [{
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { kind: "deleted" as const, oldLine: 1, newLine: null, text: `${id} 的原文` },
        { kind: "added" as const, oldLine: null, newLine: 1, text: `${path} 的建议` },
      ],
    }],
  })),
}));

vi.mock("../../../src/host/api", () => ({ api: { reviewSuggestionDiff } }));

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = "";
  reviewSuggestionDiff.mockClear();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

function buttons(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")]
    .filter((item) => item.textContent?.trim() === label);
}

const suggestion: Suggestion = {
  id: "suggestion-1",
  title: "补充实验结论",
  authorName: "林",
  authorEmail: "lin@example.com",
  at: Math.floor(Date.now() / 1000) - 60,
  files: [
    { path: "甲.md", previousPath: null, kind: "modified" },
    { path: "新名.md", previousPath: "旧名.md", kind: "renamed" },
  ],
  additions: 8,
  deletions: 3,
};

describe("修改建议审阅", () => {
  it("要求逐文件明确决定，并只提交接受的路径", async () => {
    const onSubmit = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    root.render(
      <ReviewDialog
        suggestion={suggestion}
        busy={false}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );
    await settle();

    const submit = buttons(host, "完成审阅")[0];
    expect(submit.disabled).toBe(true);
    expect(host.textContent).toContain("旧名 → 新名");
    expect(reviewSuggestionDiff).toHaveBeenCalledWith("suggestion-1", "甲.md");

    await userEvent.click(buttons(host, "接受")[0]);
    expect(submit.disabled).toBe(true);
    await userEvent.click(buttons(host, "退回")[1]);
    expect(submit.disabled).toBe(false);
    expect(host.textContent).toContain("将接受 1 个，退回 1 个");

    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(["甲.md"]);
  });

  it("在常见窗口内为文件列表和差异各留出可用区域", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    root.render(
      <ReviewDialog
        suggestion={suggestion}
        busy={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
    await settle();

    const modal = host.querySelector<HTMLElement>(".review-modal")!.getBoundingClientRect();
    const files = host.querySelector<HTMLElement>(".review-files")!.getBoundingClientRect();
    const diff = host.querySelector<HTMLElement>(".review-diff")!.getBoundingClientRect();
    expect(modal.right).toBeLessThanOrEqual(window.innerWidth);
    expect(modal.bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(files.width).toBeGreaterThan(220);
    expect(diff.width).toBeGreaterThan(400);
  });
});
