import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { Icon } from "./Icon";
import { newNoteParent, nextSort, readSort, writeSort } from "../lib/viewSpec";
import type { ViewResult, ViewRow } from "../types";

interface Props {
  /** `verso-view` 代码块里的原文（YAML） */
  source: string;
  onOpen: (path: string) => void;
  /** 属性被改写后通知外层重查 */
  onChanged: () => void;
  revision: number;
  /**
   * 把改过的 YAML 写回代码块。排序这些**是用户内容不是界面状态**：
   * 它写在笔记里，跟着 `.md` 走，换个编辑器打开也还在（§0 第 1 条）。
   */
  onPatch?: (yaml: string) => void;
}

/**
 * database 视图 —— DESIGN.md §2.6。
 *
 * 「不引入新的存储形态，全部建立在 frontmatter 之上。」数据来源是索引里的
 * `props` 表，而 `props` 是 frontmatter 摊平的结果。改一个单元格就是改
 * 对应笔记的 frontmatter，文件立刻落盘 —— 设计文档说这是「它好不好用的
 * 分水岭：只能看不能改的表格，价值和一个静态列表差不多」。
 */
export function DatabaseView({ source, onOpen, onChanged, revision, onPatch }: Props) {
  const [result, setResult] = useState<ViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(() => {
    api
      .viewQuery(source)
      .then((r) => {
        setResult(r);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [source]);

  useEffect(load, [load, revision]);

  const sort = readSort(source);

  /** 点表头：升 → 降 → 恢复默认。改的是代码块，不是一个 React state */
  const toggleSort = (col: string) => onPatch?.(writeSort(source, nextSort(sort, col)));

  /**
   * 加一行 = 新建一篇笔记。§2.6：「加一行 → 新建一篇笔记并写入对应属性」。
   *
   * 建在 `from:` 指的那个范围里，否则建完它不在表里，等于什么都没发生。
   */
  const addRow = async () => {
    const title = window.prompt("新建笔记", "未命名");
    if (!title) return;
    try {
      const meta = await api.createNote(newNoteParent(source), title);
      onChanged();
      load();
      onOpen(meta.path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const commit = async () => {
    if (!editing) return;
    const { path, key } = editing;
    setEditing(null);
    try {
      await api.propSet(path, key, draft.trim() === "" ? null : draft);
      onChanged();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <div className="dbview dbview-error">
        <strong>视图出错</strong>
        <div>{error}</div>
      </div>
    );
  }
  if (!result) return <div className="dbview dbview-loading">查询中…</div>;

  const cell = (row: ViewRow, col: string) => {
    const value = row.props[col] ?? "";
    const isEditing = editing?.path === row.path && editing.key === col;

    // 标题列是笔记本身，点它应当跳转而不是编辑
    if (col === "title") {
      return (
        <button className="dbview-link" onClick={() => onOpen(row.path)}>
          {/* 一行就是一篇笔记 —— 前面那个图标是在说这件事，不是装饰 */}
          <Icon name="doc" size={14} className="dbview-rowicon" />
          <span>{row.title}</span>
        </button>
      );
    }
    if (isEditing) {
      return (
        <input
          className="dbview-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(null);
            }
          }}
        />
      );
    }
    return (
      <button
        className="dbview-cell"
        onClick={() => {
          setEditing({ path: row.path, key: col });
          setDraft(value);
        }}
        title="点击编辑，改动会写回这篇笔记的 frontmatter"
      >
        {value || <span className="dbview-empty">—</span>}
      </button>
    );
  };

  if (result.view === "board" && result.groupBy) {
    const groups = new Map<string, ViewRow[]>();
    for (const r of result.rows) {
      const g = r.props[result.groupBy] || "（未设置）";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    return (
      <div className="dbview">
        <div className="dbview-board">
          {[...groups].map(([name, rows]) => (
            <div className="dbview-col" key={name}>
              <div className="dbview-col-head">
                {name} <span className="dbview-count">{rows.length}</span>
              </div>
              {rows.map((r) => (
                <button key={r.path} className="dbview-card" onClick={() => onOpen(r.path)}>
                  {r.title}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="dbview-foot">{result.rows.length} 条</div>
      </div>
    );
  }

  return (
    <div className="dbview">
      <div className="dbview-bar">
        <span className="dbview-kind">
          <Icon name="table" size={14} />
          表格
        </span>
        {onPatch && (
          <button className="dbview-new" onClick={addRow}>
            新建
          </button>
        )}
      </div>
      <table className="dbview-table">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} className={sort?.key === c ? "is-sorted" : undefined}>
                {onPatch ? (
                  <button className="dbview-th" onClick={() => toggleSort(c)} title="点击排序">
                    {c}
                    {/* 箭头只在这一列真的在排序时出现 —— 每列都挂一个灰箭头
                        会把表头变成一排噪点 */}
                    {sort?.key === c && (
                      <span className="dbview-arrow">{sort.dir === "desc" ? "↓" : "↑"}</span>
                    )}
                  </button>
                ) : (
                  c
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.path}>
              {result.columns.map((c) => (
                <td key={c}>{cell(r, c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {onPatch && (
        <button className="dbview-add" onClick={addRow} title="新建一篇笔记并加进这个视图">
          <Icon name="plus" size={13} />
          添加条目
        </button>
      )}
      <div className="dbview-foot">
        {result.rows.length === 0 ? "没有匹配的笔记" : `${result.rows.length} 条`}
      </div>
    </div>
  );
}
