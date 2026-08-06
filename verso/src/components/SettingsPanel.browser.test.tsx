import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/dialog", () => ({ confirm: vi.fn(async () => true) }));

import { parseCustomSnippets } from "../editor/snippets/custom";
import { parseSlashCustom } from "../lib/slash";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { SettingsPanel, type Tab } from "./SettingsPanel";
import "../styles.css";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = "";
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

function mountSettings(
  tab: Tab,
  patch: Partial<Settings> = {},
  extra: Partial<Parameters<typeof SettingsPanel>[0]> = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const changes: Partial<Settings>[] = [];
  const root = createRoot(host);
  roots.push(root);
  root.render(
    <SettingsPanel
      settings={{ ...DEFAULT_SETTINGS, ...patch }}
      commands={[]}
      onChange={(change) => changes.push(change)}
      onReset={() => {}}
      onClose={() => {}}
      remote={null}
      tokenSaved={false}
      identity={null}
      githubAccount={null}
      githubChecking={false}
      onRemoteChange={() => {}}
      onTokenChange={() => {}}
      onIdentityChange={() => {}}
      onGitHubCheck={() => {}}
      onGitHubConnect={async () => ({ login: "owner" })}
      onGitHubDisconnect={async () => {}}
      agentsDocAvailable={true}
      onOpenAgentsDoc={() => {}}
      onRewriteAgentsDoc={async () => {}}
      update={{
        state: { phase: "idle" },
        check: () => {},
        download: () => {},
        install: () => {},
        dismiss: () => {},
      }}
      initialTab={tab}
      {...extra}
    />,
  );
  return { host, changes };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const hit = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!hit) throw new Error(`没有找到按钮「${label}」`);
  return hit;
}

describe("AI 协作设置", () => {
  it("把真实规则文件放在专用入口，并确认后才恢复默认内容", async () => {
    const open = vi.fn();
    const rewrite = vi.fn(async () => {});
    const { host } = mountSettings("ai", {}, {
      onOpenAgentsDoc: open,
      onRewriteAgentsDoc: rewrite,
    });
    await settle();

    expect(host.textContent).toContain("AGENTS.md");
    expect(host.textContent).toContain("CLAUDE.md");
    expect(host.textContent).toContain("不会混进普通文档树");

    await userEvent.click(button(host, "打开并编辑"));
    expect(open).toHaveBeenCalledOnce();

    await userEvent.click(button(host, "恢复默认说明"));
    await settle();
    expect(rewrite).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("已恢复当前版本的默认说明");
  });

  it("没有打开仓库时不允许操作规则文件", async () => {
    const { host } = mountSettings("ai", {}, { agentsDocAvailable: false });
    await settle();

    expect(button(host, "打开并编辑").disabled).toBe(true);
    expect(button(host, "恢复默认说明").disabled).toBe(true);
    expect(host.textContent).toContain("打开一个仓库后才能管理这些文件");
  });
});

