import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { confirm } from "../lib/dialog";
import type {
  GitHubAccount,
  GitIdentity,
  SharePreview,
  SharedSpaceAccess,
  SharedSpaceInfo,
} from "../types";
import { Icon } from "./Icon";

export type ShareNoteInput =
  | {
      mode: "space";
      note: string;
      spaceRoot: string;
      name: string;
      email: string;
    }
  | {
      mode: "github";
      note: string;
      collaborators: string[];
      name: string;
      email: string;
    }
  | {
      mode: "existing";
      note: string;
      url: string;
      path: string;
      token: string;
      name: string;
      email: string;
    };

interface Props {
  preview: SharePreview;
  spaces: SharedSpaceInfo[];
  identity: GitIdentity | null;
  githubAccount: GitHubAccount | null;
  githubChecking: boolean;
  onCheckGitHub: () => void;
  onCheckSpaceAccess: (spaceRoot: string) => Promise<SharedSpaceAccess>;
  onOpenConnectionSettings: () => void;
  busy: boolean;
  error: string | null;
  onPickFolder: () => Promise<string | null>;
  onShare: (input: ShareNoteInput) => void;
  onClose: () => void;
}

const display = (path: string) => path.replace(/\.md$/, "");
const isGitHubHttps = (url: string) => /^https:\/\/(?:www\.)?github\.com\//i.test(url);

function parseCollaborators(value: string) {
  return [...new Set(value.split(/[\s,，;；]+/).map((item) => item.replace(/^@/, "").trim()).filter(Boolean))];
}

