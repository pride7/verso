/**
 * 模板：挑一个 → 插进当前笔记 / 用它新建一篇。DESIGN.md §4.6
 *
 * 变量展开本身在 `lib/template.test.ts` 里用纯函数测干净了。这一层测的是
 * 它接进 App 之后还成不成立：模板列表是不是真从模板目录里挑的、插入是不是
 * 落在编辑器里、用模板新建有没有把正文和 frontmatter 都写下去。
 *
 * 必须是 browser 测试：插入走的是真实 `EditorView` 的 dispatch，纯 Node 里
 * 连编辑器都建不起来（AGENTS.md「什么时候必须写 browser 测试」）。
 */
import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteContent, NoteRef, TreeNode, VaultInfo } from "./types";

const VAULT: VaultInfo = {
  root: "D:/Notes/vault",
  name: "test-vault",
  createdRepo: false,
  createdGitignore: false,
  renamedBranch: false,
};

const doc = (name: string, path: string): TreeNode => ({
  name,
  path,
  kind: "document",
  children: [],
  childDir: null,
  order: null,
  created: null,
  updated: null,
});

const TPL_BODY = "# {{title}}\n\n日期：{{date}}\n\n## 待办\n- {{cursor}}\n";

let tree: TreeNode[] = [
  doc("甲", "甲.md"),
  doc("会议纪要", "templates/会议纪要.md"),
  doc("日记", "templates/日记.md"),
];

const bodies: Record<string, string> = {
  "甲.md": "原有正文\n",
  "templates/会议纪要.md": TPL_BODY,
  "templates/日记.md": "今天：{{date:YYYY年M月D日}}\n",
};
const fronts: Record<string, string | null> = {
  "templates/会议纪要.md": "status: 草稿\n",
};

const createUntitled = vi.fn(async () => {
  tree = [...tree, doc("未命名", "未命名.md")];
  bodies["未命名.md"] = "";
  return { path: "未命名.md", id: null, title: "未命名" };
});
const createTemplate = vi.fn(async (dir: string) => {
  const path = `${dir}/未命名模板.md`;
  tree = [...tree, doc("未命名模板", path)];
  bodies[path] = "";
  return { path, id: null, title: "未命名模板" };
});
const writeNote = vi.fn(async (path: string, body: string) => {
  bodies[path] = body;
  return 0;
});
const writeFrontmatter = vi.fn(async () => 0);
const renameNote = vi.fn(async (path: string, title: string) => {
  const cut = path.lastIndexOf("/");
  const newPath = `${cut < 0 ? "" : `${path.slice(0, cut + 1)}`}${title}.md`;
  tree = tree.map((node) =>
    node.path === path ? { ...node, name: title, path: newPath } : node,
  );
  bodies[newPath] = bodies[path];
  fronts[newPath] = fronts[path];
  delete bodies[path];
  delete fronts[path];
  return newPath;
});
const deleteNote = vi.fn(async (path: string) => {
  tree = tree.filter((node) => node.path !== path);
  delete bodies[path];
  delete fronts[path];
});

const { confirmDialog } = vi.hoisted(() => ({
  confirmDialog: vi.fn(async () => true),
}));

vi.mock("./lib/dialog", () => ({ confirm: confirmDialog }));

vi.mock("./api", () => ({
  api: {
    isMobile: async () => false,
    openDefaultVault: async () => VAULT,
    reopenLastVault: async () => ({ vault: VAULT, lastNote: "甲.md" }),
    openVault: async () => VAULT,
    tree: async () => tree,
    listNotes: async () => tree.map((n) => ({ path: n.path, name: n.name })) as NoteRef[],
    readNote: async (path: string) =>
      ({
        path,
        id: null,
        title: path.replace(/\.md$/, "").split("/").pop()!,
        frontmatter: {},
        frontmatterText: fronts[path] ?? null,
        body: bodies[path] ?? "",
        mtimeMs: 0,
      }) as NoteContent,
    writeNote: (p: string, b: string) => writeNote(p, b),
    statNote: async () => 0,
    createNote: async () => ({ path: "x.md", id: null, title: "x" }),
    createUntitled: () => createUntitled(),
    createTemplate: (dir: string) => createTemplate(dir),
    renameNote: (path: string, title: string) => renameNote(path, title),
    moveNote: async () => "",
    deleteNote: (path: string) => deleteNote(path),
    search: async () => [],
    backlinks: async () => [],
    allTags: async () => [],
    notesByTag: async () => [],
    viewQuery: async () => ({ columns: [], rows: [], view: "table", groupBy: null }),
    propSet: async () => {},
    propRename: async () => {},
    propSchema: async () => ({}),
    reorder: async () => {},
    writeAttachment: async () => "",
    writeFrontmatter: () => writeFrontmatter(),
    workspaceGet: async () => ({ tabs: ["甲.md"], active: 0, pinnedCount: 0 }),
    workspaceSet: async () => {},
    getSettings: async () => ({}),
    setSettings: async (s: unknown) => s,
    openTerminal: async () => {},
    rebuildIndex: async () => ({}),
    ptyOpen: async () => "1",
    ptyWrite: async () => {},
    ptyResize: async () => {},
    ptyClose: async () => {},
  },
  onBackendNotice: async () => () => {},
  onVaultChanged: async () => () => {},
  onAppClosing: async () => () => {},
  onPtyData: async () => () => {},
  onPtyExit: async () => () => {},
  pickVaultFolder: async () => null,
}));