describe("公式补全设置表格", () => {
  it("已有 JSON 自动变成表格，迁移入口默认收起", async () => {
    const { host } = mountSettings("snippets", {
      customSnippets: JSON.stringify([
        { trigger: "@a", replacement: "\\alpha", options: "mA", description: "alpha" },
      ]),
    });
    await settle();

    expect(host.querySelectorAll(".set-snippet-table tbody tr")).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('[aria-label="第 1 条触发词"]')!.value).toBe("@a");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="第 1 条展开内容"]')!.value)
      .toBe("\\alpha");
    const details = host.querySelector<HTMLDetailsElement>(".set-import")!;
    expect(details.open).toBe(false);
    // closed details 里的元素在 Chromium 里仍可能保留布局尺寸；checkVisibility
    // 才回答用户到底看不看得见它。
    expect(details.querySelector("textarea")!.checkVisibility()).toBe(false);

    const wrap = host.querySelector<HTMLElement>(".set-snippet-table")!.parentElement!;
    expect(wrap.scrollWidth).toBeLessThanOrEqual(wrap.clientWidth + 1);
    const action = host.querySelector<HTMLElement>(".set-table-row-actions button")!;
    expect(action.getBoundingClientRect().width).toBeLessThanOrEqual(24);
  });

  it("新增规则、设置条件并应用，不需要编辑 JSON", async () => {
    const { host, changes } = mountSettings("snippets");
    await settle();

    await userEvent.click(button(host, "新增规则"));
    await userEvent.fill(
      host.querySelector<HTMLInputElement>('[aria-label="第 1 条触发词"]')!,
      "@b",
    );
    await userEvent.fill(
      host.querySelector<HTMLTextAreaElement>('[aria-label="第 1 条展开内容"]')!,
      "\\beta$0",
    );
    await userEvent.click(button(host, "词界"));
    await userEvent.click(button(host, "应用更改"));

    const saved = changes[changes.length - 1]?.customSnippets;
    expect(typeof saved).toBe("string");
    expect(parseCustomSnippets(saved!)).toEqual({
      specs: [{ trigger: "@b", replacement: "\\beta$0", options: "mAw" }],
      errors: [],
    });
  });

  it("规则可以上下排序和删除", async () => {
    const { host } = mountSettings("snippets", {
      customSnippets: JSON.stringify([
        { trigger: "@a", replacement: "\\alpha", options: "mA" },
        { trigger: "@b", replacement: "\\beta", options: "mA" },
      ]),
    });
    await settle();

    let rows = [...host.querySelectorAll<HTMLElement>(".set-snippet-table tbody tr")];
    await userEvent.click(rows[0].querySelector('[aria-label="下移这一行"]')!);
    rows = [...host.querySelectorAll<HTMLElement>(".set-snippet-table tbody tr")];
    expect(rows[0].querySelector<HTMLInputElement>("input")!.value).toBe("@b");

    await userEvent.click(rows[0].querySelector('[aria-label="删除这一行"]')!);
    expect(host.querySelectorAll(".set-snippet-table tbody tr")).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('[aria-label="第 1 条触发词"]')!.value).toBe("@a");
  });
});

describe("斜杠菜单设置表格", () => {
  it("内置命令和自定义命令都用表格管理", async () => {
    const { host, changes } = mountSettings("slash", {
      slashCustom: JSON.stringify([
        { label: "定理", detail: "callout", template: "> [!note] $0" },
      ]),
    });
    await settle();

    expect(host.querySelectorAll(".set-slash-builtins tbody tr").length).toBeGreaterThan(10);
    expect(host.querySelectorAll(".set-slash-custom-table tbody tr")).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('[aria-label="第 1 条命令名称"]')!.value)
      .toBe("定理");
    const builtins = host.querySelector<HTMLElement>(".set-builtins-wrap")!;
    expect(builtins.scrollHeight).toBeGreaterThan(builtins.clientHeight);
    expect(getComputedStyle(builtins.querySelector("th")!).position).toBe("sticky");

    await userEvent.click(host.querySelector<HTMLInputElement>('[aria-label="显示一级标题"]')!);
    expect(changes[changes.length - 1]?.slashHidden).toContain("一级标题");
  });

  it("新增多行模板并应用，$0 原样保留", async () => {
    const { host, changes } = mountSettings("slash");
    await settle();

    await userEvent.click(button(host, "新增命令"));
    await userEvent.fill(
      host.querySelector<HTMLInputElement>('[aria-label="第 1 条命令名称"]')!,
      "结论",
    );
    await userEvent.fill(
      host.querySelector<HTMLTextAreaElement>('[aria-label="第 1 条插入内容"]')!,
      "> [!success] 结论\n> $0",
    );
    await userEvent.click(button(host, "应用更改"));

    const saved = changes[changes.length - 1]?.slashCustom;
    expect(typeof saved).toBe("string");
    expect(parseSlashCustom(saved!)).toEqual({
      items: [{ label: "结论", detail: "", template: "> [!success] 结论\n> $0" }],
      errors: [],
    });
  });
});

