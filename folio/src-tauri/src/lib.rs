mod error;
mod recent;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, State};

use error::{Error, Result};
use vault::{note::NoteContent, tree::TreeNode, NoteMeta, Vault, VaultInfo};

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
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
    recent::save(&app, &info.root);
    *state.vault.lock().unwrap() = Some(v);
    Ok(info)
}

/// 启动时自动重开上次的 vault。目录被删或被移走就静默返回 None，
/// 让前端回到欢迎页 —— 不该拿一个「上次的路径没了」的报错拦住用户。
#[tauri::command]
fn vault_reopen_last(app: AppHandle, state: State<'_, AppState>) -> Option<VaultInfo> {
    let last = recent::load(&app).last_vault?;
    let (v, info) = Vault::open(PathBuf::from(last)).ok()?;
    *state.vault.lock().unwrap() = Some(v);
    Some(info)
}

#[tauri::command]
fn tree_list(state: State<'_, AppState>) -> Result<Vec<TreeNode>> {
    state.with_vault(|v| v.tree())
}

#[tauri::command]
fn note_read(state: State<'_, AppState>, path: String) -> Result<NoteContent> {
    state.with_vault(|v| v.read_note(&path))
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
