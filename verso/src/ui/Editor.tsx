import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

import { applyCustomSnippets, applySourceMode, createExtensions } from "../editor";
import {
  foldAllHeadings,
  foldHeadingLines,
  toggleHeadingFold,
  unfoldAllHeadings,
} from "../editor/fold";
import { toggleFormatSpec, type InlineFormat } from "../editor/format";
import { toggleBlockSpec, type BlockKind } from "../editor/paragraph";
import { mathDelimiterConversion } from "../editor/mathDelimiters";
import { textForPaste } from "../editor/richPaste";
import { tableAt, tableOpSpec, type TableOp } from "../editor/tableOps";
import { calculateCurrent } from "../editor/calculation";
import { installAttachmentDrop } from "../editor/paste";
import { foldTargets } from "../core/journal";
import { parseCustomSnippets } from "../core/snippets/custom";
import { expand } from "../core/snippets/match";
import { shiftTabSpec, tabSpec } from "../editor/snippets";
import { setTabstops } from "../editor/snippets/tabstops";
import { setImageResolver } from "../editor/image";
import { setSlashConfig } from "../editor/completion";
import { setViewRenderer } from "../editor/viewBlock";
import { parseSlashCustom } from "../core/slash";
import { normalizeIcon } from "../core/emoji";
import { DatabaseView } from "./DatabaseView";
import { Icon } from "./Icon";
import type { NoteContent, NoteRef } from "../core/types";
import { Backlinks } from "./Backlinks";
import { FrontmatterSource } from "./FrontmatterSource";
import { Properties } from "./Properties";

/** 让 App 能往编辑器里塞内容（符号面板、模板要用） */
export interface EditorHandle {
  /**
   * 在光标处插入。`cursorOffset` 是插入后光标相对这段文本开头的位置，
   * 不给就落在末尾 —— 模板里的 `{{cursor}}` 靠它落点（§4.6）
   */
  insert: (text: string, cursorOffset?: number) => void;
  /** 按粘贴语义插入纯文本：其中的 LaTeX 公式定界符会自动转成 Markdown。 */
  paste: (text: string) => void;
  /**
   * 插一段带跳转点的 snippet（`$1` `$2`），光标落在第一个跳转点上。
   *
   * 移动端公式工具条用（§5.5）。走的是 snippet 引擎同一套展开和跳转点
   * 状态 —— 于是工具条插出来的东西和用户自己敲展开出来的**在编辑器眼里
   * 一模一样**，`nextStop` 和 Tab 走的是同一条路，不用维护第二套逻辑。
   */
  insertSnippet: (replacement: string) => void;
  /** 跳到下一个 / 上一个跳转点。就是 Tab / Shift-Tab 那两条命令 */
  nextStop: () => void;
  prevStop: () => void;
  /** 当前选中的文字，没选就是空串。模板的 `{{selection}}` 用 */
  selectedText: () => string;
  /** 开关一种行内格式（粗体、斜体…，§4.8）。逻辑在 `editor/format.ts` */
  toggleFormat: (kind: InlineFormat) => void;
  /** 转换选区里的 LaTeX 公式定界符；没有选区时处理整篇。返回转换数量。 */
  convertMathDelimiters: () => number;
  /** 计算选区或当前行并写入结果。返回结果；null 表示不是纯数字算式。 */
  calculate: () => string | null;
  /**
   * 把选中的这几行换成标题 / 引用 / 列表（§4.10）。逻辑在
   * `editor/paragraph.ts` —— 和 `/` 菜单的区别是「换」不是「插」
   */
  setBlock: (kind: BlockKind) => void;
  /** 光标在不在一张表格里。右键菜单靠它决定要不要列出表格那几条 */
  inTable: () => boolean;
  /** 全选正文。右键菜单里那一条（键盘那条路是 CM6 自带的 Mod-a） */
  selectAll: () => void;
  /**
   * 对光标所在的表格做一次结构操作（插行插列…，§4.9）。逻辑在
   * `editor/tableOps.ts`，渲染态上的把手走的是同一套。
   *
   * 返回**做没做成** —— 光标不在表格里时命令面板得说一声，静默失败会让人
   * 以为是软件坏了
   */
  tableOp: (op: TableOp) => boolean;
  /**
   * 按行替换。思维导图的每一次改动都走它（§4.7）。
   *
   * `fromLine > toLine` 表示纯插入（插在第 `toLine` 行之后），`insert` 为空
   * 表示删掉这几行。都是 1 起、闭区间。
   *
   * 走编辑器的 dispatch 而不是「算出一整篇新正文再整体替换」：后者会让
   * CM6 把光标、选区、滚动位置全部重算，撤销栈里也只剩「换掉了整个文档」
   * 这么一步 —— 在图上敲错一个字，撤销回去正文就面目全非了
   */
  replaceLines: (fromLine: number, toLine: number, insert: string) => void;
  /** 思维导图仍共用正文编辑器的撤销栈，不另造一份历史。 */
  undo: () => boolean;
  redo: () => boolean;
  /** 跳到第 `line` 行（1 起）并把它顶到可视区上沿。大纲点击用 */
  gotoLine: (line: number) => void;
  /** 折叠／展开光标所在的小节 */
  toggleFold: () => void;
  foldAll: () => void;
  unfoldAll: () => void;
  /** 可视区上沿落在第几行（1 起）。大纲判断「当前在哪一节」用 */
  topLine: () => number;
}

