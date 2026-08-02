import { useEffect, useState } from "react";

import { api } from "../api";
import { Icon } from "./Icon";
import { relTime } from "../lib/relTime";
import type { HistoryEntry } from "../types";

interface Props {
  /** vault 或改动变了就重查 */
  revision: number;
  onOpen: (path: string) => void;
  /** 把某篇笔记回退到某一版 */
  onRestore: (commit: string, path: string) => void;
}

const KIND: Record<string, string> = {
  added: "新增",
  modified: "更新",
  deleted: "删除",
  renamed: "改名",
};

/**
 * 侧栏里的版本历史。DESIGN.md §2.8
 *
 * ## 为什么值得占侧栏一格
 *
 * 「AI 改完我这篇到底动了什么、能不能退回去」是这个软件最要紧的一个问题
 * （§7.4）。答案本来就在 `.git` 里，但要用户去开一个 git 客户端才能看到，
 * 等于没有。
 *
 * ## 有意不做 diff 视图
 *
 * 逐行 diff 是另一个量级的东西（渲染、折叠、语法高亮）。这一版先给出
 * 「哪一版、什么时候、动了哪几篇」和**单篇回退** —— 那已经能解决上面
 * 那个问题；真要逐行看，笔记就在那儿，git 客户端也在那儿。
 */
export function HistoryView({ revision, onOpen, onRestore }: Props) {
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 用 try 包住：命令不存在时 invoke 是同步抛的，会把整个侧栏带崩
    try {
      void api
        .gitHistory(50)
        .then((h) => alive && setList(h))
        .catch(() => alive && setList([]));
    } catch {
      setList([]);
    }
    return () => {
      alive = false;
    };
  }, [revision]);

  if (list === null) return <p className="side-empty">读取中…</p>;
  if (list.length === 0) {
    return (
      <p className="side-empty">
        还没有版本记录。改点什么，停手几分钟就会自动记一个；也可以点状态栏上的那个点立刻记。
      </p>
    );
  }

  const now = new Date();
  return (
    <ul className="hist">
      {list.map((h) => (
        <li key={h.id} className={open === h.id ? "is-open" : undefined}>
          <button className="hist-head" onClick={() => setOpen(open === h.id ? null : h.id)}>
            <Icon name="chevron" size={11} className="hist-caret" />
            <span className="hist-msg">{h.message}</span>
            <span className="hist-when">{relTime(h.at, now)}</span>
          </button>

          {open === h.id && (
            <ul className="hist-files">
              {h.files.map((f) => (
                <li key={f.path}>
                  <button
                    className="hist-file"
                    onClick={() => onOpen(f.path)}
                    disabled={f.kind === "deleted"}
                    title={f.path}
                  >
                    <span className={`hist-kind is-${f.kind}`}>{KIND[f.kind] ?? f.kind}</span>
                    <span className="hist-path">{f.path.replace(/\.md$/, "")}</span>
                  </button>
                  {/* 回退只给笔记：附件不是文本，覆盖回去会坏 */}
                  {f.path.endsWith(".md") && f.kind !== "deleted" && (
                    <button
                      className="hist-restore"
                      onClick={() => onRestore(h.id, f.path)}
                      title="把这篇恢复成这一版的内容"
                      aria-label={`恢复 ${f.path}`}
                    >
                      <Icon name="history" size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
