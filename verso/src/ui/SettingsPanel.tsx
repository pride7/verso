import { useEffect, useMemo, useRef, useState } from "react";

import { parseCustomSnippets } from "../core/snippets/custom";
import { confirm } from "../host/dialog";
import { BUILTIN_SLASH, parseSlashCustom } from "../core/slash";
import {
  APP_VERSION,
  progressText,
  updateChecksSupported,
  updatesSupported,
  type UpdateApi,
} from "../host/update";
import { DEFAULT_SETTINGS, type Settings } from "../app/settings";
import type {
  GitHubAccount,
  GitHubDeviceAuthorization,
  GitHubDevicePoll,
  GitIdentity,
  RemoteInfo,
} from "../core/types";
import { RAIL_FIXED, RAIL_ITEMS } from "./ActivityBar";
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
  /** 提交署名。null = 还没打开 vault */
  identity: GitIdentity | null;
  onRemoteChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onIdentityChange: (name: string, email: string) => void;
  githubAccount: GitHubAccount | null;
  githubChecking: boolean;
  onGitHubCheck: () => void;
  onGitHubDeviceBegin: () => Promise<GitHubDeviceAuthorization>;
  onGitHubDevicePoll: (deviceCode: string) => Promise<GitHubDevicePoll>;
  onGitHubConnect: (token: string) => Promise<GitHubAccount>;
  onGitHubDisconnect: () => Promise<void>;
  /** §7.7：直接打开 vault 根目录里真实的 AGENTS.md，不维护第二份副本 */
  agentsDocAvailable: boolean;
  onOpenAgentsDoc: () => void;
  /** 明确确认后，用当前版本的模板覆盖两份 AI CLI 约定文件 */
  onRewriteAgentsDoc: () => Promise<void>;
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
  | "ai"
  | "snippets"
  | "slash"
  | "sync"
  | "update";

const TABS: { id: Tab; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "editor", label: "编辑" },
  { id: "keys", label: "快捷键" },
  { id: "terminal", label: "终端" },
  { id: "ai", label: "AI 协作" },
  { id: "snippets", label: "公式补全" },
  { id: "slash", label: "斜杠菜单" },
  { id: "sync", label: "同步与共享" },
  { id: "update", label: "软件更新" },
];

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  appearance: "主题、字体与界面显示",
  editor: "阅读、标签页、模板与版本记录",
  keys: "查看并修改命令快捷键",
  terminal: "内嵌终端的显示设置",
  ai: "仓库说明与本地 AI CLI 协作",
  snippets: "自定义 LaTeX 输入规则",
  slash: "管理内置命令与自定义条目",
  sync: "连接 GitHub，配置当前空间的同步与署名",
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
 * 界面上只有三样东西：**仓库地址**、**令牌**和**提交署名**。没有 branch、
 * 没有 remote 名字、没有 push/pull 的选项 —— 那些概念对着一个笔记软件的
 * 用户没有意义，而它们全都有一个唯一合理的取值。
 *
 * 三样都**不是设置项**：地址和署名存在仓库自己的 `.git/config` 里（跟着
 * vault 走，换台机器重新填一次是对的），令牌存在系统钥匙串里。所以这一页
 * 不走 `onChange`，而是各自有自己的回调。
 */
