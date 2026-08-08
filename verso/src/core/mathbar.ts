/**
 * 移动端公式工具条的符号表。DESIGN.md §5.5
 *
 * ## 为什么手机上需要另一套
 *
 * snippet 那套（`//` 自动展开、Tab 跳占位符、tabout 跳出括号）的**全部前提
 * 是物理键盘**。软键盘上没有 Tab，也不存在「打字快」这回事 —— 手机上按七下
 * 打出 `\frac{}{}` 比按一下慢得多，而且每一下都可能按错。
 *
 * 所以这里是**一格一个符号**：点一下插一个，占位符之间用工具条最右边的
 * `←` `→` 走。这不是桌面那套的响应式适配，是两套交互。
 *
 * ## 插入的写法和 snippet 完全一致
 *
 * `$1` `$2` 是跳转点（`editor/snippets/match.ts` 的 `expand` 认它）。所以
 * 工具条插进去的东西和用户自己敲 snippet 展开出来的东西**在编辑器眼里
 * 没有区别** —— 按 `→` 和按 Tab 走的是同一条路，不用维护第二套跳转逻辑。
 *
 * ## 这里只有数据和纯函数
 *
 * 组件在 `components/MathBar.tsx`。分开是为了这张表能在 Node 里穷举着测：
 * 一个写错的 `\fracc` 在界面上看不出来，插进笔记里才发现。
 */

export interface MathKey {
  /** 键面上显示的字。KaTeX 渲染不了的用退化写法，别显示原始命令 */
  label: string;
  /** 插入的文本，`$1` `$2` 是跳转点 */
  insert: string;
  /** 长按出来的变体（§5.5）。第一格通常是它自己的常用形式 */
  variants?: MathKey[];
  /** 无障碍标签。符号本身念不出来时给一个中文名 */
  name?: string;
}

export interface MathPage {
  id: string;
  label: string;
  keys: MathKey[];
}

const k = (label: string, insert: string, name?: string, variants?: MathKey[]): MathKey => ({
  label,
  insert,
  ...(name ? { name } : {}),
  ...(variants ? { variants } : {}),
});

/**
 * 页 1：结构。§5.5 列的是「`$` 切换公式模式、上标、下标、分式、根式、括号」。
 *
 * 排在最前的是 `$…$`：手机上要写公式，第一步永远是进公式模式。
 */
const STRUCT: MathKey[] = [
  k("$…$", "$$1$", "行内公式", [
    k("$…$", "$$1$", "行内公式"),
    k("$$…$$", "$$\n$1\n$$", "块级公式"),
  ]),
  k("x²", "^{$1}", "上标", [k("x²", "^{$1}", "上标"), k("x²ʸ", "^{$1}_{$2}", "上下标")]),
  k("x₂", "_{$1}", "下标"),
  k("a/b", "\\frac{$1}{$2}", "分式", [
    k("a/b", "\\frac{$1}{$2}", "分式"),
    k("∂/∂x", "\\frac{\\partial $1}{\\partial $2}", "偏导"),
    k("d/dx", "\\frac{\\mathrm{d}$1}{\\mathrm{d}$2}", "导数"),
  ]),
  k("√", "\\sqrt{$1}", "根式", [
    k("√", "\\sqrt{$1}", "平方根"),
    k("ⁿ√", "\\sqrt[$1]{$2}", "n 次根"),
  ]),
  k("()", "\\left($1\\right)", "括号", [
    k("()", "\\left($1\\right)", "圆括号"),
    k("[]", "\\left[$1\\right]", "方括号"),
    k("{}", "\\left\\{$1\\right\\}", "花括号"),
    k("|·|", "\\left|$1\\right|", "绝对值"),
  ]),
  k("→", "\\to", "箭头", [
    k("→", "\\to"),
    k("⇒", "\\Rightarrow"),
    k("⟺", "\\iff"),
    k("↦", "\\mapsto"),
  ]),
  k("^T", "^{\\mathsf{T}}", "转置"),
];

/** 页 2：希腊字母。大写只列真正长得不一样的那几个 */
const GREEK: MathKey[] = [
  k("α", "\\alpha"),
  k("β", "\\beta"),
  k("γ", "\\gamma", "gamma", [k("γ", "\\gamma"), k("Γ", "\\Gamma")]),
  k("δ", "\\delta", "delta", [k("δ", "\\delta"), k("Δ", "\\Delta")]),
  k("ε", "\\varepsilon"),
  k("θ", "\\theta", "theta", [k("θ", "\\theta"), k("Θ", "\\Theta")]),
  k("λ", "\\lambda", "lambda", [k("λ", "\\lambda"), k("Λ", "\\Lambda")]),
  k("μ", "\\mu"),
  k("π", "\\pi", "pi", [k("π", "\\pi"), k("Π", "\\Pi")]),
  k("ρ", "\\rho"),
  k("σ", "\\sigma", "sigma", [k("σ", "\\sigma"), k("Σ", "\\Sigma")]),
  k("τ", "\\tau"),
  k("φ", "\\varphi", "phi", [k("φ", "\\varphi"), k("Φ", "\\Phi")]),
  k("ω", "\\omega", "omega", [k("ω", "\\omega"), k("Ω", "\\Omega")]),
  k("∇", "\\nabla"),
  k("∞", "\\infty"),
];

