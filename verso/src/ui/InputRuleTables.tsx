import type { SnippetSpec } from "../core/snippets/types";
import type { SlashItem } from "../core/slash";
import { Icon } from "./Icon";

const OPTION_ORDER = ["m", "t", "A", "r", "w"] as const;

/**
 * 设置文件仍保持 Latex Suite 兼容的 JSON，但界面只操作结构化的行。
 * 序列化集中在这里，避免两个页面各自拼出略有差异的配置文本。
 */
export function serializeSnippetSpecs(rows: readonly SnippetSpec[]): string {
  if (rows.length === 0) return "";
  return JSON.stringify(
    rows.map((row) => ({
      trigger: row.trigger,
      replacement: row.replacement,
      options: normalizeOptions(row.options),
      ...(row.priority === undefined ? {} : { priority: row.priority }),
      ...(row.description === undefined || row.description === ""
        ? {}
        : { description: row.description }),
    })),
    null,
    2,
  );
}

export function serializeSlashItems(rows: readonly SlashItem[]): string {
  if (rows.length === 0) return "";
  return JSON.stringify(
    rows.map((row) => ({
      label: row.label,
      ...(row.detail ? { detail: row.detail } : {}),
      template: row.template ?? "",
    })),
    null,
    2,
  );
}

function normalizeOptions(options: string): string {
  const set = new Set(options);
  return OPTION_ORDER.filter((flag) => set.has(flag)).join("");
}

function setFlag(options: string, flag: string, enabled: boolean): string {
  const set = new Set(options);
  if (enabled) set.add(flag);
  else set.delete(flag);
  return normalizeOptions([...set].join(""));
}

function setRange(options: string, range: "" | "m" | "t"): string {
  let next = setFlag(setFlag(options, "m", false), "t", false);
  if (range) next = setFlag(next, range, true);
  return next;
}

function move<T>(rows: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= rows.length || from === to) return [...rows];
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

