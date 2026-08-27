import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { readText } from "../host/clipboard";
import { folderNameFromUrl, parseInvite } from "../core/invite";
import { useGitHubDeviceConnect } from "./githubDevice";
import { Icon } from "./Icon";
import type {
  GitHubAccount,
  GitHubDeviceAuthorization,
  GitHubDevicePoll,
  GitIdentity,
} from "../core/types";

export interface JoinVaultInput {
  url: string;
  path: string;
  token: string;
  name: string;
  email: string;
}

interface Props {
  busy: boolean;
  error: string | null;
  githubAccount: GitHubAccount | null;
  identity: GitIdentity | null;
  onPickFolder: () => Promise<string | null>;
  /** 默认落点：当前空间同级的 `Verso Shared/<仓库名>`。算不出来时返回 null。 */
  onDefaultPath: (folder: string) => Promise<string | null>;
  onGitHubDeviceBegin: () => Promise<GitHubDeviceAuthorization>;
  onGitHubDevicePoll: (deviceCode: string) => Promise<GitHubDevicePoll>;
  onJoin: (input: JoinVaultInput) => void;
  onClose: () => void;
}

const isGitHubHttps = (url: string) => /^https:\/\/(?:www\.)?github\.com\//i.test(url);
const isHttp = (url: string) => /^https?:\/\//i.test(url);

/**
 * 加入共享空间。DESIGN.md §2.8
 *
 * **只问一件事：把邀请粘进来。** 受邀者是这条链上信息最少的人 —— 他没建过这个
 * 仓库，不知道它在 GitHub 上叫什么，也不该为了读一篇笔记先学会「克隆地址」和
 * 「空文件夹」。所以地址、空间名、本地位置、提交身份全部推导出来摆在他眼前
 * 让他核对，而不是变成四个必填框。默认值可以省掉输入，但不能省掉知情：署名会
 * 写进所有人都看得见的提交历史，因此它必须显示在确认卡片上。
 */
