mod error;
mod index;
mod pty;
mod recent;
mod settings;
mod terminal;
mod vault;
mod watcher;
mod winpath;
mod workspace;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use error::{Error, Result};
use vault::{note::NoteContent, order, tree::TreeNode, NoteMeta, NoteRef, Vault, VaultInfo};

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

    // 图片要走 Tauri 的 asset 协议才能在 webview 里显示。**只放行当前这个
    // vault**：笔记可以来自分享（§2.9），`![[../../秘密.png]]` 不该能读到
    // vault 外面去。换 vault 时这里会再放行新的那个，旧的留着无妨 ——
    // 作用域只是「允许读」，真正的路径检查仍在 `Vault::resolve`
    //
    // **两种写法都要放行。** `canonicalize` 在 Windows 上给的是扩展长度路径
    // （`\\?\D:\…`），而前端交给 asset 协议的是剥掉前缀的 `D:/…`；作用域是
    // 按模式匹配的，只授权其中一种，另一种会被一律拒掉 —— 表现就是
    // 「图片找不到」，而文件明明就在那儿。
    let scope = app.asset_protocol_scope();
    let raw = root.to_string_lossy().into_owned();
    let plain = raw
        .trim_start_matches(r"\\?\UNC\")
        .trim_start_matches(r"\\?\")
        .to_string();
    for dir in [&raw, &plain] {
        if let Err(e) = scope.allow_directory(dir, true) {
            let _ = app.emit("index:error", format!("图片显示可能不可用：{e}"));
        }
    }

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
    let mut tree = state.with_vault(|v| v.tree())?;

    // 时间戳从索引补。索引没就绪时留空 —— 树照样能显示，只是暂时不能按
    // 时间排，不该因此整个打不开
    if let Ok(keys) = state.with_index(|i| i.sort_keys()) {
        let map: std::collections::HashMap<_, _> = keys
            .into_iter()
            .map(|(path, created, updated)| (path, (created, updated)))
            .collect();
        fill_times(&mut tree, &map);
    }

    // 手动顺序来自 vault 根的 .verso-order.json（见 vault/order.rs
    // 里为什么不放 .verso/ 也不放 frontmatter）
    let order = state.with_vault(|v| Ok(order::load(v.fs.as_ref(), &v.root)))?;
    fill_order(&mut tree, &order);

    Ok(tree)
}

type Times = std::collections::HashMap<String, (Option<String>, Option<String>)>;

fn fill_times(nodes: &mut [TreeNode], map: &Times) {
    for n in nodes {
        if let Some((created, updated)) = map.get(&n.path) {
            n.created = created.clone();
            n.updated = updated.clone();
        }
        fill_times(&mut n.children, map);
    }
}

fn fill_order(nodes: &mut [TreeNode], map: &order::OrderMap) {
    for n in nodes {
        n.order = order::index_of(map, &n.path);
        fill_order(&mut n.children, map);
    }
}

/// 记录一组兄弟的手动顺序。
///
/// 只写 vault 根目录的一个文件，**不碰任何笔记** —— 早先的版本往每篇
/// frontmatter 写 `order`，除了污染笔记，还会顺手把 `updated` 刷成现在，
/// 把「最近修改」排序毁掉。
#[tauri::command]
fn notes_reorder(state: State<'_, AppState>, parent: String, paths: Vec<String>) -> Result<()> {
    state.with_vault(|v| {
        let mut map = order::load(v.fs.as_ref(), &v.root);
        order::set_group(&mut map, &parent, paths);
        order::save(v.fs.as_ref(), &v.root, &map)
    })
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

/// 源码模式里手改 frontmatter。正文不经过这条路，见 `Vault::write_frontmatter`
#[tauri::command]
fn frontmatter_write(state: State<'_, AppState>, path: String, yaml: String) -> Result<i64> {
    let mtime = state.with_vault(|v| v.write_frontmatter(&path, &yaml))?;
    state.reindex(&path);
    Ok(mtime)
}

/// 粘贴板里的图片落盘。`data` 是 base64（IPC 传大字节数组极慢，终端那边
/// 也是这么传的），返回 vault 相对路径供前端拼 `![[]]`。
#[tauri::command]
fn attachment_write(state: State<'_, AppState>, name: String, data: String) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| Error::Vault(format!("附件数据不是合法的 base64: {e}")))?;
    state.with_vault(|v| v.write_attachment(&name, &bytes))
}

/// 属性 schema（`.verso-props.json`）。见 `vault::schema`
#[tauri::command]
fn prop_schema(state: State<'_, AppState>) -> Result<vault::schema::Schema> {
    state.with_vault(|v| Ok(v.prop_schema()))
}

#[tauri::command]
fn prop_def_set(
    state: State<'_, AppState>,
    key: String,
    def: Option<vault::schema::PropDef>,
) -> Result<()> {
    state.with_vault(|v| v.set_prop_def(&key, def.clone()))
}

/// 一个属性在多少篇笔记里出现过。重命名前拿它去问用户
#[tauri::command]
fn prop_count(state: State<'_, AppState>, key: String) -> Result<usize> {
    state.with_vault(|v| v.count_prop(&key))
}

/// **全库**重命名一个属性，返回改了多少篇。前端必须先确认过再调
#[tauri::command]
fn prop_rename_all(state: State<'_, AppState>, from: String, to: String) -> Result<usize> {
    let n = state.with_vault(|v| v.rename_prop_everywhere(&from, &to))?;
    // 改的是全库，逐篇 reindex 不如整重建一次；失败也不该让重命名本身失败 ——
    // 索引是派生数据，最坏是下次打开时重来
    {
        let vault = state.vault.lock().unwrap();
        if let Some(v) = vault.as_ref() {
            let mut index = state.index.lock().unwrap();
            if let Some(i) = index.as_mut() {
                let _ = i.rebuild(v);
            }
        }
    }
    Ok(n)
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

/// 建一篇「未命名」。名字由后端定（重名往后编号），前端建完就地改名
#[tauri::command]
fn note_create_untitled(state: State<'_, AppState>, parent_doc: Option<String>) -> Result<NoteMeta> {
    let meta = state.with_vault(|v| v.create_untitled(parent_doc.as_deref()))?;
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

/// 带某个标签的笔记。标签面板点一下就列出来（含嵌套子标签）。
#[tauri::command]
fn notes_by_tag(state: State<'_, AppState>, tag: String) -> Result<Vec<NoteRef>> {
    state.with_index(|i| i.notes_by_tag(&tag))
}

// ------------------------------------------------------ database 视图（§2.6）

/// 执行一个 `verso-view` 代码块。`source` 是代码块里的原文（YAML）。
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
/// 属性改名。保留原值和原位置 —— 见 `Vault::rename_prop` 的说明。
#[tauri::command]
fn prop_rename(state: State<'_, AppState>, path: String, from: String, to: String) -> Result<()> {
    state.with_vault(|v| v.rename_prop(&path, &from, &to))?;
    state.reindex(&path);
    Ok(())
}

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
/// 路径变了之后把排序文件里的条目修好。
///
/// 不修的话，重命名一篇笔记会让它（以及它整棵子树）在树里沉到底部 ——
/// 一个很常见的操作，结果是手排的顺序莫名其妙乱掉。
fn fix_order_after_move(state: &AppState, from: &str, to: Option<&str>) {
    let _ = state.with_vault(|v| {
        let mut map = order::load(v.fs.as_ref(), &v.root);
        match to {
            Some(to) => order::rename_path(&mut map, from, to),
            None => order::remove_path(&mut map, from),
        }
        order::save(v.fs.as_ref(), &v.root, &map)
    });
}

#[tauri::command]
fn note_rename(state: State<'_, AppState>, path: String, title: String) -> Result<String> {
    let new_path = state.with_vault(|v| v.rename_note(&path, &title))?;
    fix_order_after_move(&state, &path, Some(&new_path));
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
    fix_order_after_move(&state, &path, Some(&new_path));
    rebuild_index(&state);
    Ok(new_path)
}

#[tauri::command]
fn note_delete(state: State<'_, AppState>, path: String, with_children: bool) -> Result<()> {
    state.with_vault(|v| v.delete_note(&path, with_children))?;
    fix_order_after_move(&state, &path, None);
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

// —— 每个 vault 的界面状态：标签页（§2.1）——

/// 读不出来就返回空 —— 见 `workspace.rs`，这份状态丢了只是少开几个页签
/// 仓库现在有多少改动。状态栏那个点每隔一会儿问一次（§2.8）
#[tauri::command]
fn git_status(state: State<'_, AppState>) -> Result<vault::git::GitStatus> {
    state.with_vault(|v| Ok(vault::git::status(&v.root)))
}

/// 把工作区的改动提交掉。没有改动时返回 null，**不产生空提交**。
///
/// 只做本地历史，不碰远端 —— 完整的 pull/push 与冲突解决仍在 M5 的后半段。
#[tauri::command]
fn git_commit(
    state: State<'_, AppState>,
    message: Option<String>,
) -> Result<Option<vault::git::CommitInfo>> {
    state.with_vault(|v| vault::git::commit_all(&v.root, message.as_deref()))
}

#[tauri::command]
fn workspace_get(state: State<'_, AppState>) -> Result<workspace::Workspace> {
    state.with_vault(|v| Ok(workspace::load(v.fs.as_ref(), &v.root)))
}

#[tauri::command]
fn workspace_set(state: State<'_, AppState>, ws: workspace::Workspace) -> Result<()> {
    state.with_vault(|v| workspace::save(v.fs.as_ref(), &v.root, &ws))
}

// —— 用户设置（§6）——

#[tauri::command]
fn settings_get(app: AppHandle) -> settings::Settings {
    settings::load(&app)
}

/// 存之前先过一遍 `sanitized()`：前端的输入框、以及手改过的设置文件，
/// 都可能送进 0 或者 NaN，那会让界面直接不可用。
#[tauri::command]
fn settings_set(app: AppHandle, settings: settings::Settings) -> Result<settings::Settings> {
    let clean = settings.sanitized();
    settings::store(&app, &clean)?;
    Ok(clean)
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
            attachment_write,
            frontmatter_write,
            note_create,
            note_create_untitled,
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
            notes_by_tag,
            index_rebuild,
            view_query,
            prop_set,
            prop_schema,
            prop_def_set,
            prop_count,
            prop_rename_all,
            prop_rename,
            notes_reorder,
            git_status,
            git_commit,
            workspace_get,
            workspace_set,
            settings_get,
            settings_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
