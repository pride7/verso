/**
 * 行内格式的开关：粗体、斜体、行内代码、高亮、删除线。DESIGN.md §4.8
 *
 * 做成**纯函数**（`EditorState` → `TransactionSpec`）而不是直接操作 view：
 * 这样它能在 Node 测试里跑，不需要浏览器。和 snippet 的 `tabSpec` 同一个路子。
 *
 * 用 `changeByRange` 而不是自己拼 `changes`：一次要在**两个位置**同时改
 * （前后各一个标记），手写位置映射差一个字符是这类代码最常见的错法，而它
 * 表现成「标记插在了字的中间」这种一眼看不出规律的现象。
 */
import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

export type InlineFormat = "bold" | "italic" | "code" | "highlight" | "strike";

/**
 * 每种格式的标记：**重复哪个字符、重复几次**。
 *
 * 拆成「字符 + 次数」而不是直接存 `"**"`，是为了数星号的连续段 —— 粗体和
 * 斜体共用 `*`，只靠字符串比较分不开它俩（见 `wrapped`）。
 */
const MARKS: Record<InlineFormat, { char: string; n: number }> = {
  bold: { char: "*", n: 2 },
  italic: { char: "*", n: 1 },
  // 行内代码用单反引号。围栏代码块是另一回事，不归这里管
  code: { char: "`", n: 1 },
  // §2.4：高亮沿用 Obsidian 的 `==文字==`，不自创语法
  highlight: { char: "=", n: 2 },
  strike: { char: "~", n: 2 },
};

/** 从 `pos` 往左数，连着有几个 `char` */
function runBefore(text: string, pos: number, char: string): number {
  let n = 0;
  while (pos - n - 1 >= 0 && text[pos - n - 1] === char) n++;
  return n;
}

/** 从 `pos` 往右数，连着有几个 `char` */
function runAfter(text: string, pos: number, char: string): number {
  let n = 0;
  while (pos + n < text.length && text[pos + n] === char) n++;
  return n;
}

/**
 * 这一段两边的标记算不算「已经是这个格式」。
 *
 * 关键在粗体和斜体共用星号，只看「旁边是不是 `*`」会把两者搅在一起。
 * 按**连续星号的个数**判就干净了：
 *
 * | 两边的星号 | 粗体（要 2 个） | 斜体（要 1 个） |
 * |---|---|---|
 * | `*文字*`     | 不是 → 加粗成 `***文字***` | 是 → 去掉成 `文字` |
 * | `**文字**`   | 是 → 去掉成 `文字`         | 不是 → 变成 `***文字***` |
 * | `***文字***` | 是 → 去掉成 `*文字*`       | 是 → 去掉成 `**文字**` |
 *
 * 也就是说：粗体看「够不够两个」，斜体看「是不是奇数个」—— 偶数个星号全被
 * 粗体用掉了，没有余下的那一个给斜体。
 */
function wrapped(run: number, n: number): boolean {
  return n === 1 ? run % 2 === 1 : run >= n;
}

/**
 * 选区自己把标记框进来了（整个选中 `**文字**`）的话，先缩到里面。
 *
 * 缩完之后标记就落在选区**外**，和「只选了中间那几个字」变成同一种情况，
 * 下面只需要一套逻辑。
 */
function shrink(text: string, from: number, to: number, char: string): [number, number] {
  const head = runAfter(text, from, char);
  const tail = runBefore(text, to, char);
  // 两边都得有，而且不能把整段吃光（选中的就是一串 `***` 时）
  if (head === 0 || tail === 0 || from + head >= to - tail) return [from, to];
  return [from + head, to - tail];
}

/**
 * 开关一种行内格式。
 *
 * 没选中任何东西时插一对空标记、光标停在中间 —— **不去猜「当前这个词」**。
 * 中文没有词边界，`**` 该套住哪几个字是猜不出来的；而猜错的代价是用户得先
 * 撤销再手动改，比自己敲两个星号还慢。
 */
export function toggleFormatSpec(state: EditorState, kind: InlineFormat): TransactionSpec {
  const { char, n } = MARKS[kind];
  const mark = char.repeat(n);
  const text = state.doc.toString();

  return state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: mark + mark },
        range: EditorSelection.cursor(range.from + n),
      };
    }

    const [from, to] = shrink(text, range.from, range.to, char);
    const run = Math.min(runBefore(text, from, char), runAfter(text, to, char));

    if (wrapped(run, n)) {
      return {
        changes: [
          { from: from - n, to: from },
          { from: to, to: to + n },
        ],
        // 选中的还是那几个字（整体往前挪了 n 格），于是可以接着按下一个格式键
        range: EditorSelection.range(from - n, to - n),
      };
    }

    return {
      changes: [
        { from, insert: mark },
        { from: to, insert: mark },
      ],
      range: EditorSelection.range(from + n, to + n),
    };
  });
}
