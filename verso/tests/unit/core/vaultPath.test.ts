import { describe, expect, it } from "vitest";

import { attachmentPath, normalizeRoot } from "../../../src/core/vaultPath";

describe("normalizeRoot", () => {
  it("剥掉 Windows 的扩展长度前缀 —— 图片显示不出来就是栽在这里", () => {
    // Rust 侧 canonicalize 出来的就是这个样子
    expect(normalizeRoot("\\\\?\\D:\\Notes\\vault")).toBe("D:/Notes/vault");
  });

  it("UNC 路径还原成 //服务器/共享", () => {
    expect(normalizeRoot("\\\\?\\UNC\\srv\\share\\vault")).toBe("//srv/share/vault");
  });

  it("macOS / Linux 的路径原样不动", () => {
    expect(normalizeRoot("/Users/me/vault")).toBe("/Users/me/vault");
  });

  it("末尾的分隔符去掉，免得拼出双斜杠", () => {
    expect(normalizeRoot("D:\\Notes\\vault\\")).toBe("D:/Notes/vault");
  });
});

describe("attachmentPath", () => {
  const ROOT = "\\\\?\\D:\\Notes\\vault";

  it("粘贴插入的完整相对路径直接拼", () => {
    expect(attachmentPath(ROOT, "attachments/图.png")).toBe("D:/Notes/vault/attachments/图.png");
  });

  it("只有文件名时去 attachments/ 找（§2.3 的约定）", () => {
    expect(attachmentPath(ROOT, "图.png")).toBe("D:/Notes/vault/attachments/图.png");
  });

  it("反斜杠写法也认", () => {
    expect(attachmentPath(ROOT, "attachments\\图.png")).toBe("D:/Notes/vault/attachments/图.png");
  });

  it("`..` 一律拒绝 —— 笔记可以来自分享，不能拿它去读 vault 外面", () => {
    expect(attachmentPath(ROOT, "../../秘密.png")).toBeNull();
    expect(attachmentPath(ROOT, "attachments/../../秘密.png")).toBeNull();
  });

  it("绝对路径也拒绝", () => {
    expect(attachmentPath(ROOT, "C:/Windows/win.png")).toBeNull();
    expect(attachmentPath(ROOT, "/etc/passwd.png")).toBeNull();
  });

  it("没打开 vault、或者目标是空的，就不去取", () => {
    expect(attachmentPath("", "图.png")).toBeNull();
    expect(attachmentPath(ROOT, "   ")).toBeNull();
  });
});