function RowActions({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="set-table-row-actions">
      <button
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        title="上移"
        aria-label="上移这一行"
      >
        <Icon name="arrow-up" size={14} />
      </button>
      <button
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        title="下移"
        aria-label="下移这一行"
      >
        <Icon name="arrow-down" size={14} />
      </button>
      <button className="is-danger" onClick={onRemove} title="删除" aria-label="删除这一行">
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}

export function SnippetRulesTable({
  rows,
  onChange,
}: {
  rows: SnippetSpec[];
  onChange: (rows: SnippetSpec[]) => void;
}) {
  const patch = (index: number, change: Partial<SnippetSpec>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <>
      <div className="set-table-toolbar">
        <span className="set-hint">{rows.length} 条自定义规则</span>
        <button
          className="set-table-add"
          onClick={() => onChange([...rows, { trigger: "", replacement: "", options: "mA" }])}
        >
          <Icon name="plus" size={14} />
          新增规则
        </button>
      </div>

      <div className="set-config-table-wrap">
        <table className="set-config-table set-snippet-table">
          <colgroup>
            <col className="set-snippet-key-col" />
            <col className="set-snippet-value-col" />
            <col className="set-snippet-option-col" />
            <col className="set-table-action-col" />
          </colgroup>
          <thead>
            <tr>
              <th>触发词与说明</th>
              <th>展开内容</th>
              <th>触发条件</th>
              <th><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const range = row.options.includes("m")
                ? "m"
                : row.options.includes("t")
                  ? "t"
                  : "";
              return (
                <tr key={index}>
                  <td data-label="触发词与说明">
                    <input
                      className="set-table-input set-table-code"
                      value={row.trigger}
                      placeholder="例如 @a"
                      aria-label={`第 ${index + 1} 条触发词`}
                      aria-invalid={!row.trigger || undefined}
                      onChange={(e) => patch(index, { trigger: e.target.value })}
                    />
                    <input
                      className="set-table-input set-table-secondary"
                      value={row.description ?? ""}
                      placeholder="说明（可选）"
                      aria-label={`第 ${index + 1} 条说明`}
                      onChange={(e) => patch(index, { description: e.target.value || undefined })}
                    />
                  </td>
                  <td data-label="展开内容">
                    <textarea
                      className="set-table-input set-table-code"
                      rows={2}
                      value={row.replacement}
                      placeholder="例如 \\alpha"
                      spellCheck={false}
                      aria-label={`第 ${index + 1} 条展开内容`}
                      onChange={(e) => patch(index, { replacement: e.target.value })}
                    />
                  </td>
                  <td data-label="触发条件">
                    <div className="set-snippet-options">
                      <select
                        value={range}
                        aria-label={`第 ${index + 1} 条生效范围`}
                        onChange={(e) =>
                          patch(index, {
                            options: setRange(row.options, e.target.value as "" | "m" | "t"),
                          })
                        }
                      >
                        <option value="m">公式内</option>
                        <option value="t">正文内</option>
                        <option value="">任意位置</option>
                      </select>
                      <div className="set-snippet-flags">
                        {([
                          ["A", "自动", "输入触发词后立即展开"],
                          ["r", "正则", "将触发词作为正则表达式"],
                          ["w", "词界", "只在词边界处触发"],
                        ] as const).map(([flag, label, title]) => (
                          <button
                            key={flag}
                            className={row.options.includes(flag) ? "is-on" : undefined}
                            aria-pressed={row.options.includes(flag)}
                            title={title}
                            onClick={() =>
                              patch(index, {
                                options: setFlag(
                                  row.options,
                                  flag,
                                  !row.options.includes(flag),
                                ),
                              })
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <label className="set-priority">
                        <span>优先级</span>
                        <input
                          type="number"
                          value={row.priority ?? ""}
                          placeholder="自动"
                          aria-label={`第 ${index + 1} 条优先级`}
                          onChange={(e) =>
                            patch(index, {
                              priority: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  </td>
                  <td data-label="操作">
                    <RowActions
                      index={index}
                      count={rows.length}
                      onMove={(to) => onChange(move(rows, index, to))}
                      onRemove={() => onChange(rows.filter((_, i) => i !== index))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="set-table-empty">还没有自定义规则。点击“新增规则”开始添加。</p>
        )}
      </div>
    </>
  );
}

export function SlashCustomTable({
  rows,
  onChange,
}: {
  rows: SlashItem[];
  onChange: (rows: SlashItem[]) => void;
}) {
  const patch = (index: number, change: Partial<SlashItem>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  return (
    <>
      <div className="set-table-toolbar">
        <span className="set-hint">{rows.length} 条自定义命令</span>
        <button
          className="set-table-add"
          onClick={() => onChange([...rows, { label: "", detail: "", template: "$0" }])}
        >
          <Icon name="plus" size={14} />
          新增命令
        </button>
      </div>

      <div className="set-config-table-wrap">
        <table className="set-config-table set-slash-custom-table">
          <colgroup>
            <col className="set-slash-name-col" />
            <col />
            <col className="set-table-action-col" />
          </colgroup>
          <thead>
            <tr>
              <th>名称与说明</th>
              <th>插入内容</th>
              <th><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td data-label="名称与说明">
                  <input
                    className="set-table-input"
                    value={row.label}
                    placeholder="例如 定理"
                    aria-label={`第 ${index + 1} 条命令名称`}
                    aria-invalid={!row.label.trim() || undefined}
                    onChange={(e) => patch(index, { label: e.target.value })}
                  />
                  <input
                    className="set-table-input set-table-secondary"
                    value={row.detail}
                    placeholder="菜单中的简短说明"
                    aria-label={`第 ${index + 1} 条命令说明`}
                    onChange={(e) => patch(index, { detail: e.target.value })}
                  />
                </td>
                <td data-label="插入内容">
                  <textarea
                    className="set-table-input set-table-code"
                    rows={2}
                    value={row.template ?? ""}
                    placeholder="输入要插入的 Markdown；$0 是光标位置"
                    spellCheck={false}
                    aria-label={`第 ${index + 1} 条插入内容`}
                    aria-invalid={!row.template || undefined}
                    onChange={(e) => patch(index, { template: e.target.value })}
                  />
                </td>
                <td data-label="操作">
                  <RowActions
                    index={index}
                    count={rows.length}
                    onMove={(to) => onChange(move(rows, index, to))}
                    onRemove={() => onChange(rows.filter((_, i) => i !== index))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="set-table-empty">还没有自定义命令。点击“新增命令”开始添加。</p>
        )}
      </div>
    </>
  );
}

