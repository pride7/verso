import { describe, expect, it } from "vitest";

import { cssFontName, DEFAULT_SETTINGS, sanitize } from "./settings";

describe("字体名转 CSS", () => {
  it("单个词不加引号", () => {
    expect(cssFontName("Inter")).toBe("Inter");
  });

  it("带空格的要加引号，否则不是合法的 font-family", () => {
    expect(cssFontName("Microsoft YaHei")).toBe('"Microsoft YaHei"');
  });

  it("前后空白无所谓", () => {
    expect(cssFontName("  Inter  ")).toBe("Inter");
  });

  it("空串表示没填", () => {
    expect(cssFontName("")).toBeNull();
    expect(cssFontName("   ")).toBeNull();
  });

  // 这个值会原样进 CSS 自定义属性。设置文件是可以手改、也可能从别处抄来的，
  // 放任引号和大括号进去就等于让它改写整个界面的样式
  it("挡掉能逃出 font-family 的字符", () => {
    expect(cssFontName('a"; } body { display:none } .x {')).toBeNull();
    expect(cssFontName("a'")).toBeNull();
    expect(cssFontName("a; b")).toBeNull();
    expect(cssFontName("a/*x*/")).toBeNull();
    expect(cssFontName("a\\b")).toBeNull();
  });
});

describe("设置夹紧", () => {
  it("默认值原样通过", () => {
    expect(sanitize(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  // 夹紧而不是报错：字号填成 0 之后，唯一能改回来的地方
  // 恰恰是那个已经看不见的设置界面
  it("离谱的字号被拉回可用范围", () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, bodyFontSize: 0, uiFontSize: 999 });
    expect(s.bodyFontSize).toBe(12);
    expect(s.uiFontSize).toBe(20);
  });

  // NaN 和 Infinity 都走「非有限值 → 回默认」这条，而不是被夹到边界上。
  // Infinity 夹到 80 也说得通，但和 Rust 侧保持一致更重要 —— 两边算出
  // 不同的值，界面显示的和存下去的就会不一样
  it("NaN 和 Infinity 都回到默认值", () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, lineHeight: NaN, contentWidth: Infinity });
    expect(s.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
    expect(s.contentWidth).toBe(DEFAULT_SETTINGS.contentWidth);
  });

  it("不认识的主题回退到跟随系统", () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, theme: "霓虹" as never });
    expect(s.theme).toBe("system");
  });

  it("字体名和 snippet 文本不动 —— 那是用户原话", () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, bodyFont: "  等线  ", customSnippets: "[]" });
    expect(s.bodyFont).toBe("  等线  ");
    expect(s.customSnippets).toBe("[]");
  });
});
