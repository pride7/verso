import { describe, expect, it } from "vitest";

import { DEFAULT_SNIPPETS } from "../../../../src/core/snippets/defaults";
import { expand, findTrigger, taboutTarget } from "../../../../src/core/snippets/match";
import { compileAll, type SnippetSpec } from "../../../../src/core/snippets/types";

const ALL = compileAll(DEFAULT_SNIPPETS);

/** 模拟「在数学模式里敲完 textBefore」，返回展开后的文本和跳转点 */
function fire(textBefore: string, inMath = true) {
  const m = findTrigger(ALL, textBefore, inMath);
  if (!m) return null;
  const e = expand(m.snippet.replacement, m.groups, m.snippet.build);
  return {
    trigger: m.snippet.trigger,
    // 触发词被替换掉之后，整行长什么样
    line: textBefore.slice(0, m.start) + e.text,
    text: e.text,
    tabstops: e.tabstops,
    auto: m.snippet.auto,
  };
}

describe("触发词匹配", () => {
  it("分式：// 展开成 frac 并把光标放在分子", () => {
    const r = fire("//")!;
    expect(r.text).toBe("\\frac{}{}");
    // $0 在分子里，$1 在分母里，$2 在整体之后
    expect(r.tabstops).toEqual([6, 8, 9]);
    expect(r.auto).toBe(true);
  });

  it("上标：sr 变成 ^2", () => {
    expect(fire("x sr")!.line).toBe("x ^{2}");
  });

  it("希腊字母", () => {
    expect(fire("@a")!.text).toBe("\\alpha");
    expect(fire("@S")!.text).toBe("\\Sigma");
  });

  it("正文里不触发数学 snippet", () => {
    expect(fire("//", false)).toBeNull();
    expect(fire("sr", false)).toBeNull();
  });

  it("数学模式里不触发正文 snippet", () => {
    // mk 是「从正文进入数学模式」，在公式里再触发会套娃
    expect(fire("mk", true)).toBeNull();
    expect(fire("mk", false)!.text).toBe("$$");
  });

  /**
   * 词边界是最容易出事的地方：`in` 是个普通英文词，没有 `w` 标志的话，
   * 在公式里写 `\sin` 或者变量名 `point` 都会被吃掉。
   */
  it("词边界：普通英文词不会在词中间被吃掉", () => {
    expect(fire("x in")!.text).toBe("\\in"); // 前面是空格，触发
    expect(fire("point")).toBeNull(); // in 在词中间，不触发
    expect(fire("\\sin")).toBeNull(); // 反斜杠命令里的 in 不触发
  });

  it("更具体的触发词赢过更短的", () => {
    // sub 与 sube 都能匹配 "sube"，应当选后者
    expect(fire("x sube")!.text).toBe("\\subseteq");
    // <= 与 <=> 都能匹配 "<=>"，应当选后者
    expect(fire("a <=>")!.text).toBe("\\iff");
  });

  /**
   * `_`/`^` 后面的 `{}` 是分组，展开成 `\left\{ \right\}` 会得到
   * `h_\left\{` 这种非法 LaTeX（KaTeX 当场报错）。真实用户报过这条。
   */
  it("上下标后面的 {} 保持普通分组，不做自适应定界符", () => {
    const sub = fire("h_{}")!;
    expect(sub.line).toBe("h_{}");
    expect(sub.tabstops).toEqual([2, 3]); // 光标落在花括号里
    expect(fire("h^{}")!.line).toBe("h^{}");
    // 不挨着上下标时仍然是自适应花括号
    expect(fire("A {}")!.text).toBe("\\left\\{  \\right\\}");
  });

  it("命令名后面的 {} 是参数，同样保持普通分组", () => {
    expect(fire("\\mathbf{}")!.line).toBe("\\mathbf{}");
    expect(fire("\\text{}")!.line).toBe("\\text{}");
    // 手打 \frac 时第二个参数的 {} 前面是 `}`
    expect(fire("\\frac{a}{}")!.line).toBe("\\frac{a}{}");
  });

  it("函数名自动加反斜杠", () => {
    expect(fire("sin")!.text).toBe("\\sin");
    expect(fire("arctan")!.text).toBe("\\arctan");
    // 已经有反斜杠的不重复加
    expect(fire("\\sin")).toBeNull();
    // 变量名里的子串不误触
    expect(fire("cosine")).toBeNull();
  });
});

