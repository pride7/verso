import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

import { applyCustomSnippets, createExtensions } from "../editor";
import { parseCustomSnippets } from "../editor/snippets/custom";
import { setViewRenderer } from "../editor/viewBlock";
import { DatabaseView } from "./DatabaseView";
import type { NoteContent, NoteRef } from "../types";
import { Backlinks } from "./Backlinks";
import { Properties } from "./Properties";

/** 让 App 能往编辑器里塞内容（符号面板要用） */
export interface EditorHandle {
  insert: (text: string) => void;
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
  onNavigate: (path: string) => void;
  handleRef?: React.MutableRefObject<EditorHandle | null>;
  /** vault 变化时递增，反向链接与 database 视图靠它重查 */
  revision: number;
  /** database 视图改写了某篇笔记的属性 */
  onNoteChanged: () => void;
  /** 设置里的自定义 snippet（Latex Suite 格式的 JSON 文本） */
  customSnippets: string;
}

export function Editor({
  note,
  onChange,
  onSaveNow,
  onFollowLink,
  getNotes,
  breadcrumb,
  onNavigate,
  handleRef,
  revision,
  onNoteChanged,
  customSnippets,
}: Props) {
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
      mount: (el, source) => {
        // 同一个容器可能被 CM6 复用，先清掉旧的
        roots.current.get(el)?.unmount();
        const root = createRoot(el);
        roots.current.set(el, root);
        root.render(
          <DatabaseView
            source={source}
            onOpen={(p) => cb.current.onNavigate(p)}
            onChanged={() => cb.current.onChanged()}
            revision={cb.current.revision}
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
      insert: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
          userEvent: "input.symbol",
          scrollIntoView: true,
        });
        view.focus();
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
    onChanged: onNoteChanged,
    revision,
  });
  cb.current = {
    onChange,
    onSaveNow,
    onFollowLink,
    getNotes,
    onNavigate,
    onChanged: onNoteChanged,
    revision,
  };

  // 自定义 snippet 的初值。放 ref 是因为它只在建 view 的那一刻用一次，
  // 之后的变化走下面的 compartment reconfigure，不该让编辑器重建
  const initialSnippets = useRef(customSnippets);

  // 只在挂载时建一次 view
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: note.body,
        extensions: createExtensions({
          onChange: (v) => cb.current.onChange(v),
          onSaveNow: () => cb.current.onSaveNow(),
          onFollowLink: (t) => cb.current.onFollowLink(t),
          getNotes: () => cb.current.getNotes(),
          customSnippets: parseCustomSnippets(initialSnippets.current).specs,
        }),
      }),
      parent: host.current,
    });
    viewRef.current = view;
    view.focus();
    return () => {
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

  return (
    <div className="editor">
      <nav className="breadcrumb">
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

      <Properties frontmatter={note.frontmatter} />

      <div className="editor-host" ref={host} />

      <Backlinks path={note.path} onOpen={onNavigate} revision={revision} />
    </div>
  );
}
