import { useEffect, useMemo, useState } from "react";

import type {
  GitHubAccount,
  RecentVault,
  SharedSpaceAccess,
  SharedSpaceInfo,
} from "../types";
import { Icon } from "./Icon";

interface Props {
  space: SharedSpaceInfo;
  privateVaults: RecentVault[];
  account: GitHubAccount | null;
  busy: boolean;
  onLoadAccess: (root: string) => Promise<SharedSpaceAccess>;
  onInvite: (root: string, username: string) => Promise<SharedSpaceAccess>;
  onRemove: (root: string, username: string) => Promise<SharedSpaceAccess>;
  onUnshare: (spaceRoot: string, note: string, privateRoot: string) => Promise<void>;
  onClose: () => void;
}

function titleOf(path: string) {
  const parts = path.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? path;
  return name.replace(/\.md$/i, "");
}

export function SharedSpaceDialog({
  space,
  privateVaults,
  account,
  busy,
  onLoadAccess,
  onInvite,
  onRemove,
  onUnshare,
  onClose,
}: Props) {
  const [access, setAccess] = useState<SharedSpaceAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [privateRoot, setPrivateRoot] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const entries = space.entries ?? [];
  const usablePrivate = useMemo(
    () => privateVaults.filter((vault) => vault.available && !vault.shared),
    [privateVaults],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    void onLoadAccess(space.root)
      .then((next) => live && setAccess(next))
      .catch((reason) => live && setError((reason as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [space.root, onLoadAccess]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !memberBusy) {
        if (moving) {
          setMoving(null);
          setConfirmed(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, memberBusy, moving, onClose]);

  const invite = async () => {
    const value = username.trim();
    if (!value || memberBusy) return;
    setMemberBusy("invite");
    setError(null);
    try {
      setAccess(await onInvite(space.root, value));
      setUsername("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberBusy(null);
    }
  };

  const remove = async (member: string) => {
    if (memberBusy) return;
    setMemberBusy(member);
    setError(null);
    try {
      setAccess(await onRemove(space.root, member));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMemberBusy(null);
    }
  };

  const unshare = async () => {
    if (!moving || !privateRoot || !confirmed || busy) return;
    setError(null);
    try {
      await onUnshare(space.root, moving, privateRoot);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && !memberBusy && onClose()}
    >
      <section
        className="shared-space-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-space-title"
      >
        <header className="vault-manager-head">
          <div>
            <h2 id="shared-space-title">{space.name}</h2>
            <p>管理这里的内容和访问成员。</p>
          </div>
          <button className="modal-close" onClick={onClose} disabled={busy || !!memberBusy} aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="shared-space-body">
          {error && <p className="vault-manager-error">{error}</p>}

          <section className="shared-space-section">
            <h3>共享内容</h3>
            {entries.length === 0 ? (
              <p className="shared-space-empty">这个旧空间没有可用的内容清单；文档本身不受影响。</p>
            ) : (
              <div className="shared-entry-list">
                {entries.map((entry) => (
                  <div className="shared-entry-row" key={entry}>
                    <span>
                      <Icon name="doc" size={15} />
                      <span><strong>{titleOf(entry)}</strong><small>{entry}</small></span>
                    </span>
                    <button
                      className="btn-quiet"
                      onClick={() => {
                        setMoving(entry);
                        setPrivateRoot(usablePrivate[0]?.root ?? "");
                        setConfirmed(false);
                        setError(null);
                      }}
                      disabled={busy || usablePrivate.length === 0}
                    >
                      移回私人…
                    </button>
                  </div>
                ))}
              </div>
            )}
            {usablePrivate.length === 0 && (
              <p className="shared-space-hint">需要先打开过一个可用的私人空间，才能迁回内容。</p>
            )}
          </section>

          <section className="shared-space-section">
            <h3>成员</h3>
            {loading ? (
              <p className="shared-space-empty">正在核对远端权限…</p>
            ) : access ? (
              <>
                {access.warning && <p className="shared-space-warning">{access.warning}</p>}
                {!access.github && space.remote && (
                  <p className="shared-space-remote" title={space.remote}>{space.remote}</p>
                )}
                <div className="shared-member-list">
                  {access.members.map((member) => (
                    <div className="shared-member" key={`member-${member}`}>
                      <span><Icon name="people" size={14} /> @{member}</span>
                      <span className="shared-member-state">已加入</span>
                      {access.github && access.verified && account?.login.toLowerCase() !== member.toLowerCase() && (
                        <button
                          aria-label={`移除 @${member}`}
                          onClick={() => void remove(member)}
                          disabled={!!memberBusy || busy}
                        >
                          {memberBusy === member ? "移除中…" : "移除"}
                        </button>
                      )}
                    </div>
                  ))}
                  {access.pending.map((member) => (
                    <div className="shared-member" key={`pending-${member}`}>
                      <span><Icon name="people" size={14} /> @{member}</span>
                      <span className="shared-member-state is-pending">等待接受</span>
                      {access.github && access.verified && (
                        <button
                          aria-label={`撤销 @${member} 的邀请`}
                          onClick={() => void remove(member)}
                          disabled={!!memberBusy || busy}
                        >
                          {memberBusy === member ? "撤销中…" : "撤销"}
                        </button>
                      )}
                    </div>
                  ))}
                  {access.members.length === 0 && access.pending.length === 0 && (
                    <p className="shared-space-empty">远端没有返回其他成员。</p>
                  )}
                </div>
                {access.github && access.verified && (
                  <div className="shared-member-add">
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && void invite()}
                      placeholder="GitHub 用户名"
                      aria-label="邀请 GitHub 成员"
                      disabled={!!memberBusy || busy}
                    />
                    <button className="btn-quiet" onClick={() => void invite()} disabled={!username.trim() || !!memberBusy || busy}>
                      {memberBusy === "invite" ? "邀请中…" : "邀请"}
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </section>
        </div>

        {moving && (
          <div className="shared-unshare-confirm">
            <h3>把「{titleOf(moving)}」移回私人？</h3>
            <label>
              私人空间
              <select value={privateRoot} onChange={(event) => setPrivateRoot(event.target.value)}>
                {usablePrivate.map((item) => <option key={item.root} value={item.root}>{item.name}</option>)}
              </select>
            </label>
            <p>
              正文和子文档会从共享空间移走，附件会复制。成员已经下载的文件和 Git 历史无法收回。
            </p>
            <label className="shared-unshare-check">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              我明白过去的副本无法收回
            </label>
            <div>
              <button className="btn-quiet" onClick={() => setMoving(null)} disabled={busy}>取消</button>
              <button
                className="btn-danger"
                disabled={!confirmed || !privateRoot || busy}
                onClick={() => void unshare()}
              >
                {busy ? "正在迁移…" : "移回私人"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
