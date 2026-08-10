import { useEffect, useMemo, useRef, useState } from "react";

import {
  editAddChild,
  editAddSibling,
  editRemove,
  editText,
  parentOf,
  type Edit,
  type MindNode,
} from "../core/mindmap";
import {
  addScratchCard,
  indentScratchCard,
  moveScratchCard,
  outdentScratchCard,
  scratchCards,
  scratchTree,
  selectedScratchMarkdown,
} from "../core/scratch";
import { Icon } from "./Icon";

interface Props {
  title: string;
  body: string;
  onEdit: (edit: Edit) => void;
  onUndo: () => void;
  onRedo: () => void;
  onMindmap: () => void;
  onSource: () => void;
  onPromote: (markdown: string) => void;
}

interface CardProps {
  node: MindNode;
  bodyLines: string[];
  selected: boolean;
  editing: boolean;
  menu: boolean;
  canUp: boolean;
  canDown: boolean;
  canIndent: boolean;
  canOutdent: boolean;
  onSelect: () => void;
  onEditing: () => void;
  onMenu: () => void;
  onCommit: (text: string) => void;
  onAddSibling: () => void;
  onAddChild: () => void;
  onMove: (direction: -1 | 1) => void;
  onIndent: (out: boolean) => void;
  onDelete: () => void;
  children: React.ReactNode;
}

function nodeLabel(node: MindNode): string {
  if (node.kind === "heading") return `H${node.level}`;
  if (node.kind === "task") return node.done ? "已完成" : "待办";
  return node.indent > 0 ? `层级 ${Math.floor(node.indent / 2) + 1}` : "想法";
}

function ScratchCard({
  node,
  bodyLines,
  selected,
  editing,
  menu,
  canUp,
  canDown,
  canIndent,
  canOutdent,
  onSelect,
  onEditing,
  onMenu,
  onCommit,
  onAddSibling,
  onAddChild,
  onMove,
  onIndent,
  onDelete,
  children,
}: CardProps) {
  const raw = (bodyLines[node.line - 1] ?? "").slice(node.prefix.length);
  const [value, setValue] = useState(raw);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setValue(raw), [raw]);
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "0";
    area.style.height = `${area.scrollHeight}px`;
    if (editing) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  }, [editing, value]);

  const commit = () => {
    if (value.trim() !== raw.trim()) onCommit(value);
  };

  return (
    <div className="scratch-branch" data-line={node.line}>
      <article className={`scratch-card${selected ? " is-selected" : ""}`}>
        <header className="scratch-card-head">
          <label className="scratch-select" title="选中后可生成正式文档">
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              aria-label={`选中卡片：${node.text || "空卡片"}`}
            />
            <span aria-hidden="true" />
          </label>
          <span className="scratch-kind">{nodeLabel(node)}</span>
          <button
            className="scratch-more"
            onClick={onMenu}
            aria-label={`卡片操作：${node.text || "空卡片"}`}
            aria-expanded={menu}
          >
            <Icon name="more" size={14} />
          </button>
        </header>
        {/* 在卡片内展开，不做绝对定位浮层。最后一张卡片贴着滚动区底边时，
            浮层会被 overflow 裁掉；就地展开则会把卡片自然撑高，各端都有退路。 */}
        {menu && (
          <div className="scratch-menu">
            <button onClick={onAddChild}><Icon name="plus" size={13} />添加子项</button>
            <button onClick={() => onAddSibling()}><Icon name="insert" size={13} />在后面新增</button>
            <button disabled={!canUp} onClick={() => onMove(-1)}><Icon name="arrow-up" size={13} />上移</button>
            <button disabled={!canDown} onClick={() => onMove(1)}><Icon name="arrow-down" size={13} />下移</button>
            <button disabled={!canIndent} onClick={() => onIndent(false)}><Icon name="chevron" size={13} />缩进</button>
            <button disabled={!canOutdent} onClick={() => onIndent(true)}><Icon name="chevron" className="scratch-flip" size={13} />提升</button>
            <button className="is-danger" onClick={onDelete}><Icon name="trash" size={13} />删除这一支</button>
          </div>
        )}
        <textarea
          ref={areaRef}
          className="scratch-text"
          value={value}
          rows={1}
          placeholder="记下一个还没想完的念头…"
          aria-label="草稿卡片内容"
          onFocus={onEditing}
          onChange={(event) => setValue(event.target.value.replace(/[\r\n]+/g, " "))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              commit();
              onAddSibling();
            } else if (event.key === "Tab") {
              event.preventDefault();
              commit();
              onIndent(event.shiftKey);
            } else if (event.altKey && event.key === "ArrowUp") {
              event.preventDefault();
              commit();
              onMove(-1);
            } else if (event.altKey && event.key === "ArrowDown") {
              event.preventDefault();
              commit();
              onMove(1);
            }
          }}
        />
      </article>
      {children && <div className="scratch-children">{children}</div>}
    </div>
  );
}