const { default: App } = await import("./App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  tree = [
    doc("甲", "甲.md"),
    doc("会议纪要", "templates/会议纪要.md"),
    doc("日记", "templates/日记.md"),
  ];
  bodies["甲.md"] = "原有正文\n";
  bodies["templates/会议纪要.md"] = TPL_BODY;
  bodies["templates/日记.md"] = "今天：{{date:YYYY年M月D日}}\n";
  fronts["templates/会议纪要.md"] = "status: 草稿\n";
  createUntitled.mockClear();
  createTemplate.mockClear();
  writeNote.mockClear();
  writeFrontmatter.mockClear();
  renameNote.mockClear();
  deleteNote.mockClear();
  confirmDialog.mockClear();
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
});

async function mountApp() {
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<App />);
    await settle(600);
  });
}

/** 从命令面板跑一条命令 —— 和用户真正的路径一致 */
async function runCommand(label: string) {
  await act(async () => {
    document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
    await settle(200);
  });
  const item = [...document.querySelectorAll<HTMLElement>(".palette-list button")].find(
    (b) => b.querySelector(".palette-label")?.textContent === label,
  )!;
  expect(item, `命令面板里该有「${label}」`).toBeTruthy();
  await act(async () => {
    item.click();
    await settle(300);
  });
}

const picker = () => document.querySelector<HTMLElement>(".modal");
const items = () => [...document.querySelectorAll<HTMLElement>(".qs-item .qs-name")];

async function pick(name: string) {
  const hit = items().find((i) => i.textContent === name)!;
  expect(hit, `模板列表里该有「${name}」`).toBeTruthy();
  await act(async () => {
    hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle(400);
  });
}

describe("插入模板", () => {
  it("列表里只有模板目录下的笔记", async () => {
    await mountApp();
    await runCommand("插入模板");

    expect(picker()).not.toBeNull();
    const names = items().map((i) => i.textContent);
    expect(names).toEqual(["会议纪要", "日记"]);
    // 普通笔记不该混进来
    expect(names).not.toContain("甲");
  });

  it("选中一个就把展开后的内容插进正文", async () => {
    await mountApp();
    await runCommand("插入模板");
    await pick("日记");

    const text = document.querySelector(".cm-content")!.textContent ?? "";
    // 变量已经展开：不该还留着 {{ }}
    expect(text).not.toContain("{{");
    expect(text).toMatch(/今天：\d{4}年\d{1,2}月\d{1,2}日/);
    // 原有正文还在 —— 插入是插入，不是覆盖
    expect(text).toContain("原有正文");
  });

  it("{{cursor}} 决定插完光标停在哪", async () => {
    await mountApp();
    await runCommand("插入模板");
    await pick("会议纪要");

    // live preview 会把 `#` 藏起来，所以这里看到的是渲染后的文字
    expect(document.querySelector(".cm-content")!.textContent).toContain("待办");

    // **光标落在哪，只能靠敲一个字看它出现在哪。** 直接读 selection
    // 验不出「用户接着打字会打在哪儿」，而那才是 {{cursor}} 的全部意义
    await act(async () => {
      await userEvent.keyboard("补材料");
      await settle(200);
    });
    expect(document.querySelector(".cm-content")!.textContent).toContain("- 补材料");
  });
});

describe("用模板新建", () => {
  it("建一篇未命名，正文是展开后的模板，frontmatter 也带过去", async () => {
    await mountApp();
    await runCommand("用模板新建文档");
    await pick("会议纪要");

    expect(createUntitled).toHaveBeenCalledTimes(1);
    expect(writeNote).toHaveBeenCalled();
    const calls = writeNote.mock.calls;
    const [path, body] = calls[calls.length - 1];
    expect(path).toBe("未命名.md");
    // {{title}} 按**新建出来的那篇**算，不是模板自己的名字
    expect(body).toContain("# 未命名");
    expect(body).not.toContain("{{");
    // 模板的属性也带过去 —— 「读书笔记」这类模板一半价值在那几个属性上
    expect(writeFrontmatter).toHaveBeenCalled();
  });

  it("建完进改名态 —— 和普通新建同一条路", async () => {
    await mountApp();
    await runCommand("用模板新建文档");
    await pick("日记");

    expect(document.querySelector(".tree-rename")).not.toBeNull();
  });
});

