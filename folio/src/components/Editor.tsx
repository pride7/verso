import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { createExtensions } from "../editor";
import type { NoteContent } from "../types";
import { Properties } from "./Properties";

/** 让 App 能往编辑器里塞内容（符号面板要用） */
export interface EditorHandle {
  insert: (text: string) => void;
}

interface Props {
  note: NoteContent;
  onChange: (body: string) => void;
  onSaveNow: () => void;
  onFollowLink: (target: string) => void;
  breadcrumb: { name: string; path: string | null }[];
  onNavigate: (path: string) => void;
  handleRef?: React.MutableRefObject<EditorHandle | null>;
}

export function Editor({
  note,
  onChange,
  onSaveNow,
  onFollowLink,
  breadcrumb,
  onNavigate,
  handleRef,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

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
  const cb = useRef({ onChange, onSaveNow, onFollowLink });
  cb.current = { onChange, onSaveNow, onFollowLink };

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
    </div>
  );
}
