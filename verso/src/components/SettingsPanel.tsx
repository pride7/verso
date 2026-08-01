import { useEffect, useMemo, useRef, useState } from "react";

import { parseCustomSnippets } from "../editor/snippets/custom";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { Icon } from "./Icon";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
}

type Tab = "appearance" | "editor" | "terminal" | "snippets";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "editor", label: "编辑器" },
  { id: "terminal", label: "终端" },
  { id: "snippets", label: "公式 snippet" },
];

/** 数值设置统一长这样：滑块调、右边显示当前值、能一键回默认 */
function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  fallback,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  fallback: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      <div className="set-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="set-value">
          {value}
          {suffix}
        </span>
        <button
          className="set-reset"
          // 默认值本身就是当前值时按了也没意义，直接禁用比让人怀疑没生效好
          disabled={value === fallback}
          onClick={() => onChange(fallback)}
          title={`恢复默认 ${fallback}${suffix}`}
        >
          ↺
        </button>
      </div>
    </div>
  );
}

function TextRow({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      <div className="set-control">
        <input
          type="text"
          className="set-text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * 设置界面。DESIGN.md §6
 *
 * 有意做成**改一下立刻生效**、没有「保存」按钮：调字号这种事必须边看边调，
 * 隔着一次确认根本调不准。撤销的入口是每一项旁边的「恢复默认」。
 */
export function SettingsPanel({ settings, onChange, onReset, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("appearance");
  // snippet 文本单独存一份本地状态：它要边打边校验，但不该每敲一个字符
  // 就往磁盘写一次
  const [snippetText, setSnippetText] = useState(settings.customSnippets);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSnippetText(settings.customSnippets), [settings.customSnippets]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const snippetCheck = useMemo(() => parseCustomSnippets(snippetText), [snippetText]);
  const snippetDirty = snippetText !== settings.customSnippets;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="modal settings"
        ref={boxRef}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="设置"
      >
        <header className="settings-head">
          <nav className="settings-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={t.id === tab ? "is-on" : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <button className="modal-close" onClick={onClose} title="关闭 (Esc)" aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="settings-body">
          {tab === "appearance" && (
            <>
              <div className="set-row">
                <div className="set-label">
                  <span>主题</span>
                  <span className="set-hint">深浅两套用同一组色相，只翻转明度</span>
                </div>
                <div className="set-control">
                  <div className="segmented">
                    {(
                      [
                        ["system", "跟随系统"],
                        ["light", "浅色"],
                        ["dark", "深色"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        className={settings.theme === v ? "is-on" : undefined}
                        onClick={() => onChange({ theme: v })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Slider
                label="界面字号"
                hint="侧栏、状态栏、各种面板"
                value={settings.uiFontSize}
                min={11}
                max={20}
                step={0.5}
                suffix="px"
                fallback={DEFAULT_SETTINGS.uiFontSize}
                onChange={(v) => onChange({ uiFontSize: v })}
              />

              <TextRow
                label="界面与正文字体"
                hint="填一个已装好的字体名，留空用内置回退"
                value={settings.bodyFont}
                placeholder="例如 Source Han Sans SC"
                onChange={(v) => onChange({ bodyFont: v })}
              />
              <TextRow
                label="等宽字体"
                hint="代码块、公式源码、终端默认都用它"
                value={settings.monoFont}
                placeholder="例如 JetBrains Mono"
                onChange={(v) => onChange({ monoFont: v })}
              />
            </>
          )}

          {tab === "editor" && (
            <>
              <Slider
                label="正文字号"
                hint="中文比西文需要更大字号"
                value={settings.bodyFontSize}
                min={12}
                max={28}
                step={0.5}
                suffix="px"
                fallback={DEFAULT_SETTINGS.bodyFontSize}
                onChange={(v) => onChange({ bodyFontSize: v })}
              />
              <Slider
                label="行高"
                hint="中文密度高，1.5 会显得拥挤"
                value={settings.lineHeight}
                min={1.2}
                max={2.4}
                step={0.05}
                suffix=""
                fallback={DEFAULT_SETTINGS.lineHeight}
                onChange={(v) => onChange({ lineHeight: v })}
              />
              <Slider
                label="正文栏宽"
                hint="约 34 汉字。超过 40 字眼睛回扫容易丢行"
                value={settings.contentWidth}
                min={24}
                max={80}
                step={1}
                suffix="rem"
                fallback={DEFAULT_SETTINGS.contentWidth}
                onChange={(v) => onChange({ contentWidth: v })}
              />
              <p className="set-note">
                窗口拉宽时留白增加，而不是行变长 —— 这是长时间阅读最影响眼睛的一项。
              </p>
            </>
          )}

          {tab === "terminal" && (
            <>
              <Slider
                label="终端字号"
                value={settings.terminalFontSize}
                min={9}
                max={24}
                step={0.5}
                suffix="px"
                fallback={DEFAULT_SETTINGS.terminalFontSize}
                onChange={(v) => onChange({ terminalFontSize: v })}
              />
              <TextRow
                label="终端字体"
                hint="留空则跟随上面的等宽字体"
                value={settings.terminalFont}
                placeholder="跟随等宽字体"
                onChange={(v) => onChange({ terminalFont: v })}
              />
              <p className="set-note">
                终端里跑 AI CLI 时字号可以调小一点，能多看到几行上下文。
              </p>
            </>
          )}

          {tab === "snippets" && (
            <div className="set-snippets">
              <p className="set-note">
                格式与 Obsidian Latex Suite 相同，可以把现有配置整段粘过来。
                这些会与内置的 135 条合并，同触发词时你写的优先。
              </p>
              <textarea
                className="set-code"
                spellCheck={false}
                value={snippetText}
                placeholder={
                  '[\n  { "trigger": "@a", "replacement": "\\\\alpha", "options": "mA" }\n]'
                }
                onChange={(e) => setSnippetText(e.target.value)}
              />

              {snippetCheck.errors.length > 0 && (
                <ul className="set-errors">
                  {snippetCheck.errors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}

              <div className="set-actions">
                <span className="set-hint">
                  {snippetCheck.errors.length
                    ? `${snippetCheck.specs.length} 条可用，${snippetCheck.errors.length} 条有问题`
                    : `${snippetCheck.specs.length} 条`}
                </span>
                <button
                  className="btn-primary"
                  // 有问题的条目会被跳过而不是拦下整批，所以这里不禁用 ——
                  // 只要还有能用的就允许应用，错误信息留在上面继续提示
                  disabled={!snippetDirty}
                  onClick={() => onChange({ customSnippets: snippetText })}
                >
                  {snippetDirty ? "应用" : "已应用"}
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="settings-foot">
          <button
            className="set-reset-all"
            onClick={() => {
              if (window.confirm("把所有设置恢复成默认值？")) onReset();
            }}
          >
            全部恢复默认
          </button>
        </footer>
      </div>
    </div>
  );
}
