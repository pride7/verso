/**
 * 正文里的小计算器。
 *
 * 这里只接受一小套明确的算术语法，绝不把笔记内容交给 `eval`：表达式来自
 * 用户正在写的正文，能执行任意 JavaScript 的计算器会把一个输入便利变成
 * 代码执行入口。纯解析器也让这一层可以原样搬到别的端。
 */

const MAX_EXPRESSION_LENGTH = 256;

/** 把正文与 LaTeX 里常见的算符收敛成解析器认识的字符。 */
function normalize(input: string): string {
  return input
    .trim()
    .replace(/\\(?:times|cdot)\b/g, "*")
    .replace(/\\div\b/g, "/")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/[（{]/g, "(")
    .replace(/[）}]/g, ")");
}

class Parser {
  private position = 0;

  constructor(private readonly source: string) {}

  parse(): number | null {
    try {
      const value = this.additive();
      this.space();
      if (this.position !== this.source.length || !Number.isFinite(value)) return null;
      return value;
    } catch {
      return null;
    }
  }

  private additive(): number {
    let value = this.multiplicative();
    for (;;) {
      this.space();
      if (this.take("+")) value += this.multiplicative();
      else if (this.take("-")) value -= this.multiplicative();
      else return value;
    }
  }

  private multiplicative(): number {
    let value = this.unary();
    for (;;) {
      this.space();
      if (this.take("*")) value *= this.unary();
      else if (this.take("/")) {
        const divisor = this.unary();
        if (divisor === 0) throw new Error("division by zero");
        value /= divisor;
      } else return value;
    }
  }

  /** 一元负号低于幂：`-2^2` 按通常数学约定得到 -4。 */
  private unary(): number {
    this.space();
    if (this.take("+")) return this.unary();
    if (this.take("-")) return -this.unary();
    return this.power();
  }

  /** 幂是右结合的：`2^3^2` = `2^(3^2)`。 */
  private power(): number {
    const base = this.postfix();
    this.space();
    return this.take("^") ? base ** this.unary() : base;
  }

  /** 百分号是后缀运算：`200 * 15%` = 30。 */
  private postfix(): number {
    let value = this.primary();
    this.space();
    while (this.take("%")) {
      value /= 100;
      this.space();
    }
    return value;
  }

  private primary(): number {
    this.space();
    if (this.take("(")) {
      const value = this.additive();
      this.space();
      if (!this.take(")")) throw new Error("missing close parenthesis");
      return value;
    }

    const rest = this.source.slice(this.position);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)?.[0];
    if (!number) throw new Error("expected number");
    this.position += number.length;
    const value = Number(number);
    if (!Number.isFinite(value)) throw new Error("number out of range");
    return value;
  }

  private space() {
    while (/\s/.test(this.source[this.position] ?? "")) this.position++;
  }

  private take(token: string): boolean {
    if (!this.source.startsWith(token, this.position)) return false;
    this.position += token.length;
    return true;
  }
}

/**
 * 输出人能读的数字，并抹掉 IEEE 754 最常见的尾巴：
 * `0.1 + 0.2` 应当显示 0.3，而不是 0.30000000000000004。
 */
function format(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (Object.is(value, -0)) return "0";
  return Number.parseFloat(value.toPrecision(15)).toString();
}

/** 解析并计算一个完整表达式。含变量、比较符或普通文字时返回 null。 */
export function calculateExpression(input: string): string | null {
  if (!input.trim() || input.length > MAX_EXPRESSION_LENGTH) return null;
  const source = normalize(input);
  if (!source || !/\d/.test(source)) return null;
  const value = new Parser(source).parse();
  return value === null ? null : format(value);
}
