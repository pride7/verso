/**
 * Verso 的 Markdown 方言 —— DESIGN.md §2.4。
 *
 * 这是整条编辑器链路的地基：live preview 靠它产出的语法树决定渲染什么，
 * M2 的数学模式检测靠它区分「光标在公式里」和「光标在正文里」。
 * 用正则数 `$` 的个数会被代码块、行内代码、转义 `\$` 骗到 —— 必须走语法树。
 *
 * 只实现 Obsidian 已有的语法，不自创（§2.4）。
 */
import { Tag, styleTags } from "@lezer/highlight";
import type {
  BlockContext,
  BlockParser,
  InlineContext,
  InlineParser,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";

const DOLLAR = 36; // $
const BANG = 33; // !
const OPEN_BRACKET = 91; // [
const CLOSE_BRACKET = 93; // ]
const HASH = 35; // #
const EQUALS = 61; // =
const BACKSLASH = 92; // \
const PIPE = 124; // |
const NEWLINE = 10;

/** 供主题使用的高亮标签。CM6 的内置 tag 里没有「数学公式」这类概念。 */
export const versoTags = {
  math: Tag.define(),
  mathMarker: Tag.define(),
  wikiLink: Tag.define(),
  wikiLinkMarker: Tag.define(),
  hashtag: Tag.define(),
  highlight: Tag.define(),
  callout: Tag.define(),
};

function isSpace(ch: number) {
  return ch === 32 || ch === 9 || ch === NEWLINE || ch === 13;
}

function isDigit(ch: number) {
  return ch >= 48 && ch <= 57;
}

/**
 * CJK 与全角标点。
 *
 * 必须把它们从「标签字符」里排除，否则两头都出错：
 *   - `标签：#线性代数` 的全角冒号会被当成标签字符，导致整个标签识别不出来
 *   - `#标签。` 的句号会被吃进标签里
 * 全角的数字和字母（ＡＢＣ／０１２）不在这些区段内，仍然算标签字符。
 */
function isCjkPunctuation(ch: number) {
  return (
    (ch >= 0x2010 && ch <= 0x206f) || // 通用标点 — … " " ' '
    (ch >= 0x3000 && ch <= 0x303f) || // CJK 标点 、。〈〉《》「」【】
    (ch >= 0xfe10 && ch <= 0xfe6f) || // 竖排与小型标点
    (ch >= 0xff00 && ch <= 0xff0f) || // ！＂＃＄％＆＇（）＊＋，－．／
    (ch >= 0xff1a && ch <= 0xff20) || // ：；＜＝＞？＠
    (ch >= 0xff3b && ch <= 0xff40) || // ［＼］＾＿｀
    (ch >= 0xff5b && ch <= 0xff65) // ｛｜｝～｟｠･
  );
}

/** 标签允许的字符：字母、数字、`/`（嵌套标签）、`-`、`_`，以及 CJK 文字（不含标点）。 */
function isTagChar(ch: number) {
  return (
    (ch >= 48 && ch <= 57) || // 0-9
    (ch >= 65 && ch <= 90) || // A-Z
    (ch >= 97 && ch <= 122) || // a-z
    ch === 47 || // /
    ch === 45 || // -
    ch === 95 || // _
    (ch > 0x7f && !isCjkPunctuation(ch)) // 让中文标签能用，但标点不算
  );
}

/** `\$` 是转义的美元符号，不能当作公式定界符。连续反斜杠要按奇偶判断。 */
function isEscaped(cx: InlineContext, pos: number) {
  let n = 0;
  for (let i = pos - 1; i >= cx.offset && cx.char(i) === BACKSLASH; i--) n++;
  return n % 2 === 1;
}

// ---------------------------------------------------------------- 公式

/**
 * 找配对的闭合定界符。跳过 `\$`，且不跨越空行。
 */
function findMathClose(cx: InlineContext, from: number, delimLen: number): number {
  for (let p = from; p < cx.end; p++) {
    const ch = cx.char(p);
    if (ch === BACKSLASH) {
      p++; // 跳过被转义的字符
      continue;
    }
    if (ch !== DOLLAR) continue;
    if (delimLen === 2) {
      if (cx.char(p + 1) === DOLLAR) return p;
      continue;
    }
    return p;
  }
  return -1;
}

const inlineMath: InlineParser = {
  name: "VersoInlineMath",
  // 必须早于强调解析 —— 否则 `$a_1$` 里的下划线会先被吃成斜体
  before: "Emphasis",
  parse(cx, next, pos) {
    if (next !== DOLLAR || isEscaped(cx, pos)) return -1;

    const double = cx.char(pos + 1) === DOLLAR;
    const delimLen = double ? 2 : 1;
    const contentStart = pos + delimLen;
    if (contentStart >= cx.end) return -1;

    // 单个 `$` 的启发式：紧跟空白就不当公式。
    // 这是避免把「$5 起，最多 $20」误判成公式的关键 —— 货币写法里
    // `$` 后面总是数字、前面是空白，而 `$ ` 这种形式在 LaTeX 里没意义。
    if (!double && isSpace(cx.char(contentStart))) return -1;

    const close = findMathClose(cx, contentStart, delimLen);
    if (close < 0 || close === contentStart) return -1;
    // 闭合定界符前是空白同样不当公式（对称的启发式）
    if (!double && isSpace(cx.char(close - 1))) return -1;

    const to = close + delimLen;
    return cx.addElement(
      cx.elt(double ? "BlockMath" : "InlineMath", pos, to, [
        cx.elt("MathMarker", pos, contentStart),
        cx.elt("MathContent", contentStart, close),
        cx.elt("MathMarker", close, to),
      ]),
    );
  },
};

/** 独占若干行的 `$$ … $$`。行内那种由 inlineMath 处理。 */
const blockMath: BlockParser = {
  name: "VersoBlockMath",
  parse(cx: BlockContext, line: Line) {
    const text = line.text.slice(line.pos);
    if (!text.startsWith("$$")) return false;

    const from = cx.lineStart + line.pos;

    // 同一行闭合：`$$x^2$$`
    const sameLine = text.slice(2).indexOf("$$");
    if (sameLine >= 0) {
      const to = from + 2 + sameLine + 2;
      cx.addElement(cx.elt("BlockMath", from, to));
      cx.nextLine();
      return true;
    }

    // 跨行：扫到只有 `$$` 的那一行
    while (cx.nextLine()) {
      if (/^\s*\$\$\s*$/.test(line.text)) {
        const to = cx.lineStart + line.text.length;
        cx.addElement(cx.elt("BlockMath", from, to));
        cx.nextLine();
        return true;
      }
    }

    // 没有闭合。仍然作为公式块收尾到文末 —— 正在输入中的公式属于这种状态，
    // 若返回 false 会让整段内容在打字过程中反复重解析、样式抖动。
    cx.addElement(cx.elt("BlockMath", from, cx.lineStart + line.text.length));
    return true;
  },
};

// ------------------------------------------------------------ 内部链接

/** `[[笔记]]`、`[[笔记|别名]]`、`[[笔记#标题]]`、以及嵌入 `![[文件]]` */
const wikiLink: InlineParser = {
  name: "VersoWikiLink",
  before: "Link",
  parse(cx, next, pos) {
    let embed = false;
    if (next === BANG) {
      if (cx.char(pos + 1) !== OPEN_BRACKET || cx.char(pos + 2) !== OPEN_BRACKET) return -1;
      embed = true;
    } else if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) {
      return -1;
    }

    const openStart = embed ? pos + 1 : pos;
    const contentStart = openStart + 2;

    let close = -1;
    for (let p = contentStart; p < cx.end - 1; p++) {
      const ch = cx.char(p);
      if (ch === NEWLINE) break; // 内部链接不跨行
      if (ch === CLOSE_BRACKET && cx.char(p + 1) === CLOSE_BRACKET) {
        close = p;
        break;
      }
    }
    if (close < 0 || close === contentStart) return -1;

    // `|` 之后是显示别名
    let pipe = -1;
    for (let p = contentStart; p < close; p++) {
      if (cx.char(p) === PIPE) {
        pipe = p;
        break;
      }
    }

    const children = [cx.elt("WikiLinkMarker", pos, contentStart)];
    if (pipe >= 0) {
      children.push(cx.elt("WikiLinkTarget", contentStart, pipe));
      children.push(cx.elt("WikiLinkMarker", pipe, pipe + 1));
      children.push(cx.elt("WikiLinkAlias", pipe + 1, close));
    } else {
      children.push(cx.elt("WikiLinkTarget", contentStart, close));
    }
    children.push(cx.elt("WikiLinkMarker", close, close + 2));

    return cx.addElement(cx.elt(embed ? "Embed" : "WikiLink", pos, close + 2, children));
  },
};

