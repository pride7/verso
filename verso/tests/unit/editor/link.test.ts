/**
 * 标准 Markdown 链接的拆解与协议判据。DESIGN.md §4.2
 *
 * 这两件事是 live preview 和点击处理**共用**的判据 —— 分开判会长出
 * 「渲染成了链接却点不动」这种状态，所以钉在这里。
 */
import { GFM, parser as baseParser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";

import { externalHref, linkParts } from "../../../src/editor/link";
import { markdownExtended } from "../../../src/editor/markdownExtended";

const parser = baseParser.configure([GFM, markdownExtended]);

/** 取文档里第一个 `Link` / `Autolink`，拆出显示文字和地址 */
function parts(src: string) {
  let found: { label: string; url: string | null } | null = null;
  parser.parse(src).iterate({
    enter(n) {
      if (found || (n.name !== "Link" && n.name !== "Autolink")) return;
      const p = linkParts(n.node);
      if (!p) return;
      found = {
        label: src.slice(p.labelFrom, p.labelTo),
        url: p.url ? src.slice(p.url.from, p.url.to) : null,
      };
    },
  });
  return found as { label: string; url: string | null } | null;
}

describe("拆链接", () => {
  it("`[文字](地址)` 拆出文字和地址", () => {
    expect(parts("[文字](https://example.com)")).toEqual({
      label: "文字",
      url: "https://example.com",
    });
  });

  it("链接文字里的格式标记留在文字那一段里", () => {
    expect(parts("[**粗**文字](https://example.com)")?.label).toBe("**粗**文字");
  });

  it("地址后面的标题不算进文字", () => {
    expect(parts('[文字](https://example.com "标题")')?.label).toBe("文字");
  });

  it("`<地址>` 的显示文字就是地址本身", () => {
    expect(parts("看 <https://example.com> 吧")).toEqual({
      label: "https://example.com",
      url: "https://example.com",
    });
  });

  /** 解析器不解引用，地址取不到 —— 这类必须保持源码，见 §4.2 */
  it("引用式链接没有地址", () => {
    expect(parts("[文字][ref]\n\n[ref]: https://example.com")?.url).toBeNull();
  });

  it("`[空]()` 没有地址", () => {
    expect(parts("[空]()")?.url).toBeNull();
  });
});

describe("能不能点开", () => {
  it("http / https 认", () => {
    expect(externalHref("https://example.com")).toBe("https://example.com");
    expect(externalHref("http://example.com/a?b=1#c")).toBe("http://example.com/a?b=1#c");
  });

  it("mailto / tel 认，大小写不敏感", () => {
    expect(externalHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(externalHref("tel:+8613800138000")).toBe("tel:+8613800138000");
    expect(externalHref("HTTPS://Example.com")).toBe("HTTPS://Example.com");
  });

  it("`<a@b.com>` 这种没写协议的邮箱补成 mailto —— GFM 的原意", () => {
    expect(externalHref("a@b.com")).toBe("mailto:a@b.com");
  });

  it("地址两头的尖括号不是地址的一部分", () => {
    expect(externalHref("<https://example.com>")).toBe("https://example.com");
  });

  /** 藏起标记却点不动等于给了个假链接，所以这几类一律保持源码 */
  it("相对路径不认 —— 内部跳转的真源是 `[[链接]]`", () => {
    expect(externalHref("./笔记.md")).toBeNull();
    expect(externalHref("笔记.md")).toBeNull();
    expect(externalHref("#锚点")).toBeNull();
    expect(externalHref("attachments/图.png")).toBeNull();
  });

  it("能在打开那一刻执行东西的协议一律不认", () => {
    expect(externalHref("javascript:alert(1)")).toBeNull();
    expect(externalHref("JavaScript:alert(1)")).toBeNull();
    expect(externalHref("data:text/html,<script>x</script>")).toBeNull();
    expect(externalHref("file:///C:/Windows")).toBeNull();
  });

  it("空地址不认", () => {
    expect(externalHref("")).toBeNull();
    expect(externalHref("   ")).toBeNull();
    expect(externalHref("<>")).toBeNull();
  });
});
