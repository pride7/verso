import { describe, expect, it } from "vitest";

import { EMOJI_GROUPS, normalizeIcon, searchEmoji } from "./emoji";

describe("searchEmoji", () => {
  it("按中文关键词找得到", () => {
    expect(searchEmoji("笔记").map((e) => e.ch)).toContain("📝");
    expect(searchEmoji("公式").map((e) => e.ch)).toEqual([]);
    expect(searchEmoji("数学").map((e) => e.ch)).toContain("🧮");
  });

  it("英文关键词不区分大小写", () => {
    expect(searchEmoji("BOOK").map((e) => e.ch)).toContain("📖");
  });

  it("空查询给空结果 —— 那时该显示分组浏览，不是显示全部", () => {
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });
});

describe("normalizeIcon", () => {
  /**
   * 这条是这个文件里最重要的一条：frontmatter 是用户手写的，
   * `icon: 一整段说明文字` 会把文档树每一行都撑开
   */
  it("一整段文字只取第一个字符", () => {
    expect(normalizeIcon("重要的项目笔记")).toBe("重");
  });

  it("多码点的 emoji 不能被切成半个", () => {
    // ❤️ = U+2764 + U+FE0F。按码点取会得到一个显示成方框的裸心
    expect(normalizeIcon("❤️")).toBe("❤️");
    // ZWJ 连接的组合 emoji 同理
    expect(normalizeIcon("👩‍💻")).toBe("👩‍💻");
  });

  it("空白当作没有图标", () => {
    expect(normalizeIcon("")).toBeNull();
    expect(normalizeIcon("   \n")).toBeNull();
  });

  it("表里的每一个都能原样过一遍 —— 切坏了树上就是方框", () => {
    for (const group of EMOJI_GROUPS) {
      for (const item of group.items) {
        expect(normalizeIcon(item.ch)).toBe(item.ch);
      }
    }
  });
});

describe("图标表本身", () => {
  it("没有重复的字符 —— 同一个东西出现两次会让人以为它们不一样", () => {
    const all = EMOJI_GROUPS.flatMap((g) => g.items.map((i) => i.ch));
    expect(new Set(all).size).toBe(all.length);
  });

  it("每个都带关键词，否则它只能靠肉眼在网格里找", () => {
    for (const group of EMOJI_GROUPS) {
      for (const item of group.items) {
        expect(item.keywords.length, `${item.ch} 没有关键词`).toBeGreaterThan(0);
      }
    }
  });
});
