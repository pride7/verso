/**
 * 默认 snippet 库。DESIGN.md §5.4
 *
 * 「这份库的质量直接决定第一印象，值得花整块时间打磨，不要边做边凑。」
 *
 * 设计原则：
 *   1. 触发词要**短且顺手**。`//` 比 `frac` 好，因为分式是最高频的结构。
 *   2. 全部带 `m`（仅数学模式）—— 正文里打 `sr` 绝不能变成 `^2`。
 *      少数几条是从正文进入数学模式用的，标 `t`。
 *   3. `A`（自动展开）只给那些**不可能误触**的触发词。像 `in` 这种
 *      普通英文词必须配 `w`（词边界），否则打 "point" 就炸了。
 *   4. `description` 是中文的 —— 符号面板要能用「积分」「叉乘」搜到（§5.3）。
 */
import type { SnippetSpec } from "./types";

const greek: SnippetSpec[] = [
  // `@` 前缀是希腊字母的统一入口：好记，且绝不与正常文本冲突
  { trigger: "@a", replacement: "\\alpha", options: "mA", description: "阿尔法 alpha" },
  { trigger: "@b", replacement: "\\beta", options: "mA", description: "贝塔 beta" },
  { trigger: "@g", replacement: "\\gamma", options: "mA", description: "伽马 gamma" },
  { trigger: "@G", replacement: "\\Gamma", options: "mA", description: "大写伽马 Gamma" },
  { trigger: "@d", replacement: "\\delta", options: "mA", description: "德尔塔 delta" },
  { trigger: "@D", replacement: "\\Delta", options: "mA", description: "大写德尔塔 Delta 增量" },
  { trigger: "@e", replacement: "\\epsilon", options: "mA", description: "艾普西龙 epsilon" },
  { trigger: "@ve", replacement: "\\varepsilon", options: "mA", description: "变体艾普西龙" },
  { trigger: "@z", replacement: "\\zeta", options: "mA", description: "泽塔 zeta" },
  { trigger: "@h", replacement: "\\eta", options: "mA", description: "伊塔 eta" },
  { trigger: "@t", replacement: "\\theta", options: "mA", description: "西塔 theta" },
  { trigger: "@T", replacement: "\\Theta", options: "mA", description: "大写西塔 Theta" },
  { trigger: "@vt", replacement: "\\vartheta", options: "mA", description: "变体西塔" },
  { trigger: "@i", replacement: "\\iota", options: "mA", description: "约塔 iota" },
  { trigger: "@k", replacement: "\\kappa", options: "mA", description: "卡帕 kappa" },
  { trigger: "@l", replacement: "\\lambda", options: "mA", description: "拉姆达 lambda" },
  { trigger: "@L", replacement: "\\Lambda", options: "mA", description: "大写拉姆达 Lambda" },
  { trigger: "@m", replacement: "\\mu", options: "mA", description: "缪 mu 均值" },
  { trigger: "@n", replacement: "\\nu", options: "mA", description: "纽 nu" },
  { trigger: "@x", replacement: "\\xi", options: "mA", description: "克西 xi" },
  { trigger: "@X", replacement: "\\Xi", options: "mA", description: "大写克西 Xi" },
  { trigger: "@p", replacement: "\\pi", options: "mA", description: "派 pi 圆周率" },
  { trigger: "@P", replacement: "\\Pi", options: "mA", description: "大写派 Pi 连乘" },
  { trigger: "@r", replacement: "\\rho", options: "mA", description: "柔 rho" },
  { trigger: "@s", replacement: "\\sigma", options: "mA", description: "西格玛 sigma 标准差" },
  { trigger: "@S", replacement: "\\Sigma", options: "mA", description: "大写西格玛 Sigma 求和" },
  { trigger: "@u", replacement: "\\tau", options: "mA", description: "陶 tau" },
  { trigger: "@f", replacement: "\\phi", options: "mA", description: "斐 phi" },
  { trigger: "@F", replacement: "\\Phi", options: "mA", description: "大写斐 Phi" },
  { trigger: "@vf", replacement: "\\varphi", options: "mA", description: "变体斐 varphi" },
  { trigger: "@c", replacement: "\\chi", options: "mA", description: "chi 卡方" },
  { trigger: "@y", replacement: "\\psi", options: "mA", description: "普西 psi" },
  { trigger: "@Y", replacement: "\\Psi", options: "mA", description: "大写普西 Psi" },
  { trigger: "@w", replacement: "\\omega", options: "mA", description: "欧米伽 omega 角频率" },
  { trigger: "@W", replacement: "\\Omega", options: "mA", description: "大写欧米伽 Omega" },
  { trigger: "@o", replacement: "\\partial", options: "mA", description: "偏导符号 partial" },
];

