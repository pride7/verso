/**
 * Callout 的类型表。DESIGN.md §2.4
 *
 * 与 Obsidian 的写法保持一致（`> [!note] 标题`），别名也照搬 —— 从那边
 * 迁过来的笔记不该有一半 callout 变成普通引用。
 *
 * ## 为什么只有六种颜色
 *
 * Obsidian 有十几种类型，但**颜色只有六族**。类型多是为了语义（`bug` 和
 * `danger` 都是红的，但读的人知道哪个是缺陷哪个是危险），不是为了配色。
 * §6.2 说「多彩配色是业余感的最大来源」—— 这里的做法是：类型可以多，
 * 但都归到六个色族里。
 */

export interface CalloutKind {
  /** 色族，对应 CSS 里的 `.cm-callout-<tone>` */
  tone: "info" | "tip" | "warning" | "danger" | "question" | "quote";
  /** 图标名，见 widgets.ts 里的 CALLOUT_ICONS */
  icon: string;
  /** 没写标题时显示的中文名 */
  label: string;
}

const KINDS: Record<string, CalloutKind> = {
  note: { tone: "info", icon: "info", label: "笔记" },
  info: { tone: "info", icon: "info", label: "说明" },
  todo: { tone: "info", icon: "example", label: "待办" },
  abstract: { tone: "info", icon: "example", label: "摘要" },
  summary: { tone: "info", icon: "example", label: "摘要" },
  tldr: { tone: "info", icon: "example", label: "摘要" },

  tip: { tone: "tip", icon: "tip", label: "提示" },
  hint: { tone: "tip", icon: "tip", label: "提示" },
  important: { tone: "tip", icon: "tip", label: "要点" },
  success: { tone: "tip", icon: "success", label: "完成" },
  check: { tone: "tip", icon: "success", label: "完成" },
  done: { tone: "tip", icon: "success", label: "完成" },

  warning: { tone: "warning", icon: "warning", label: "注意" },
  caution: { tone: "warning", icon: "warning", label: "注意" },
  attention: { tone: "warning", icon: "warning", label: "注意" },

  danger: { tone: "danger", icon: "danger", label: "危险" },
  error: { tone: "danger", icon: "danger", label: "错误" },
  bug: { tone: "danger", icon: "danger", label: "缺陷" },
  failure: { tone: "danger", icon: "danger", label: "失败" },
  fail: { tone: "danger", icon: "danger", label: "失败" },
  missing: { tone: "danger", icon: "danger", label: "缺失" },

  question: { tone: "question", icon: "question", label: "问题" },
  help: { tone: "question", icon: "question", label: "求助" },
  faq: { tone: "question", icon: "question", label: "常见问题" },

  quote: { tone: "quote", icon: "quote", label: "引用" },
  cite: { tone: "quote", icon: "quote", label: "引用" },
  example: { tone: "quote", icon: "example", label: "例" },
};

/** 不认识的类型退回到「说明」，而不是当成普通引用 —— 用户明确写了
 *  `[!随便什么]`，那就是想要一个 callout，只是我们不认识这个名字 */
const FALLBACK: CalloutKind = { tone: "info", icon: "info", label: "说明" };

/**
 * 解析 `[!note]` 里的类型名。
 *
 * 大小写不敏感（Obsidian 也是），并且容忍 `[!NOTE]-`、`[!note]+` 这种
 * 折叠标记 —— 折叠功能没做，但不该因为多一个符号就整个不认。
 */
export function calloutKind(marker: string): CalloutKind {
  const m = /^\[!\s*([^\]\s]+)\s*\][-+]?$/.exec(marker.trim());
  if (!m) return FALLBACK;
  return KINDS[m[1].toLowerCase()] ?? FALLBACK;
}