describe("一个模板都没有时", () => {
  it("说清楚该往哪儿放，而不是空着", async () => {
    tree = [doc("甲", "甲.md")];
    await mountApp();
    await runCommand("插入模板");

    const empty = document.querySelector(".modal-empty")?.textContent ?? "";
    expect(empty).toContain("templates/");
  });
});

describe("侧栏里的模板面板", () => {
  /** 点图标栏上的「模板」 */
  async function openPanel() {
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="模板"]')!.click();
      await settle(300);
    });
  }

  it("列出所有模板", async () => {
    await mountApp();
    await openPanel();

    const names = [...document.querySelectorAll<HTMLElement>(".tpl-name span")].map(
      (b) => b.textContent,
    );
    expect(names).toEqual(["会议纪要", "日记"]);
  });

  it("单击一行打开模板编辑，不会误插进当前笔记", async () => {
    await mountApp();
    await openPanel();

    const row = [...document.querySelectorAll<HTMLElement>(".tpl-name")].find((b) =>
      b.textContent?.includes("日记"),
    )!;
    await act(async () => {
      row.click();
      await settle(400);
    });

    const text = document.querySelector(".cm-content")!.textContent ?? "";
    expect(text).toContain("今天：{{date:YYYY年M月D日}}");
    expect(text).not.toContain("原有正文");
    expect(bodies["甲.md"]).toBe("原有正文\n");
  });

  it("插入有独立按钮，编辑模板自身时会禁用", async () => {
    await mountApp();
    await openPanel();

    const insert = document.querySelector<HTMLButtonElement>(
      '.tpl-acts button[aria-label="插入「日记」"]',
    )!;
    expect(insert.disabled).toBe(false);
    await act(async () => {
      insert.click();
      await settle(400);
    });
    expect(document.querySelector(".cm-content")!.textContent).toMatch(/今天：\d{4}年/);

    const row = [...document.querySelectorAll<HTMLElement>(".tpl-name")].find((b) =>
      b.textContent?.includes("日记"),
    )!;
    await act(async () => {
      row.click();
      await settle(400);
    });
    expect(
      document.querySelector<HTMLButtonElement>('.tpl-acts button[aria-label="插入「日记」"]')!
        .disabled,
    ).toBe(true);
  });

  it("右边的 + 是「用它新建一篇」", async () => {
    await mountApp();
    await openPanel();

    await act(async () => {
      document.querySelector<HTMLElement>('.tpl-acts button[aria-label="用「日记」新建"]')!.click();
      await settle(500);
    });

    expect(createUntitled).toHaveBeenCalledTimes(1);
    expect(writeNote).toHaveBeenCalled();
  });

  it("双击模板就地改名，并真的写回文件", async () => {
    await mountApp();
    await openPanel();

    const row = [...document.querySelectorAll<HTMLElement>(".tpl-name")].find((b) =>
      b.textContent?.includes("日记"),
    )!;
    await act(async () => {
      await userEvent.dblClick(row);
      await settle(150);
    });
    const input = document.querySelector<HTMLInputElement>(".tpl-rename")!;
    expect(input.value).toBe("日记");

    await act(async () => {
      await userEvent.fill(input, "晨间日记");
      await userEvent.keyboard("{Enter}");
      await settle(500);
    });
    expect(renameNote).toHaveBeenCalledWith("templates/日记.md", "晨间日记");
    expect(document.querySelector(".tpl-list")?.textContent).toContain("晨间日记");
  });

  it("右键和常显的更多按钮都有完整管理菜单", async () => {
    await mountApp();
    await openPanel();

    const row = [...document.querySelectorAll<HTMLElement>(".tpl-name")].find((b) =>
      b.textContent?.includes("日记"),
    )!;
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 180,
        }),
      );
      await settle(100);
    });
    const menuText = document.querySelector(".tpl-menu")?.textContent ?? "";
    for (const action of [
      "编辑模板",
      "插入到当前笔记",
      "用模板新建文档",
      "重命名",
      "删除模板",
    ]) {
      expect(menuText).toContain(action);
    }

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await settle(50);
      document
        .querySelector<HTMLButtonElement>('.tpl-acts button[aria-label="管理「日记」"]')!
        .click();
      await settle(100);
    });
    expect(document.querySelector(".tpl-menu")?.textContent).toContain("重命名");
  });

  it("可以从更多菜单删除模板", async () => {
    await mountApp();
    await openPanel();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('.tpl-acts button[aria-label="管理「日记」"]')!
        .click();
      await settle(100);
    });
    const remove = [...document.querySelectorAll<HTMLButtonElement>(".tpl-menu button")].find(
      (button) => button.textContent?.trim() === "删除模板",
    )!;
    await act(async () => {
      remove.click();
      await settle(500);
    });

    expect(confirmDialog).toHaveBeenCalled();
    expect(deleteNote).toHaveBeenCalledWith("templates/日记.md");
    expect(document.querySelector(".tpl-list")?.textContent).not.toContain("日记");
  });

  it("一个模板都没有时，说清楚往哪儿放", async () => {
    tree = [doc("甲", "甲.md")];
    await mountApp();
    await openPanel();

    const empty = document.querySelector(".side-empty")?.textContent ?? "";
    expect(empty).toContain("templates/");
  });

  it("不用预先建立目录，可以在空面板里直接新建并就地改名", async () => {
    tree = [doc("甲", "甲.md")];
    await mountApp();
    await openPanel();

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".tpl-new")!.click();
      await settle(500);
    });

    expect(createTemplate).toHaveBeenCalledWith("templates");
    expect(document.querySelector<HTMLInputElement>(".tpl-rename")?.value).toBe("未命名模板");
    expect(document.querySelector(".cm-content")?.textContent).toBe("");
  });

  it("变量说明列全变量、日期格式和正文边界", async () => {
    await mountApp();
    await openPanel();

    const details = document.querySelector<HTMLDetailsElement>(".tpl-help")!;
    await act(async () => {
      details.querySelector<HTMLElement>("summary")!.click();
      await settle(100);
    });

    expect(details.open).toBe(true);
    const help = details.textContent ?? "";
    for (const variable of [
      "{{title}}",
      "{{path}}",
      "{{date}}",
      "{{time}}",
      "{{selection}}",
      "{{cursor}}",
    ]) {
      expect(help).toContain(variable);
    }
    expect(help).toContain("YYYY年M月D日");
    expect(help).toContain("变量只替换正文");
  });
});