describe("展开与跳转点", () => {
  it("$n 按序号排序，不按出现顺序", () => {
    const e = expand("a$2b$0c$1");
    expect(e.text).toBe("abc");
    // $0 在 "ab" 之后（位置 2），$1 在 "abc" 之后（3），$2 在 "a" 之后（1）
    expect(e.tabstops).toEqual([2, 3, 1]);
  });

  it("$ 后面不是数字时当字面量", () => {
    // `mk` 的替换是 `$$0$`：字面 $ + 跳转点0 + 字面 $
    const e = expand("$$0$");
    expect(e.text).toBe("$$");
    expect(e.tabstops).toEqual([1]);
  });

  it("[[n]] 引用捕获组", () => {
    expect(expand("\\[[0]]", ["sin"]).text).toBe("\\sin");
    expect(expand("[[0]]_{[[1]]}", ["x", "1"]).text).toBe("x_{1}");
  });

  it("没有跳转点时返回空数组", () => {
    expect(expand("\\alpha")).toEqual({ text: "\\alpha", tabstops: [] });
  });
});

describe("矩阵按尺寸生成（§5.3）", () => {
  it("pmat3x3 生成 3×3 骨架，每个单元格一个跳转点", () => {
    const r = fire("pmat3x3")!;
    expect(r.text).toBe(
      "\\begin{pmatrix}  &  &  \\\\  &  &  \\\\  &  &  \\end{pmatrix}",
    );
    expect(r.tabstops).toHaveLength(10); // 9 个单元格 + 1 个出口
  });

  it("bmat2x2 用方括号环境", () => {
    expect(fire("bmat2x2")!.text).toContain("\\begin{bmatrix}");
  });
});

describe("tabout（§5.1）", () => {
  it("跳到最近的闭合符号之外", () => {
    //  \frac{a|}{b}   →  应当跳到 } 之后
    expect(taboutTarget("\\frac{a}{b}", 7)).toBe(8);
  });

  it("认得各种闭合符号", () => {
    expect(taboutTarget("(x)", 1)).toBe(3);
    expect(taboutTarget("[x]", 1)).toBe(3);
    expect(taboutTarget("$x$", 1)).toBe(3);
    expect(taboutTarget("|x|", 1)).toBe(3);
  });

  it("后面没有闭合符号时返回 null，让 Tab 走默认行为", () => {
    expect(taboutTarget("abc", 1)).toBeNull();
  });
});

describe("默认库的完整性", () => {
  it("触发词不重复", () => {
    const seen = new Map<string, number>();
    for (const s of DEFAULT_SNIPPETS) {
      seen.set(s.trigger, (seen.get(s.trigger) ?? 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([t]) => t);
    expect(dupes).toEqual([]);
  });

  it("每条都标了模式，不会在正文和公式里同时触发", () => {
    const bad = DEFAULT_SNIPPETS.filter(
      (s) => !s.options.includes("m") && !s.options.includes("t"),
    );
    expect(bad.map((s) => s.trigger)).toEqual([]);
  });

  it("每条都有中文描述，符号面板才搜得到", () => {
    const missing = DEFAULT_SNIPPETS.filter((s) => !s.description);
    expect(missing.map((s) => s.trigger)).toEqual([]);
  });

  it("规模够用", () => {
    expect(DEFAULT_SNIPPETS.length).toBeGreaterThan(100);
  });

  /**
   * 误触是最能毁掉手感的一类 bug：在公式里写个变量名，半个词突然变成
   * LaTeX 命令。开发中真的踩到过 `point` → `p\oint`。
   *
   * 这条测试把已知的危险词钉死，以后新增 snippet 忘了加 `w` 会立刻失败。
   */
  it("常见标识符不会被误触", () => {
    const identifiers = [
      "point", // oint
      "print", // int
      "distance", // ang? st?
      "cost", // st
      "constraint", // int
      "domain", // dm(正文)、ang
      "variance", // ang
      "gradient", // grad
      "sublimit", // sub / lim
      "capacity", // cap
      "information", // inf / int
      "matrix", // rm
      "context", // text
      "absolute", // abs
      "normal", // norm
      "propagate", // prop
      "summary", // sum
      "product", // prod
      "vector", // vec
      "category", // cal
      "barrier", // bar
      "hatch", // hat
      "starting", // star
    ];
    const misfired = identifiers.filter((w) => findTrigger(ALL, w, true) !== null);
    expect(misfired).toEqual([]);
  });
});

describe("用户自定义能覆盖内置", () => {
  it("同触发词时优先级高的赢", () => {
    const custom: SnippetSpec[] = [
      { trigger: "//", replacement: "\\dfrac{$0}{$1}", options: "mA", priority: 100 },
    ];
    const merged = compileAll([...DEFAULT_SNIPPETS, ...custom]);
    const m = findTrigger(merged, "//", true)!;
    expect(expand(m.snippet.replacement, m.groups).text).toBe("\\dfrac{}{}");
  });
});
