import { useState } from "react";

import { Icon } from "./Icon";
import {
  OPS,
  readColumns,
  readKey,
  readWhere,
  writeColumns,
  writeKey,
  writeWhere,
  type Condition,
} from "../lib/viewSpec";
import type { PropMeta } from "../types";

interface Props {
  /** 代码块里的 YAML 原文 */
  source: string;
  /** 这批笔记身上有哪些属性，筛选和加列都从这里挑 */
  properties: PropMeta[];
  onPatch: (yaml: string) => void;
  onClose: () => void;
}

const VIEWS: { id: string; label: string }[] = [
  { id: "table", label: "表格" },
  { id: "board", label: "看板" },
  { id: "list", label: "列表" },
];

/**
 * 视图设置。DESIGN.md §2.6
 *
 * 面板里改的每一项都**写回代码块**，不是界面状态 —— 视图定义就写在笔记里
 * （§0 第 1 条）。所以这个面板本质上是「那段 YAML 的一个表单」。
 *
 * 手写的筛选表达式**不接管**：`readWhere` 看不懂时（用了 `or`、括号这些
 * Rust 侧不支持的写法）就只显示原文并让人去代码块里改。在界面上把它
 * 规范化成一个语义不同的东西，比不做还糟。
 */
export function ViewSettings({ source, properties, onPatch, onClose }: Props) {
  const view = readKey(source, "view") ?? "table";
  const from = readKey(source, "from") ?? "";
  const limit = readKey(source, "limit") ?? "";
  const where = readWhere(source);
  const [draftFrom, setDraftFrom] = useState(from);

  const patchWhere = (conds: Condition[]) => onPatch(writeWhere(source, conds));

  return (
    <div className="vset" onMouseDown={(e) => e.stopPropagation()}>
      <div className="vset-head">
        <span>视图设置</span>
        <button className="vset-x" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={13} />
        </button>
      </div>

      <label className="vset-row">
        <span className="vset-label">类型</span>
        <span className="vset-seg">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={v.id === view ? "is-on" : undefined}
              onClick={() => onPatch(writeKey(source, "view", v.id))}
            >
              {v.label}
            </button>
          ))}
        </span>
      </label>

      <label className="vset-row">
        <span className="vset-label">来源</span>
        {/* 失焦才写：每敲一个字符就改一次文件，撤销历史会被冲掉 */}
        <input
          className="vset-input"
          value={draftFrom}
          placeholder="论文/**"
          onChange={(e) => setDraftFrom(e.target.value)}
          onBlur={() =>
            draftFrom !== from &&
            onPatch(writeKey(source, "from", draftFrom ? `"${draftFrom}"` : null))
          }
        />
      </label>

      <div className="vset-row vset-filters">
        <span className="vset-label">筛选</span>
        <div className="vset-conds">
          {where === null ? (
            <p className="vset-hand">
              这个筛选是手写的（用了界面表达不了的写法），去代码块里改：
              <code>{readKey(source, "where")}</code>
            </p>
          ) : (
            <>
              {where.map((c, i) => (
                <div className="vset-cond" key={i}>
                  <select
                    value={c.key}
                    onChange={(e) =>
                      patchWhere(where.map((x, j) => (i === j ? { ...x, key: e.target.value } : x)))
                    }
                  >
                    {[...new Set([c.key, ...properties.map((p) => p.key)])].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                  <select
                    value={c.op}
                    onChange={(e) =>
                      patchWhere(where.map((x, j) => (i === j ? { ...x, op: e.target.value } : x)))
                    }
                  >
                    {OPS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  <input
                    defaultValue={c.value}
                    onBlur={(e) =>
                      e.target.value !== c.value &&
                      patchWhere(
                        where.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    className="vset-del"
                    onClick={() => patchWhere(where.filter((_, j) => j !== i))}
                    aria-label="删掉这个条件"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
              <button
                className="vset-add"
                disabled={properties.length === 0}
                onClick={() =>
                  patchWhere([...where, { key: properties[0]?.key ?? "", op: "=", value: "" }])
                }
              >
                <Icon name="plus" size={12} /> 加一个条件
              </button>
            </>
          )}
        </div>
      </div>

      <label className="vset-row">
        <span className="vset-label">上限</span>
        <input
          className="vset-input vset-num"
          defaultValue={limit}
          placeholder="500"
          inputMode="numeric"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === limit) return;
            // 填了非数字就当没填 —— 夹紧而不是报错（§6.4 那条同理）
            onPatch(writeKey(source, "limit", /^\d+$/.test(v) ? v : null));
          }}
        />
      </label>
    </div>
  );
}

interface ColumnPickerProps {
  source: string;
  /** 当前显示的列 */
  shown: string[];
  properties: PropMeta[];
  onPatch: (yaml: string) => void;
  onClose: () => void;
}

/**
 * 「加一列」。
 *
 * 两种加法：勾一个已有的属性，或者**起一个新名字**。后者不会立刻改任何笔记
 * —— 属性是在你往某个格子里填值时才写进那篇笔记的 frontmatter 的（§2.6：
 * 数据来源就是 frontmatter，没有另一份 schema）。
 */
export function ColumnPicker({ source, shown, properties, onPatch, onClose }: ColumnPickerProps) {
  const [name, setName] = useState("");
  const rest = properties.filter((p) => !shown.includes(p.key));

  const add = (key: string) => {
    const k = key.trim();
    if (!k || shown.includes(k)) return;
    onPatch(writeColumns(source, [...(readColumns(source) ?? shown), k]));
    onClose();
  };

  return (
    <div className="vset vset-cols" onMouseDown={(e) => e.stopPropagation()}>
      <div className="vset-head">
        <span>加一列</span>
        <button className="vset-x" onClick={onClose} aria-label="关闭">
          <Icon name="close" size={13} />
        </button>
      </div>

      {rest.length > 0 && (
        <ul className="vset-list">
          {rest.map((p) => (
            <li key={p.key}>
              <button onClick={() => add(p.key)}>
                <Icon name={propIcon(p.type)} size={13} />
                {p.key}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="vset-newcol"
        onSubmit={(e) => {
          e.preventDefault();
          add(name);
        }}
      >
        <input
          value={name}
          placeholder="新属性名"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={!name.trim()}>
          添加
        </button>
      </form>
    </div>
  );
}

/** 属性类型 → 图标。§2.6：UI 按类型渲染，类型来自索引里的 `props.type` */
export function propIcon(type: string): "hash" | "clock" | "check" | "tag" | "text" {
  switch (type) {
    case "number":
      return "hash";
    case "date":
      return "clock";
    case "bool":
      return "check";
    case "list":
      return "tag";
    default:
      return "text";
  }
}