describe("默认快捷键", () => {
  /** 命令面板里那一行显示的键位 —— 用户看到的就是这个 */
  function keyOf(label: string): string | undefined {
    const row = [...document.querySelectorAll<HTMLElement>(".palette-list button")].find(
      (b) => b.querySelector(".palette-label")?.textContent === label,
    );
    return row?.querySelector(".palette-keys")?.textContent ?? undefined;
  }

  async function openPalette() {
    await act(async () => {
      document.querySelector<HTMLElement>('.rail-btn[aria-label="命令面板"]')!.click();
      await settle(200);
    });
  }

  it("三条模板命令都有默认键位", async () => {
    await mountApp();
    await openPalette();

    expect(keyOf("插入模板")).toBe("Ctrl+Alt+T");
    // 和「新建文档」的 Ctrl+N 成一对：多按一个 Alt = 这次带模板
    expect(keyOf("用模板新建文档")).toBe("Ctrl+Alt+N");
    expect(keyOf("模板面板")).toBe("Ctrl+Shift+M");
  });

  /**
   * **两条命令绑同一个键 = 其中一条是死的**，而界面上不会有任何提示：
   * 派发时先匹配到谁就跑谁。加一条新命令时最容易犯这个错，所以这条
   * 测试扫的是整张命令表，不是模板这几条。
   */
  it("整张命令表里没有两条命令抢同一个键", async () => {
    await mountApp();
    await openPalette();

    const seen = new Map<string, string>();
    for (const b of document.querySelectorAll<HTMLElement>(".palette-list button")) {
      const keys = b.querySelector(".palette-keys")?.textContent;
      const label = b.querySelector(".palette-label")?.textContent ?? "";
      if (!keys) continue;
      expect(seen.has(keys), `「${label}」和「${seen.get(keys)}」都绑了 ${keys}`).toBe(false);
      seen.set(keys, label);
    }
    // 命令面板默认只列出可用的命令，扫到的条数得像回事，否则这条测试是空转
    expect(seen.size).toBeGreaterThan(10);
  });

  it("按下 Ctrl+Alt+T 就插入 —— 不用先打开面板", async () => {
    await mountApp();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyT",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle(300);
    });
    expect(document.querySelector(".modal"), "该弹出模板选择器").not.toBeNull();
  });
});
