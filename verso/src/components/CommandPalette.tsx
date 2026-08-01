import { useEffect, useMemo, useRef, useState } from "react";

import { rankNotes } from "../lib/fuzzy";

export interface Command {
  id: string;
  label: string;
  /**
   * 设置里那份快捷键清单用的稳定名字。
   *
   * `label` 会跟着状态变（「收起侧栏」／「展开侧栏」），当命令名读着别扭 ——
   * 那份清单是绑键位的地方，不该跟着当前状态左右横跳。只有变的那几条要填。
   */
  name?: string;
  /** 分组名，显示在标题左侧。也参与搜索 */
  group: string;
  /** 默认键位，`Mod+Shift+P` 这种平台无关写法。留空 = 默认不绑 */
  defaultKeys?: string;
  /** 当前实际生效的键位（用户可能改过）。由 `App` 算好填进来 */
  binding?: string;
  /** 快捷键提示，已按平台转换好。由 `App` 从 `binding` 算出来 */
  keys?: string;
  run: () => void;
  /** 返回 false 时这条命令当前不可用（比如没打开笔记时的「重命名」） */
  enabled?: boolean;
}

interface Props {
  commands: Command[];
  onClose: () => void;
}

/**
 * 命令面板。DESIGN.md §8 M4
 *
 * 存在的理由不是「多一个入口」，而是**让快捷键可以被发现**。一个不做插件
 * 系统的软件，功能全靠内置，用户没有任何地方能看到「原来还能这样」——
 * 所以每条命令都带着它的快捷键一起显示，用过几次自然就记住了。
 *
 * 搜索复用快速切换器那套模糊匹配：同一个手感，不需要学第二遍。
 */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const available = useMemo(() => commands.filter((c) => c.enabled !== false), [commands]);

  const results = useMemo(() => {
    // 名字里带上分组，这样输入「终端」既能搜到「终端：打开面板」也能搜到
    // 分组本身；path 给模糊匹配当兜底字段用
    const items = available.map((c) => ({
      ...c,
      name: `${c.group} ${c.label}`,
      path: c.id,
    }));
    return rankNotes(items, query, 40);
  }, [available, query]);

  useEffect(() => setActive(0), [query]);

  // 键盘选中项要跟着滚进视野，否则按到第十条以后就看不见自己在选什么
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [active]);

  const pick = (i: number) => {
    const hit = results[i]?.item;
    if (!hit) return;
    // 先关面板再执行：命令里有「打开设置」这种会弹另一个浮层的，
    // 顺序反过来会出现两层叠在一起
    onClose();
    hit.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="overlay overlay-top" onMouseDown={onClose}>
      <div className="modal palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="输入命令名…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <ul className="palette-list" ref={listRef}>
          {results.map((r, i) => (
            <li key={r.item.id} aria-selected={i === active}>
              <button
                className={i === active ? "is-active" : undefined}
                // 用 mouseMove 而不是 mouseEnter：面板刚弹出时鼠标可能恰好
                // 停在某一行上，enter 不会触发，选中项看着就像卡住了
                onMouseMove={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="palette-group">{r.item.group}</span>
                <span className="palette-label">{r.item.label}</span>
                {r.item.keys && <kbd className="palette-keys">{r.item.keys}</kbd>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">没有匹配的命令</li>}
        </ul>
      </div>
    </div>
  );
}