const structures: SnippetSpec[] = [
  // 分式是最高频的结构，给它最短的触发词
  {
    trigger: "//",
    replacement: "\\frac{$0}{$1}$2",
    options: "mA",
    description: "分式 分数 frac",
  },
  { trigger: "sq", replacement: "\\sqrt{$0}$1", options: "mAw", description: "根号 平方根 sqrt" },
  { trigger: "nsq", replacement: "\\sqrt[$0]{$1}$2", options: "mAw", description: "n 次根号" },

  // 下面这几条**故意不加 `w`** —— 它们的用法就是紧贴前一个 token：
  // 打 `xsr` 得到 `x^{2}`、`Ainv` 得到 `A^{-1}`。加了词边界反而废掉。
  { trigger: "sr", replacement: "^{2}", options: "mA", description: "平方 上标2" },
  { trigger: "cb", replacement: "^{3}", options: "mA", description: "立方 上标3" },
  { trigger: "rd", replacement: "^{$0}$1", options: "mA", description: "上标 幂" },
  { trigger: "__", replacement: "_{$0}$1", options: "mA", description: "下标" },
  { trigger: "inv", replacement: "^{-1}", options: "mA", description: "逆 倒数 负一次方" },
  { trigger: "trn", replacement: "^{\\mathsf{T}}", options: "mA", description: "转置 transpose" },
  { trigger: "dag", replacement: "^{\\dagger}", options: "mA", description: "共轭转置 dagger" },

  { trigger: "star", replacement: "^{*}", options: "mAw", description: "星号上标 共轭" },

  // 装饰
  { trigger: "hat", replacement: "\\hat{$0}$1", options: "mAw", description: "帽子 hat 估计量" },
  { trigger: "bar", replacement: "\\bar{$0}$1", options: "mAw", description: "横线 bar 平均" },
  { trigger: "ovl", replacement: "\\overline{$0}$1", options: "mAw", description: "上划线 overline" },
  { trigger: "unl", replacement: "\\underline{$0}$1", options: "mAw", description: "下划线" },
  { trigger: "vec", replacement: "\\vec{$0}$1", options: "mAw", description: "向量箭头 vec" },
  { trigger: "bvec", replacement: "\\mathbf{$0}$1", options: "mAw", description: "粗体向量" },
  { trigger: "tld", replacement: "\\tilde{$0}$1", options: "mAw", description: "波浪号 tilde" },
  { trigger: "dot", replacement: "\\dot{$0}$1", options: "mAw", description: "一阶导 点" },
  { trigger: "ddot", replacement: "\\ddot{$0}$1", options: "mAw", description: "二阶导 双点" },
];

// 全部带 `w`：这些都是英文词，没有词边界的话在公式里写 `point` 会变成
// `p\oint`、写 `print` 会变成 `pr\int`
const operators: SnippetSpec[] = [
  { trigger: "sum", replacement: "\\sum_{$0}^{$1} $2", options: "mAw", description: "求和 sum 累加" },
  { trigger: "prod", replacement: "\\prod_{$0}^{$1} $2", options: "mAw", description: "连乘 累积 prod" },
  { trigger: "lim", replacement: "\\lim_{$0 \\to $1} $2", options: "mAw", description: "极限 limit" },
  { trigger: "int", replacement: "\\int $0 \\, d$1", options: "mAw", description: "积分 integral" },
  {
    trigger: "dint",
    replacement: "\\int_{$0}^{$1} $2 \\, d$3",
    options: "mAw",
    description: "定积分 上下限积分",
  },
  { trigger: "iint", replacement: "\\iint $0", options: "mAw", description: "二重积分" },
  { trigger: "iiint", replacement: "\\iiint $0", options: "mAw", description: "三重积分" },
  { trigger: "oint", replacement: "\\oint $0", options: "mAw", description: "环路积分 曲线积分" },
  {
    trigger: "pd",
    replacement: "\\frac{\\partial $0}{\\partial $1}$2",
    options: "mAw",
    description: "偏导数 partial",
  },
  {
    trigger: "dv",
    replacement: "\\frac{\\mathrm{d}$0}{\\mathrm{d}$1}$2",
    options: "mAw",
    description: "导数 全导数",
  },
  { trigger: "nabla", replacement: "\\nabla", options: "mAw", description: "梯度 nabla 算子" },
  { trigger: "grad", replacement: "\\nabla", options: "mAw", description: "梯度 gradient" },
  { trigger: "lap", replacement: "\\nabla^{2}", options: "mAw", description: "拉普拉斯算子" },
  { trigger: "inf", replacement: "\\infty", options: "mAw", description: "无穷 无穷大 infinity" },
];

