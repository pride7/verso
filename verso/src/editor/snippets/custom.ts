/**
 * 解析用户在设置里写的自定义 snippet。DESIGN.md §5.1
 *
 * 输入是一段 JSON 文本，格式与 Obsidian Latex Suite 相同 —— 用户能把练熟的
 * 配置整段粘过来，这正是 §5.1 选这个格式的理由。
 *
 * ## 为什么错误信息要这么啰嗦
 *
 * 这是**唯一**一处让用户直接写代码式配置的地方，而且写坏了的表现是
 * 「snippet 全都不响应」—— 和「我记错了触发词」长得一模一样，极难自己诊断。
 * 所以宁可把「第几条、哪个字段、期望什么」全说清楚，也不要只报一句
 * "invalid JSON"。
 *
 * ## 为什么一条坏的不能连累其他
 *
 * 用户的 snippet 表会长到几百条。为了第 87 条的一个拼写错误让前 86 条
 * 全部失效，是不能接受的 —— 那会让人在自己最熟的输入法上突然失去手感，
 * 而且完全不知道发生了什么。所以逐条校验，坏的跳过并报告，好的照常生效。
 */
import { type SnippetSpec } from "./types";

export interface CustomSnippetsResult {
  specs: SnippetSpec[];
  /** 人能照着改的错误描述。空数组 = 全部正常 */
  errors: string[];
}

const VALID_OPTIONS = new Set(["m", "t", "A", "r", "w"]);

/** 描述一个值实际是什么，用于错误信息 —— `null` 的 typeof 是 "object"，会误导 */
function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "数组";
  return typeof v;
}

export function parseCustomSnippets(text: string): CustomSnippetsResult {
  const trimmed = text.trim();
  if (!trimmed) return { specs: [], errors: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    return { specs: [], errors: [`JSON 格式有误：${(e as Error).message}`] };
  }

  if (!Array.isArray(raw)) {
    return { specs: [], errors: [`最外层要是一个数组 [ … ]，现在是${describe(raw)}`] };
  }

  const specs: SnippetSpec[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();

  raw.forEach((item, i) => {
    // 面向人的编号：JSON 里是第 0 条，但用户数的是第 1 条
    const at = `第 ${i + 1} 条`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${at}：应当是一个对象 { … }，现在是${describe(item)}`);
      return;
    }

    const o = item as Record<string, unknown>;
    if (typeof o.trigger !== "string" || !o.trigger) {
      errors.push(`${at}：缺少 trigger（触发词），或者它不是非空字符串`);
      return;
    }
    if (typeof o.replacement !== "string") {
      errors.push(`${at}（${o.trigger}）：缺少 replacement（替换文本）`);
      return;
    }

    const options = o.options === undefined ? "" : o.options;
    if (typeof options !== "string") {
      errors.push(`${at}（${o.trigger}）：options 要是字符串，比如 "mA"`);
      return;
    }
    const bad = [...options].filter((c) => !VALID_OPTIONS.has(c));
    if (bad.length) {
      errors.push(
        `${at}（${o.trigger}）：不认识的选项 ${bad.join("")} —— 可用的是 m(数学模式) t(正文) A(自动展开) r(正则) w(词边界)`,
      );
      return;
    }

    if (options.includes("r")) {
      try {
        new RegExp(`(?:${o.trigger})$`);
      } catch (e) {
        errors.push(`${at}（${o.trigger}）：正则无效 —— ${(e as Error).message}`);
        return;
      }
    }

    if (o.priority !== undefined && typeof o.priority !== "number") {
      errors.push(`${at}（${o.trigger}）：priority 要是数字`);
      return;
    }
    if (o.description !== undefined && typeof o.description !== "string") {
      errors.push(`${at}（${o.trigger}）：description 要是字符串`);
      return;
    }

    // 同一个触发词写了两遍，多半是改到一半忘了删旧的。不算错误，
    // 但一定要说 —— 否则改了没反应会让人以为是软件的问题
    const dupOf = seen.get(o.trigger);
    if (dupOf !== undefined) {
      errors.push(`${at}（${o.trigger}）：和第 ${dupOf} 条触发词重复，两条都会参与匹配`);
    } else {
      seen.set(o.trigger, i + 1);
    }

    specs.push({
      trigger: o.trigger,
      replacement: o.replacement,
      options,
      priority: o.priority as number | undefined,
      description: o.description as string | undefined,
    });
  });

  return { specs, errors };
}
