import { useEffect, useMemo, useRef, useState } from "react";

import { parseCustomSnippets } from "../editor/snippets/custom";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import type { Command } from "./CommandPalette";
import { Icon } from "./Icon";
import { KeyBindings } from "./KeyBindings";

interface Props {
  settings: Settings;
  /** 全部命令。快捷键那一页要照着它列出每一条 */
  commands: Command[];
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
}

type Tab = "appearance" | "editor" | "keys" | "terminal" | "snippets";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "editor", label: "编辑器" },
  { id: "keys", label: "快捷键" },
  { id: "terminal", label: "终端" },
  { id: "snippets", label: "公式 snippet" },
];

/**
 * 预设主题色：名字、色相、鲜艳度。
 *
 * 第一个是石墨（鲜艳度 0）—— 它不是「没选颜色」，而是一个明确的选择：
 * 整个界面连重音都不要彩色。默认那个青绿取自应用图标。
 */
const ACCENTS: [string, number, number][] = [
  ["石墨", 0, 0],
  ["青绿", 195, 0.085],
  ["靛蓝", 255, 0.09],
  ["紫", 300, 0.085],
  ["森绿", 150, 0.085],
  ["琥珀", 75, 0.1],
  ["绯红", 20, 0.095],
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
export function SettingsPanel({ settings, commands, onChange, onReset, onClose }: Props) {
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
                  <span className="set-hint">深浅两套共用一组中性灰，只翻转明度</span>
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

              <div className="set-row">
                <div className="set-label">
                  <span>主题色</span>
                  <span className="set-hint">
                    界面本身是黑白灰，这个颜色只出现在链接、焦点环、选中标记上
                  </span>
                </div>
                <div className="set-control">
                  <div className="swatches">
                    {ACCENTS.map(([name, h, c]) => {
                      const on =
                        Math.round(settings.accentHue) === h &&
                        Math.abs(settings.accentChroma - c) < 0.005;
                      return (
                        <button
                          key={name}
                          className={`swatch${on ? " is-on" : ""}`}
                          style={{ background: `oklch(58% ${c} ${h})` }}
                          title={name}
                          aria-label={name}
                          aria-pressed={on}
                          onClick={() => onChange({ accentHue: h, accentChroma: c })}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              <Slider
                label="色相"
                hint="沿着色环转。鲜艳度为 0 时它不起作用"
                value={settings.accentHue}
                min={0}
                max={359}
                step={1}
                suffix="°"
                fallback={DEFAULT_SETTINGS.accentHue}
                onChange={(v) => onChange({ accentHue: v })}
              />
              <Slider
                label="鲜艳度"
                hint="拉到 0 就是完全无彩的石墨风"
                value={settings.accentChroma}
                min={0}
                max={0.16}
                step={0.005}
                suffix=""
                fallback={DEFAULT_SETTINGS.accentChroma}
                onChange={(v) => onChange({ accentChroma: v })}
              />

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
                label="打开时展开最近几条进展"
                hint="项目日志（## 2026-08-01 14:30）旧的自动折叠起来。0 = 不折叠"
                value={settings.journalKeep}
                min={0}
                max={12}
                step={1}
                suffix=" 条"
                fallback={DEFAULT_SETTINGS.journalKeep}
                onChange={(v) => onChange({ journalKeep: v })}
              />
              <TextRow
                label="模板目录"
                hint="这个目录下的每篇 .md 就是一个模板。留空 = 关掉模板功能"
                value={settings.templateDir}
                placeholder="templates"
                onChange={(v) => onChange({ templateDir: v })}
              />

              <div className="set-row">
                <div className="set-label">
                  <span>点侧栏文件时</span>
                  <span className="set-hint">
                    Ctrl/⌘+点 和中键总是开新标签，不受这里影响
                  </span>
                </div>
                <div className="set-control">
                  <div className="segmented">
                    {(
                      [
                        ["new", "开新标签"],
                        ["replace", "替换当前"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        className={settings.tabOpen === v ? "is-on" : undefined}
                        onClick={() => onChange({ tabOpen: v })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

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

          {tab === "keys" && (
            <KeyBindings
              commands={commands}
              overrides={settings.keybindings}
              onChange={(keybindings) => onChange({ keybindings })}
            />
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