const relations: SnippetSpec[] = [
  { trigger: "<=", replacement: "\\leq", options: "mA", description: "小于等于" },
  { trigger: ">=", replacement: "\\geq", options: "mA", description: "大于等于" },
  { trigger: "!=", replacement: "\\neq", options: "mA", description: "不等于" },
  { trigger: "~~", replacement: "\\approx", options: "mA", description: "约等于 近似" },
  { trigger: "==", replacement: "\\equiv", options: "mA", description: "恒等于 同余" },
  { trigger: "prop", replacement: "\\propto", options: "mAw", description: "正比于" },
  { trigger: "->", replacement: "\\to", options: "mA", description: "趋向 箭头 映射到" },
  { trigger: "=>", replacement: "\\implies", options: "mA", description: "推出 蕴含" },
  { trigger: "<=>", replacement: "\\iff", options: "mA", description: "等价 当且仅当" },
  { trigger: "|->", replacement: "\\mapsto", options: "mA", description: "映射 mapsto" },
  { trigger: "!>", replacement: "\\mapsto", options: "mA", description: "映射 mapsto" },

  // 这些是普通英文词，必须要求词边界，否则 "point" 里的 in 会被吃掉
  { trigger: "in", replacement: "\\in", options: "mAw", description: "属于 集合" },
  { trigger: "nin", replacement: "\\notin", options: "mAw", description: "不属于" },
  { trigger: "sub", replacement: "\\subset", options: "mAw", description: "子集 真子集" },
  { trigger: "sube", replacement: "\\subseteq", options: "mAw", description: "子集等于" },
  { trigger: "sup", replacement: "\\supset", options: "mAw", description: "超集 包含" },
  { trigger: "cup", replacement: "\\cup", options: "mAw", description: "并集" },
  { trigger: "cap", replacement: "\\cap", options: "mAw", description: "交集" },
  { trigger: "empty", replacement: "\\emptyset", options: "mAw", description: "空集" },

  { trigger: "xx", replacement: "\\times", options: "mA", description: "乘号 叉乘 笛卡尔积" },
  { trigger: "**", replacement: "\\cdot", options: "mA", description: "点乘 内积 中点" },
  { trigger: "o+", replacement: "\\oplus", options: "mA", description: "直和 异或" },
  { trigger: "ox", replacement: "\\otimes", options: "mA", description: "张量积 克罗内克积" },
  { trigger: "+-", replacement: "\\pm", options: "mA", description: "正负号" },
  { trigger: "-+", replacement: "\\mp", options: "mA", description: "负正号" },
  { trigger: "...", replacement: "\\cdots", options: "mA", description: "省略号 中间点" },
  { trigger: "ldots", replacement: "\\ldots", options: "mA", description: "省略号 底部点" },
];

const logic: SnippetSpec[] = [
  { trigger: "AA", replacement: "\\forall", options: "mA", description: "任意 全称量词" },
  { trigger: "EE", replacement: "\\exists", options: "mA", description: "存在 存在量词" },
  { trigger: "notex", replacement: "\\nexists", options: "mAw", description: "不存在" },
  { trigger: "land", replacement: "\\land", options: "mAw", description: "逻辑与 合取" },
  { trigger: "lor", replacement: "\\lor", options: "mAw", description: "逻辑或 析取" },
  { trigger: "neg", replacement: "\\neg", options: "mAw", description: "逻辑非 否定" },
  { trigger: "st", replacement: "\\text{ s.t. }", options: "mAw", description: "使得 subject to" },
];

const sets: SnippetSpec[] = [
  { trigger: "RR", replacement: "\\mathbb{R}", options: "mA", description: "实数集" },
  { trigger: "NN", replacement: "\\mathbb{N}", options: "mA", description: "自然数集" },
  { trigger: "ZZ", replacement: "\\mathbb{Z}", options: "mA", description: "整数集" },
  { trigger: "QQ", replacement: "\\mathbb{Q}", options: "mA", description: "有理数集" },
  { trigger: "CC", replacement: "\\mathbb{C}", options: "mA", description: "复数集" },
  { trigger: "EE2", replacement: "\\mathbb{E}", options: "mA", description: "期望 数学期望" },
  { trigger: "PP", replacement: "\\mathbb{P}", options: "mA", description: "概率" },
  { trigger: "bb", replacement: "\\mathbb{$0}$1", options: "mAw", description: "黑板粗体" },
  { trigger: "cal", replacement: "\\mathcal{$0}$1", options: "mAw", description: "花体 手写体" },
  { trigger: "frak", replacement: "\\mathfrak{$0}$1", options: "mAw", description: "哥特体" },
];

