import { useEffect, useMemo, useRef, useState } from "react";

import { parseCustomSnippets } from "../editor/snippets/custom";
import { confirm } from "../lib/dialog";
import { BUILTIN_SLASH, parseSlashCustom } from "../lib/slash";
import { APP_VERSION, progressText, updatesSupported, type UpdateApi } from "../lib/update";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import type { RemoteInfo } from "../types";
import type { Command } from "./CommandPalette";
import { Icon } from "./Icon";
import {
  serializeSlashItems,
  serializeSnippetSpecs,
  SlashCustomTable,
  SnippetRulesTable,
} from "./InputRuleTables";
import { KeyBindings } from "./KeyBindings";

interface Props {
  settings: Settings;
  /** 全部命令。快捷键那一页要照着它列出每一条 */
  commands: Command[];
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
  /** §2.8 远端。null = 还没打开 vault */
  remote: RemoteInfo | null;
  /** 这个远端在系统钥匙串里存过令牌没有 */
  tokenSaved: boolean;
  onRemoteChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  /** §2.11 更新。状态机在 App 上，这里只是它的一个界面 */
  update: UpdateApi;
  /** 打开时停在哪一页。状态栏那个「有新版本」直接跳到「更新」 */
  initialTab?: Tab;
}

export type Tab =
  | "appearance"
  | "editor"
  | "keys"
  | "terminal"
  | "snippets"
  | "slash"
  | "sync"
  | "update";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "editor", label: "编辑" },
  { id: "keys", label: "快捷键" },
  { id: "terminal", label: "终端" },
  { id: "snippets", label: "公式补全" },
  { id: "slash", label: "斜杠菜单" },
  { id: "sync", label: "同步" },
  { id: "update", label: "软件更新" },
];

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  appearance: "主题、字体与界面显示",
  editor: "阅读、标签页、模板与版本记录",
  keys: "查看并修改命令快捷键",
  terminal: "内嵌终端的显示设置",
  snippets: "自定义 LaTeX 输入规则",
  slash: "管理内置命令与自定义条目",
  sync: "配置远程仓库与访问凭据",
  update: "检查版本与配置自动更新",
};

/**
 * 预设主题色：名字、色相、鲜艳度。
 *
 * 第一个是石墨（鲜艳度 0）—— 它不是「没选颜色」，而是一个明确的选择：
 * 整个界面连重音都不要彩色。默认那个青绿取自应用图标。
 */
