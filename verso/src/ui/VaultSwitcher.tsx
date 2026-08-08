import { useEffect, useMemo, useRef, useState } from "react";

import type { RecentVault, VaultInfo } from "../core/types";
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
  /**
   * 起个名字新建一个仓库。**只有手机传这个**（§2.1）——
   * 那边没有目录选择器，仓库统一建在容器目录里；给了它就说明这台设备走的是
   * 容器模型，于是「打开其他文件夹…」和「管理空间…」都不成立（前者要选目录，
   * 后者要能选到任意目录去删）。
   */
  onCreate?: (name: string) => void;
}

/** 同名仓库只看名字分不出来；平时不铺路径，只有真的重名时才补一行。 */
function duplicateNames(vaults: RecentVault[]) {
  const count = new Map<string, number>();
  for (const vault of vaults) count.set(vault.name, (count.get(vault.name) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([name]) => name));
}

function vaultGroups(vaults: RecentVault[]) {
  return [
    { label: "私人", items: vaults.filter((vault) => !vault.shared) },
    { label: "共享", items: vaults.filter((vault) => vault.shared) },
  ].filter((group) => group.items.length > 0);
}

export function VaultSwitcher({
  vaults,
  current,
  switching,
  onSwitch,
  onOpenFolder,
  onJoin,
  onManage,
  onCreate,
}: SwitcherProps) {
  const [open, setOpen] = useState(false);
  /** 新建仓库的名字输入。null = 没在建 */
  const [newName, setNewName] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const duplicates = useMemo(() => duplicateNames(vaults), [vaults]);
  const currentShared = vaults.find((item) => item.root === current?.root)?.shared ?? false;

  // 就地输入，不用 `window.prompt`：安卓 WebView 上它可能根本不弹
  // （M6 清单里那一条），而那时「新建仓库」就是个按下去没反应的按钮
  useEffect(() => {
    if (newName !== null) nameRef.current?.focus();
  }, [newName]);

  const submitName = () => {
    const name = (newName ?? "").trim();
    if (!name) return;
    setNewName(null);
    setOpen(false);
    onCreate?.(name);
  };

  useEffect(() => {
    if (!open) {
      setNewName(null);
      return;
    }
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
        <div className="vault-menu" role="menu" aria-label="切换空间">
          {vaultGroups(vaults).map((group) => (
            <div className="vault-menu-group" key={group.label}>
              <div className="vault-menu-label">{group.label}</div>
              {group.items.map((item) => {
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
            </div>
          ))}
          <div className="vault-menu-sep" />
          {onCreate ? (
            // 容器模型（手机）：新建只要一个名字，位置由后端定
            newName === null ? (
              <button
                className="vault-menu-action"
                onClick={() => setNewName("")}
                role="menuitem"
              >
                <Icon name="plus" size={15} />
                新建仓库…
              </button>
            ) : (
              <div className="vault-new">
                <input
                  ref={nameRef}
                  className="vault-new-input"
                  value={newName}
                  placeholder="仓库名"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitName();
                    if (e.key === "Escape") setNewName(null);
                  }}
                />
                <button
                  className="vault-new-ok"
                  onClick={submitName}
                  disabled={!newName.trim()}
                >
                  新建
                </button>
              </div>
            )
          ) : (
            <>
              <button
                className="vault-menu-action"
                onClick={() => {
                  setOpen(false);
                  onManage();
                }}
                role="menuitem"
              >
                <Icon name="settings" size={15} />
                管理空间…
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
                加入共享空间…
              </button>
            </>
          )}
        </div>
      )}
      <button
        className="vault-name"
        title={`${current?.root ?? ""}\n切换空间`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name={currentShared ? "people" : "vault"} size={14} />
        <span>{current?.name}</span>
        <Icon name="chevron" size={12} className={`vault-chevron${open ? " is-open" : ""}`} />
      </button>
    </div>
  );
}

interface ManagerProps extends CommonProps {
  error?: string | null;
  onForget: (root: string) => void;
  onManageShared: (root: string) => void;
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
  onManageShared,
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
            <h2 id="vault-manager-title">管理空间</h2>
            <p>切换私人笔记与受邀加入的共享内容。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="vault-manager-list">
          {error && <p className="vault-manager-error">{error}</p>}
          {vaults.length === 0 ? (
            <p className="vault-manager-empty">还没有记录任何空间。</p>
          ) : (
            vaultGroups(vaults).map((group) => (
              <div className="vault-manager-section" key={group.label}>
                <div className="vault-manager-section-title">{group.label}</div>
                {group.items.map((item) => {
                  const active = item.root === current?.root;
                  const busy = switching === item.root;
                  return <div className={`vault-manager-row${active ? " is-current" : ""}`} key={item.root}>
                  <span className="vault-manager-icon">
                    <Icon name={item.shared ? "people" : "vault"} size={16} />
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
                  {item.shared && item.available && (
                    <button
                      className="vault-row-action"
                      onClick={() => onManageShared(item.root)}
                      disabled={switching !== null}
                    >
                      管理
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
                  </div>;
                })}
              </div>
            ))
          )}
        </div>

        <footer className="vault-manager-foot">
          <p>移除记录不会删除目录或笔记。</p>
          <button className="btn-quiet" onClick={onJoin} disabled={switching !== null}>
            <Icon name="people" size={14} />
            加入共享空间
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
          {vaultGroups(usable).map((group) => (
            <div className="welcome-vault-group" key={group.label}>
              <div className="welcome-vault-label">{group.label}</div>
              {group.items.slice(0, 5).map((item) => (
                <button
                  className="welcome-vault-item"
                  key={item.root}
                  onClick={() => onSwitch(item.root)}
                  disabled={switching !== null}
                  title={item.root}
                >
                  <Icon name={item.shared ? "people" : "vault"} size={15} />
                  <span>{item.name}</span>
                  {switching === item.root ? <small>打开中…</small> : <Icon name="chevron" size={12} />}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
      <div className="welcome-vault-actions">
        <button className="btn-primary" onClick={onOpenFolder} disabled={switching !== null}>
          打开其他文件夹
        </button>
        <button className="btn-quiet" onClick={onJoin} disabled={switching !== null}>
          加入共享空间
        </button>
        {vaults.length > 0 && <button className="btn-quiet" onClick={onManage}>管理空间…</button>}
      </div>
    </div>
  );
}
