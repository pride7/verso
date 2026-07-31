mod error;
mod pty;
mod recent;
mod terminal;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, State};

use error::{Error, Result};
use vault::{note::NoteContent, tree::TreeNode, NoteMeta, NoteRef, Vault, VaultInfo};

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    pty: pty::PtyManager,
}

impl AppState {
    /// 所有需要 vault 的命令都从这里取，保证「未打开 vault」时给出
    /// 一致的、能直接展示给用户的错误。
    fn with_vault<T>(&self, f: impl FnOnce(&Vault) -> Result<T>) -> Result<T> {
        let guard = self.vault.lock().unwrap();
        let v = guard
            .as_ref()
            .ok_or_else(|| Error::Vault("尚未打开任何 vault".into()))?;
        f(v)
    }
}

#[tauri::command]
fn vault_open(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<VaultInfo> {
    let (v, info) = Vault::open(PathBuf::from(path))?;
    recent::save_vault(&app, &info.root);
    *state.vault.lock().unwrap() = Some(v);
    Ok(info)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Reopened {
    vault: VaultInfo,
    /// 上次打开的笔记，仍然存在才返回
    last_note: Option<String>,
}

/// 启动时自动重开上次的 vault 和笔记。目录被删或被移走就静默返回 None，
/// 让前端回到欢迎页 —— 不该拿一个「上次的路径没了」的报错拦住用户。
#[tauri::command]
fn vault_reopen_last(app: AppHandle, state: State<'_, AppState>) -> Option<Reopened> {
    let saved = recent::load(&app);
    let (v, vault) = Vault::open(PathBuf::from(saved.last_vault?)).ok()?;

    // 笔记可能已被删除或改名，存在才恢复
    let last_note = saved
        .last_note
        .filter(|rel| v.resolve(rel).map(|p| p.is_file()).unwrap_or(false));

    *state.vault.lock().unwrap() = Some(v);
    Some(Reopened { vault, last_note })
}

#[tauri::command]
fn tree_list(state: State<'_, AppState>) -> Result<Vec<TreeNode>> {
    state.with_vault(|v| v.tree())
}

#[tauri::command]
fn note_read(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<NoteContent> {
    let content = state.with_vault(|v| v.read_note(&path))?;
    recent::save_note(&app, &path);
    Ok(content)
}

#[tauri::command]
fn note_write(state: State<'_, AppState>, path: String, body: String) -> Result<i64> {
    state.with_vault(|v| v.write_note(&path, &body))
}

#[tauri::command]
fn note_create(
    state: State<'_, AppState>,
    parent_doc: Option<String>,
    title: String,
) -> Result<NoteMeta> {
    state.with_vault(|v| v.create_note(parent_doc.as_deref(), &title))
}

/// 窗口重新获得焦点时，前端拿它比对已打开文件的 mtime。
/// §7.4：有了终端跑 AI 之后，外部修改从边界情况变成日常主路径。
#[tauri::command]
fn note_stat(state: State<'_, AppState>, path: String) -> Result<i64> {
    state.with_vault(|v| v.stat(&path))
}

/// 全量笔记清单。快速切换器在前端本地做模糊匹配 —— 每敲一个字符走一次
/// IPC 会毁掉「三个字母直达」的手感（§2.2）。
#[tauri::command]
fn note_list(state: State<'_, AppState>) -> Result<Vec<NoteRef>> {
    state.with_vault(|v| v.note_list())
}

#[tauri::command]
fn note_rename(state: State<'_, AppState>, path: String, title: String) -> Result<String> {
    state.with_vault(|v| v.rename_note(&path, &title))
}

#[tauri::command]
fn note_move(
    state: State<'_, AppState>,
    path: String,
    new_parent_doc: Option<String>,
) -> Result<String> {
    state.with_vault(|v| v.move_note(&path, new_parent_doc.as_deref()))
}

#[tauri::command]
fn note_delete(state: State<'_, AppState>, path: String, with_children: bool) -> Result<()> {
    state.with_vault(|v| v.delete_note(&path, with_children))
}

// ---------------------------------------------------------------- 内嵌终端
// §7.3 方案 B。cwd 默认 vault 根 —— AI 工具通常需要看到整个 vault 才能做
// 跨笔记的操作（§10.7）。

#[tauri::command]
fn pty_open(
    app: AppHandle,
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
    path: Option<String>,
) -> Result<String> {
    let dir = state.with_vault(|v| match path.as_deref() {
        Some(p) if !p.is_empty() => v.resolve(p),
        _ => Ok(v.root.clone()),
    })?;
    state.pty.open(&app, &dir, cols.max(2), rows.max(2))
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<()> {
    state.pty.write(&id, &data)
}

#[tauri::command]
fn pty_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<()> {
    state.pty.resize(&id, cols.max(2), rows.max(2))
}

#[tauri::command]
fn pty_close(state: State<'_, AppState>, id: String) -> Result<()> {
    state.pty.close(&id)
}

/// 退出前问一句还有没有跑着的进程（§7.3「进程生命周期」）。
#[tauri::command]
fn pty_active_count(state: State<'_, AppState>) -> usize {
    state.pty.active_count()
}

/// 在**系统**终端中打开（§7.3 方案 A）。内嵌面板之外的备用入口 ——
/// 有时候还是想要一个独立窗口。`path` 为空则用 vault 根目录。
///
/// §10.7 待定：默认该用当前笔记所在目录还是 vault 根？AI 工具通常需要看到
/// 整个 vault 才能做跨笔记操作，所以这里默认根目录，等实际用下来再定。
#[tauri::command]
fn open_terminal(state: State<'_, AppState>, path: Option<String>) -> Result<()> {
    state.with_vault(|v| {
        let dir = match path.as_deref() {
            Some(p) if !p.is_empty() => v.resolve(p)?,
            _ => v.root.clone(),
        };
        terminal::open_at(&dir)
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            vault_open,
            vault_reopen_last,
            tree_list,
            note_read,
            note_write,
            note_create,
            note_stat,
            note_list,
            note_rename,
            note_move,
            note_delete,
            open_terminal,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            pty_active_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