/** 默认值放模块级：写成 `= []` 的话每次渲染都是新数组，effect 会白跑一轮 */
const EMPTY_HIDDEN: string[] = [];

/** 跳转后标题距上沿留的空隙，也是 `topLine` 的取样点 */
const TOP_MARGIN = 12;

/**
 * 找到真正在滚动的那个祖先。
 *
 * 编辑器自己不滚 —— `.editor-host` 是 `flex: 1`，滚的是外面的 `.main`
 * （见 styles.css「编辑区」一节）。但把 `.main` 写死在这里，编辑器就绑死
 * 在某一套布局上了；往上找第一个能滚的元素既准确又不产生这份耦合。
 */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight + 1) {
      return p;
    }
  }
  return document.documentElement;
}

/**
 * 延后卸载 widget 里的 React root。
 *
 * 必须先拍快照再清空 Map：StrictMode 会在微任务执行前重新挂载，
 * 新 root 会放回同一个 Map，旧 cleanup 绝不能碰它们。
 */
export function cleanupWidgetRoots(roots: Map<HTMLElement, Root>) {
  const staleRoots = [...roots.values()];
  roots.clear();
  queueMicrotask(() => staleRoots.forEach((r) => r.unmount()));
}

interface Props {
  note: NoteContent;
  onChange: (body: string) => void;
  onSaveNow: () => void;
  onFollowLink: (target: string) => void;
  /** `[[` 补全的候选来源。用 getter 保证清单变化时不必重建编辑器 */
  getNotes: () => NoteRef[];
  breadcrumb: { name: string; path: string | null }[];
  /**
   * 点面包屑最前面那个图标（§2.3 的 frontmatter `icon`）。给屏幕坐标，
   * 由 App 在那里弹出选择器。
   *
   * 可选：只关心编辑行为的测试不必为它准备一个回调
   */
  onPickIcon?: (at: { x: number; y: number }) => void;
  /**
   * 在正文里按了右键。给屏幕坐标，由 App 在那里弹菜单（和 `onPickIcon` 同一
   * 个路子：菜单项要用到发终端、通知这些 App 级的东西，编辑器不该认识它们）。
   *
   * 不给这个回调就**不拦** webview 自带的那个菜单 —— 只关心编辑行为的测试
   * 不必为它准备一个回调。
   */
  onContextMenu?: (at: { x: number; y: number }) => void;
  onNavigate: (path: string) => void;
  handleRef?: React.MutableRefObject<EditorHandle | null>;
  /** vault 变化时递增，反向链接与 database 视图靠它重查 */
  revision: number;
  /** database 视图里改一行的名字。改名要连标签页路径一起修，只能交回上层 */
  onRenameNote: (path: string) => void;
  /** database 视图改写了某篇笔记的属性 */
  onNoteChanged: () => void;
  /** 设置里的自定义 snippet（Latex Suite 格式的 JSON 文本） */
  customSnippets: string;
  /** `/` 菜单里隐藏掉的内置条目名。可选是为了让只关心别的行为的测试
      不必每个都填一遍；App 那边是显式传的 */
  slashHidden?: string[];
  /** 自己加的 `/` 菜单条目（JSON 文本） */
  slashCustom?: string;
  /** 源码模式：摘掉全部 live preview 装饰，直接看 Markdown 源码 */
  sourceMode: boolean;
  /**
   * 打开这篇时，保持展开的最近日志条数（§2.10）。0 = 不自动折叠。
   *
   * 项目笔记写长之后最新状态会被埋在一堆旧记录里，这一条就是它的解药：
   * 文件一个字节都不改，只是**打开时的默认视图**收起旧的那几节。
   */
  journalKeep?: number;
  /** 源码模式下手改了 frontmatter。抛错 = YAML 没通过解析，文件没被动 */
  onSaveFrontmatter: (yaml: string) => Promise<void>;
  /** 粘贴图片或拖入文件时存盘，返回 vault 相对路径（§4.3 / §4.4） */
  onSaveAttachment: (name: string, dataBase64: string) => Promise<string>;
  /** `![[图.png]]` 的目标名 → 能显示的 URL。null = 显示不了 */
  imageSrc: (target: string) => string | null;
  onError: (msg: string) => void;
  /**
   * 上次离开这一页时存下的编辑器状态：光标、选区、**撤销历史**。
   *
   * 文档对不上就忽略（笔记在别处被改过），从头建一个 —— 把旧的撤销历史
   * 接到一份不一样的内容上，撤销会把文件改成从来没存在过的样子。
   */
  restoreState?: EditorState | null;
  /** 卸载前把状态交出去，交给上层按标签存起来 */
  onStashState?: (state: EditorState) => void;
}