/**
 * 卡片只是 Markdown 的自动排版视图。它与 MindMap 一样不直接存盘，
 * 每次改动都交给背后仍然挂着的 CodeMirror。
 */
export function Scratchpad({ title, body, onEdit, onUndo, onRedo, onMindmap, onSource, onPromote }: Props) {
  const root = useMemo(() => scratchTree(body, title), [body, title]);
  const cards = useMemo(() => scratchCards(root), [root]);
  const bodyLines = useMemo(() => body.split(/\r\n|\r|\n/), [body]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [menuLine, setMenuLine] = useState<number | null>(null);

  // 结构操作会改行号。宁可清掉一次选中，也不能把「选中甲」悄悄套给移动后占了同一行的乙。
  const structural = (edit: Edit | null, focus?: number) => {
    setMenuLine(null);
    setSelected(new Set());
    if (!edit) return;
    onEdit(edit);
    setEditingLine(focus ?? null);
  };

  const addTop = () => {
    const added = addScratchCard(body, root);
    structural(added.edit, added.line);
  };

  const renderNode = (node: MindNode): React.ReactNode => {
    const parent = parentOf(root, node.line);
    const siblings = parent?.children ?? [];
    const at = siblings.findIndex((candidate) => candidate.line === node.line);
    return (
      <ScratchCard
        key={`${node.line}:${node.prefix}:${node.text}`}
        node={node}
        bodyLines={bodyLines}
        selected={selected.has(node.line)}
        editing={editingLine === node.line}
        menu={menuLine === node.line}
        canUp={at > 0}
        canDown={at >= 0 && at < siblings.length - 1}
        canIndent={at > 0 && (node.kind === "list" || node.kind === "task")}
        canOutdent={(node.kind === "list" || node.kind === "task") && node.indent >= 2}
        onSelect={() => {
          setSelected((before) => {
            const next = new Set(before);
            if (next.has(node.line)) next.delete(node.line);
            else next.add(node.line);
            return next;
          });
        }}
        onEditing={() => setEditingLine(node.line)}
        onMenu={() => setMenuLine((line) => line === node.line ? null : node.line)}
        onCommit={(text) => onEdit(editText(node, text))}
        onAddSibling={() => {
          const added = editAddSibling(node);
          structural(added.edit, added.line);
        }}
        onAddChild={() => {
          const added = editAddChild(node);
          structural(added.edit, added.line);
        }}
        onMove={(direction) => structural(moveScratchCard(body, root, node.line, direction))}
        onIndent={(out) => structural(
          out
            ? outdentScratchCard(body, root, node.line)
            : indentScratchCard(body, root, node.line),
        )}
        onDelete={() => structural(editRemove(node))}
      >
        {node.children.map(renderNode)}
      </ScratchCard>
    );
  };

  const markdown = selectedScratchMarkdown(body, root, selected);

  return (
    <section className="scratchpad" aria-label="草稿台">
      <header className="scratch-head">
        <div>
          <span className="scratch-eyebrow">草稿台</span>
          <h1>{title}</h1>
          <p>先记下，再整理。每张卡片都是普通 Markdown。</p>
        </div>
        <div className="scratch-view-actions">
          <button onClick={onMindmap}><Icon name="mindmap" size={14} />导图</button>
          <button onClick={onSource}><Icon name="text" size={14} />正文</button>
        </div>
      </header>

      <div className="scratch-toolbar">
        <button className="primary" onClick={addTop}><Icon name="plus" size={14} />新想法</button>
        <span>{selected.size ? `已选 ${selected.size} 张` : `${cards.length} 张卡片`}</span>
        <div className="scratch-toolbar-gap" />
        <button title="撤销" aria-label="撤销" onClick={onUndo}><Icon name="undo" size={14} /></button>
        <button title="重做" aria-label="重做" onClick={onRedo}><Icon name="redo" size={14} /></button>
        <button
          className="promote"
          disabled={!markdown}
          onClick={() => markdown && onPromote(markdown)}
        >
          <Icon name="doc" size={14} />生成文档
        </button>
      </div>

      <div className="scratch-scroll">
        {cards.length ? (
          <div className="scratch-grid" role="list">
            {root.children.map(renderNode)}
          </div>
        ) : body.trim() ? (
          <div className="scratch-empty">
            <Icon name="text" size={24} />
            <strong>这篇草稿里是自由段落</strong>
            <p>草稿台只把标题和列表排成卡片；回到正文可继续编辑原内容。</p>
            <button onClick={onSource}>回到正文</button>
          </div>
        ) : (
          <div className="scratch-empty">
            <Icon name="pencil" size={24} />
            <strong>还没有想法</strong>
            <p>不用先想标题。记下第一条，结构以后再说。</p>
            <button className="primary" onClick={addTop}>记第一条</button>
          </div>
        )}
      </div>
    </section>
  );
}
