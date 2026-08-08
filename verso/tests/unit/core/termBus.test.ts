import { afterEach, describe, expect, it } from "vitest";

import { attachTerminal, sanitizeForPaste, sendToTerminal } from "../../../src/core/termBus";

afterEach(() => attachTerminal(null));

describe("终端文本通道", () => {
  it("终端在的时候直接送过去", () => {
    const got: string[] = [];
    attachTerminal((t) => got.push(t));
    sendToTerminal("@a.md ");
    expect(got).toEqual(["@a.md "]);
  });

  it("终端还没起来时排队，就绪后按顺序补发", () => {
    sendToTerminal("@a.md ");
    sendToTerminal("@b.md ");
    const got: string[] = [];
    attachTerminal((t) => got.push(t));
    expect(got).toEqual(["@a.md ", "@b.md "]);
  });

  it("补发过一次就清空，不会第二次挂上来时又冒出来", () => {
    sendToTerminal("@a.md ");
    attachTerminal(() => {});
    const got: string[] = [];
    attachTerminal((t) => got.push(t));
    expect(got).toEqual([]);
  });

  it("终端卸载时把没送出去的也丢掉 —— 那个 shell 已经被杀了", () => {
    attachTerminal(() => {});
    attachTerminal(null);
    sendToTerminal("@a.md ");
    attachTerminal(null);
    const got: string[] = [];
    attachTerminal((t) => got.push(t));
    expect(got).toEqual([]);
  });

  /**
   * 这一组盯的是两次**真出过**的事故，它们把「按对面的模式决定要不要留换行」
   * 这个思路彻底否掉了：
   *
   * 1. PowerShell 提示符（没开括号粘贴）：`@项目/Latent.md` 那一行被 shell
   *    直接执行，回了个 ParserError。
   * 2. Codex 的 TUI（开着括号粘贴）：xterm 总会把 `\n` 换成 `\r`，而 `\r`
   *    在它的输入框里是「发送」—— 那一行被当成整条消息提交了出去。
   *
   * 所以不变量是无条件的：送进终端的东西里，一个换行、一个控制字符都没有。
   */
  describe("送进终端的永远是一行，且不含控制字符", () => {
    it("多行并成一行，一个回车都不许出现", () => {
      const out = sanitizeForPaste("@项目/Latent.md\nMSE 对 joint 有激励");
      expect(out).toBe("@项目/Latent.md MSE 对 joint 有激励");
      expect(/[\r\n]/.test(out)).toBe(false);
    });

    it("连续空行只并成一个空格，内容一个字不丢", () => {
      expect(sanitizeForPaste("甲\r\n\r\n乙\r丙")).toBe("甲 乙 丙");
    });

    it("制表符也算 —— 没开括号粘贴的 shell 里那是补全键", () => {
      expect(sanitizeForPaste("甲\t乙")).toBe("甲 乙");
    });

    /**
     * 笔记可以是分享来的、也可以是 AI 生成的（§2.9）。一段 `ESC[201~` 就能
     * 提前关掉括号粘贴，把后面的内容从「文本」变成「按键」。
     */
    it("ESC 之类的控制字符整个去掉，笔记内容不能变成按键", () => {
      const out = sanitizeForPaste("正常\x1b[201~\x1b[Aрискованно\x00");
      expect(out).toBe("正常[201~[Aрискованно");
      // eslint-disable-next-line no-control-regex
      expect(/[\x00-\x1f\x7f]/.test(out)).toBe(false);
    });

    it("`@路径 ` 末尾那个空格是分隔符，不能被 trim 掉", () => {
      expect(sanitizeForPaste("@甲.md ")).toBe("@甲.md ");
    });
  });

  it("始终没人接时不会无限攒下去，留下的是最后按的那些", () => {
    for (let i = 0; i < 40; i++) sendToTerminal(`@${i}.md `);
    const got: string[] = [];
    attachTerminal((t) => got.push(t));
    expect(got).toHaveLength(32);
    expect(got[0]).toBe("@8.md ");
    expect(got[31]).toBe("@39.md ");
  });
});
