/**
 * 项目日志：往笔记里追加一条带时间戳的进展。DESIGN.md §2.10
 *
 * ## 要解决的问题
 *
 * 拿一篇笔记记一个项目，写着写着就没法看了 —— **最新的状态被埋在最下面**，
 * 而上面那一大半是已经翻篇的过程。GitHub Issues 之所以好用，靠的是三件事：
 * 一件事一个条目、能关闭、以及**追加式的评论流**（新的往上冒，旧的自然沉下去）。
 *
 * 前两件在 Verso 里已经有了（一篇笔记 + frontmatter 的 `status` + database
 * 视图筛选），缺的正是第三件。这个模块就是它：
 *
 * - **追加**：算出「一条新记录该插在哪、插什么」
 * - **只看最新**：算出「打开这篇笔记时该折叠掉哪几条旧记录」
 *
 * ## 为什么日志条目就是普通标题
 *
 * `## 2026-08-01 14:30` 是一个再普通不过的 Markdown 标题。这样它天然能折叠、
 * 进大纲、进思维导图、被别的编辑器认得 —— 而如果自创一种「日志块」语法，
 * 上面这些全要重做一遍，还欠一份可移植性的债（§0 第 3 条）。
 */

/** 一条日志记录 = 一个标题文字以日期开头的标题 */
export interface JournalEntry {
  /** 1 起的行号 */
  line: number;
  /** `#` 的个数 */
  level: number;
  /** 标题上的整段文字，如 `2026-08-01 14:30` */
  stamp: string;
  /** 排序用的可比较键（`YYYY-MM-DD HH:mm`，缺时刻的补 00:00） */
  sortKey: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;
/** 标题文字**以日期开头**才算日志条目，后面可以再跟别的字 */
const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/;

const pad = (n: number) => String(n).padStart(2, "0");

/** 时间戳的写法。只到分钟 —— 秒对「今天干了什么」没有意义，还占地方 */
export function stampOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function journalEntries(body: string): JournalEntry[] {
  const lines = body.split(/\r\n|\r|\n/);
  const out: JournalEntry[] = [];
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (f) {
      const [, marker, rest] = f;
      if (!fence) {
        fence = { char: marker[0], len: marker.length };
        continue;
      }
      if (marker[0] === fence.char && marker.length >= fence.len && rest.trim() === "") {
        fence = null;
        continue;
      }
    }
    // 代码块里的 `## 2026-01-01` 是内容不是记录
    if (fence) continue;

    const atx = ATX.exec(lines[i]);
    if (!atx) continue;
    const m = STAMP.exec(atx[2]);
    if (!m) continue;
    out.push({
      line: i + 1,
      level: atx[1].length,
      stamp: atx[2],
      sortKey: `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? "00"}:${m[5] ?? "00"}`,
    });
  }
  return out;
}

/** 和 `editor/mindmap` 那边同一种按行替换 */
export interface JournalEdit {
  fromLine: number;
  toLine: number;
  insert: string;
  /** 插完光标该落在第几行（1 起）—— 就是标题下面那个空行 */
  cursorLine: number;
}

/**
 * 算出「记一条进展」这一下要改什么。
 *
 * **新的加在最上面**（在已有的第一条记录之前）：打开笔记第一眼就是最新状态，
 * 不用滚到底。代价是时间线倒着读，但「回看整段历史」远不如「现在到哪了」频繁。
 *
 * 还没有任何记录时插在正文末尾 —— 那时上面是项目描述，记录应当排在它后面。
 *
 * 层级跟着已有的记录走；一条都没有时用 `##`：`#` 通常留给笔记标题本身。
 */
export function journalInsert(body: string, now: Date): JournalEdit {
  const entries = journalEntries(body);
  const stamp = stampOf(now);
  const blank = body.trim() === "";

  if (blank) {
    return { fromLine: 1, toLine: 0, insert: `## ${stamp}\n`, cursorLine: 2 };
  }

  if (entries.length > 0) {
    // 文档里位置最靠前的那条。**不是时间最新的那条** —— 用户可能手动整理过
    // 顺序，我们只负责插在这一串的最前面
    const first = entries.reduce((a, b) => (a.line <= b.line ? a : b));
    const at = first.line - 1;
    return {
      fromLine: at + 1,
      toLine: at,
      insert: `${"#".repeat(first.level)} ${stamp}\n`,
      cursorLine: at + 2,
    };
  }

  const lines = body.split(/\r\n|\r|\n/);
  let last = lines.length;
  while (last > 0 && lines[last - 1].trim() === "") last--;
  return {
    fromLine: last + 1,
    toLine: last,
    // 前面空一行，和上面的描述隔开
    insert: `\n## ${stamp}\n`,
    cursorLine: last + 3,
  };
}

/**
 * 打开笔记时该折叠哪几条记录（返回它们的行号）。
 *
 * 「最近 `keep` 条」按**时间戳**算而不是按文档顺序：默认新的加在上面，但用户
 * 完全可能自己整理成正序，那时按位置取就会把最旧的几条留着展开。
 *
 * `keep <= 0` 表示关掉这个行为。只有一条记录时也不折叠 —— 把唯一的内容
 * 收起来，打开笔记看到的就是一片空白。
 */
export function foldTargets(body: string, keep: number): number[] {
  if (keep <= 0) return [];
  const entries = journalEntries(body);
  if (entries.length <= Math.max(keep, 1)) return [];
  const newest = [...entries].sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, keep);
  const open = new Set(newest.map((e) => e.line));
  return entries.filter((e) => !open.has(e.line)).map((e) => e.line);
}