export function Editor({
  note,
  onChange,
  onSaveNow,
  onFollowLink,
  getNotes,
  breadcrumb,
  onPickIcon,
  onContextMenu,
  onNavigate,
  onRenameNote,
  handleRef,
  revision,
  onNoteChanged,
  customSnippets,
  slashHidden = EMPTY_HIDDEN,
  slashCustom = "",
  sourceMode,
  // 默认 0 = 不自动折叠。可选是为了让只关心别的行为的测试不必每个都填一遍；
  // App 那边是显式传的
  journalKeep = 0,
  onSaveFrontmatter,
  onSaveAttachment,
  imageSrc,
  onError,
  restoreState,
  onStashState,
}: Props) {
  const editorRoot = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** CM6 widget 里挂的 React root，卸载时要一个个清掉 */
  const roots = useRef(new Map<HTMLElement, Root>());

  /**
   * 把 CM6 的 widget 容器渲染成 React 组件。
   *
   * database 视图要交互（点单元格编辑、点标题跳转），用手写 DOM 会重复
   * 造一遍 React 已经解决的问题。在 widget 里挂一个 React root 更直接。
   */
  // 有意不加依赖数组：每次渲染都重新注册。赋值一个单例是零成本的，
  // 而热更新会把 viewBlock 模块整个换掉、里面的 renderer 变回 null ——
  // 只在挂载时注册的话，改一次代码 database 视图就全变空白了。
  useEffect(() => {
    setViewRenderer({
      mount: (el, source, patch, editSource) => {
        // 同一个容器可能被 CM6 复用，先清掉旧的
        roots.current.get(el)?.unmount();
        const root = createRoot(el);
        roots.current.set(el, root);
        root.render(
          <DatabaseView
            source={source}
            onOpen={(p) => cb.current.onNavigate(p)}
            onChanged={() => cb.current.onChanged()}
            onRename={(path) => cb.current.onRenameNote(path)}
            revision={cb.current.revision}
            onPatch={patch}
            onEditSource={editSource}
            imageSrc={(t) => cb.current.imageSrc(t)}
          />,
        );
      },
      unmount: (el) => {
        const root = roots.current.get(el);
        if (!root) return;
        roots.current.delete(el);
        // 延后卸载：CM6 是在自己的渲染过程中调 destroy 的，
        // 同步 unmount 会撞上 React 的「不能在渲染期间更新」告警
        queueMicrotask(() => root.unmount());
      },
    });
  });

  // 图片 URL 的解析器。同样每次渲染都重新注册 —— 换 vault 之后
  // 拼出来的路径要跟着变，而热更新会把模块整个换掉
  useEffect(() => {
    setImageResolver((target) => cb.current.imageSrc(target));
    return () => setImageResolver(null);
  });

  // `/` 菜单的配置。走模块级注入而不是重建编辑器 —— 改一条设置就丢光标、
  // 丢撤销历史的话，这个设置只会被用一次（和 snippet compartment 同理）
  useEffect(() => {
    setSlashConfig(slashHidden, parseSlashCustom(slashCustom).items);
  }, [slashHidden, slashCustom]);

  // 编辑器销毁时把残留的 React root 一起清掉，否则内存泄漏
  useEffect(
    () => () => {
      cleanupWidgetRoots(roots.current);
    },
    [],
  );

  // 暴露命令式入口。用 ref 而不是 props 传内容：插入是「一次动作」，
  // 做成状态的话得额外处理「同一个符号连插两次」的去重
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      insert: (text: string, cursorOffset?: number) => {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        const at = cursorOffset ?? text.length;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          // 夹一下：模板算出来的偏移来自展开后的文本，理论上一定在范围内，
          // 但越界的 anchor 会让 CM6 直接抛错、整个编辑器白屏
          selection: { anchor: sel.from + Math.min(Math.max(at, 0), text.length) },
          userEvent: "input.symbol",
          scrollIntoView: true,
        });
        view.focus();
      },
      paste: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const selection = view.state.selection.main;
        const converted = textForPaste(view.state, text);
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: converted },
          selection: { anchor: selection.from + converted.length },
          userEvent: "input.paste",
          scrollIntoView: true,
        });
        view.focus();
      },
      insertSnippet: (replacement: string) => {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        const { text, tabstops } = expand(replacement);
        const stops = tabstops.map((t) => sel.from + t);
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          // 没有跳转点时落在末尾 —— 单个符号（`\alpha`）就是这种
          selection: { anchor: stops.length ? stops[0] : sel.from + text.length },
          effects: setTabstops.of(
            // 第一个跳转点就是现在光标所在处，所以下一个是从第二个开始
            stops.length > 1
              ? { positions: stops.slice(1), from: sel.from, to: sel.from + text.length }
              : null,
          ),
          userEvent: "input.snippet",
          scrollIntoView: true,
        });
        view.focus();
      },
      nextStop: () => {
        const view = viewRef.current;
        if (!view) return;
        const spec = tabSpec(view.state);
        if (spec) view.dispatch(spec);
        view.focus();
      },
      prevStop: () => {
        const view = viewRef.current;
        if (!view) return;
        const spec = shiftTabSpec(view.state);
        if (spec) view.dispatch(spec);
        view.focus();
      },
      selectedText: () => {
        const view = viewRef.current;
        if (!view) return "";
        const sel = view.state.selection.main;
        return view.state.doc.sliceString(sel.from, sel.to);
      },
      toggleFormat: (kind: InlineFormat) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          ...toggleFormatSpec(view.state, kind),
          // 标成 input：撤销栈按输入的粒度合并，Ctrl+Z 一次退回来正好是
          // 「刚才那次加粗」，而不是把前面敲的字一起吞掉
          userEvent: "input.format",
          scrollIntoView: true,
        });
        // 快捷键是在全局那一层截下来的，焦点可能根本不在编辑器里
        view.focus();
      },
      convertMathDelimiters: () => {
        const view = viewRef.current;
        if (!view) return 0;
        const conversion = mathDelimiterConversion(view.state);
        if (!conversion) return 0;
        view.dispatch(conversion.spec);
        view.focus();
        return conversion.count;
      },
      calculate: () => {
        const view = viewRef.current;
        return view ? calculateCurrent(view) : null;
      },
      setBlock: (kind: BlockKind) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch(toggleBlockSpec(view.state, kind));
        view.focus();
      },
      inTable: () => {
        const view = viewRef.current;
        return !!view && tableAt(view.state) !== null;
      },
      selectAll: () => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        view.focus();
      },
      tableOp: (op: TableOp) => {
        const view = viewRef.current;
        if (!view) return false;
        const spec = tableOpSpec(view.state, op);
        // 光标不在表格里、或者这一步做不了（删掉唯一一列之类）。**不产生
        // 一次空的改动** —— 那会在撤销栈里留下一步什么都没做的记录
        if (!spec) return false;
        view.dispatch(spec);
        // 快捷键是在全局那一层截下来的，焦点可能根本不在编辑器里
        view.focus();
        return true;
      },
      replaceLines: (fromLine: number, toLine: number, insert: string) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const clamp = (n: number) => Math.min(Math.max(n, 1), doc.lines);

        if (fromLine > toLine) {
          // 纯插入。行号可能指到文末之外（往最后一个节点后面加），夹一下
          const after = Math.min(toLine, doc.lines);
          if (after <= 0) {
            view.dispatch({
              changes: { from: 0, insert: doc.length ? `${insert}
` : insert },
              userEvent: "input.mindmap",
            });
          } else {
            const at = doc.line(after).to;
            view.dispatch({
              changes: { from: at, insert: `
${insert}` },
              userEvent: "input.mindmap",
            });
          }
          return;
        }

        const a = doc.line(clamp(fromLine));
        const b = doc.line(clamp(toLine));
        if (insert === "") {
          // 连行尾的换行一起删，否则删一个节点会留下一行空白
          view.dispatch({
            changes: { from: a.from, to: Math.min(b.to + 1, doc.length) },
            userEvent: "delete.mindmap",
          });
        } else {
          view.dispatch({
            changes: { from: a.from, to: b.to, insert },
            userEvent: "input.mindmap",
          });
        }
      },
      undo: () => {
        const view = viewRef.current;
        return view ? undo(view) : false;
      },
      redo: () => {
        const view = viewRef.current;
        return view ? redo(view) : false;
      },
      gotoLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const target = doc.line(Math.min(Math.max(1, line), doc.lines));
        view.dispatch({
          // 光标也跟过去：这是编辑器，「跳到某一节」的下一个动作通常是改它
          selection: { anchor: target.from },
          effects: EditorView.scrollIntoView(target.from, { y: "start", yMargin: TOP_MARGIN }),
        });
        view.focus();
      },
      // 折叠命令都先聚焦：它们作用于「光标所在的小节」，而从命令面板
      // 调用时焦点在面板上，不聚焦回来的话作用点会是上一次的位置
      toggleFold: () => {
        const view = viewRef.current;
        if (!view) return;
        view.focus();
        toggleHeadingFold(view);
      },
      foldAll: () => {
        const view = viewRef.current;
        if (!view) return;
        view.focus();
        foldAllHeadings(view);
      },
      unfoldAll: () => {
        const view = viewRef.current;
        if (!view) return;
        view.focus();
        unfoldAllHeadings(view);
      },
      topLine: () => {
        const view = viewRef.current;
        if (!view) return 1;
        // `documentTop` 是文档首行在窗口坐标里的 y，减掉它就换算成
        // 「相对文档顶部的高度」。CM6 的高度图对**没渲染**的部分也有估算，
        // 所以整篇都问得出来，不受可视区渲染范围限制
        const y =
          scrollParent(view.dom).getBoundingClientRect().top + TOP_MARGIN - view.documentTop;
        return view.state.doc.lineAt(view.lineBlockAtHeight(y).from).number;
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  // 回调放 ref：它们每次渲染都是新函数，直接进 CM6 扩展会导致
  // 每次渲染都重建整个编辑器，光标和撤销历史全没了。
  const cb = useRef({
    onChange,
    onSaveNow,
    onFollowLink,
    getNotes,
    onNavigate,
    onRenameNote,
    onChanged: onNoteChanged,
    onSaveFrontmatter,
    onSaveAttachment,
    onError,
    imageSrc,
    revision,
    onStashState,
  });
  cb.current = {
    onChange,
    onSaveNow,
    onFollowLink,
    getNotes,
    onNavigate,
    onRenameNote,
    onChanged: onNoteChanged,
    onSaveFrontmatter,
    onSaveAttachment,
    onError,
    imageSrc,
    revision,
    onStashState,
  };

  /** 同理：只在建 view 的那一刻读一次，之后的变化不该触发重建 */
  const restoreRef = useRef(restoreState);

  // 自定义 snippet 的初值。放 ref 是因为它只在建 view 的那一刻用一次，
  // 之后的变化走下面的 compartment reconfigure，不该让编辑器重建
  const initialSnippets = useRef(customSnippets);
  /** 同理：只在建 view 那一刻用一次，之后的切换走 compartment */
  const initialSourceMode = useRef(sourceMode);

  // 只在挂载时建一次 view
  useEffect(() => {
    if (!editorRoot.current || !host.current) return;

    // 切回一个之前开过的标签时，直接接着上次那份 state 用 —— 光标、选区、
    // 撤销历史都在里面。文档对不上就说明这篇在别处被改过，那份历史已经不
    // 适用了，从头建（把旧历史接到不一样的内容上，撤销会把文件改成从来
    // 没存在过的样子）
    const stashed = restoreRef.current;
    const reusable = stashed && stashed.doc.toString() === note.body ? stashed : null;

    const view = new EditorView({
      state:
        reusable ??
        EditorState.create({
          doc: note.body,
          extensions: createExtensions({
            onChange: (v) => cb.current.onChange(v),
            onSaveNow: () => cb.current.onSaveNow(),
            onFollowLink: (t) => cb.current.onFollowLink(t),
            getNotes: () => cb.current.getNotes(),
            customSnippets: parseCustomSnippets(initialSnippets.current).specs,
            sourceMode: initialSourceMode.current,
            saveAttachment: (name, data) => cb.current.onSaveAttachment(name, data),
            onError: (m) => cb.current.onError(m),
          }),
        }),
      parent: host.current,
    });
    viewRef.current = view;
    // 接在整篇 `.editor` 而不是 `.cm-content`：短文下面的空白、属性条和面包屑
    // 都属于当前文档，文件落在那里同样要归档并插进 Markdown，不能页面导航。
    const removeAttachmentDrop = installAttachmentDrop(
      editorRoot.current,
      view,
      () => cb.current.onSaveAttachment,
      (message) => cb.current.onError(message),
    );

    // 复用的那份 state 里，compartment 装的还是**离开这一页时**的配置。
    // 中途切过源码模式或改过 snippet 的话，这里要按当前值再压一遍
    if (reusable) {
      applySourceMode(view, initialSourceMode.current);
      applyCustomSnippets(view, initialSnippets.current);
    }

    // **别抢正在输入的框。** 新建文档时树里那个改名框刚拿到焦点，编辑器
    // 紧接着挂载；抢过来的话改名框会失焦，而失焦按「确定」处理 —— 表现就是
    // 输入框一闪就没了。搜索框、属性条同理。
    const busy = document.activeElement;
    const typing =
      busy instanceof HTMLInputElement ||
      busy instanceof HTMLTextAreaElement ||
      (busy instanceof HTMLElement && busy.isContentEditable && !view.dom.contains(busy));
    // **触摸设备上打开一篇笔记不等于要改它。** 拿到焦点在桌面上是白拿的
    // 便利（光标就位，直接能打字），在手机上代价却很实在：软键盘每开一篇
    // 就弹起来一次，吃掉半屏、把公式工具条顶上来，而多数时候用户只是想
    // 读一眼。要改就点一下正文，那一下本来也躲不掉（§1.2）
    const touch = document.documentElement.dataset.touch === "on";
    if (!typing && !touch) view.focus();

    // 「只看最新」：把旧的日志条目折起来（§2.10）。
    //
    // **要重试几次。** 折叠范围得查语法树，而 CM6 的解析是建 view 之后异步
    // 进行的 —— 这一刻调用一条都折不成（和 parseRefresh.ts 里是同一个时序
    // 问题）。折成功一次就不再试
    const targets = foldTargets(note.body, journalKeep);
    const timers: number[] = [];
    if (targets.length > 0 && !reusable) {
      let done = false;
      const attempt = () => {
        if (done || !view.dom.isConnected) return;
        done = foldHeadingLines(view, targets) > 0;
      };
      timers.push(requestAnimationFrame(attempt));
      timers.push(window.setTimeout(attempt, 80), window.setTimeout(attempt, 400));
    }

    return () => {
      if (timers.length) {
        cancelAnimationFrame(timers[0]);
        for (const t of timers.slice(1)) clearTimeout(t);
      }
      cb.current.onStashState?.(view.state);
      removeAttachmentDrop();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 设置里改了自定义 snippet：只重配 compartment，光标和撤销历史都留着
  useEffect(() => {
    const view = viewRef.current;
    if (!view || customSnippets === initialSnippets.current) return;
    initialSnippets.current = customSnippets;
    applyCustomSnippets(view, customSnippets);
  }, [customSnippets]);

  // 切源码模式：同样只重配 compartment。光标、选区、撤销历史、滚动位置
  // 全都留在原处 —— 切一次就把这些丢光的开关，没人会切第二次
  useEffect(() => {
    const view = viewRef.current;
    if (!view || sourceMode === initialSourceMode.current) return;
    initialSourceMode.current = sourceMode;
    applySourceMode(view, sourceMode);
  }, [sourceMode]);

  // 切换笔记 / 从磁盘重载时，整篇换掉内容
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === note.body) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: note.body },
      // 换文档时把光标收到开头，否则会停在上一篇笔记的偏移量上，
      // 可能落在新文档的任意位置
      selection: { anchor: 0 },
    });
  }, [note.path, note.body]);

  // frontmatter 是用户手写的，`icon:` 完全可能是一整句话或者一个数组 ——
  // 收敛成一个字符，否则面包屑会被撑成一行文字（见 lib/emoji）
  const icon =
    note.frontmatter?.icon === undefined || note.frontmatter?.icon === null
      ? null
      : normalizeIcon(String(note.frontmatter.icon));

  return (
    <div className="editor" ref={editorRoot}>
      <nav className="breadcrumb">
        {/* 图标的主入口。摆在这里而不是只放右键菜单里：这一行就是这篇文档的
            «标题栏»，Notion / 思源 都在这个位置改图标，而右键菜单是要先想到
            「去哪儿找」才用得上的。没设过图标时画一个淡的占位，它同时也是
            「这里可以设图标」的唯一提示 */}
        {onPickIcon && (
          <button
            className={`crumb-icon${icon ? " has-icon" : ""}`}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              onPickIcon({ x: box.left, y: box.bottom + 6 });
            }}
            title={icon ? "换个图标" : "给这篇设个图标"}
            aria-label="设置文档图标"
          >
            {icon ? <span className="emoji">{icon}</span> : <Icon name="image" size={14} />}
          </button>
        )}
        {breadcrumb.map((seg, i) => (
          <span key={i}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            {seg.path ? (
              <button className="breadcrumb-link" onClick={() => onNavigate(seg.path!)}>
                {seg.name}
              </button>
            ) : (
              <span>{seg.name}</span>
            )}
          </span>
        ))}
      </nav>

      {/* 属性条是 frontmatter 的渲染结果，和正文里的表格公式是一回事：
          源码模式下正文都退回源码了，它也得跟着退 */}
      {sourceMode ? (
        <FrontmatterSource
          text={note.frontmatterText}
          path={note.path}
          onSave={(yaml) => cb.current.onSaveFrontmatter(yaml)}
        />
      ) : (
        <Properties
          frontmatter={note.frontmatter}
          path={note.path}
          revision={revision}
          // 改完属性要重读这篇笔记 —— 正文没变，所以编辑器里的光标和
          // 撤销历史都不会被打断
          onChanged={() => cb.current.onChanged()}
        />
      )}

      <div
        className="editor-host"
        ref={host}
        onContextMenu={
          onContextMenu
            ? (e) => {
                // 拦掉 webview 自带的那个菜单。它给的是「复制/粘贴/拼写检查」，
                // 一条 Markdown 相关的都没有 —— 而右键正是找「加粗」「插一行」
                // 的人第一个会试的地方
                e.preventDefault();
                const view = viewRef.current;
                const sel = view?.state.selection.main;
                if (view && sel) {
                  // 点在选区外就把光标挪过去：菜单里那些命令作用于光标，
                  // 而人的预期是「作用于我刚点的地方」。点在选区里则保留选区
                  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                  if (pos !== null && (pos < sel.from || pos > sel.to)) {
                    view.dispatch({ selection: { anchor: pos } });
                  }
                }
                onContextMenu({ x: e.clientX, y: e.clientY });
              }
            : undefined
        }
      />

      <Backlinks path={note.path} onOpen={onNavigate} revision={revision} />
    </div>
  );
}