// ---------------------------------------------------------------- 标签

const hashtag: InlineParser = {
  name: "VersoHashtag",
  parse(cx, next, pos) {
    if (next !== HASH) return -1;

    // 判据是「前一个字符不是标签字符」，而不是「前一个字符是空白」。
    //
    // 后者会漏掉中文写作里极常见的 `标签：#线性代数` —— 全角冒号不是空白。
    // 而前者依然能挡住 `C#`、`F#`、`foo#bar`（前面是字母，属于标签字符）。
    if (pos > cx.offset && isTagChar(cx.char(pos - 1))) return -1;

    let p = pos + 1;
    let hasNonDigit = false;
    while (p < cx.end && isTagChar(cx.char(p))) {
      if (!isDigit(cx.char(p))) hasNonDigit = true;
      p++;
    }
    // 纯数字不是标签 —— `#1`、`#2026` 通常是编号或引用，不是标签
    if (p === pos + 1 || !hasNonDigit) return -1;

    return cx.addElement(cx.elt("Hashtag", pos, p));
  },
};

// ---------------------------------------------------------------- 高亮

const highlight: InlineParser = {
  name: "VersoHighlight",
  before: "Emphasis",
  parse(cx, next, pos) {
    if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) return -1;
    for (let p = pos + 2; p < cx.end - 1; p++) {
      const ch = cx.char(p);
      if (ch === NEWLINE) return -1;
      if (ch === EQUALS && cx.char(p + 1) === EQUALS) {
        if (p === pos + 2) return -1; // `====` 空高亮
        return cx.addElement(
          cx.elt("Highlight", pos, p + 2, [
            cx.elt("HighlightMarker", pos, pos + 2),
            cx.elt("HighlightMarker", p, p + 2),
          ]),
        );
      }
    }
    return -1;
  },
};

