import { describe, expect, it } from "vitest";

import { expand } from "../editor/snippets/match";
import {
  allKeys,
  loadRecent,
  MATH_PAGES,
  pushRecent,
  RECENT_MAX,
  saveRecent,
  type MathKey,
} from "./mathbar";

const key = (insert: string): MathKey => ({ label: insert, insert });

describe("符号表", () => {
  it("四页都在，顺序按 §5.5", () => {
    expect(MATH_PAGES.map((p) => p.id)).toEqual(["struct", "greek", "ops", "env"]);
  });

  /**
   * **每一个 insert 都要能被 snippet 引擎展开。** 一个写错的 `\fracc` 在
   * 工具条上看不出来 —— 键面显示的是 `a/b`，插进笔记里才发现公式炸了。
   */
  it("每个键插进去的东西都是合法的 snippet 写法", () => {
    for (const k of allKeys()) {
      const { text, tabstops } = expand(k.insert);
      expect(text.length, `「${k.label}」插了个空`).toBeGreaterThan(0);
      // 展开之后不该还留着 `$1` 这种没被认出来的跳转点
      expect(text, `「${k.label}」有没被解析的跳转点`).not.toMatch(/\$\d/);
      // 跳转点位置必须落在文本范围内
      for (const t of tabstops) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(text.length);
      }
    }
  });

  it("反斜杠没有被少写 —— LaTeX 命令必须以单个反斜杠开头", () => {
    for (const k of allKeys()) {
      // `$…$`、`&`、`^{}` 这些不是命令，跳过
      if (!k.insert.includes("\\")) continue;
      expect(k.insert, `「${k.label}」`).not.toMatch(/(^|[^\\])\\\\[a-zA-Z]/);
    }
  });

  it("没有两个键插一模一样的东西", () => {
    const seen = new Map<string, string>();
    for (const page of MATH_PAGES) {
      for (const k of page.keys) {
        expect(seen.has(k.insert), `「${k.label}」和「${seen.get(k.insert)}」重了`).toBe(false);
        seen.set(k.insert, k.label);
      }
    }
  });

  it("长按变体的第一格就是它自己 —— 长按之后还得能选回原来那个", () => {
    for (const page of MATH_PAGES) {
      for (const k of page.keys) {
        if (!k.variants) continue;
        expect(k.variants[0].insert, `「${k.label}」`).toBe(k.insert);
        expect(k.variants.length).toBeGreaterThan(1);
      }
    }
  });

  it("矩阵换行是 LaTeX 的 `\\\\`（在 JS 字符串里是四个反斜杠）", () => {
    const nl = MATH_PAGES.find((p) => p.id === "env")!.keys.find((k) => k.label === "换行")!;
    expect(expand(nl.insert).text).toBe(" \\\\\n");
  });
});

describe("最近用过", () => {
  it("刚用的排最前，重复的不再占一格", () => {
    let list = pushRecent([], key("a"));
    list = pushRecent(list, key("b"));
    list = pushRecent(list, key("a"));
    expect(list.map((k) => k.insert)).toEqual(["a", "b"]);
  });

  it("最多留 8 个，挤掉最老的", () => {
    let list: MathKey[] = [];
    for (let i = 0; i < 12; i++) list = pushRecent(list, key(`k${i}`));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].insert).toBe("k11");
    expect(list.some((k) => k.insert === "k0")).toBe(false);
  });

  /** 存的是 insert，键面现查 —— 以后改了 label，用户那边不该留着旧的 */
  it("存下来再读回来，认的是符号表里当前的那份", () => {
    const store = new Map<string, string>();
    const io = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const real = MATH_PAGES[1].keys[0];
    saveRecent([real], io);
    expect(store.get("verso.mathbar.recent")).toBe(JSON.stringify([real.insert]));
    expect(loadRecent(io)).toEqual([real]);
  });

  it("存的东西坏了就当没有，不抛", () => {
    const bad = { getItem: () => "{不是 JSON" };
    expect(loadRecent(bad)).toEqual([]);
    expect(loadRecent({ getItem: () => '"不是数组"' })).toEqual([]);
    // 表里已经没有的符号（比如改版删掉了）直接跳过
    expect(loadRecent({ getItem: () => '["\\\\不存在的命令"]' })).toEqual([]);
  });
});
