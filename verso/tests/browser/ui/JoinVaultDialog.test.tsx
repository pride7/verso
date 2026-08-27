import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInvite } from "../../../src/core/invite";
import { JoinVaultDialog } from "../../../src/ui/JoinVaultDialog";
import "../../../src/ui/styles.css";

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

const INVITE = buildInvite({
  url: "https://github.com/lab/records.git",
  name: "与 @alice 的共享",
});

function mountDialog(overrides: Partial<Parameters<typeof JoinVaultDialog>[0]> = {}) {
  const props: Parameters<typeof JoinVaultDialog>[0] = {
    busy: false,
    error: null,
    githubAccount: { login: "bob" },
    identity: null,
    onPickFolder: vi.fn(async () => "D:/Picked"),
    onDefaultPath: vi.fn(async (folder: string) => `D:/Notes/Verso Shared/${folder}`),
    onGitHubDeviceBegin: vi.fn(async () => ({
      deviceCode: "dev",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      interval: 5,
      expiresIn: 900,
    })),
    onGitHubDevicePoll: vi.fn(async () => ({ account: null, retryAfter: 0 })),
    onJoin: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  root.render(<JoinVaultDialog {...props} />);
  return { host, props };
}

const paste = async (host: HTMLElement, text: string) => {
  await settle();
  const field = host.querySelector<HTMLTextAreaElement>(".join-invite-input")!;
  await userEvent.fill(field, text);
  await settle();
};

describe("加入共享空间", () => {
  it("粘贴一次就够：地址、位置、署名都填好并摆出来核对", async () => {
    const { host, props } = mountDialog();
    await paste(host, INVITE);

    expect(props.onDefaultPath).toHaveBeenCalledWith("records");
    const summary = host.querySelector<HTMLElement>(".join-summary")!;
    expect(summary.textContent).toContain("与 @alice 的共享");
    expect(summary.textContent).toContain("https://github.com/lab/records.git");
    expect(summary.textContent).toContain("D:/Notes/Verso Shared/records");
    // 署名会写进所有人都看得见的历史，默认值可以省掉输入、不能省掉知情
    expect(summary.textContent).toContain("bob <bob@users.noreply.github.com>");

    await userEvent.click(button(host, "加入并打开"));
    expect(props.onJoin).toHaveBeenCalledWith({
      url: "https://github.com/lab/records.git",
      path: "D:/Notes/Verso Shared/records",
      token: "",
      name: "bob",
      email: "bob@users.noreply.github.com",
    });
  });

  it("对方只发来一个裸地址照样能加入", async () => {
    const { host, props } = mountDialog();
    await paste(host, "https://github.com/lab/records.git");

    expect(host.querySelector(".join-summary")!.textContent).toContain("records");
    await userEvent.click(button(host, "加入并打开"));
    expect(props.onJoin).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://github.com/lab/records.git" }),
    );
  });

  it("已配过的提交身份优先于 GitHub 账号", async () => {
    const { host } = mountDialog({ identity: { name: "林清", email: "lin@lab.edu" } });
    await paste(host, INVITE);
    expect(host.querySelector(".join-summary")!.textContent).toContain("林清 <lin@lab.edu>");
  });

  it("认不出来时说清楚看到了什么，而不是把人挡在一个必填框前", async () => {
    const { host } = mountDialog();
    await paste(host, "明天下午三点开会");

    expect(host.querySelector(".join-summary")).toBeNull();
    expect(host.textContent).toContain("没在这段文字里找到仓库地址");
    expect(button(host, "加入并打开").disabled).toBe(true);
  });

  it("手选过位置之后不再被推导值改掉", async () => {
    const { host, props } = mountDialog();
    await paste(host, INVITE);

    await userEvent.click(button(host, "改…"));
    await settle();
    expect(host.querySelector(".join-summary")!.textContent).toContain("D:/Picked");

    // 换一个空间：位置是用户自己的决定，不该跟着地址重算
    await paste(host, "https://github.com/lab/other.git");
    expect(host.querySelector(".join-summary")!.textContent).toContain("D:/Picked");
    expect(props.onDefaultPath).toHaveBeenCalledTimes(1);
  });

  it("没连 GitHub 就地授权，不必先跑去设置面板", async () => {
    const { host, props } = mountDialog({ githubAccount: null });
    await paste(host, INVITE);

    expect(host.textContent).toContain("还需要连接一次账号");
    await userEvent.click(button(host, "在 GitHub 中连接"));
    await settle();

    expect(props.onGitHubDeviceBegin).toHaveBeenCalled();
    expect(host.textContent).toContain("ABCD-1234");
  });

  it("令牌和手选位置收进高级，不占主流程", async () => {
    const { host } = mountDialog();
    await paste(host, INVITE);

    const advanced = host.querySelector<HTMLDetailsElement>(".join-advanced")!;
    expect(advanced.open).toBe(false);
    expect(advanced.textContent).toContain("访问令牌");
  });
});
