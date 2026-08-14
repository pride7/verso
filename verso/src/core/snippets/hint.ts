/**
 * 打字时的 snippet 提示。DESIGN.md §5.3
 *
 * ## 为什么需要它
 *
 * 符号面板（§5.3）解决的是「知道有这个符号、但记不住怎么打」；这里解决的是
 * **根本不知道库里有什么**。一百八十条触发词，靠翻面板背下来是不现实的 ——
 * 唯一能真正记住的方式是「正好在要用的时候看见它」。
 *
 * 所以规则是：打到某条触发词的**前缀**时，把还差几个字符的那几条列出来。
 * 打 `su` 就看见 `sum` `sub` `sube`，下次自然会直接打 `sum`。学习发生在
 * 打字的动作里，不需要专门去查。
 *
 * ## 不能吵
 *
 * 这东西一吵就会被关掉，然后就白做了。三条克制措施：
 *
 *   1. **只认最长的前缀。** `su` 有匹配就不再退回去看 `s` —— 否则在公式里
 *      打任何一个字母都弹一屏。
 *   2. **单字符前缀要求非字母数字，且至少两个候选。** `@` 弹出全套希腊字母
 *      是有用的（`@` 只可能是为了打希腊字母），而打 `(` 只会匹配到 `()`
 *      一条，弹出来纯属打扰 —— 直接不弹。
 *   3. **已经能自动展开的不再提示。** 触发词打完整时 `A` 那批早就展开了；
 *      留在列表里的只有 `pmat` 这类需要按 Tab 的，那正是最该提示的时刻。
 *
 * 纯函数，不碰 CodeMirror —— 和 `match.ts` 一样，手感靠测试守。
 */
import type { Snippet } from "./types";

export interface Hint {
  snippet: Snippet;
  /** 已经打出来的那段前缀，界面上要把它和剩下的部分分开显示 */
  typed: string;
}

/** 最多列几条。再多就挡住正文了，而且前缀打长一个字符就自然收窄 */
export const HINT_LIMIT = 8;

/** 往前看多少个字符。最长的触发词也就十来个 */
const MAX_TYPED = 12;

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9\\]/.test(ch);
}

/**
 * 找出「再打几个字符就能触发」的那些 snippet。
 *
 * `textBefore` 同 `findTrigger`：光标所在行从行首到光标的文本。
 * 返回空数组表示不该弹。
 */
export function hintsFor(
  snippets: Snippet[],
  textBefore: string,
  inMath: boolean,
  limit = HINT_LIMIT,
): Hint[] {
  const usable = snippets.filter((s) => {
    // 正则和 build 那几条没有字面触发词，「还差几个字符」无从算起
    if (s.regex || s.build) return false;
    return s.mathOnly ? inMath : s.textOnly ? !inMath : true;
  });

  for (let k = Math.min(MAX_TYPED, textBefore.length); k >= 1; k--) {
    const typed = textBefore.slice(-k);
    // 单字符前缀：字母数字一律不弹（公式里每个变量名都会中招）
    if (k === 1 && /[A-Za-z0-9]/.test(typed)) return [];

    const before = textBefore[textBefore.length - k - 1];
    const hit = usable.filter((s) => {
      if (!s.trigger.startsWith(typed)) return false;
      // 触发词已经打完：`A` 那批此刻早就展开了，只剩要按 Tab 的还值得提示
      if (s.trigger.length === k && s.auto) return false;
      return !(s.wordBoundary && before !== undefined && isWordChar(before));
    });

    if (!hit.length) continue;
    // 单字符前缀还要求「值得弹」：只有一条候选时，弹出来的信息量抵不上打扰
    if (k === 1 && hit.length < 2) return [];

    // 同触发词时取最后一条 —— 自定义 snippet 排在内置之后，界面该显示用户那份
    const order = new Map(usable.map((s, i) => [s, i]));
    const byTrigger = new Map(hit.map((s) => [s.trigger, s]));
    return [...byTrigger.values()]
      .sort((a, b) => a.trigger.length - b.trigger.length || order.get(a)! - order.get(b)!)
      .slice(0, limit)
      .map((snippet) => ({ snippet, typed }));
  }

  return [];
}
