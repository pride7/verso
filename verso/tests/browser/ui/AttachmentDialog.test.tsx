import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "../../../src/ui/styles.css";

const audit = vi.fn(async () => ({
  missing: [{
    path: "attachments/缺失.pdf",
    references: [{ note: "项目/实验.md", line: 12 }],
  }],
  unused: [
    { path: "attachments/旧图.png", size: 2048 },
    { path: "attachments/草稿.pdf", size: 1024 * 1024 },
  ],
}));
const remove = vi.fn(async (paths: string[]) => paths.slice(0, 1));
vi.mock("../../../src/host/api", () => ({
  api: { attachmentAudit: audit, deleteUnusedAttachments: remove },
}));
vi.mock("../../../src/host/dialog", () => ({ confirm: vi.fn(async () => true) }));

const { AttachmentDialog } = await import("../../../src/ui/AttachmentDialog");

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function mount(onOpen = vi.fn(), onChanged = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<AttachmentDialog onOpen={onOpen} onChanged={onChanged} onClose={() => {}} />);
  return { onOpen, onChanged };
}

describe("附件体检", () => {
  it("缺失项能跳到引用出处", async () => {
    const { onOpen } = mount();
    await vi.waitFor(() => expect(document.querySelector(".attachment-section")).not.toBeNull());
    expect(document.body.textContent).toContain("attachments/缺失.pdf");
    await userEvent.click([...document.querySelectorAll<HTMLButtonElement>(".attachment-refs button")][0]);
    expect(onOpen).toHaveBeenCalledWith("项目/实验.md", 12);
  });

  it("只删除勾选项，并报告后端跳过的过期项目", async () => {
    const { onChanged } = mount();
    await vi.waitFor(() => expect(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).toHaveLength(2));
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await userEvent.click(input);
    }
    await userEvent.click(document.querySelector<HTMLButtonElement>(".attachment-dialog-foot .btn-danger")!);
    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
    expect(remove).toHaveBeenCalledWith(["attachments/旧图.png", "attachments/草稿.pdf"]);
    expect(onChanged).toHaveBeenCalledWith(1, 1);
  });
});
