/**
 * 从 Markdown 正文里抽出标题，供大纲面板与浮动目录使用。
 *
 * ## 为什么不复用编辑器的语法树
 *
 * 大纲要在**没有打开编辑器**的时候也算得出来（切笔记的那一帧、以及以后
 * 可能出现的预览态），而 CM6 的语法树是异步解析的（见 AGENTS.md
 * 「database 视图的解析时序」）—— 挂在它上面等于把「大纲什么时候出现」
 * 交给解析调度。标题的语法是全 Markdown 里最简单的一种，几十行正则足够，
 * 而且能在纯 Node 里测。
 *
 * ## 为什么记行号而不是字符偏移
 *
 * 磁盘上的文件可能是 CRLF，而 CodeMirror 的文档一律把行分隔符归一成 `\n`
 * —— 两边的字符偏移会差出「前面有多少行」那么多。行号在两种换行下都一致，
 * 跳转时用 `doc.line(n).from` 换算即可。
 */

export interface Heading {
  /** 1–6 */
  level: number;
  /** 去掉标记后的显示文本 */
  text: string;
  /** 正文里的行号，1 起算 —— 与 Backlink.line 的口径一致 */
  line: number;
}

/** 围栏代码块。缩进 4 空格以上的是代码块内容，不算围栏 */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** ATX 标题。`#` 后**必须**有空格，否则 `#标签`（§2.4）会被当成一级标题 */
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/** setext 的下划线。`===` 是一级，`---` 是二级 */
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
/**
 * 能被 setext 下划线「顶」成标题的行，只有段落。
 * 列表项、引用、表格行、围栏、已经是标题的行都不算 —— 漏掉这条的话，
 * 一条普通的分隔线 `---` 会把它上面那行变成标题。
 */
const NOT_PARAGRAPH = /^ {0,3}(?:[-*+>|#]|\d+[.)]\s|={3,}\s*$)/;

/**
 * 去掉标题里的行内标记，只留人读的那部分。
 *
 * 公式**故意不动**：`$\varepsilon$` 去掉美元符号之后是 `\varepsilon`，
 * 反而更不像人话。留着 `$` 至少能一眼看出「这里是个公式」。
 */
export function stripInline(raw: string): string {
  return raw
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, inner: string) => {
      // `[[目标|别名]]` 显示别名，这是写的人自己选的说法
      const bar = inner.indexOf("|");
      return bar < 0 ? inner : inner.slice(bar + 1);
    })
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(?!\s)(.*?)(?<!\s)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function parseHeadings(body: string): Heading[] {
  const lines = body.split(/\r\n|\r|\n/);
  const out: Heading[] = [];
  /** 当前围栏的标记字符与长度，null 表示不在围栏里 */
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const f = FENCE.exec(line);
    if (f) {
      const [, marker, rest] = f;
      if (!fence) {
        // 开围栏。info string 里可能有语言名，不影响
        fence = { char: marker[0], len: marker.length };
        continue;
      }
      // 收围栏：标记字符相同、不短于开的那道，且后面不能有别的东西
      if (marker[0] === fence.char && marker.length >= fence.len && rest.trim() === "") {
        fence = null;
        continue;
      }
    }
    if (fence) continue;

    const atx = ATX.exec(line);
    if (atx) {
      // 结尾的 `###` 是闭合标记，不是内容
      const text = (atx[2] ?? "").replace(/(?:^|[ \t])#+[ \t]*$/, "");
      out.push({ level: atx[1].length, text: stripInline(text), line: i + 1 });
      continue;
    }

    const setext = SETEXT.exec(line);
    if (setext && i > 0) {
      const prev = lines[i - 1];
      // 上一行必须是段落，且自己还没被认成标题（`# 标题` 下面画一条线，
      // 线属于分隔线，不该再产出第二个标题）
      const taken = out.length > 0 && out[out.length - 1].line === i;
      if (prev.trim() !== "" && !NOT_PARAGRAPH.test(prev) && !taken) {
        out.push({
          level: setext[1][0] === "=" ? 1 : 2,
          text: stripInline(prev),
          line: i, // 标题是**上面**那一行
        });
      }
    }
  }

  return out;
}

/**
 * 视线落在第 `line` 行时，哪一条标题算「当前所在」。
 *
 * 取最后一条位于它上方（含）的标题。整篇的第一条标题之前（比如开头的
 * 一段引言）返回 -1 —— 那里确实不属于任何一节，硬把第一条点亮会让浮动
 * 目录在页首就先亮起来，反而误导。
 */
export function activeHeading(headings: Heading[], line: number): number {
  let hit = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].line <= line) hit = i;
    else break;
  }
  return hit;
}

/**
 * 缩进层级。按**文档里实际出现的最浅标题**归零，而不是按 `#` 的个数。
 *
 * 很多人把一级标题留给笔记标题本身、正文从 `##` 开始；照 `#` 个数缩进的话
 * 整个大纲会平白往右缩一格，右边的浮动目录尤其明显。
 */
export function outlineDepths(headings: Heading[]): number[] {
  if (headings.length === 0) return [];
  const base = Math.min(...headings.map((h) => h.level));
  // 超过 3 层就不再往右缩：侧栏只有 252px，再缩下去标题就只剩省略号了
  return headings.map((h) => Math.min(h.level - base, 3));
}
