/**
 * 快速切换器的模糊匹配。DESIGN.md §2.2
 *
 * 目标是「两三个字母直达」。在前端做而不是 Rust：全量清单只取一次，
 * 之后每次按键都在本地算，没有 IPC 往返 —— 手感差别很明显。
 */

export interface FuzzyResult {
  /** 越大越靠前 */
  score: number;
  /** 命中的字符下标，用于在 UI 里加粗 */
  positions: number[];
}

const BONUS_CONSECUTIVE = 8; // 连续命中
const BONUS_BOUNDARY = 10; // 命中词首（路径分隔符、空格、连字符之后）
const BONUS_START = 12; // 命中开头
const PENALTY_GAP = -1; // 每跳过一个字符

function isBoundary(prev: string): boolean {
  return prev === "/" || prev === " " || prev === "-" || prev === "_" || prev === ".";
}

/**
 * 子序列匹配 + 位置打分。
 *
 * 用贪心而不是最优匹配（Smith-Waterman 那类）：贪心是 O(n)，在每次按键都要
 * 跑几千次的场景下足够快，而排序质量的差距在实际使用中察觉不到。
 */
export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] };

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let ti = 0;

  for (let qi = 0; qi < lowerQuery.length; qi++) {
    const ch = lowerQuery[qi];
    if (ch === " ") continue; // 空格当作「任意间隔」，允许 "线代 特征" 这种写法

    const found = lowerText.indexOf(ch, ti);
    if (found < 0) return null;

    if (found === 0) score += BONUS_START;
    else if (isBoundary(lowerText[found - 1])) score += BONUS_BOUNDARY;

    if (positions.length > 0 && found === positions[positions.length - 1] + 1) {
      score += BONUS_CONSECUTIVE;
    }
    score += (found - ti) * PENALTY_GAP;

    positions.push(found);
    ti = found + 1;
  }

  // 同样命中的情况下更短的目标更可能是想要的那个
  score -= Math.floor(text.length / 12);
  return { score, positions };
}

export interface Candidate {
  path: string;
  name: string;
}

export interface Ranked<T> {
  item: T;
  score: number;
  /** 命中位置，相对 `name` */
  namePositions: number[];
}

/**
 * 先按名字匹配，名字匹配不上再按完整路径。
 *
 * 名字优先是关键：输入「特征」时想要的是《特征值》这篇，而不是所有路径里
 * 恰好含这两个字的笔记。路径匹配作为兜底，让「数学/特征」这种写法也能用。
 */
export function rankNotes<T extends Candidate>(items: T[], query: string, limit = 30): Ranked<T>[] {
  const q = query.trim();
  if (!q) {
    return items.slice(0, limit).map((item) => ({ item, score: 0, namePositions: [] }));
  }

  const out: Ranked<T>[] = [];
  for (const item of items) {
    const byName = fuzzyMatch(item.name, q);
    if (byName) {
      // 名字命中加权，保证它排在仅路径命中的前面
      out.push({ item, score: byName.score + 60, namePositions: byName.positions });
      continue;
    }
    const byPath = fuzzyMatch(item.path, q);
    if (byPath) out.push({ item, score: byPath.score, namePositions: [] });
  }

  out.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
  return out.slice(0, limit);
}
