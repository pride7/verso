/**
 * 有序列表的自动重排。DESIGN.md §4.3。
 *
 * CM6 自带的 Enter 续列表（`insertNewlineContinueMarkup`）只在**插入**时补号，
 * 删掉中间一项后源码里仍是 `1. 3.` —— 而有序列表的编号在 live preview 里是
 * 内容本身（见 livePreview.ts 的 ListMark 分支），源码错就是看着错。
 * 这里在删除 / 粘贴 / 拖动之后把受影响列表的编号排顺。
 *
 * 走 `transactionFilter` 而不是 updateListener：重排挂在同一个事务上，
 * 撤销是一步（和 autoFence 同一个理由）。
 *
 * 两条有意的取舍：
 *
 * - **起始编号不强制为 1。** `1. a`、代码块、`3. b` 这种「被块打断的列表」在
 *   Markdown 里靠第二段起始编号衔接，强制归 1 会毁掉它。所以锚点是列表原来
 *   的起始号；只有当用户亲手改了第一项的编号时才跟着新值走 —— 这让「改第一项、
 *   后面全体顺延」成为一个功能而不是一场拉锯。
 * - **找列表用旧状态的语法树，不用正则扫全文。** 代码块里的 `1.` `2.` 长得和
 *   列表一模一样，纯文本扫描分不出来；语法树里它们不在 OrderedList 节点下。
 */
import { syntaxTree } from "@codemirror/language";
import { EditorState, type ChangeSpec, type Extension, type Transaction } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** 行首的有序列表标记：缩进 + 数字 + `.` 或 `)`。第 4 组捕获标记后的空白 */
const MARKER = /^([ \t]*)(\d+)([.)])([ \t]+|$)/;

function markOf(item: SyntaxNode): SyntaxNode | null {
  return item.name === "ListItem" ? item.getChild("ListMark") : null;
}

export function renumberChanges(tr: Transaction): ChangeSpec[] {
  const tree = syntaxTree(tr.startState);
  const lists = new Map<number, SyntaxNode>();
  tr.changes.iterChangedRanges((fromA, toA) => {
    tree.iterate({
      // 各放宽 1 字符，让「正好贴着列表边界」的删除也能命中
      from: Math.max(0, fromA - 1),
      to: Math.min(tr.startState.doc.length, toA + 1),
      enter: (node) => {
        if (node.name === "OrderedList") lists.set(node.from, node.node);
      },
    });
  });

  const doc = tr.newDoc;
  const changes: ChangeSpec[] = [];
  for (const list of lists.values()) {
    // 事务之前就存在的标记位置。用途见下面「没有后随空格」那条注释
    const known = new Set<number>();
    let firstMark: SyntaxNode | null = null;
    for (let item = list.firstChild; item; item = item.nextSibling) {
      const mark = markOf(item);
      if (!mark) continue;
      firstMark = firstMark ?? mark;
      known.add(tr.changes.mapPos(mark.from, 1));
    }
    if (!firstMark) continue;
    const startNum = parseInt(tr.startState.doc.sliceString(firstMark.from, firstMark.to), 10);
    // 第一项被整个删掉时退回原起始号（删掉 `1.` 剩下的变 1, 2…）；
    // 只是被改动（用户手改编号）时尊重改后的值。判据是映射后的区间有没有
    // 塌缩成一个点 —— touchesRange 的 "cover" 要求改动严格包住区间，
    // 从行首开始的删除恰好取不到
    const firstSurvives =
      tr.changes.mapPos(firstMark.to, -1) > tr.changes.mapPos(firstMark.from, 1);

    const from = tr.changes.mapPos(list.from, 1);
    const to = tr.changes.mapPos(list.to, 1);
    if (from >= to) continue;

    let indent: string | null = null;
    let next: number | null = null;
    const lastLine = doc.lineAt(Math.min(to, doc.length)).number;
    for (let n = doc.lineAt(from).number; n <= lastLine; n++) {
      const line = doc.line(n);
      const m = MARKER.exec(line.text);
      if (!m) continue;
      const [, lead, num, , space] = m;
      const markFrom = line.from + lead.length;
      // 没有后随空格的「标记」只认事务之前就是列表项的（空项 `3.` 要跟着重排）。
      // 否则用户在列表下方打年份，敲到 `2025.` 这一刻它就会被改写成序号
      if (!space && !known.has(markFrom)) continue;
      // 第一条命中的行定下本层缩进；更深的行是嵌套列表，交给它自己的节点
      if (indent === null) indent = lead;
      if (lead !== indent) continue;
      if (next === null) next = firstSurvives ? parseInt(num, 10) : startNum;
      if (num !== String(next)) {
        changes.push({ from: markFrom, to: markFrom + num.length, insert: String(next) });
      }
      next++;
    }
  }
  return changes;
}

export const listRenumber: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // 只管用户编辑。撤销/重做要还原的是当时的文档，不能再改；
  // 程序性替换（外部改动同步进来）更不该动用户文件
  if (!(tr.isUserEvent("delete") || tr.isUserEvent("input") || tr.isUserEvent("move"))) return tr;
  const changes = renumberChanges(tr);
  if (!changes.length) return tr;
  return [tr, { changes, sequential: true }];
});
