import { useEffect, useMemo, useState } from "react";

import type { RecentVault, VaultInfo } from "../types";
import { Icon } from "./Icon";

interface CommonProps {
  vaults: RecentVault[];
  current: VaultInfo | null;
  switching: string | null;
  onSwitch: (root: string) => void;
  onOpenFolder: () => void;
  onJoin: () => void;
}

interface SwitcherProps extends CommonProps {
  onManage: () => void;
}

/** 同名仓库只看名字分不出来；平时不铺路径，只有真的重名时才补一行。 */
function duplicateNames(vaults: RecentVault[]) {
  const count = new Map<string, number>();
  for (const vault of vaults) count.set(vault.name, (count.get(vault.name) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([name]) => name));
}

export function VaultSwitcher({
  vaults,
  current,
  switching,
  onSwitch,
  onOpenFolder,
  onJoin,
  onManage,
}: SwitcherProps) {
  const [open, setOpen] = useState(false);
  const duplicates = useMemo(() => duplicateNames(vaults), [vaults]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="vault-switcher" onMouseDown={(event) => event.stopPropagation()}>
      {open && (
        <div className="vault-menu" role="menu" aria-label="切换仓库">
          <div className="vault-menu-label">仓库</div>
          {vaults.map((item) => {
            const active = item.root === current?.root;
            return (
              <button
                key={item.root}
                className={`vault-menu-item${active ? " is-current" : ""}`}
                onClick={() => {
                  if (active) setOpen(false);
                  else if (item.available) {
                    setOpen(false);
                    onSwitch(item.root);
                  }
                }}
                disabled={!item.available || switching !== null}
                role="menuitem"
                title={item.root}
              >
                <span className="vault-menu-check">
                  {active && <Icon name="check" size={13} />}
                </span>
                <span className="vault-menu-copy">
                  <strong>{item.name}</strong>
                  {(duplicates.has(item.name) || !item.available) && (
                    <small>{item.available ? item.root : "位置不可用"}</small>
                  )}
                </span>
              </button>
            );
          })}
          <div className="vault-menu-sep" />
          <button
            className="vault-menu-action"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
            role="menuitem"
          >
            <Icon name="settings" size={15} />
            管理仓库…
          </button>
          <button
            className="vault-menu-action"
            onClick={() => {
              setOpen(false);
              onOpenFolder();
            }}
            role="menuitem"
          >
            <Icon name="plus" size={15} />
            打开其他文件夹…
          </button>
          <button
            className="vault-menu-action"
            onClick={() => {
              setOpen(false);
              onJoin();
            }}
            role="menuitem"
          >
            <Icon name="people" size={15} />
            加入共享仓库…
          </button>
        </div>
      )}
      <button
        className="vault-name"
        title={`${current?.root ?? ""}\n切换仓库`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="vault" size={14} />
        <span>{current?.name}</span>
        <Icon name="chevron" size={12} className={`vault-chevron${open ? " is-open" : ""}`} />
      </button>
    </div>
  );
}

interface ManagerProps extends CommonProps {
  error?: string | null;
  onForget: (root: string) => void;
  onClose: () => void;
}

export function VaultManager({
  vaults,
  current,
  switching,
  error,
  onSwitch,
  onOpenFolder,
  onJoin,
  onForget,
  onClose,
}: ManagerProps) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="vault-manager" role="dialog" aria-modal="true" aria-labelledby="vault-manager-title">
        <header className="vault-manager-head">
          <div>
            <h2 id="vault-manager-title">管理仓库</h2>
            <p>快速切换这台设备上打开过的笔记目录。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="vault-manager-list">
          {error && <p className="vault-manager-error">{error}</p>}
          {vaults.length === 0 ? (
            <p className="vault-manager-empty">还没有记录仓库。</p>
          ) : (
            vaults.map((item) => {
              const active = item.root === current?.root;
              const busy = switching === item.root;
              return (
                <div className={`vault-manager-row${active ? " is-current" : ""}`} key={item.root}>
                  <span className="vault-manager-icon">
                    <Icon name="vault" size={16} />
                  </span>
                  <span className="vault-manager-copy">
                    <strong>{item.name}</strong>
                    <small title={item.root}>{item.root}</small>
                  </span>
                  {!item.available ? (
                    <span className="vault-unavailable">位置不可用</span>
                  ) : active ? (
                    <span className="vault-current"><Icon name="check" size={13} /> 当前</span>
                  ) : (
                    <button
                      className="vault-row-action"
                      onClick={() => onSwitch(item.root)}
                      disabled={switching !== null}
                    >
                      {busy ? "切换中…" : "打开"}
                    </button>
                  )}
                  {!active && (
                    <button
                      className="vault-row-remove"
                      onClick={() => onForget(item.root)}
                      disabled={switching !== null}
                      title="只从列表移除，不删除文件"
                      aria-label={`从列表移除 ${item.name}`}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <footer className="vault-manager-foot">
          <p>移除记录不会删除目录或笔记。</p>
          <button className="btn-quiet" onClick={onJoin} disabled={switching !== null}>
            <Icon name="people" size={14} />
            加入共享仓库
          </button>
          <button className="btn-primary" onClick={onOpenFolder} disabled={switching !== null}>
            <Icon name="plus" size={14} />
            打开其他文件夹
          </button>
        </footer>
      </section>
    </div>
  );
}

interface WelcomeProps {
  vaults: RecentVault[];
  switching: string | null;
  onSwitch: (root: string) => void;
  onOpenFolder: () => void;
  onJoin: () => void;
  onManage: () => void;
}

export function VaultWelcome({
  vaults,
  switching,
  onSwitch,
  onOpenFolder,
  onJoin,
  onManage,
}: WelcomeProps) {
  const usable = vaults.filter((item) => item.available);
  return (
    <div className="welcome-vaults">
      {usable.length > 0 && (
        <>
          <div className="welcome-vault-label">已记录的仓库</div>
          {usable.slice(0, 5).map((item) => (
            <button
              className="welcome-vault-item"
              key={item.root}
              onClick={() => onSwitch(item.root)}
              disabled={switching !== null}
              title={item.root}
            >
              <Icon name="vault" size={15} />
              <span>{item.name}</span>
              {switching === item.root ? <small>打开中…</small> : <Icon name="chevron" size={12} />}
            </button>
          ))}
        </>
      )}
      <div className="welcome-vault-actions">
        <button className="btn-primary" onClick={onOpenFolder} disabled={switching !== null}>
          打开其他文件夹
        </button>
        <button className="btn-quiet" onClick={onJoin} disabled={switching !== null}>
          加入共享仓库
        </button>
        {vaults.length > 0 && <button className="btn-quiet" onClick={onManage}>管理仓库…</button>}
      </div>
    </div>
  );
}