function SyncSettings({
  remote,
  tokenSaved,
  identity,
  githubAccount,
  githubChecking,
  onRemoteChange,
  onTokenChange,
  onIdentityChange,
  onGitHubCheck,
  onGitHubDeviceBegin,
  onGitHubDevicePoll,
  onGitHubConnect,
  onGitHubDisconnect,
}: {
  remote: RemoteInfo | null;
  tokenSaved: boolean;
  identity: GitIdentity | null;
  githubAccount: GitHubAccount | null;
  githubChecking: boolean;
  onRemoteChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onIdentityChange: (name: string, email: string) => void;
  onGitHubCheck: () => void;
  onGitHubDeviceBegin: () => Promise<GitHubDeviceAuthorization>;
  onGitHubDevicePoll: (deviceCode: string) => Promise<GitHubDevicePoll>;
  onGitHubConnect: (token: string) => Promise<GitHubAccount>;
  onGitHubDisconnect: () => Promise<void>;
}) {
  // 输入框都**按下「保存」才提交**，不是边打边存：地址打到一半就去连
  // 远端毫无意义，而令牌每敲一个字符写一次钥匙串更是荒唐
  const [url, setUrl] = useState(remote?.url ?? "");
  const [token, setToken] = useState("");
  const [githubToken, setGitHubToken] = useState("");
  const [githubBusy, setGitHubBusy] = useState(false);
  const [githubError, setGitHubError] = useState<string | null>(null);
  const [deviceAuthorization, setDeviceAuthorization] = useState<GitHubDeviceAuthorization | null>(null);
  const [deviceMessage, setDeviceMessage] = useState<string | null>(null);
  const devicePollRef = useRef<number | null>(null);
  const deviceRequestRef = useRef(false);
  const [name, setName] = useState(identity?.name ?? "");
  const [email, setEmail] = useState(identity?.email ?? "");
  useEffect(() => setUrl(remote?.url ?? ""), [remote?.url]);
  useEffect(() => onGitHubCheck(), [onGitHubCheck]);
  useEffect(() => {
    setName(identity?.name ?? "");
    setEmail(identity?.email ?? "");
  }, [identity?.name, identity?.email]);
  const identityDirty =
    name.trim() !== (identity?.name ?? "") || email.trim() !== (identity?.email ?? "");

  function stopDevicePolling() {
    if (devicePollRef.current !== null) {
      window.clearTimeout(devicePollRef.current);
      devicePollRef.current = null;
    }
  }

  useEffect(() => stopDevicePolling, []);

  const openExternalPage = (url: string) => {
    // `openUrl` 走系统默认浏览器；在 browser test / 纯网页预览里 import 失败也不影响
    // 链接打不开时不要把它伪装成 GitHub 授权或设置保存失败。
    void import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl(url))
      .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  };

  const openDevicePage = (authorization: GitHubDeviceAuthorization) =>
    openExternalPage(authorization.verificationUri);

  function scheduleDevicePolling(authorization: GitHubDeviceAuthorization, delaySeconds: number) {
    stopDevicePolling();
    devicePollRef.current = window.setTimeout(
      () => pollDeviceConnection(authorization),
      Math.max(1, delaySeconds) * 1000,
    );
  }

  function pollDeviceConnection(authorization: GitHubDeviceAuthorization) {
    if (deviceRequestRef.current) return;
    deviceRequestRef.current = true;
    setGitHubBusy(true);
    setGitHubError(null);
    void onGitHubDevicePoll(authorization.deviceCode)
      .then((result) => {
        if (result.account) {
          stopDevicePolling();
          setDeviceAuthorization(null);
          setDeviceMessage(null);
        } else {
          setDeviceMessage(
            result.retryAfter > 0
              ? `GitHub 要求稍候，${authorization.interval + result.retryAfter} 秒后会再检查。`
              : "正在等待 GitHub 确认；完成授权后会自动继续检查。",
          );
          // 只有本次请求结束后才安排下一次，避免固定 interval 与手动检查重叠，
          // 也能严格遵守 GitHub 在 slow_down 时额外给出的等待时间。
          scheduleDevicePolling(authorization, authorization.interval + result.retryAfter);
        }
      })
      .catch((error) => {
        // 过期、取消或网络错误都要离开验证码态；一直留着一张无法继续的卡片
        // 比报错更像是界面死掉了，也让用户不知道该重新开始。
        stopDevicePolling();
        setDeviceAuthorization(null);
        setDeviceMessage(null);
        setGitHubError((error as Error).message);
      })
      .finally(() => {
        deviceRequestRef.current = false;
        setGitHubBusy(false);
      });
  }

  const beginDeviceConnection = () => {
    stopDevicePolling();
    setGitHubBusy(true);
    setGitHubError(null);
    setDeviceMessage(null);
    void onGitHubDeviceBegin()
      .then((authorization) => {
        setDeviceAuthorization(authorization);
        openDevicePage(authorization);
        // 自动检查之外也提供明确的手动入口：用户在网页确认后，不需要猜是继续
        // 等待还是点哪里。轮询是串行的，绝不会并发叠加。
        scheduleDevicePolling(authorization, authorization.interval);
        setGitHubBusy(false);
      })
      .catch((error) => {
        setGitHubError((error as Error).message);
        setGitHubBusy(false);
      });
  };

  return (
    <div className="set-sync">
      <p className="set-note">
        GitHub 账号在这台设备上连接一次即可；每个空间仍分别设置仓库地址，访问范围由 GitHub App
        安装时选择的仓库决定。
      </p>

      <h3 className="set-section">GitHub 连接</h3>
      {githubChecking ? (
        <div className="set-account-card">正在检查 GitHub 连接…</div>
      ) : githubAccount ? (
        <div className="set-account-card">
          <div className="set-account-summary">
            <span><Icon name="check" size={14} /> 已连接 <strong>@{githubAccount.login}</strong></span>
            <small>账号连接不会自动开放所有仓库；请在 GitHub 中选择 Verso 可访问的仓库。</small>
          </div>
          <div className="set-account-actions">
            <button className="btn-quiet" onClick={() => openExternalPage("https://github.com/settings/installations")}>
              管理仓库授权
            </button>
            <button
              className="set-save"
              disabled={githubBusy}
              onClick={() => {
                setGitHubBusy(true);
                setGitHubError(null);
                void onGitHubDisconnect()
                  .catch((error) => setGitHubError((error as Error).message))
                  .finally(() => setGitHubBusy(false));
              }}
            >
              断开
            </button>
          </div>
        </div>
      ) : (
        <div className="set-row set-sync-stack-row">
          <div className="set-label">
            <span>连接 GitHub</span>
            <span className="set-hint">
              通过 Verso GitHub App 授权一次，之后同步、创建共享空间和邀请成员都会复用；
              凭据只保存在这台设备。
            </span>
          </div>
          <div className="set-control">
            {deviceAuthorization ? (
              <div className="set-device-code" aria-live="polite">
                <span>在浏览器中确认 GitHub 授权</span>
                <strong aria-label="GitHub 验证码">{deviceAuthorization.userCode}</strong>
                <div className="set-device-actions">
                  <button className="set-save" onClick={() => openDevicePage(deviceAuthorization)}>
                    打开 GitHub
                  </button>
                  <button
                    className="btn-quiet"
                    onClick={() => {
                      stopDevicePolling();
                      setDeviceAuthorization(null);
                      setDeviceMessage(null);
                    }}
                  >
                    取消
                  </button>
                </div>
                {deviceMessage && <small>{deviceMessage}</small>}
              </div>
            ) : (
              <div className="set-github-connect-actions">
                <button className="set-save set-github-connect" disabled={githubBusy} onClick={beginDeviceConnection}>
                  {githubBusy ? "正在准备…" : "在 GitHub 中连接"}
                </button>
                <details className="set-sync-token-fallback">
                  <summary>使用个人访问令牌</summary>
                  <div className="set-token-fallback-control">
                    <input
                      type="password"
                      className="set-text"
                      aria-label="GitHub 连接令牌"
                      value={githubToken}
                      placeholder="github_pat_…"
                      autoComplete="off"
                      onChange={(event) => setGitHubToken(event.target.value)}
                    />
                    <button
                      className="set-save"
                      disabled={!githubToken.trim() || githubBusy}
                      onClick={() => {
                        setGitHubBusy(true);
                        setGitHubError(null);
                        void onGitHubConnect(githubToken.trim())
                          .then(() => setGitHubToken(""))
                          .catch((error) => setGitHubError((error as Error).message))
                          .finally(() => setGitHubBusy(false));
                      }}
                    >
                      连接
                    </button>
                  </div>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
      {githubError && <p className="set-note set-sync-error">{githubError}</p>}

      <h3 className="set-section">当前空间同步</h3>

      {!remote && <p className="set-note">请先打开一个笔记库。</p>}

      {remote && <>

      <div className="set-row set-sync-stack-row">
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
        <details className="set-sync-advanced">
          <summary>使用当前仓库的其他凭据</summary>
        <div className="set-row">
          <div className="set-label">
            <span>访问令牌</span>
            <span className="set-hint">
              {/* 说清楚它存哪儿 —— 一个仓库令牌等于那个仓库的写权限，
                  人有权知道自己把它交到了哪里 */}
              适用于 GitLab、自托管服务或需要覆盖 GitHub 账号连接的仓库。凭据仅存储于系统密钥链
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
        </details>
      )}

      <h3 className="set-section">版本署名</h3>
      <div className="set-row set-sync-stack-row set-identity-row">
        <div className="set-label">
          <span>提交署名</span>
          <span className="set-hint">
            {/* 说清楚写到哪儿：只写这个笔记库，不动整台机器的 git 配置 */}
            记录版本时使用的用户名和邮箱。仅对当前笔记库生效，不会更改全局 Git
            配置。留空时沿用全局署名；若未设置，则使用「Verso」。
          </span>
        </div>
        <div className="set-control">
          <label className="set-identity-field">
            <span className="set-field-label">用户名</span>
            <input
              type="text"
              className="set-text"
              aria-label="署名"
              value={name}
              placeholder="例如：pride7"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="set-identity-field">
            <span className="set-field-label">邮箱</span>
            <input
              type="email"
              className="set-text"
              aria-label="署名邮箱"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button
            className="set-save"
            disabled={!identityDirty}
            onClick={() => onIdentityChange(name.trim(), email.trim())}
          >
            保存
          </button>
        </div>
      </div>

      {remote.url && (
        <p className="set-note set-note-dim">
          当前同步分支：<code>{remote.branch}</code>。不重叠的正文和不同属性会自动合并；同一段、
          同一属性或删除与修改相撞时会暂停，请你确认后再写回。
        </p>
      )}
      </>}
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
  /** 能不能就地装。移动端不能 —— 但**查得了**，那是两件事 */
  const supported = updatesSupported();
  const canCheck = updateChecksSupported();
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
          <button className="set-save" disabled={busy || !canCheck} onClick={update.check}>
            {state.phase === "checking" ? "检查中…" : "检查更新"}
          </button>
        </div>
      </div>

      {/* 「装不了」要说清楚是**装**不了，不是查不了 —— 上一版把这句话写成
          「当前平台不支持应用内更新」再把按钮一并置灰，用户连有没有新版本
          都问不出来（§2.11） */}
      {!supported && canCheck && (
        <p className="set-note">
          这个平台不能在应用内安装更新。可以检查有没有新版本，下载后由系统安装器完成安装。
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

      {/* 查到了但装不了：直链拿到了就直接下那个安装包，拿不到才退回发布页。
          按钮文案要如实说明会发生什么 —— 「下载」跳进浏览器开始下载，
          「打开下载页」跳到一个还要自己挑文件的页面，两者对用户不是一回事 */}
      {state.phase === "manual" && (
        <div className="set-update-found">
          <p className="set-note">
            有新版本 <strong>{state.version}</strong>
            {state.date && ` · ${state.date.slice(0, 10)}`}
            {state.downloadUrl && "。下载在浏览器中进行，完成后由系统安装器安装。"}
          </p>
          {state.notes && <pre className="set-update-notes">{state.notes}</pre>}
          <div className="set-actions">
            <button className="set-save" onClick={update.dismiss}>
              稍后
            </button>
            <button className="btn-primary" onClick={update.openReleases}>
              {state.downloadUrl ? `下载 ${state.version}` : "打开下载页"}
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
  identity,
  githubAccount,
  githubChecking,
  onRemoteChange,
  onTokenChange,
  onIdentityChange,
  onGitHubCheck,
  onGitHubDeviceBegin,
  onGitHubDevicePoll,
  onGitHubConnect,
  onGitHubDisconnect,
  agentsDocAvailable,
  onOpenAgentsDoc,
  onRewriteAgentsDoc,
  update,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "appearance");
  const [agentsBusy, setAgentsBusy] = useState(false);
  const [agentsMessage, setAgentsMessage] = useState<string | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
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
  // 同样只记录已隐藏的项目，具体约定见 settings.ts 中 railHidden 的注释
  const railHidden = new Set(settings.railHidden);
  const toggleRail = (id: string) =>
    onChange({
      railHidden: railHidden.has(id)
        ? settings.railHidden.filter((x) => x !== id)
        : [...settings.railHidden, id],
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

              <h3 className="set-section">侧栏图标</h3>
              <p className="set-note">
                可选择左侧图标栏（窄屏设备上显示为底部导航）的入口。隐藏图标不影响对应功能，
                仍可通过命令面板和快捷键访问；「设置」入口始终显示。
              </p>
              {(
                [
                  ["view", "侧栏视图"],
                  ["action", "操作"],
                ] as const
              ).map(([group, caption]) => (
                <div className="rail-picker" key={group}>
                  <span className="rail-picker-caption">{caption}</span>
                  <div className="rail-picker-items" role="group" aria-label={caption}>
                    {RAIL_ITEMS.filter((item) => item.group === group).map((item) => {
                      const fixed = item.id === RAIL_FIXED;
                      const on = fixed || !railHidden.has(item.id);
                      return (
                        <button
                          key={item.id}
                          className={`rail-pick${on ? " is-on" : ""}`}
                          disabled={fixed}
                          aria-pressed={on}
                          title={fixed ? "「设置」入口不可隐藏" : undefined}
                          onClick={() => toggleRail(item.id)}
                        >
                          <Icon name={item.icon} size={15} />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "editor" && (
            <>
              <h3 className="set-section">版本记录</h3>
              {/* 总开关摆在最前面：让 AI 在仓库里改东西的人要的是「先别记」，
                  而分别关掉下面三条等于把一个是非题拆成三个（§2.8） */}
              <div className="set-row">
                <div className="set-label">
                  <span>自动记录版本</span>
                  <span className="set-hint">
                    关掉之后下面三条都不生效，什么时候记版本完全由你决定：状态栏那个点，
                    或命令面板里的「记一个版本」。
                  </span>
                </div>
                <div className="set-control">
                  <div className="segmented">
                    {([true, false] as const).map((v) => (
                      <button
                        key={String(v)}
                        className={settings.autoCommit === v ? "is-on" : undefined}
                        onClick={() => onChange({ autoCommit: v })}
                      >
                        {v ? "启用" : "停用"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className={`set-row${settings.autoCommit ? "" : " is-off"}`}>
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
              <div className={`set-row${settings.autoCommit ? "" : " is-off"}`}>
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
                hint={
                  settings.autoCommit
                    ? "停止编辑达到指定时长后记录版本；设为 0 可停用。"
                    : "自动记录已停用，这一条当前不生效。"
                }
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
                  <span>打开文档时</span>
                  <span className="set-hint">
                    “复用标签”不会替换固定标签；按住 Ctrl/⌘ 单击或使用鼠标中键时，始终新建标签。
                  </span>
                </div>
                <div className="set-control">
                  <div className="segmented">
                    {(
                      [
                        ["new", "新建标签"],
                        ["replace", "复用标签"],
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
              {/* §7.6：不绑定任何 AI 工具，所以引用前缀是可改的而不是写死的 */}
              <TextRow
                label="引用前缀"
                hint="把笔记发给终端时加在路径前面。Claude Code、Codex 用 @；用别的工具可以清空，得到的就是裸路径。"
                value={settings.terminalMention}
                placeholder="不加前缀"
                onChange={(v) => onChange({ terminalMention: v })}
              />
              <p className="set-note">
                较小的字号可在终端中显示更多上下文。
              </p>
            </>
          )}

          {tab === "ai" && (
            <div className="set-ai">
              <p className="set-note">
                Verso 会在仓库根目录保留两份标准 Markdown 说明，供你在终端里使用的
                AI CLI 自动读取。它们会参与版本记录和同步，但不会混进普通文档树、
                搜索结果或 database。
              </p>

              <div className="set-row">
                <div className="set-label">
                  <span><code>AGENTS.md</code></span>
                  <span className="set-hint">
                    唯一的规则正文。打开的是仓库里的真实文件，可以加入项目自己的约定。
                  </span>
                </div>
                <div className="set-control">
                  <button
                    className="set-save"
                    disabled={!agentsDocAvailable}
                    onClick={onOpenAgentsDoc}
                  >
                    打开并编辑
                  </button>
                </div>
              </div>

              <div className="set-row">
                <div className="set-label">
                  <span><code>CLAUDE.md</code></span>
                  <span className="set-hint">
                    Claude Code 的兼容入口，只负责指向 AGENTS.md，避免维护两份重复规则。
                  </span>
                </div>
                <div className="set-control">
                  <span className="set-hint">由 Verso 维护</span>
                </div>
              </div>

              <h3 className="set-section">维护</h3>
              <div className="set-row">
                <div className="set-label">
                  <span>恢复默认说明</span>
                  <span className="set-hint">
                    用当前 Verso 版本的模板覆盖两个文件；自己添加的规则也会被替换，
                    之后仍可从版本历史恢复。
                  </span>
                </div>
                <div className="set-control">
                  <button
                    className="set-save"
                    disabled={!agentsDocAvailable || agentsBusy}
                    onClick={async () => {
                      const ok = await confirm(
                        "这会用当前版本的默认内容覆盖 AGENTS.md 和 CLAUDE.md。你自己添加的规则也会被替换，但可以从版本历史恢复。确定继续吗？",
                        {
                          title: "恢复 AI 仓库说明",
                          okLabel: "覆盖并恢复",
                          cancelLabel: "取消",
                          kind: "warning",
                        },
                      );
                      if (!ok) return;
                      setAgentsBusy(true);
                      setAgentsMessage(null);
                      setAgentsError(null);
                      try {
                        await onRewriteAgentsDoc();
                        setAgentsMessage("已恢复当前版本的默认说明");
                      } catch (e) {
                        setAgentsError((e as Error).message);
                      } finally {
                        setAgentsBusy(false);
                      }
                    }}
                  >
                    {agentsBusy ? "正在恢复…" : "恢复默认说明"}
                  </button>
                </div>
              </div>

              {!agentsDocAvailable && <p className="set-note">打开一个仓库后才能管理这些文件。</p>}
              {agentsMessage && <p className="set-note set-ai-success">{agentsMessage}</p>}
              {agentsError && <p className="set-note set-ai-error">{agentsError}</p>}
            </div>
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
              identity={identity}
              githubAccount={githubAccount}
              githubChecking={githubChecking}
              onRemoteChange={onRemoteChange}
              onTokenChange={onTokenChange}
              onIdentityChange={onIdentityChange}
              onGitHubCheck={onGitHubCheck}
              onGitHubDeviceBegin={onGitHubDeviceBegin}
              onGitHubDevicePoll={onGitHubDevicePoll}
              onGitHubConnect={onGitHubConnect}
              onGitHubDisconnect={onGitHubDisconnect}
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