// -------------------------------------------------------------- callout

/** `> [!note] 标题` 里的 `[!note]` 部分。`>` 本身由标准的引用块解析器处理。 */
const calloutMarker: InlineParser = {
  name: "VersoCallout",
  before: "Link",
  parse(cx, next, pos) {
    if (next !== OPEN_BRACKET || cx.char(pos + 1) !== BANG) return -1;
    if (pos !== cx.offset) return -1; // 只认内容开头

    for (let p = pos + 2; p < cx.end; p++) {
      const ch = cx.char(p);
      if (ch === NEWLINE) return -1;
      if (ch === CLOSE_BRACKET) {
        if (p === pos + 2) return -1;
        return cx.addElement(cx.elt("CalloutMarker", pos, p + 1));
      }
    }
    return -1;
  },
};

// ----------------------------------------------------------------------

export const markdownExtended: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: versoTags.math },
    { name: "BlockMath", style: versoTags.math },
    { name: "MathMarker", style: versoTags.mathMarker },
    { name: "MathContent" },
    { name: "WikiLink", style: versoTags.wikiLink },
    { name: "Embed", style: versoTags.wikiLink },
    { name: "WikiLinkMarker", style: versoTags.wikiLinkMarker },
    { name: "WikiLinkTarget" },
    { name: "WikiLinkAlias" },
    { name: "Hashtag", style: versoTags.hashtag },
    { name: "Highlight", style: versoTags.highlight },
    { name: "HighlightMarker", style: versoTags.mathMarker },
    { name: "CalloutMarker", style: versoTags.callout },
  ],
  parseBlock: [blockMath],
  parseInline: [inlineMath, wikiLink, hashtag, highlight, calloutMarker],
  props: [
    styleTags({
      "MathContent/...": versoTags.math,
      "WikiLinkTarget/...": versoTags.wikiLink,
      "WikiLinkAlias/...": versoTags.wikiLink,
    }),
  ],
};
