mod error;
mod index;
mod pty;
mod recent;
mod terminal;
mod vault;
mod watcher;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use error::{Error, Result};
use vault::{note::NoteContent, tree::TreeNode, NoteMeta, NoteRef, Vault, VaultInfo};

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    index: Mutex<Option<index::Index>>,
    pty: pty::PtyManager,
    /// 自己写入的路径登记表，与文件监听共享（§2.7）
    self_writes: std::sync::Arc<watcher::SelfWrites>,
    /// 持有它就是在监听；换 vault 时替换掉，旧的 Drop 里会停线程
    watcher: Mutex<Option<watcher::VaultWatcher>>,
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

    fn with_index<T>(&self, f: impl FnOnce(&index::Index) -> Result<T>) -> Result<T> {
        let guard = self.index.lock().unwrap();
        let i = guard
            .as_ref()
            .ok_or_else(|| Error::Vault("索引尚未就绪".into()))?;
        f(i)
    }

    /// 保存 / 新建 / 删除之后同步索引。失败不该让主操作失败 ——
    /// 索引是派生数据，最坏情况是下次打开时重建。
    fn reindex(&self, rel: &str) {
        let vault = self.vault.lock().unwrap();
        let Some(v) = vault.as_ref() else { return };
        let mut index = self.index.lock().unwrap();
        if let Some(i) = index.as_mut() {
            let _ = i.update_note(v, rel);
        }
    }
}

/// 打开 vault 之后统一做的三件事：建索引、起监听、存进 state。
///
/// 索引失败不阻断打开 —— 它是派生数据，没有它编辑器照样能用，
/// 只是搜索和反向链接暂时缺席。
fn activate(app: &AppHandle, state: &AppState, v: Vault) {
    let root = v.root.clone();

    match index::Index::open(&root).and_then(|mut i| i.rebuild(&v).map(|_| i)) {
        Ok(i) => *state.index.lock().unwrap() = Some(i),
        Err(e) => {
            let _ = app.emit("index:error", e.to_string());
            *state.index.lock().unwrap() = None;
        }
    }

    let handle = app.clone();
    let w = watcher::watch(&root, state.self_writes.clone(), move |paths| {
        let st = handle.state::<AppState>();
        {
            let vault = st.vault.lock().unwrap();
            let Some(v) = vault.as_ref() else { return };
            let mut index = st.index.lock().unwrap();
            if let Some(i) = index.as_mut() {
                for p in &paths {
                    let _ = i.update_note(v, p);
                }
            }
        }
        let _ = handle.emit("vault:changed", watcher::VaultChanged { paths });
    });

    *state.watcher.lock().unwrap() = w.ok();
    *state.vault.lock().unwrap() = Some(v);
}

