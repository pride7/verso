/**
 * 自动展开的触发词不许是另一条触发词的前缀。DESIGN.md §5.4
 *
 * 这一条不是洁癖。两条都自动展开时，打到短的那一刻就先炸了，长的那条
 * **永远轮不到** —— 而且失败得很安静：`inf` 得到的是合法的 `\inf`（下确界），
 * 用户只会以为自己记错了触发词。设计里 `pmat` / `pmat3x3` 那一对就是为此
 * 把短的改成 Tab 触发的。
 *
 * 用测试钉住而不是靠人记：这份库是要长期迭代的（§5.4），而加一条新触发词的
 * 人不会去回想它是不是撞了三百行以外的另一条。
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_SNIPPETS } from "../../../../src/core/snippets/defaults";
import { compileAll } from "../../../../src/core/snippets/types";
import { expand, findTrigger } from "../../../../src/core/snippets/match";

const ALL = compileAll(DEFAULT_SNIPPETS);

/** 正则触发的那两条没有固定的触发词，不参与前缀比较 */
const PLAIN = ALL.filter((s) => !s.regex);

describe("触发词前缀", () => {
  it("自动展开的触发词不是任何别的触发词的前缀", () => {
    const offenders: string[] = [];
    for (const a of PLAIN) {
      if (!a.auto) continue;
      for (const b of PLAIN) {
        if (a.trigger === b.trigger) continue;
        if (b.trigger.startsWith(a.trigger)) {
          offenders.push(`${a.trigger} 挡住 ${b.trigger}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 上面那条是规则，这一条是后果 —— 逐字符地打，看最终得到什么。
   *
   * `findTrigger` 一次喂整串是测不出来的：真实输入是一个字符一个字符进来的，
   * 短触发词在中途就把前面吃掉了，后面的字符只能接在展开结果后面。
   */
  it("逐字符打完整触发词，得到的是那一条自己的展开", () => {
    /** 模拟真的一个字一个字打进去，返回屏幕上最后剩下什么 */
    const type = (keys: string) => {
      let line = "";
      for (const ch of keys) {
        line += ch;
        const m = findTrigger(ALL, line, true);
        if (!m || !m.snippet.auto) continue;
        const e = expand(m.snippet.replacement, m.groups, m.snippet.build);
        line = line.slice(0, m.start) + e.text;
      }
      return line;
    };

    // 每一对都是真实踩到的：左边是想打的，右边是那条触发词自己的展开
    expect(type("inf")).toBe("\\infty");
    expect(type("int")).toBe("\\int  \\, d");
    expect(type("inv")).toBe("^{-1}");
    expect(type("sube")).toBe("\\subseteq");
    expect(type("star")).toBe("^{*}");
    expect(type("<=>")).toBe("\\iff");
  });

  /** 放弃 `A` 的那几条仍然要能用，只是改成 Tab 触发 */
  it("被改成 Tab 触发的短触发词照样匹配得到", () => {
    for (const trigger of ["in", "sub", "st", "EE", "<="]) {
      const m = findTrigger(ALL, trigger, true);
      expect(m?.snippet.trigger, `${trigger} 匹配不到了`).toBe(trigger);
      expect(m?.snippet.auto, `${trigger} 不该再自动展开`).toBe(false);
    }
  });
});
