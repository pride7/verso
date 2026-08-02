import { useEffect, useMemo, useRef, useState } from "react";

import {
  bindingOf,
  conflictIds,
  eventSpec,
  isUsableSpec,
  pruneOverrides,
  type KeyOverrides,
} from "../lib/keymap";
import { keyLabel } from "../lib/platform";
import { confirm } from "../lib/dialog";
import type { Command } from "./CommandPalette";

interface Props {
  /** 全部命令，含当前不可用的那些 —— 绑键位与「此刻能不能用」无关 */
  commands: Command[];
  overrides: KeyOverrides;
  onChange: (next: KeyOverrides) => void;
}

/**
 * 设置里的快捷键清单。DESIGN.md §7.3
 *
 * 每条命令一行，点右边的按钮进入**录制**：直接按下想要的组合键，按什么就是
 * 什么。不做「填一个字符串」的输入框 —— 那样用户得先知道这个软件管
 * `Ctrl` 叫 `Mod`、管方向键叫 `ArrowUp`，而这些他没有任何办法知道。
 *
 * 撞键**不拦**，只标红。改键位天然是个来回试的过程，中途必然出现「先占上、
 * 待会儿把原来那个挪走」；拦下来的话这个过程根本没法完成。
 */
export function KeyBindings({ commands, overrides, onChange }: Props) {
  const [filter, setFilter] = useState("");
  /** 正在录哪条命令的键位。null = 没在录 */
  const [recording, setRecording] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 录制时事件在 window 上截，回调里要读到最新的 overrides
  const stateRef = useRef({ overrides, commands });
  stateRef.current = { overrides, commands };

  const conflicts = useMemo(() => conflictIds(commands, overrides), [commands, overrides]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const hit = commands.filter(
      (c) => !q || `${c.group} ${c.name ?? c.label} ${c.id}`.toLowerCase().includes(q),
    );
    // 按分组聚一下，顺序沿用命令表 —— 那正是命令面板里的顺序
    const groups: { group: string; items: Command[] }[] = [];
    for (const c of hit) {
      const last = groups[groups.length - 1];
      if (last?.group === c.group) last.items.push(c);
      else groups.push({ group: c.group, items: [c] });
    }
    return groups;
  }, [commands, filter]);

  const set = (id: string, spec: string) => {
    const { overrides: cur, commands: cmds } = stateRef.current;
    // pruneOverrides 会把「改回默认」的那条删掉，所以设成默认值 = 恢复默认
    onChange(pruneOverrides(cmds, { ...cur, [id]: spec }));
  };

  const reset = (id: string) => {
    const { overrides: cur, commands: cmds } = stateRef.current;
    const next = { ...cur };
    delete next[id];
    onChange(pruneOverrides(cmds, next));
  };

  // 录制。挂 capture 阶段并掐断传播：这一发按键既不能触发它本身对应的命令，
  // 也不能被设置面板的 Esc 关闭逻辑收走 —— Esc 在这里的意思是「取消录制」
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const spec = eventSpec(e);
      if (!spec) return; // 光按着修饰键，等后面那个真正的键
      if (spec === "Escape") {
        setRecording(null);
        setNotice(null);
        return;
      }
      if (spec === "Backspace" || spec === "Delete") {
        set(recording, "");
        setRecording(null);
        setNotice(null);
        return;
      }
      if (!isUsableSpec(spec)) {
        // 不带 Ctrl/Alt 的键绑上去会把正常打字吃掉，而那时用户正好在
        // 编辑器里，第一反应是「这软件坏了」
        setNotice("要配合 Ctrl / Alt，或者用 F1–F12");
        return;
      }
      set(recording, spec);
      setRecording(null);
      setNotice(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // set 每次渲染都是新函数，但它读的是 ref 里的最新状态，不必进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const changedCount = Object.keys(pruneOverrides(commands, overrides)).length;

  return (
    <div className="set-keys">
      <div className="set-keys-head">
        <input
          type="text"
          className="set-text set-keys-filter"
          placeholder="筛选命令…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="set-reset-all"
          disabled={changedCount === 0}
          onClick={async () => {
            if (await confirm("把所有快捷键恢复成默认？")) onChange({});
          }}
        >
          {changedCount ? `恢复默认键位（改过 ${changedCount} 条）` : "全是默认键位"}
        </button>
      </div>

      <p className="set-note set-keys-note">
        点右边的按钮，然后直接按下想要的组合键。Backspace 清除，Esc 取消。
        {notice && <strong className="set-keys-warn">　{notice}</strong>}
      </p>

      {rows.map(({ group, items }) => (
        <section key={group} className="set-keys-group">
          <h4>{group}</h4>
          {items.map((c) => {
            const spec = bindingOf(c, overrides);
            const custom = typeof overrides[c.id] === "string";
            const isConflict = conflicts.has(c.id);
            return (
              <div className="key-row" key={c.id}>
                <span className="key-name">{c.name ?? c.label}</span>
                <button
                  className={`key-cap${recording === c.id ? " is-recording" : ""}${
                    isConflict ? " is-conflict" : ""
                  }${spec ? "" : " is-empty"}`}
                  onClick={() => {
                    setNotice(null);
                    setRecording((cur) => (cur === c.id ? null : c.id));
                  }}
                  title={
                    isConflict ? "和另一条命令绑在同一个键上，先按下的那条会赢" : "点一下开始录制"
                  }
                >
                  {recording === c.id ? "按下组合键…" : spec ? keyLabel(spec) : "未绑定"}
                </button>
                <button
                  className="set-reset"
                  disabled={!custom}
                  onClick={() => reset(c.id)}
                  title="恢复这一条的默认键位"
                >
                  ↺
                </button>
              </div>
            );
          })}
        </section>
      ))}

      {rows.length === 0 && <p className="side-empty">没有匹配的命令</p>}
    </div>
  );
}
