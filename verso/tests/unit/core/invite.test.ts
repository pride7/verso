import { describe, expect, it } from "vitest";

import { buildInvite, folderNameFromUrl, parseInvite } from "../../../src/core/invite";

describe("buildInvite", () => {
  it("邀请是一段能直接发出去的话，不是一串协议链接", () => {
    const text = buildInvite({ url: "https://github.com/alice/notes.git", name: "与 @bob 的共享" });
    expect(text).toContain("与 @bob 的共享");
    expect(text).toContain("https://github.com/alice/notes.git");
    // 收到的人要知道拿它去哪儿用；只发一个地址等于让对方自己猜
    expect(text).toContain("加入共享空间");
  });

  it("没有空间名也生成得出来", () => {
    expect(buildInvite({ url: "https://example.com/x.git" })).toContain("https://example.com/x.git");
  });

  it("自己生成的邀请自己认得回来", () => {
    const invite = parseInvite(buildInvite({ url: "https://github.com/a/b.git", name: "组会记录" }));
    expect(invite).toEqual({ url: "https://github.com/a/b.git", name: "组会记录" });
  });
});

describe("parseInvite", () => {
  it("整段邀请里认出地址和空间名", () => {
    const invite = parseInvite(`【Verso 共享空间邀请】实验组
在 Verso 里点「加入共享空间」，把这段整个粘贴进去即可。
https://github.com/lab/records.git`);
    expect(invite).toEqual({ url: "https://github.com/lab/records.git", name: "实验组" });
  });

  it("对方只发来一个裸地址也能用 —— 退化得体面", () => {
    expect(parseInvite("https://github.com/lab/records.git")).toEqual({
      url: "https://github.com/lab/records.git",
      name: null,
    });
  });

  it("SSH 与 git@ 形式都认", () => {
    expect(parseInvite("git@github.com:lab/records.git")?.url).toBe("git@github.com:lab/records.git");
    expect(parseInvite("ssh://git@example.com/lab/records.git")?.url).toBe(
      "ssh://git@example.com/lab/records.git",
    );
  });

  it("owner/repo 简写补成 GitHub 地址", () => {
    expect(parseInvite("lab/records")?.url).toBe("https://github.com/lab/records.git");
  });

  it("从聊天记录里带出来的句号和右括号不属于地址", () => {
    expect(parseInvite("地址在这（https://github.com/lab/records.git）。")?.url).toBe(
      "https://github.com/lab/records.git",
    );
  });

  it("真的地址优先于看起来像简写的普通词", () => {
    // 「加入共享空间」那句话里就有斜杠形状的东西时，不能把它当成仓库
    const invite = parseInvite("参考 docs/readme 里的说明 https://github.com/lab/records.git");
    expect(invite?.url).toBe("https://github.com/lab/records.git");
  });

  it("认不出来时返回 null，让界面说清楚看到了什么", () => {
    expect(parseInvite("明天下午三点开会")).toBeNull();
    expect(parseInvite("   ")).toBeNull();
  });
});

describe("folderNameFromUrl", () => {
  it("本地目录就叫仓库名 —— 两边机器上是同一个称呼", () => {
    expect(folderNameFromUrl("https://github.com/lab/records.git")).toBe("records");
    expect(folderNameFromUrl("https://github.com/lab/records")).toBe("records");
    expect(folderNameFromUrl("https://github.com/lab/records/")).toBe("records");
    expect(folderNameFromUrl("git@github.com:lab/records.git")).toBe("records");
  });

  it("远端地址可以很随意，本地目录名不行", () => {
    expect(folderNameFromUrl("https://example.com/a/b<c>d.git")).toBe("b-c-d");
  });

  it("取不出名字时也得有个能建的目录", () => {
    expect(folderNameFromUrl("https://example.com/")).toBe("shared-space");
  });
});