/** 页 3：算符与关系符 */
const OPS: MathKey[] = [
  k("∑", "\\sum_{$1}^{$2}", "求和", [
    k("∑", "\\sum_{$1}^{$2}", "求和"),
    k("∏", "\\prod_{$1}^{$2}", "求积"),
  ]),
  k("∫", "\\int", "积分", [
    k("∫", "\\int"),
    k("∫ₐᵇ", "\\int_{$1}^{$2}", "定积分"),
    k("∬", "\\iint"),
    k("∮", "\\oint"),
  ]),
  k("lim", "\\lim_{$1 \\to $2}", "极限"),
  k("≤", "\\leq"),
  k("≥", "\\geq"),
  k("≠", "\\neq"),
  k("≈", "\\approx", "约等于", [k("≈", "\\approx"), k("≡", "\\equiv"), k("∝", "\\propto")]),
  k("∈", "\\in", "属于", [k("∈", "\\in"), k("∉", "\\notin"), k("⊂", "\\subset")]),
  k("∪", "\\cup", "并", [k("∪", "\\cup"), k("∩", "\\cap"), k("∅", "\\emptyset")]),
  k("∀", "\\forall", "任意", [k("∀", "\\forall"), k("∃", "\\exists"), k("¬", "\\neg")]),
  k("±", "\\pm"),
  k("×", "\\times", "乘", [k("×", "\\times"), k("·", "\\cdot"), k("÷", "\\div"), k("⊗", "\\otimes")]),
  k("ℝ", "\\mathbb{R}", "实数集", [
    k("ℝ", "\\mathbb{R}"),
    k("ℕ", "\\mathbb{N}"),
    k("ℤ", "\\mathbb{Z}"),
    k("ℚ", "\\mathbb{Q}"),
    k("ℂ", "\\mathbb{C}"),
  ]),
  k("⋯", "\\cdots", "省略号", [k("⋯", "\\cdots"), k("⋮", "\\vdots"), k("⋱", "\\ddots")]),
];

/** 页 4：矩阵与多行环境 */
const ENV: MathKey[] = [
  k("[矩阵]", "\\begin{bmatrix}\n$1\n\\end{bmatrix}", "方阵", [
    k("[矩阵]", "\\begin{bmatrix}\n$1\n\\end{bmatrix}", "方括号矩阵"),
    k("(矩阵)", "\\begin{pmatrix}\n$1\n\\end{pmatrix}", "圆括号矩阵"),
    k("|行列式|", "\\begin{vmatrix}\n$1\n\\end{vmatrix}", "行列式"),
  ]),
  k("分情况", "\\begin{cases}\n$1 & $2 \\\\\n\\end{cases}", "分段函数"),
  k("对齐", "\\begin{aligned}\n$1 &= $2 \\\\\n\\end{aligned}", "多行对齐"),
  k("&", "&", "对齐点"),
  k("换行", " \\\\\n", "矩阵换行"),
  k("列分隔", " & ", "列分隔"),
  k("文字", "\\text{$1}", "公式里的中文"),
  k("空格", "\\quad", "间距", [k("空格", "\\quad"), k("大空格", "\\qquad"), k("细", "\\,")]),
];

export const MATH_PAGES: MathPage[] = [
  { id: "struct", label: "结构", keys: STRUCT },
  { id: "greek", label: "希腊", keys: GREEK },
  { id: "ops", label: "算符", keys: OPS },
  { id: "env", label: "矩阵", keys: ENV },
];

/** 最近用过的存这么多。§5.5 定的 8 个，正好是一屏不用横滑的量 */
export const RECENT_MAX = 8;

const RECENT_KEY = "verso.mathbar.recent";

/**
 * 把刚用过的挪到最前。
 *
 * 按 `insert` 去重而不是按 label：同一个符号可能从主键和长按变体两条路
 * 进来，那是同一件事。
 */
export function pushRecent(list: readonly MathKey[], key: MathKey): MathKey[] {
  return [key, ...list.filter((x) => x.insert !== key.insert)].slice(0, RECENT_MAX);
}

/**
 * 从 localStorage 读。存的只是 `insert`，键面从符号表里现查 ——
 * 存整个对象的话，以后改了某个键的 label，用户那边会一直留着旧的。
 */
export function loadRecent(store: Pick<Storage, "getItem"> = localStorage): MathKey[] {
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const all = allKeys();
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((ins) => all.find((k) => k.insert === ins))
    .filter((k): k is MathKey => !!k)
    .slice(0, RECENT_MAX);
}

export function saveRecent(
  list: readonly MathKey[],
  store: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    store.setItem(RECENT_KEY, JSON.stringify(list.map((k) => k.insert)));
  } catch {
    // 存不进去只是下次没有「最近用过」，不该让插入符号这件事失败
  }
}

/** 所有页里的所有键，含长按变体。查找和测试用 */
export function allKeys(): MathKey[] {
  const out: MathKey[] = [];
  for (const page of MATH_PAGES) {
    for (const key of page.keys) {
      out.push(key);
      for (const v of key.variants ?? []) {
        if (!out.some((x) => x.insert === v.insert)) out.push(v);
      }
    }
  }
  return out;
}
