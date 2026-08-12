import { useCallback, useEffect, useMemo, useState } from "react";

import type { AttachmentAudit } from "../core/types";
import { api } from "../host/api";
import { confirm } from "../host/dialog";
import { Icon } from "./Icon";

interface Props {
  onOpen: (path: string, line: number) => void;
  onChanged: (deleted: number, skipped: number) => void;
  onClose: () => void;
}

function size(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentDialog({ onOpen, onChanged, onClose }: Props) {
  const [audit, setAudit] = useState<AttachmentAudit | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setAudit(await api.attachmentAudit());
      setSelected(new Set());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);

  const all = useMemo(() => audit?.unused.map((item) => item.path) ?? [], [audit]);
  const toggle = (path: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path); else next.delete(path);
      return next;
    });
  };

  const clean = async () => {
    if (!selected.size) return;
    const paths = [...selected];
    if (!(await confirm(
      `确定删除选中的 ${paths.length} 个未使用附件吗？\n\n文件会从 attachments 目录永久删除，无法在正文里撤销。`,
      { title: "清理未使用附件", okLabel: "删除", cancelLabel: "取消", kind: "warning" },
    ))) return;

    setBusy(true);
    try {
      const deleted = await api.deleteUnusedAttachments(paths);
      onChanged(deleted.length, paths.length - deleted.length);
      await load();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const empty = audit && audit.missing.length === 0 && audit.unused.length === 0;
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="attachment-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-dialog-title">
        <header className="vault-manager-head">
          <div>
            <h2 id="attachment-dialog-title">检查附件</h2>
            <p>定位失效引用，清理 attachments 目录中没有被使用的文件。</p>
          </div>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭"><Icon name="close" /></button>
        </header>

        <div className="attachment-dialog-body">
          {error && <p className="join-error">{error}</p>}
          {!audit && !error && <p className="attachment-empty">正在扫描全部文档与附件…</p>}
          {empty && <p className="attachment-empty">附件状态正常：没有缺失引用，也没有未使用文件。</p>}

          {!!audit?.missing.length && <section className="attachment-section">
            <header><h3>缺失附件</h3><span>{audit.missing.length}</span></header>
            <p>文件已经不在附件目录中。点击出处可打开对应文档。</p>
            <ul>
              {audit.missing.map((item) => <li className="attachment-item is-missing" key={item.path}>
                <div className="attachment-path"><Icon name="close" size={14} /><span>{item.path}</span></div>
                <div className="attachment-refs">
                  {item.references.map((ref) => <button key={`${ref.note}:${ref.line}`} onClick={() => onOpen(ref.note, ref.line)}>
                    {ref.note.replace(/\.md$/, "")} · 第 {ref.line} 行
                  </button>)}
                </div>
              </li>)}
            </ul>
          </section>}

          {!!audit?.unused.length && <section className="attachment-section">
            <header>
              <h3>未使用附件</h3><span>{audit.unused.length}</span>
              <button className="attachment-select-all" onClick={() => setSelected(selected.size === all.length ? new Set() : new Set(all))}>
                {selected.size === all.length ? "取消全选" : "全选"}
              </button>
            </header>
            <p>这些文件没有被任何 Markdown 文档引用。只会删除你勾选的项目。</p>
            <ul>
              {audit.unused.map((item) => <li className="attachment-item" key={item.path}>
                <label>
                  <input type="checkbox" checked={selected.has(item.path)} onChange={(event) => toggle(item.path, event.target.checked)} />
                  <span>{item.path}</span><small>{size(item.size)}</small>
                </label>
              </li>)}
            </ul>
          </section>}
        </div>

        <footer className="attachment-dialog-foot">
          <button className="btn-quiet" onClick={() => void load()} disabled={busy}>重新扫描</button>
          <span>{selected.size ? `已选择 ${selected.size} 个` : "未选择文件"}</span>
          <button className="btn-danger" onClick={() => void clean()} disabled={busy || selected.size === 0}>
            {busy ? "处理中…" : "清理所选附件"}
          </button>
        </footer>
      </section>
    </div>
  );
}