const delimiters: SnippetSpec[] = [
  { trigger: "()", replacement: "\\left( $0 \\right)$1", options: "mA", description: "自适应圆括号" },
  { trigger: "[]", replacement: "\\left[ $0 \\right]$1", options: "mA", description: "自适应方括号" },
  { trigger: "{}", replacement: "\\left\\{ $0 \\right\\}$1", options: "mA", description: "自适应花括号" },
  {
    // 命令名（`\mathbf` `\frac`…）、`_`、`^`、`{`、`}` 后面的花括号是
    // 参数或分组，不是可见的定界符 —— `h_\left\{`、`\mathbf\left\{` 都是
    // 非法 LaTeX，KaTeX 当场报错；`\frac{a}\left\{` 同理（手打 \frac 时
    // 第二个参数的 `{}` 前面是 `}`）。靠更长的触发词（默认优先级 = 长度）
    // 抢在上面那条 `{}` 前面，展开成普通 `{}` 并把光标留在里面。
    trigger: "(\\\\[A-Za-z]+|[_^{}])\\{\\}",
    replacement: "[[0]]{$0}$1",
    options: "mAr",
    description: "命令与上下标后的花括号保持普通分组",
  },
  { trigger: "abs", replacement: "\\left| $0 \\right|$1", options: "mAw", description: "绝对值 模" },
  { trigger: "norm", replacement: "\\left\\| $0 \\right\\|$1", options: "mAw", description: "范数" },
  { trigger: "ceil", replacement: "\\left\\lceil $0 \\right\\rceil$1", options: "mAw", description: "向上取整" },
  { trigger: "flr", replacement: "\\left\\lfloor $0 \\right\\rfloor$1", options: "mAw", description: "向下取整" },
  { trigger: "ang", replacement: "\\langle $0 \\rangle$1", options: "mAw", description: "尖括号 内积" },
  { trigger: "brk", replacement: "\\left[ $0 \\right]$1", options: "mAw", description: "方括号" },
];

const functions: SnippetSpec[] = [
  // 正则一次覆盖所有标准函数名，省掉几十条重复定义
  {
    trigger: "(?<![\\\\A-Za-z])(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|log|ln|exp|det|dim|ker|deg|gcd|lcm|max|min|sup|inf|arg)",
    replacement: "\\[[0]]",
    options: "mAr",
    description: "标准函数名自动加反斜杠",
  },
  { trigger: "text", replacement: "\\text{$0}$1", options: "mAw", description: "文本 中文说明" },
  { trigger: "rm", replacement: "\\mathrm{$0}$1", options: "mAw", description: "正体 罗马体" },
  { trigger: "op", replacement: "\\operatorname{$0}$1", options: "mAw", description: "自定义算子" },
];

const environments: SnippetSpec[] = [
  {
    trigger: "pmat",
    replacement: "\\begin{pmatrix} $0 \\end{pmatrix}$1",
    options: "mw",
    description: "圆括号矩阵 pmatrix",
  },
  {
    trigger: "bmat",
    replacement: "\\begin{bmatrix} $0 \\end{bmatrix}$1",
    options: "mw",
    description: "方括号矩阵 bmatrix",
  },
  {
    trigger: "vmat",
    replacement: "\\begin{vmatrix} $0 \\end{vmatrix}$1",
    options: "mw",
    description: "行列式 vmatrix",
  },
  {
    trigger: "cases",
    replacement: "\\begin{cases} $0 & $1 \\\\ $2 & $3 \\end{cases}$4",
    options: "mAw",
    description: "分段函数 大括号",
  },
  {
    trigger: "align",
    replacement: "\\begin{aligned} $0 &= $1 \\\\ &= $2 \\end{aligned}$3",
    options: "mAw",
    description: "对齐 多行推导",
  },
  {
    // §5.3「矩阵快速输入」：`pmat3x3` 直接生成 3×3 骨架，Tab 在单元格间跳。
    // 手写一个 3×3 要敲 8 个 & 和 2 个 \\，是抄板书时最烦的一步。
    trigger: "(p|b|v|V|B)mat(\\d)x(\\d)",
    replacement: "",
    options: "mAr",
    description: "按尺寸生成矩阵骨架，如 pmat3x3 bmat2x2",
    build: (g) => {
      const env = `${g[0]}matrix`;
      const rows = Number(g[1]);
      const cols = Number(g[2]);
      let n = 0;
      const body = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => `$${n++}`).join(" & "),
      ).join(" \\\\ ");
      return `\\begin{${env}} ${body} \\end{${env}}$${n}`;
    },
  },
];

/** 从正文进入数学模式 —— 这几条是少数标 `t`（仅正文）的 */
const enterMath: SnippetSpec[] = [
  { trigger: "mk", replacement: "$$0$", options: "tAw", description: "行内公式 进入数学模式" },
  { trigger: "dm", replacement: "$$\n$0\n$$", options: "tAw", description: "块级公式 独占一行" },
];

export const DEFAULT_SNIPPETS: SnippetSpec[] = [
  ...greek,
  ...structures,
  ...operators,
  ...relations,
  ...logic,
  ...sets,
  ...delimiters,
  ...functions,
  ...environments,
  ...enterMath,
];