const ACCENTS: [string, number, number][] = [
  ["石墨", 0, 0],
  ["青绿", 195, 0.11],
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
 * 同步那一页。DESIGN.md §2.8
 *
 * 界面上只有两样东西：**仓库地址**和**令牌**。没有 branch、没有 remote 名字、
 * 没有 push/pull 的选项 —— 那些概念对着一个笔记软件的用户没有意义，而它们
 * 全都有一个唯一合理的取值。
 *
 * 地址和令牌都**不是设置项**：地址存在仓库自己的 `.git/config` 里（跟着
 * vault 走，换台机器重新填一次是对的），令牌存在系统钥匙串里。所以这一页
 * 不走 `onChange`，而是各自有自己的回调。
 */
function SyncSettings({
  remote,
  tokenSaved,
  onRemoteChange,
  onTokenChange,
}: {
  remote: RemoteInfo | null;
  tokenSaved: boolean;
  onRemoteChange: (url: string) => void;
  onTokenChange: (token: string) => void;
}) {
  // 两个输入框都**按下「保存」才提交**，不是边打边存：地址打到一半就去连
  // 远端毫无意义，而令牌每敲一个字符写一次钥匙串更是荒唐
  const [url, setUrl] = useState(remote?.url ?? "");
  const [token, setToken] = useState("");
  useEffect(() => setUrl(remote?.url ?? ""), [remote?.url]);

  if (!remote) {
    return <p className="set-note">请先打开一个笔记库。</p>;
  }

  return (
    <div className="set-sync">
      <p className="set-note">
        配置远程 Git 仓库后，可通过状态栏中的「同步」上传本机更改并获取远程更改。
      </p>

      <div className="set-row">
        <div className="set-label">
          <span>仓库地址</span>
          <span className="set-hint">
            支持 GitHub、GitLab 及自托管服务。请输入以 <code>https://</code> 开头的仓库地址；
            留空将停用同步。
          </span>
        </div>
        <div className="set-control">
          <input
            type="text"
            className="set-text"
            value={url}
            placeholder="https://github.com/用户名/笔记仓库.git"
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="set-save"
            disabled={url.trim() === (remote.url ?? "")}
            onClick={() => onRemoteChange(url.trim())}
          >
            保存
          </button>
        </div>
      </div>

      {remote.needsToken && (
        <div className="set-row">
          <div className="set-label">
            <span>访问令牌</span>
            <span className="set-hint">
              {/* 说清楚它存哪儿 —— 一个仓库令牌等于那个仓库的写权限，
                  人有权知道自己把它交到了哪里 */}
              GitHub Personal Access Token，需具备仓库读写权限。凭据仅存储于系统密钥链
              {tokenSaved && " · 已保存"}
            </span>
          </div>
          <div className="set-control">
            <input
              type="password"
              className="set-text"
              value={token}
              placeholder={tokenSaved ? "已保存；输入新令牌以替换" : "ghp_…"}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="set-save"
              disabled={!token && !tokenSaved}
              onClick={() => {
                onTokenChange(token);
                setToken("");
              }}
            >
              {token ? "保存" : "删除"}
            </button>
          </div>
        </div>
      )}

      {remote.url && (
        <p className="set-note set-note-dim">
          当前同步分支：<code>{remote.branch}</code>。若同一文档在两端均有修改，同步将暂停并列出
          冲突文档，不会自动合并。
        </p>
      )}
    </div>
  );
}

/**
 * 更新那一页。DESIGN.md §2.11
 *
 * 状态机不在这里 —— 它挂在 App 上（`useUpdate`），状态栏和这一页看的是
 * 同一份。这里只负责把那几个状态说成人话。
 *
 * **下载和安装分成两次点击**，中间那一步是有意的：更新的时机该由正在写
 * 东西的人来定，而不是由「下载刚好完成」这个与他无关的时刻来定。
 */
function UpdateSettings({
  update,
  auto,
  onAutoChange,
}: {
  update: UpdateApi;
  auto: boolean;
  onAutoChange: (v: boolean) => void;
}) {
  const { state } = update;
  const supported = updatesSupported();
  const busy = state.phase === "checking" || state.phase === "downloading";

  return (
    <div className="set-update">
      <div className="set-row">
        <div className="set-label">
          <span>当前版本</span>
          <span className="set-hint">
            更新由 GitHub Releases 提供。仅在检查或下载更新时联网。
          </span>
        </div>
        <div className="set-control">
          <span className="set-value set-version">{APP_VERSION}</span>
          <button className="set-save" disabled={busy || !supported} onClick={update.check}>
            {state.phase === "checking" ? "检查中…" : "检查更新"}
          </button>
        </div>
      </div>

      {!supported && (
        <p className="set-note">
          当前平台不支持应用内更新，请通过应用商店或安装包更新。
        </p>
      )}

      {state.phase === "latest" && <p className="set-note">当前已是最新版本。</p>}

      {state.phase === "error" && (
        <ul className="set-errors">
          <li>{state.message}</li>
        </ul>
      )}

      {state.phase === "found" && (
        <div className="set-update-found">
          <p className="set-note">
            有新版本 <strong>{state.version}</strong>
            {state.date && ` · ${state.date.slice(0, 10)}`}
          </p>
          {/* 更新说明原样显示。它来自 GitHub release 的正文，是作者写的、
              不是从提交记录拼的 —— 值得占这块地方 */}
          {state.notes && <pre className="set-update-notes">{state.notes}</pre>}
          <div className="set-actions">
            <button className="set-save" onClick={update.dismiss}>
              稍后
            </button>
            <button className="btn-primary" onClick={update.download}>
              下载
            </button>
          </div>
        </div>
      )}

      {state.phase === "downloading" && (
        <p className="set-note">
          正在下载 {state.version} · {progressText(state.received, state.total)}
        </p>
      )}

      {state.phase === "ready" && (
        <div className="set-update-found">
          <p className="set-note">
            {state.version} 已下载完成。重启并安装前，应用会保存当前内容，并按照版本记录设置
            处理尚未记录的更改。
          </p>
          <div className="set-actions">
            <button className="btn-primary" onClick={update.install}>
              重启并安装
            </button>
          </div>
        </div>
      )}

      <div className="set-row">
        <div className="set-label">
          <span>启动时自动检查</span>
          <span className="set-hint">
            应用启动后自动检查更新。网络不可用或检查失败时不显示提示。
          </span>
        </div>
        <div className="set-control">
          <div className="segmented">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                className={auto === v ? "is-on" : undefined}
                onClick={() => onAutoChange(v)}
              >
                {v ? "启用" : "停用"}
              </button>
            ))}
          </div>
        </div>
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
export function SettingsPanel({
  settings,
  commands,
  onChange,
  onReset,
  onClose,
  remote,
  tokenSaved,
  onRemoteChange,
  onTokenChange,
  update,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "appearance");
  // 底层仍存 Latex Suite 兼容的 JSON，界面则只操作表格行。这样既能无损接住
  // 旧配置，又不必让日常添加一条规则的人手写括号、引号和转义符。
  const snippetSource = useMemo(
    () => parseCustomSnippets(settings.customSnippets),
    [settings.customSnippets],
  );
  const [snippetRows, setSnippetRows] = useState(() => snippetSource.specs);
  const [snippetImportText, setSnippetImportText] = useState(settings.customSnippets);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSnippetRows(snippetSource.specs);
    setSnippetImportText(settings.customSnippets);
  }, [settings.customSnippets, snippetSource.specs]);

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

  const snippetText = useMemo(() => serializeSnippetSpecs(snippetRows), [snippetRows]);
  const snippetCheck = useMemo(() => parseCustomSnippets(snippetText), [snippetText]);
  const snippetBase = useMemo(
    () => serializeSnippetSpecs(snippetSource.specs),
    [snippetSource.specs],
  );
  const snippetDirty = snippetText !== snippetBase;
  const snippetErrors = snippetDirty ? snippetCheck.errors : snippetSource.errors;
  const snippetImportCheck = useMemo(
    () => parseCustomSnippets(snippetImportText),
    [snippetImportText],
  );

  const slashSource = useMemo(() => parseSlashCustom(settings.slashCustom), [settings.slashCustom]);
  const [slashRows, setSlashRows] = useState(() => slashSource.items);
  useEffect(() => setSlashRows(slashSource.items), [slashSource.items]);
  const slashText = useMemo(() => serializeSlashItems(slashRows), [slashRows]);
  const slashCheck = useMemo(() => parseSlashCustom(slashText), [slashText]);
  const slashBase = useMemo(() => serializeSlashItems(slashSource.items), [slashSource.items]);
  const slashDirty = slashText !== slashBase;
  const slashErrors = slashDirty ? slashCheck.errors : slashSource.errors;
  const hidden = new Set(settings.slashHidden);
  const toggleSlash = (label: string) =>
    onChange({
      slashHidden: hidden.has(label)
        ? settings.slashHidden.filter((x) => x !== label)
        : [...settings.slashHidden, label],
    });
  const activeTab = TABS.find((item) => item.id === tab)!;

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
          <strong className="settings-title">设置</strong>
          <button className="modal-close" onClick={onClose} title="关闭 (Esc)" aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="设置分类">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={t.id === tab ? "is-on" : undefined}
                onClick={() => setTab(t.id)}
                aria-current={t.id === tab ? "page" : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <section className="settings-main" aria-labelledby="settings-page-title">
            <div className="settings-page-head">
              <h2 id="settings-page-title">{activeTab.label}</h2>
              <p>{TAB_DESCRIPTIONS[tab]}</p>
            </div>

            <div className="settings-body">
          {tab === "appearance" && (
            <>
              <h3 className="set-section">颜色</h3>
              <div className="set-row">
                <div className="set-label">
                  <span>主题</span>
                  <span className="set-hint">浅色与深色主题使用一致的中性灰阶体系。</span>
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
                    仅用于链接、焦点、光标和选中标记。
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
                hint="调整强调色的色相；鲜艳度为 0 时不生效。"
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
                hint="设置为 0 时使用无彩色石墨方案。"
                value={settings.accentChroma}
                min={0}
                max={0.16}
                step={0.005}
                suffix=""
                fallback={DEFAULT_SETTINGS.accentChroma}
                onChange={(v) => onChange({ accentChroma: v })}
              />

              <h3 className="set-section">字体</h3>
              <Slider
                label="界面字号"
                hint="应用于侧栏、状态栏和设置面板等界面元素。"
                value={settings.uiFontSize}
                min={11}
                max={20}
                step={0.5}
                suffix="px"
                fallback={DEFAULT_SETTINGS.uiFontSize}
                onChange={(v) => onChange({ uiFontSize: v })}
              />

              <TextRow
                label="界面及正文字体"
                hint="输入系统中已安装的字体名称；留空时使用默认字体栈。"
                value={settings.bodyFont}
                placeholder="例如：Source Han Sans SC"
                onChange={(v) => onChange({ bodyFont: v })}
              />
              <TextRow
                label="等宽字体"
                hint="应用于代码块、公式源码，并作为终端默认字体。"
                value={settings.monoFont}
                placeholder="例如：JetBrains Mono"
                onChange={(v) => onChange({ monoFont: v })}
              />
            </>
          )}

          {tab === "editor" && (
            <>
              <h3 className="set-section">版本记录</h3>
              <div className="set-row">
                <div className="set-label">
                  <span>切换应用时记录版本</span>
                  <span className="set-hint">
                    仅在存在未记录的更改时执行，不会生成空版本。
                  </span>
                </div>
                <div className="set-control">
                  <div className="segmented">
                    {([true, false] as const).map((v) => (
                      <button
                        key={String(v)}
                        className={settings.autoCommitOnBlur === v ? "is-on" : undefined}
                        onClick={() => onChange({ autoCommitOnBlur: v })}
                      >
                        {v ? "启用" : "停用"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="set-row">
                <div className="set-label">
                  <span>退出前记录版本</span>
                  <span className="set-hint">
                    关闭应用前保存当前内容，并在存在更改时记录版本。
                  </span>
                </div>
                <div className="set-control">
                  <div className="segmented">
                    {([true, false] as const).map((v) => (
                      <button
                        key={String(v)}
                        className={settings.autoCommitOnClose === v ? "is-on" : undefined}
                        onClick={() => onChange({ autoCommitOnClose: v })}
                      >
                        {v ? "启用" : "停用"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Slider
                label="空闲后自动记录版本"
                hint="停止编辑达到指定时长后记录版本；设为 0 可停用。"
                value={settings.autoCommitIdleMin}
                min={0}
                max={60}
                step={1}
                suffix=" 分钟"
                fallback={DEFAULT_SETTINGS.autoCommitIdleMin}
                onChange={(v) => onChange({ autoCommitIdleMin: v })}
              />

              <h3 className="set-section">文档与标签页</h3>
              <Slider
                label="默认展开的日志条数"
                hint="打开项目日志时保留最近几条进展为展开状态；设为 0 时不自动折叠。"
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
                hint="目录内每个 Markdown 文件均可作为模板；留空可停用模板功能。"
                value={settings.templateDir}
                placeholder="templates"
                onChange={(v) => onChange({ templateDir: v })}
              />

              <div className="set-row">
                <div className="set-label">
                  <span>点击侧栏文档时</span>
                  <span className="set-hint">
                    按住 Ctrl/⌘ 单击或使用鼠标中键时，始终在新标签页中打开。
                  </span>
                </div>
                <div className="set-control">
                  <div className="segmented">
                    {(
                      [
                        ["new", "新建标签"],
                        ["replace", "替换当前标签"],
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

              <h3 className="set-section">阅读排版</h3>
              <Slider
                label="正文字号"
                hint="调整正文与标题的基础字号。"
                value={settings.bodyFontSize}
                min={12}
                max={28}
                step={0.5}
                suffix="px"
                fallback={DEFAULT_SETTINGS.bodyFontSize}
                onChange={(v) => onChange({ bodyFontSize: v })}
              />
              <Slider
                label="正文行距"
                hint="统一调整正文行距；较高的行距更适合中文长文阅读。"
                value={settings.lineHeight}
                min={1.2}
                max={2.4}
                step={0.05}
                suffix=""
                fallback={DEFAULT_SETTINGS.lineHeight}
                onChange={(v) => onChange({ lineHeight: v })}
              />
              <Slider
                label="段落间距"
                hint="调整普通回车产生的段落留白；Shift+Enter 的段内换行不受影响。"
                value={settings.paragraphSpacing}
                min={0}
                max={1.2}
                step={0.05}
                suffix="em"
                fallback={DEFAULT_SETTINGS.paragraphSpacing}
                onChange={(v) => onChange({ paragraphSpacing: v })}
              />
              <Slider
                label="正文栏宽"
                hint="控制正文最大宽度，默认约为 34 个汉字。"
                value={settings.contentWidth}
                min={24}
                max={80}
                step={1}
                suffix="rem"
                fallback={DEFAULT_SETTINGS.contentWidth}
                onChange={(v) => onChange({ contentWidth: v })}
              />
              <p className="set-note">
                正文达到最大宽度后，扩大窗口只会增加两侧留白，以保持稳定的阅读行长。
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
                hint="留空时使用外观设置中的等宽字体。"
                value={settings.terminalFont}
                placeholder="跟随等宽字体"
                onChange={(v) => onChange({ terminalFont: v })}
              />
              <p className="set-note">
                较小的字号可在终端中显示更多上下文。
              </p>
            </>
          )}

          {tab === "update" && (
            <UpdateSettings
              update={update}
              auto={settings.autoUpdateCheck}
              onAutoChange={(v) => onChange({ autoUpdateCheck: v })}
            />
          )}

          {tab === "sync" && (
            <SyncSettings
              remote={remote}
              tokenSaved={tokenSaved}
              onRemoteChange={onRemoteChange}
              onTokenChange={onTokenChange}
            />
          )}

          {tab === "slash" && (
            <div className="set-snippets">
              <p className="set-note">
                输入 <code>/</code> 时显示这些命令。内置命令可以停用；自定义命令直接在
                表格中填写名称、说明和要插入的 Markdown。
              </p>

              <h3 className="set-table-section">内置命令</h3>
              <div className="set-config-table-wrap set-builtins-wrap">
                <table className="set-config-table set-slash-builtins">
                  <thead>
                    <tr>
                      <th>显示</th>
                      <th>命令</th>
                      <th>菜单提示</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BUILTIN_SLASH.map((b) => (
                      <tr key={b.label} className={hidden.has(b.label) ? "is-off" : undefined}>
                        <td data-label="显示">
                          <input
                            type="checkbox"
                            checked={!hidden.has(b.label)}
                            onChange={() => toggleSlash(b.label)}
                            aria-label={`显示${b.label}`}
                          />
                        </td>
                        <td data-label="命令">{b.label}</td>
                        <td data-label="菜单提示">
                          <code>{b.detail}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="set-table-section">自定义命令</h3>
              <p className="set-note set-table-note">
                插入内容支持多行 Markdown；<code>$0</code> 表示插入后光标停留的位置。
              </p>
              <SlashCustomTable rows={slashRows} onChange={setSlashRows} />

              {slashErrors.length > 0 && (
                <ul className="set-errors">
                  {slashErrors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}

              <div className="set-actions">
                <span className="set-hint">
                  {slashCheck.errors.length
                    ? `${slashCheck.items.length} 条有效，${slashCheck.errors.length} 条无效`
                    : `${slashCheck.items.length} 条自定义条目`}
                </span>
                <button
                  className="btn-primary"
                  disabled={!slashDirty}
                  onClick={() => onChange({ slashCustom: slashText })}
                >
                  {slashDirty ? "应用更改" : "已应用"}
                </button>
              </div>
            </div>
          )}

          {tab === "snippets" && (
            <div className="set-snippets">
              <p className="set-note">
                自定义规则会与内置的 135 条规则合并；触发词相同时优先使用自定义规则。
                展开内容中的 <code>$0</code>、<code>$1</code> 是按 Tab 跳转的光标位置。
              </p>
              <SnippetRulesTable rows={snippetRows} onChange={setSnippetRows} />

              {snippetErrors.length > 0 && (
                <ul className="set-errors">
                  {snippetErrors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}

              <details className="set-import">
                <summary>从 Obsidian Latex Suite 导入</summary>
                <p className="set-hint">
                  仅用于迁移已有配置：粘贴 Latex Suite 的 snippets JSON，确认后会转换成
                  上面的表格。日常新增和修改不需要接触 JSON。
                </p>
                <textarea
                  className="set-code set-import-code"
                  spellCheck={false}
                  value={snippetImportText}
                  placeholder={'[{ "trigger": "@a", "replacement": "\\\\alpha", "options": "mA" }]'}
                  onChange={(e) => setSnippetImportText(e.target.value)}
                />
                {snippetImportCheck.errors.length > 0 && (
                  <ul className="set-errors">
                    {snippetImportCheck.errors.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                )}
                <div className="set-import-actions">
                  <button
                    className="set-save"
                    disabled={
                      !snippetImportText.trim() || snippetImportCheck.errors.length > 0
                    }
                    onClick={() => setSnippetRows(snippetImportCheck.specs)}
                  >
                    导入到表格
                  </button>
                </div>
              </details>

              <div className="set-actions">
                <span className="set-hint">
                  {snippetCheck.errors.length
                    ? `${snippetCheck.specs.length} 条有效，${snippetCheck.errors.length} 条无效`
                    : `${snippetCheck.specs.length} 条自定义规则`}
                </span>
                <button
                  className="btn-primary"
                  // 有问题的条目会被跳过而不是拦下整批，所以这里不禁用 ——
                  // 只要还有能用的就允许应用，错误信息留在上面继续提示
                  disabled={!snippetDirty}
                  onClick={() => onChange({ customSnippets: snippetText })}
                >
                  {snippetDirty ? "应用更改" : "已应用"}
                </button>
              </div>
            </div>
          )}
            </div>

            <footer className="settings-foot">
              <button
                className="set-reset-all"
                onClick={async () => {
                  if (await confirm("确定将全部设置恢复为默认值吗？")) onReset();
                }}
              >
                恢复全部默认设置
              </button>
            </footer>
          </section>
        </div>
      </div>
    </div>
  );
}
