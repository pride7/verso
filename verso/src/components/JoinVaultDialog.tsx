import { useEffect, useState, type FormEvent } from "react";

import { Icon } from "./Icon";

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
  onPickFolder: () => Promise<string | null>;
  onJoin: (input: JoinVaultInput) => void;
  onClose: () => void;
}

export function JoinVaultDialog({ busy, error, onPickFolder, onJoin, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || !path.trim() || !name.trim() || !email.trim()) {
      setLocalError("请把仓库地址、本地位置、姓名和邮箱填写完整。");
      return;
    }
    if ((url.startsWith("https://") || url.startsWith("http://")) && !token.trim()) {
      setLocalError("HTTPS 仓库需要你自己的访问令牌。");
      return;
    }
    setLocalError(null);
    onJoin({
      url: url.trim(),
      path: path.trim(),
      token: token.trim(),
      name: name.trim(),
      email: email.trim(),
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
            <p>打开别人邀请你参与的内容，每个人保留自己的本地副本。</p>
          </div>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </header>

        <form onSubmit={submit}>
          <label className="join-field">
            <span>仓库地址</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/team/notes.git"
              spellCheck={false}
              autoFocus
              disabled={busy}
            />
            <small>你需要已经获得这个仓库的写入权限。</small>
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
            <small>已有文件绝不会被覆盖；目录不是空的会直接取消。</small>
          </label>

          <label className="join-field">
            <span>访问令牌</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="需要仓库 Contents 读写权限"
              autoComplete="off"
              disabled={busy}
            />
            <small>使用你自己的令牌，只保存在这台设备的安全凭据中。</small>
          </label>

          <div className="join-identity">
            <label className="join-field">
              <span>你的姓名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
            </label>
            <label className="join-field">
              <span>你的邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>

          {(localError || error) && <p className="join-error">{localError ?? error}</p>}

          <footer className="join-actions">
            <button type="button" className="btn-quiet" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "正在加入…" : "加入并打开"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
