/**
 * Snippet 的数据模型。DESIGN.md §5.1
 *
 * 格式**刻意与 Obsidian Latex Suite 兼容** —— 用户能把现有配置直接粘过来。
 * 这不是小事：一个已经练了两年肌肉记忆的人，不会为了换编辑器重学 200 条触发词。
 */

export interface SnippetSpec {
  /** 触发词。`r` 选项下按正则解析 */
  trigger: string;
  /** 替换文本。`$0` `$1` … 是跳转点，`[[0]]` `[[1]]` … 引用正则捕获组 */
  replacement: string;
  /**
   * 按捕获组算出替换文本，用于「矩阵按尺寸生成」这类无法写死的场景。
   * 返回的字符串仍然支持 `$n` 跳转点。
   *
   * 只给内置 snippet 用 —— 用户配置是 JSON，装不下函数，那部分保持与
   * Latex Suite 完全兼容。
   */
  build?: (groups: string[]) => string;
  /** 标志位组合，见下表 */
  options: string;
  /** 越大越优先。同一段文本被多条命中时用它决定 */
  priority?: number;
  /** 符号面板里显示的说明，也是中文搜索的关键词 */
  description?: string;
}

/**
 * | 标志 | 含义 |
 * |---|---|
 * | `m` | 仅在数学模式内触发 |
 * | `t` | 仅在数学模式外（正文）触发 |
 * | `A` | 自动展开，无需按 Tab |
 * | `r` | trigger 按正则解析，`[[n]]` 引用捕获组 |
 * | `w` | 要求词边界（避免 `sr` 在 `users` 中误触） |
 */
export interface Snippet {
  trigger: string;
  replacement: string;
  build?: (groups: string[]) => string;
  /** `r` 选项编译出的正则，锚定在光标处 */
  regex: RegExp | null;
  mathOnly: boolean;
  textOnly: boolean;
  auto: boolean;
  wordBoundary: boolean;
  priority: number;
  description?: string;
}

export class SnippetError extends Error {}

export function compile(spec: SnippetSpec): Snippet {
  const o = spec.options ?? "";
  const isRegex = o.includes("r");

  let regex: RegExp | null = null;
  if (isRegex) {
    try {
      // 锚定在末尾：触发词必须紧挨着光标，否则会匹配到行首的旧文本
      regex = new RegExp(`(?:${spec.trigger})$`);
    } catch (e) {
      throw new SnippetError(`snippet 正则无效: ${spec.trigger} —— ${(e as Error).message}`);
    }
  }

  return {
    trigger: spec.trigger,
    replacement: spec.replacement,
    build: spec.build,
    regex,
    mathOnly: o.includes("m"),
    textOnly: o.includes("t"),
    auto: o.includes("A"),
    wordBoundary: o.includes("w"),
    // 默认优先级用触发词长度：更长 = 更具体 = 该赢。
    // 没有这条，`sr`（^2）会被 `s`（\sigma）之类的短触发词抢走。
    priority: spec.priority ?? spec.trigger.length,
    description: spec.description,
  };
}

export function compileAll(specs: SnippetSpec[]): Snippet[] {
  return specs.map(compile);
}
