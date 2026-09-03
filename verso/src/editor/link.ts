/**
 * 标准 Markdown 链接：`[文字](地址)` 与 `<地址>`。DESIGN.md §4.2
 *
 * 内部链接 `[[笔记名]]` 不走这里 —— 那是 `markdownExtended` 自己的节点，
 * 跳转在 `index.ts` 的 `linkClickHandler` 里。
 *
 * 这个文件只回答两个问题：**显示文字在哪一段**，**这个地址能不能点开**。
 * live preview（藏标记）和点击处理（打开浏览器）必须用同一个判据 ——
 * 两边分开判的话，会出现「渲染成了链接却点不动」或者反过来，而这两种
 * 都比不渲染更让人困惑。
 */
import type { SyntaxNode } from "@lezer/common";

/**
 * 交给系统去打开的协议白名单。
 *
 * `javascript:` 和 `data:` 挡在这里而不是挡在打开的那一刻：笔记可能来自
 * 分享或 AI 生成（§7.5 同一条边界），而 `openUrl` 在 webview 里就是执行。
 * 相对路径不带协议，走下面那条 `mailto` 判断后返回 null —— 内部跳转的真源
 * 是 `[[链接]]`，不在这一层解析路径。
 */
const OPENABLE = /^(?:https?|mailto|tel):/i;

/** `[文字](地址)` / `<地址>` 拆出来的三段。都是文档坐标 */
export interface LinkParts {
  /** 显示文字的起点（`[` 之后 / `<` 之后） */
  labelFrom: number;
  /** 显示文字的终点（`]` 之前 / `>` 之前） */
  labelTo: number;
  /** 地址节点。引用式链接（`[文字][编号]`）和 `[空]()` 都没有，为 null */
  url: SyntaxNode | null;
}

/**
 * 拆一个 `Link` 或 `Autolink` 节点。
 *
 * 两种节点的形状恰好一样 —— 头尾各一个 `LinkMark`，中间是显示文字
 * （`Autolink` 的「显示文字」就是那个地址本身），所以一个函数够用。
 *
 * **不要拿来拆 `Image`**：`![图](a.png)` 的第一个 `LinkMark` 是 `![`，
 * 按这里的算法会把 `!` 也算进标记里藏掉，剩下的行为则完全对不上。
 */
export function linkParts(node: SyntaxNode): LinkParts | null {
  const marks = node.getChildren("LinkMark");
  if (marks.length < 2) return null;
  return { labelFrom: marks[0].to, labelTo: marks[1].from, url: node.getChild("URL") };
}

/**
 * 地址原文 → 真的能交给系统打开的 URL。打不开返回 null。
 *
 * 打不开的一律**保持源码**（见 §4.2）：藏起标记却点不动，用户会以为链接
 * 坏了，而不是以为这个功能没做。
 */
export function externalHref(raw: string): string | null {
  // `[文字](<带空格的 地址>)` 这种写法地址两头带尖括号，不是地址的一部分
  const url = raw.trim().replace(/^<|>$/g, "").trim();
  if (!url) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    // `<a@b.com>` 按 GFM 的原意是邮箱，别的没有协议的（相对路径）不认
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? `mailto:${url}` : null;
  }
  return OPENABLE.test(url) ? url : null;
}