#[tauri::command]
fn vault_open(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<VaultInfo> {
    let (v, info) = Vault::open_watched(PathBuf::from(path), state.self_writes.clone())?;
    recent::save_vault(&app, &info.root);
    activate(&app, &state, v);
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
    let (v, vault) =
        Vault::open_watched(PathBuf::from(saved.last_vault?), state.self_writes.clone()).ok()?;

    // 笔记可能已被删除或改名，存在才恢复
    let last_note = saved
        .last_note
        .filter(|rel| v.resolve(rel).map(|p| p.is_file()).unwrap_or(false));

    activate(&app, &state, v);
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
    let mtime = state.with_vault(|v| v.write_note(&path, &body))?;
    state.reindex(&path);
    Ok(mtime)
}

#[tauri::command]
fn note_create(
    state: State<'_, AppState>,
    parent_doc: Option<String>,
    title: String,
) -> Result<NoteMeta> {
    let meta = state.with_vault(|v| v.create_note(parent_doc.as_deref(), &title))?;
    state.reindex(&meta.path);
    Ok(meta)
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

// ------------------------------------------------------------------ 索引
// §2.5。全文搜索、反向链接、标签。

#[tauri::command]
fn search(state: State<'_, AppState>, query: String, limit: Option<usize>) -> Result<Vec<index::SearchHit>> {
    state.with_index(|i| i.search(&query, limit.unwrap_or(50)))
}

/// 反向链接。索引里不存正文（省空间），出处那一行的原文在这里现读。
#[tauri::command]
fn backlinks(state: State<'_, AppState>, path: String) -> Result<Vec<index::Backlink>> {
    let mut links = state.with_index(|i| i.backlinks(&path))?;
    state.with_vault(|v| {
        for l in &mut links {
            if let Ok(c) = v.read_note(&l.path) {
                // frontmatter 已被剥掉，行号是相对正文的
                l.context = c
                    .body
                    .lines()
                    .nth((l.line as usize).saturating_sub(1))
                    .unwrap_or("")
                    .trim()
                    .to_string();
            }
        }
        Ok(())
    })?;
    Ok(links)
}

/// 悬空链接：指向不存在的笔记。写作时用来发现打错的名字。
#[tauri::command]
fn dangling_links(state: State<'_, AppState>) -> Result<Vec<(String, String)>> {
    state.with_index(|i| i.dangling_links())
}

#[tauri::command]
fn all_tags(state: State<'_, AppState>) -> Result<Vec<(String, i64)>> {
    state.with_index(|i| i.all_tags())
}

// ------------------------------------------------------ database 视图（§2.6）

/// 执行一个 `folio-view` 代码块。`source` 是代码块里的原文（YAML）。
///
/// 在 Rust 侧解析而不是前端：查询要拼 SQL，让解析和执行挨在一起才好保证
/// 所有用户输入都走参数绑定。视图定义写在笔记里，而笔记可能来自分享。
#[tauri::command]
fn view_query(state: State<'_, AppState>, source: String) -> Result<index::view::ViewResult> {
    let spec: index::view::ViewSpec = serde_yaml::from_str(&source)
        .map_err(|e| Error::Vault(format!("视图定义解析失败: {e}")))?;
    state.with_index(|i| index::view::query(i.conn(), &spec))
}

/// 在表格里改一个单元格 → 改对应笔记的 frontmatter → 文件落盘。
/// §2.6：「必须可写 —— 这是它好不好用的分水岭」。
#[tauri::command]
fn prop_set(
    state: State<'_, AppState>,
    path: String,
    key: String,
    value: Option<String>,
) -> Result<()> {
    state.with_vault(|v| v.set_prop(&path, &key, value.as_deref()))?;
    state.reindex(&path);
    Ok(())
}

/// 手动重建索引。索引出问题时的兜底 —— 它是派生数据，重建总能修好。
#[tauri::command]
fn index_rebuild(state: State<'_, AppState>) -> Result<index::IndexStats> {
    let vault = state.vault.lock().unwrap();
    let v = vault
        .as_ref()
        .ok_or_else(|| Error::Vault("尚未打开任何 vault".into()))?;
    let mut index = state.index.lock().unwrap();
    let i = index
        .as_mut()
        .ok_or_else(|| Error::Vault("索引尚未就绪".into()))?;
    i.rebuild(v)
}

/// 重命名/移动/删除都会改变一批文件，逐个同步索引不划算也容易漏
/// （同名文件夹里的子文档全都换了路径）—— 直接整库重建，5000 篇也就几秒。
fn rebuild_index(state: &AppState) {
    let vault = state.vault.lock().unwrap();
    let Some(v) = vault.as_ref() else { return };
    let mut index = state.index.lock().unwrap();
    if let Some(i) = index.as_mut() {
        let _ = i.rebuild(v);
    }
}

#[tauri::command]
fn note_rename(state: State<'_, AppState>, path: String, title: String) -> Result<String> {
    let new_path = state.with_vault(|v| v.rename_note(&path, &title))?;
    rebuild_index(&state);
    Ok(new_path)
}

#[tauri::command]
fn note_move(
    state: State<'_, AppState>,
    path: String,
    new_parent_doc: Option<String>,
) -> Result<String> {
    let new_path = state.with_vault(|v| v.move_note(&path, new_parent_doc.as_deref()))?;
    rebuild_index(&state);
    Ok(new_path)
}

#[tauri::command]
fn note_delete(state: State<'_, AppState>, path: String, with_children: bool) -> Result<()> {
    state.with_vault(|v| v.delete_note(&path, with_children))?;
    rebuild_index(&state);
    Ok(())
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
            search,
            backlinks,
            dangling_links,
            all_tags,
            index_rebuild,
            view_query,
            prop_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