export function JoinVaultDialog({
  busy,
  error,
  githubAccount,
  identity,
  onPickFolder,
  onDefaultPath,
  onGitHubDeviceBegin,
  onGitHubDevicePoll,
  onJoin,
  onClose,
}: Props) {
  const [pasted, setPasted] = useState("");
  const [path, setPath] = useState("");
  /** 用户自己挑过位置之后就不再跟着地址变 —— 那是他的决定，不是待刷新的推导值 */
  const [pathPicked, setPathPicked] = useState(false);
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [identityEdited, setIdentityEdited] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const pathRequest = useRef(0);

  const invite = useMemo(() => (pasted.trim() ? parseInvite(pasted) : null), [pasted]);
  const url = invite?.url ?? "";
  const folder = url ? folderNameFromUrl(url) : "";
  const spaceName = invite?.name?.trim() || folder;

  // 已经配过就用已配的；没配过而连着 GitHub，就用那个账号 —— 受邀者多半是
  // 第一次在这台设备上写共享内容，不该在这里被一个空白必填框拦住。
  const suggestedName = identity?.name ?? githubAccount?.login ?? "";
  const suggestedEmail =
    identity?.email ?? (githubAccount ? `${githubAccount.login}@users.noreply.github.com` : "");
  const finalName = identityEdited ? name : suggestedName;
  const finalEmail = identityEdited ? email : suggestedEmail;

  const device = useGitHubDeviceConnect({
    begin: onGitHubDeviceBegin,
    poll: onGitHubDevicePoll,
    onBusy: setConnectBusy,
    onError: setConnectError,
  });

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  // 认出地址就立刻把落点算好。放在这里而不是提交时算：位置要能在确认卡片上
  // 看见并改掉，事后才告诉人「放哪了」等于没得选。
  useEffect(() => {
    if (!folder || pathPicked) return;
    const request = ++pathRequest.current;
    setPathNotice(null);
    void onDefaultPath(folder)
      .then((picked) => {
        if (pathRequest.current !== request) return;
        setPath(picked ?? "");
        if (!picked) setPathNotice("没能自动选好位置，请在「高级」里指定一个空文件夹。");
      })
      .catch((reason) => {
        if (pathRequest.current !== request) return;
        setPath("");
        setPathNotice((reason as Error).message);
      });
  }, [folder, pathPicked, onDefaultPath]);

  const pasteFromClipboard = async () => {
    const text = await readText();
    // 读剪贴板没有兜底（见 host/clipboard），失败时得说清楚还有哪条路
    if (text === null) {
      setLocalError("读不到剪贴板，请直接在输入框里按 Ctrl/⌘+V 粘贴。");
      return;
    }
    setLocalError(null);
    setPasted(text.trim());
  };

  const pickFolder = () => {
    void onPickFolder().then((picked) => {
      if (!picked) return;
      pathRequest.current += 1;
      setPath(picked);
      setPathPicked(true);
      setPathNotice(null);
    });
  };

  const needsCredential = isHttp(url) && !token.trim() && !(githubAccount && isGitHubHttps(url));

  const editIdentity = () => {
    if (!identityEdited) {
      setName(suggestedName);
      setEmail(suggestedEmail);
      setIdentityEdited(true);
    }
    setAdvanced(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!invite) {
      setLocalError("请先粘贴邀请或仓库地址。");
      return;
    }
    if (!path.trim()) {
      setLocalError("还没有可用的本地位置，请在「高级」里选一个空文件夹。");
      setAdvanced(true);
      return;
    }
    if (!finalName.trim() || !finalEmail.trim()) {
      setLocalError("请填写提交记录里显示的姓名和邮箱。");
      editIdentity();
      return;
    }
    if (needsCredential) {
      setLocalError(
        isGitHubHttps(url)
          ? "请先连接 GitHub，或在「高级」里填写访问令牌。"
          : "HTTPS 仓库需要你自己的访问令牌，请在「高级」里填写。",
      );
      return;
    }
    setLocalError(null);
    onJoin({
      url,
      path: path.trim(),
      token: token.trim(),
      name: finalName.trim(),
      email: finalEmail.trim(),
    });
  };

  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section className="join-vault" role="dialog" aria-modal="true" aria-labelledby="join-vault-title">
        <header className="vault-manager-head">
          <div>
            <h2 id="join-vault-title">加入共享空间</h2>
            <p>把收到的邀请粘贴进来，其余的 Verso 会填好；每个人保留自己的本地副本。</p>
          </div>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </header>

        <form onSubmit={submit}>
          <label className="join-field">
            <span>邀请</span>
            <textarea
              className="join-invite-input"
              value={pasted}
              onChange={(event) => {
                setPasted(event.target.value);
                setLocalError(null);
              }}
              placeholder="把对方发来的邀请整段粘贴到这里"
              spellCheck={false}
              rows={3}
              autoFocus
              disabled={busy}
            />
            <span className="join-invite-actions">
              <small>整段邀请、一个仓库地址，或 owner/repo 这样的简写都可以。</small>
              <button
                type="button"
                className="btn-quiet"
                onClick={() => void pasteFromClipboard()}
                disabled={busy}
              >
                从剪贴板粘贴
              </button>
            </span>
          </label>

          {pasted.trim() && !invite && (
            <p className="join-unparsed">
              没在这段文字里找到仓库地址。确认邀请是完整复制的，或者直接粘一个 https:// 地址。
            </p>
          )}

          {invite && (
            <div className="join-summary" aria-label="将要加入的共享空间">
              <div className="join-summary-title">
                <Icon name="people" size={15} />
                <strong>{spaceName}</strong>
              </div>
              <div className="join-summary-row">
                <span>来自</span>
                <code title={url}>{url}</code>
              </div>
              <div className="join-summary-row">
                <span>存到</span>
                <code title={path || undefined}>{path || "正在选位置…"}</code>
                <button type="button" className="btn-quiet" onClick={pickFolder} disabled={busy}>
                  改…
                </button>
              </div>
              <div className="join-summary-row">
                <span>署名</span>
                {finalName.trim() && finalEmail.trim() ? (
                  <code>{`${finalName} <${finalEmail}>`}</code>
                ) : (
                  <code className="is-missing">还没有提交署名</code>
                )}
                <button type="button" className="btn-quiet" onClick={editIdentity} disabled={busy}>
                  修改
                </button>
              </div>
              {pathNotice && <p className="join-summary-notice">{pathNotice}</p>}
              <small>这个名字和邮箱会写进提交历史，空间里的每个人都看得到。</small>
            </div>
          )}

          {invite && needsCredential && isGitHubHttps(url) && (
            <div className="share-account is-missing join-connect">
              {device.authorization ? (
                <div className="set-device-code" aria-live="polite">
                  <span>在浏览器中确认 GitHub 授权</span>
                  <strong aria-label="GitHub 验证码">{device.authorization.userCode}</strong>
                  <div className="set-device-actions">
                    <button type="button" className="set-save" onClick={device.openPage}>
                      打开 GitHub
                    </button>
                    <button type="button" className="btn-quiet" onClick={device.cancel}>
                      取消
                    </button>
                  </div>
                  {device.message && <small>{device.message}</small>}
                </div>
              ) : (
                <>
                  <span>这个空间在 GitHub 上，还需要连接一次账号才能下载。</span>
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={device.start}
                    disabled={busy || connectBusy}
                  >
                    {connectBusy ? "正在准备…" : "在 GitHub 中连接"}
                  </button>
                </>
              )}
            </div>
          )}
          {connectError && <p className="join-error">{connectError}</p>}

          {invite && githubAccount && isGitHubHttps(url) && !token.trim() && (
            <div className="share-account">
              <Icon name="check" size={14} /> 将以已连接的 <strong>@{githubAccount.login}</strong> 下载
            </div>
          )}

          <details
            className="join-advanced"
            open={advanced}
            onToggle={(event) => setAdvanced((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>高级：本地位置、访问令牌与署名</summary>

            <label className="join-field">
              <span>本地位置</span>
              <span className="join-path-row">
                <input value={path} readOnly placeholder="留空则由 Verso 自动选" />
                <button type="button" className="btn-quiet" disabled={busy} onClick={pickFolder}>
                  选择…
                </button>
              </span>
              <small>已有文件绝不会被覆盖；目录不是空的会直接取消。</small>
            </label>

            <label className="join-field">
              <span>访问令牌</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={
                  githubAccount && isGitHubHttps(url)
                    ? "留空则使用已连接的 GitHub"
                    : "需要仓库 Contents 读写权限"
                }
                autoComplete="off"
                disabled={busy}
              />
              <small>
                {githubAccount && isGitHubHttps(url)
                  ? `将使用已连接的 @${githubAccount.login}；只有想覆盖该连接时才填写。`
                  : "GitLab、自托管服务或想逐仓库覆盖时才需要，只保存在这台设备的安全凭据中。"}
              </small>
            </label>

            <div className="join-identity">
              <label className="join-field">
                <span>你的姓名</span>
                <input
                  value={finalName}
                  onChange={(event) => {
                    if (!identityEdited) setEmail(suggestedEmail);
                    setIdentityEdited(true);
                    setName(event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <label className="join-field">
                <span>你的邮箱</span>
                <input
                  type="email"
                  value={finalEmail}
                  onChange={(event) => {
                    if (!identityEdited) setName(suggestedName);
                    setIdentityEdited(true);
                    setEmail(event.target.value);
                  }}
                  disabled={busy}
                />
              </label>
            </div>
          </details>

          {(localError || error) && <p className="join-error">{localError ?? error}</p>}

          <footer className="join-actions">
            <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !invite}>
              {busy ? "正在加入…" : "加入并打开"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