describe("同步设置：提交署名", () => {
  const REMOTE = { url: null, branch: "main", needsToken: false };

  it("显示生效的署名，改动后才能保存，名字和邮箱一起交回去", async () => {
    const calls: [string, string][] = [];
    const { host } = mountSettings("sync", {}, {
      remote: REMOTE,
      identity: { name: "旧名", email: null },
      onIdentityChange: (name: string, email: string) => calls.push([name, email]),
    });
    await settle();

    const name = host.querySelector<HTMLInputElement>('[aria-label="署名"]')!;
    const email = host.querySelector<HTMLInputElement>('[aria-label="署名邮箱"]')!;
    expect(name.value).toBe("旧名");
    expect(email.value).toBe("");

    // 同一页还有仓库地址的「保存」，必须取署名这一行里的那个
    const save = name.closest(".set-row")!.querySelector("button")!;
    // 没改过时保存无意义，禁用比让人怀疑没生效好
    expect(save.disabled).toBe(true);

    await userEvent.fill(name, "冯");
    await userEvent.fill(email, "x@example.com");
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(calls).toEqual([["冯", "x@example.com"]]);
  });

  it("没配远端时署名照样能编辑 —— 它管的是本地提交,不依赖远端", async () => {
    const { host } = mountSettings("sync", {}, { remote: REMOTE, identity: { name: null, email: null } });
    await settle();
    expect(host.querySelector('[aria-label="署名"]')).not.toBeNull();
  });

  it("GitHub 连接、仓库地址和署名都让说明独占一行，输入区排在下方", async () => {
    const { host } = mountSettings("sync", {}, {
      remote: REMOTE,
      identity: { name: "冯", email: "x@example.com" },
    });
    await settle();

    const rows = host.querySelectorAll<HTMLElement>(".set-sync-stack-row");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const label = row.querySelector<HTMLElement>(".set-label")!;
      const control = row.querySelector<HTMLElement>(".set-control")!;
      const rowRect = row.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const controlRect = control.getBoundingClientRect();
      expect(labelRect.width).toBeGreaterThan(rowRect.width * 0.9);
      expect(controlRect.top).toBeGreaterThan(labelRect.bottom);
    }
  });

  it("用户名和邮箱始终有各自的字段标签", async () => {
    const { host } = mountSettings("sync", {}, {
      remote: REMOTE,
      identity: { name: "冯", email: "x@example.com" },
    });
    await settle();

    const labels = [...host.querySelectorAll(".set-identity-field .set-field-label")].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["用户名", "邮箱"]);
  });
});

describe("同步与共享：GitHub 连接", () => {
  const REMOTE = { url: "https://github.com/owner/notes.git", branch: "main", needsToken: true };

  it("账号只在设置中连接一次，当前仓库凭据收进高级入口", async () => {
    const connect = vi.fn(async () => ({ login: "owner" }));
    const { host } = mountSettings("sync", {}, {
      remote: REMOTE,
      identity: { name: "林", email: "lin@example.com" },
      onGitHubConnect: connect,
    });
    await settle();

    expect(host.textContent).toContain("GitHub 账号只需连接一次");
    expect(host.querySelector<HTMLDetailsElement>(".set-sync-advanced")!.open).toBe(false);
    const token = host.querySelector<HTMLInputElement>('[aria-label="GitHub 连接令牌"]')!;
    await userEvent.fill(token, "secret");
    await userEvent.click(button(host, "连接"));
    await settle();
    expect(connect).toHaveBeenCalledWith("secret");
  });

  it("已连接时只显示账号与断开入口", async () => {
    const disconnect = vi.fn(async () => {});
    const { host } = mountSettings("sync", {}, {
      remote: REMOTE,
      identity: { name: "林", email: "lin@example.com" },
      githubAccount: { login: "pride7" },
      onGitHubDisconnect: disconnect,
    });
    await settle();

    expect(host.textContent).toContain("@pride7");
    expect(host.querySelector('[aria-label="GitHub 连接令牌"]')).toBeNull();
    await userEvent.click(button(host, "断开"));
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
