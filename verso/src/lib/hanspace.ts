/**
 * 中西文混排间距。DESIGN.md §4.3 的 `typography` 扩展。
 *
 * 中文和西文之间不留空隙时，`用 Golub–Kahan 双对角化` 会挤成一坨 —— 这是
 * 中文排版里最常见、也最影响观感的一件事。专业排版里它有个名字叫「盘古之白」，
 * 标准做法是插入四分之一到八分之一个字宽。
 *
 * ## 只改显示，不改文件
 *
 * **绝不往 `.md` 里写空格。** 那是在替用户改内容 —— 换个编辑器打开就多出
 * 一堆他没打的空格，diff 也会炸（§0 第 1 条：文件是用户的）。所以这里只算出
 * 「哪几段西文需要在边上留白」，由 CSS 的 margin 撑开。
 *
 * ## 为什么给整段西文加边距，而不是在边界插空格 widget
 *
 * 一个中英混排的段落有几十处边界，每处插一个 widget 就是几十个 DOM 节点，
 * 而且 widget 会打断选区和光标移动。给**整段西文**一个左/右外边距只要一个
 * mark，边界数减半，也不影响选中和复制 —— 复制出来仍然是原文，一个空格都不多。
 */

/**
 * 算作「中文」的字：汉字、假名、谚文。
 *
 * **不含中文标点和全角符号**（`，。「」（）`）—— 它们自己就带着字面上的
 * 留白，再加一道会让 `（Golub）` 这种写法左右豁开一个大口子。
 */
const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

/**
 * 算作「西文」的字：拉丁字母和数字。
 *
 * 有意不含标点：`中文.` `中文,` 这些要么是用户故意的，要么本来就该用中文
 * 标点，替他撑开一个空隙只会更怪。
 */
const LATIN = /[A-Za-z0-9]/;

export interface Gap {
  /** 这一段西文在字符串里的范围 */
  from: number;
  to: number;
  /** 左边挨着中文 */
  left: boolean;
  /** 右边挨着中文 */
  right: boolean;
}

/**
 * 找出一行里所有「挨着中文的西文段」。
 *
 * 返回的是**相对这一行**的偏移，调用方加上行首位置即可。两边都不挨中文的
 * 西文段不返回 —— 纯英文段落一个装饰都不该产生。
 */
export function latinRuns(text: string): Gap[] {
  const out: Gap[] = [];
  let i = 0;
  while (i < text.length) {
    if (!LATIN.test(text[i])) {
      i++;
      continue;
    }
    const from = i;
    while (i < text.length && LATIN.test(text[i])) i++;
    const left = from > 0 && CJK.test(text[from - 1]);
    const right = i < text.length && CJK.test(text[i]);
    if (left || right) out.push({ from, to: i, left, right });
  }
  return out;
}
