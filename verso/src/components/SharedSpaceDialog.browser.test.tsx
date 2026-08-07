import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SharedSpaceAccess } from "../types";
import { SharedSpaceDialog } from "./SharedSpaceDialog";
import "../styles.css";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = "";
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

function button(host: HTMLElement, label: string) {
  const hit = [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent?.trim() === label);
  if (!hit) throw new Error(`没有找到按钮「${label}」`);
  return hit;
}

function mountDialog(overrides: Partial<Parameters<typeof SharedSpaceDialog>[0]> = {}) {
  const access: SharedSpaceAccess = {
    members: ["owner", "person-1"],
    pending: ["person-2"],
    github: true,
    verified: true,
    warning: null,
  };
  const props: Parameters<typeof SharedSpaceDialog>[0] = {
    space: {
      root: "D:/Notes/Verso Shared/group",
      name: "与 @person-1 的共享",
      members: ["person-1"],
      entries: ["论文/方案.md", "记录.md"],
      remote: "https://github.com/owner/shared.git",
    },
    privateVaults: [
      { root: "D:/Notes/private-a", name: "研究笔记", available: true, shared: false },
      { root: "D:/Notes/private-b", name: "私人草稿", available: true, shared: false },
      { root: "D:/Notes/missing", name: "已移动", available: false, shared: false },
    ],
    account: { login: "owner" },
    busy: false,
    onLoadAccess: vi.fn(async () => access),
    onInvite: vi.fn(async () => ({ ...access, pending: [...access.pending, "person-3"] })),
    onRemove: vi.fn(async () => access),
    onUnshare: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...overrides,
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  root.render(<SharedSpaceDialog {...props} />);
  return { host, props };
}

describe("共享空间管理", () => {
  it("展示共享根、实时成员和待接受邀请，并保护当前账号", async () => {
    const { host } = mountDialog();
    await settle();

    expect(host.textContent).toContain("方案");
    expect(host.textContent).toContain("记录");
    expect(host.textContent).toContain("@person-1");
    expect(host.textContent).toContain("等待接受");
    expect(host.querySelector('button[aria-label="移除 @owner"]')).toBeNull();
    expect(host.querySelector('button[aria-label="移除 @person-1"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="撤销 @person-2 的邀请"]')).toBeTruthy();

    const dialog = host.querySelector<HTMLElement>(".shared-space-dialog")!;
    const rect = dialog.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(500);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it("邀请和移除都等待远端返回的新权限，而不是只改本地名单", async () => {
    const invite = vi.fn(async (): Promise<SharedSpaceAccess> => ({
      members: ["owner", "person-1"],
      pending: ["person-2", "person-3"],
      github: true,
      verified: true,
      warning: null,
    }));
    const remove = vi.fn(async (_root: string, username: string): Promise<SharedSpaceAccess> => ({
      members: username === "person-1" ? ["owner"] : ["owner", "person-1"],
      pending: ["person-2"],
      github: true,
      verified: true,
      warning: null,
    }));
    const { host } = mountDialog({ onInvite: invite, onRemove: remove });
    await settle();

    const input = host.querySelector<HTMLInputElement>('input[aria-label="邀请 GitHub 成员"]')!;
    await userEvent.fill(input, "person-3");
    await userEvent.click(button(host, "邀请"));
    await settle();
    expect(invite).toHaveBeenCalledWith("D:/Notes/Verso Shared/group", "person-3");
    expect(host.textContent).toContain("@person-3");

    await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="移除 @person-1"]')!);
    await settle();
    expect(remove).toHaveBeenCalledWith("D:/Notes/Verso Shared/group", "person-1");
  });

  it("移回私人前必须选目标并确认无法收回历史副本", async () => {
    const unshare = vi.fn(async () => {});
    const { host } = mountDialog({ onUnshare: unshare });
    await settle();

    await userEvent.click(button(host, "移回私人…"));
    const confirm = button(host, "移回私人");
    expect(confirm.disabled).toBe(true);
    expect(host.textContent).toContain("已经下载的文件和 Git 历史无法收回");

    const select = host.querySelector<HTMLSelectElement>(".shared-unshare-confirm select")!;
    await userEvent.selectOptions(select, "D:/Notes/private-b");
    await userEvent.click(host.querySelector<HTMLInputElement>('.shared-unshare-check input')!);
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    await settle();

    expect(unshare).toHaveBeenCalledWith(
      "D:/Notes/Verso Shared/group",
      "论文/方案.md",
      "D:/Notes/private-b",
    );
  });
});