export function ShareNoteDialog({
  preview,
  spaces,
  identity,
  githubAccount,
  githubChecking,
  onCheckGitHub,
  onCheckSpaceAccess,
  onOpenConnectionSettings,
  busy,
  error,
  onPickFolder,
  onShare,
  onClose,
}: Props) {
  const [mode, setMode] = useState<"github" | "existing">("github");
  // 有已有空间时不替用户选：按 Enter 就把私人内容交给最近那组人，代价太高。
  const [spaceRoot, setSpaceRoot] = useState(() => spaces.length === 0 ? "new" : "");
  const [spaceAccess, setSpaceAccess] = useState<SharedSpaceAccess | null>(null);
  const [spaceAccessLoading, setSpaceAccessLoading] = useState(false);
  const accessRequest = useRef(0);
  const [collaborators, setCollaborators] = useState("");
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [token, setToken] = useState("");
  const name = identity?.name ?? "";
  const email = identity?.email ?? "";
  const [localError, setLocalError] = useState<string | null>(null);
  const title = display(preview.note.split(/[\\/]/).pop() ?? preview.note);
  const includedExtras = useMemo(
    () => preview.files.filter((file) => !preview.documents.includes(file)),
    [preview.documents, preview.files],
  );
  const selectedSpace = spaces.find((space) => space.root === spaceRoot) ?? null;

  const checkSpaceAccess = (root: string) => {
    const request = ++accessRequest.current;
    setSpaceAccess(null);
    setSpaceAccessLoading(true);
    setLocalError(null);
    void onCheckSpaceAccess(root)
      .then((access) => {
        if (accessRequest.current === request) setSpaceAccess(access);
      })
      .catch((cause) => {
        if (accessRequest.current === request) {
          setSpaceAccess({
            members: spaces.find((space) => space.root === root)?.members ?? [],
            pending: [],
            github: true,
            verified: false,
            warning: (cause as Error).message,
          });
        }
      })
      .finally(() => {
        if (accessRequest.current === request) setSpaceAccessLoading(false);
      });
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  const confirmMove = async (audience: string) => await confirm(
    `「${title}」及其子内容会从私人区移出，${audience}。私人区不会保留继续分叉的副本。`,
    {
      title: "确认共享",
      okLabel: "移动并共享",
      cancelLabel: "返回检查",
      kind: "warning",
    },
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      setLocalError("请填写提交记录里显示的姓名和邮箱。");
      return;
    }
    if (!spaceRoot) {
      setLocalError("请先亲自选择一个共享空间，或新建空间。");
      return;
    }
    if (spaceRoot !== "new") {
      if (spaceAccessLoading) {
        setLocalError("正在核对这个空间的成员，请稍候。");
        return;
      }
      if (!spaceAccess) {
        setLocalError("请先核对这个空间的成员。");
        return;
      }
      if (spaceAccess.github && !spaceAccess.verified) {
        setLocalError(spaceAccess.warning ?? "GitHub 成员尚未核对，暂时不能安全共享。");
        return;
      }
      const known = [...spaceAccess.members, ...spaceAccess.pending];
      const audience = spaceAccess.verified
        ? known.length > 0
          ? `将共享给 ${known.map((member) => `@${member}`).join("、")}`
          : "这个空间目前只有你能访问"
        : "将共享给该远端仓库当前的全部成员（Verso 无法自动核对名单）";
      if (!(await confirmMove(audience))) return;
      setLocalError(null);
      onShare({
        mode: "space",
        note: preview.note,
        spaceRoot,
        name: name.trim(),
        email: email.trim(),
      });
      return;
    }
    if (mode === "github") {
      const members = parseCollaborators(collaborators);
      if (members.length === 0) {
        setLocalError("请至少填写一位成员的 GitHub 用户名。");
        return;
      }
      if (!githubChecking && !githubAccount) {
        setLocalError("请先在「设置 → 同步与共享」连接 GitHub。");
        return;
      }
      if (githubChecking) {
        setLocalError("正在检查 GitHub 连接，请稍候。");
        return;
      }
      if (!(await confirmMove(`将共享给 ${members.map((member) => `@${member}`).join("、")}`))) return;
      setLocalError(null);
      onShare({
        mode: "github",
        note: preview.note,
        collaborators: members,
        name: name.trim(),
        email: email.trim(),
      });
      return;
    }
    if (!url.trim() || !path.trim()) {
      setLocalError("请填写远端地址并选择一个空的本地文件夹。");
      return;
    }
    const usesConnectedGitHub = !!githubAccount && isGitHubHttps(url.trim());
    if ((url.startsWith("https://") || url.startsWith("http://")) && !token.trim() && !usesConnectedGitHub) {
      setLocalError(
        isGitHubHttps(url.trim())
          ? "请先在「设置 → 同步与共享」连接 GitHub，或填写访问令牌。"
          : "HTTPS 仓库需要访问令牌。",
      );
      return;
    }
    if (!(await confirmMove("将共享给该远端仓库当前的全部成员"))) return;
    setLocalError(null);
    onShare({
      mode: "existing",
      note: preview.note,
      url: url.trim(),
      path: path.trim(),
      token: token.trim(),
      name: name.trim(),
      email: email.trim(),
    });
  };

  const existingBlocked = !!selectedSpace
    && (spaceAccessLoading || !spaceAccess || (spaceAccess.github && !spaceAccess.verified));
  const primaryLabel = busy
    ? "正在处理…"
    : !spaceRoot
      ? "请先选择共享空间"
      : selectedSpace
        ? spaceAccessLoading
          ? "正在核对成员…"
          : "移动并共享"
        : mode === "github"
          ? "创建空间并移动"
          : "创建并移动";

  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section className="join-vault share-note" role="dialog" aria-modal="true" aria-labelledby="share-note-title">
        <header className="vault-manager-head">
          <div>
            <h2 id="share-note-title">共享「{title}」</h2>
            <p>优先加入已有空间；只有成员组合不同，才需要新建一个。</p>
          </div>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="share-manifest" aria-label="共享内容清单">
            <strong>会一起共享</strong>
            {preview.documents.map((document) => (
              <div key={document}><Icon name="doc" size={14} /> {document}</div>
            ))}
            {includedExtras.map((file) => (
              <div key={file}><Icon name="image" size={14} /> {file}</div>
            ))}
            {preview.attachments.map((attachment) => (
              <div key={attachment}><Icon name="image" size={14} /> {attachment}</div>
            ))}
            {preview.documents.length === 1 && includedExtras.length === 0 && preview.attachments.length === 0 && (
              <small>这篇文档没有子内容或本地附件。</small>
            )}
          </div>

          {preview.linkedNotes.length > 0 && (
            <div className="share-excluded">
              <strong>仍是私人内容</strong>
              <p>这些只是链接，不会交给共享成员：</p>
              <small>{preview.linkedNotes.map(display).join("、")}</small>
            </div>
          )}

          <div className="share-space-picker" aria-label="选择共享空间">
            <strong>添加到</strong>
            <div className="share-space-options">
              {spaces.map((space) => (
                <button
                  key={space.root}
                  type="button"
                  className={spaceRoot === space.root ? "is-active" : ""}
                  onClick={() => {
                    setSpaceRoot(space.root);
                    checkSpaceAccess(space.root);
                  }}
                  disabled={busy}
                  title={space.root}
                >
                  <Icon name="people" size={15} />
                  <span>
                    <b>{space.name}</b>
                    <small>
                      {space.members.length > 0
                        ? space.members.map((member) => `@${member}`).join("、")
                        : "成员由远端管理"}
                    </small>
                  </span>
                  {spaceRoot === space.root && <Icon name="check" size={14} />}
                </button>
              ))}
              <button
                type="button"
                className={spaceRoot === "new" ? "is-active" : ""}
                onClick={() => {
                  accessRequest.current += 1;
                  setSpaceRoot("new");
                  setSpaceAccess(null);
                  setSpaceAccessLoading(false);
                  setLocalError(null);
                  onCheckGitHub();
                }}
                disabled={busy}
              >
                <Icon name="plus" size={15} />
                <span>
                  <b>新建共享空间</b>
                  <small>需要另一组成员时再创建</small>
                </span>
                {spaceRoot === "new" && <Icon name="check" size={14} />}
              </button>
            </div>

            {selectedSpace && (
              <div className={`share-access${spaceAccess?.verified ? " is-verified" : ""}`} aria-live="polite">
                {spaceAccessLoading ? (
                  <span>正在从远端核对谁可以访问…</span>
                ) : spaceAccess?.verified ? (
                  <>
                    <div>
                      <Icon name="check" size={14} />
                      <span>
                        已加入：{spaceAccess.members.length > 0
                          ? spaceAccess.members.map((member) => `@${member}`).join("、")
                          : "暂无其他成员"}
                      </span>
                    </div>
                    {spaceAccess.pending.length > 0 && (
                      <div className="is-pending">
                        等待接受：{spaceAccess.pending.map((member) => `@${member}`).join("、")}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <span>{spaceAccess?.warning ?? "尚未核对这个空间的成员。"}</span>
                    <button type="button" className="btn-quiet" onClick={() => checkSpaceAccess(selectedSpace.root)}>
                      重新核对
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {spaceRoot === "new" && (
            <>
              <div className="share-mode" role="tablist" aria-label="新建方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "github"}
                  className={mode === "github" ? "is-active" : ""}
                  onClick={() => { setMode("github"); setLocalError(null); }}
                  disabled={busy}
                >
                  GitHub 快速创建
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "existing"}
                  className={mode === "existing" ? "is-active" : ""}
                  onClick={() => { setMode("existing"); setLocalError(null); }}
                  disabled={busy}
                >
                  使用已有仓库
                </button>
              </div>

              {mode === "github" ? (
                <>
                  <label className="join-field">
                    <span>共享成员</span>
                    <input
                      value={collaborators}
                      onChange={(event) => setCollaborators(event.target.value)}
                      placeholder="GitHub 用户名，多个可用逗号分隔"
                      spellCheck={false}
                      autoFocus
                      disabled={busy}
                    />
                    <small>Verso 会自动命名底层空间；同一组成员的后续内容可以继续放进来。</small>
                  </label>

                  {githubChecking ? (
                    <div className="share-account is-loading">正在检查 GitHub 连接…</div>
                  ) : githubAccount ? (
                    <div className="share-account">
                      <Icon name="check" size={14} /> 已连接 GitHub：<strong>@{githubAccount.login}</strong>
                    </div>
                  ) : (
                    <div className="share-account is-missing">
                      <span>尚未连接 GitHub。连接一次后，同步和共享都会复用。</span>
                      <button type="button" className="btn-quiet" onClick={onOpenConnectionSettings}>
                        前往设置
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="share-advanced">
                  <label className="join-field">
                    <span>空仓库地址</span>
                    <input
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://gitlab.com/team/shared-note.git"
                      spellCheck={false}
                      autoFocus
                      disabled={busy}
                    />
                    <small>适用于 GitLab、自托管服务或已经建好的空仓库。</small>
                  </label>

                  <label className="join-field">
                    <span>本地位置</span>
                    <span className="join-path-row">
                      <input value={path} readOnly placeholder="选择一个空文件夹" />
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={busy}
                        onClick={() => void onPickFolder().then((picked) => picked && setPath(picked))}
                      >
                        选择…
                      </button>
                    </span>
                    <small>共享空间不能放在当前私人空间里面，也不会覆盖已有文件。</small>
                  </label>

                  <label className="join-field">
                    <span>{githubAccount && isGitHubHttps(url) ? "访问令牌（可选）" : "访问令牌"}</span>
                    <input
                      type="password"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder={githubAccount && isGitHubHttps(url) ? "留空则使用已连接的 GitHub" : "需要仓库内容读写权限"}
                      autoComplete="off"
                      disabled={busy}
                    />
                    <small>
                      {githubAccount && isGitHubHttps(url)
                        ? `将使用已连接的 @${githubAccount.login}；只有想覆盖该连接时才填写。`
                        : "适用于 GitLab、自托管服务或未连接 GitHub 的仓库。"}
                    </small>
                  </label>
                </div>
              )}
            </>
          )}

          {name.trim() && email.trim() ? (
            <div className="share-account">
              <Icon name="check" size={14} /> 版本署名：<strong>{name}</strong>
              <span>&lt;{email}&gt;</span>
            </div>
          ) : (
            <div className="share-account is-missing">
              <span>还没有提交署名，无法区分是谁修改了内容。</span>
              <button type="button" className="btn-quiet" onClick={onOpenConnectionSettings}>
                前往设置
              </button>
            </div>
          )}

          <p className="share-move-note">
            完成后，这个节点会从「私人」移到所选「共享」空间；私人区不会保留一份继续分叉的副本。
          </p>
          {(localError || error) && <p className="join-error">{localError ?? error}</p>}

          <footer className="join-actions">
            <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>取消</button>
            <button type="submit" className="btn-primary" disabled={busy || !spaceRoot || existingBlocked}>
              {primaryLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
