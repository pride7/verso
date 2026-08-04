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
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// 已经在走关窗流程了。见 `run()` 里的 `on_window_event`
    closing: AtomicBool,
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

/// 这台设备上成功打开过的仓库。目录移走后仍然返回，由前端标成不可用；
/// 静默删掉的话，用户分不清是路径失效还是软件忘了。
#[tauri::command]
fn vault_recent_list(app: AppHandle) -> Vec<recent::RecentVault> {
    recent::list(&app)
}

/// 只移除快捷入口，不删除仓库或其中任何文件。
#[tauri::command]
fn vault_recent_forget(app: AppHandle, path: String) {
    recent::forget(&app, &path);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Reopened {
    vault: VaultInfo,
    /// 上次打开的笔记，仍然存在才返回
    last_note: Option<String>,
}

/// 移动端的 vault 位置。DESIGN.md §1.2(b)
///
/// **手机上不问「选哪个文件夹」。** Tauri 的目录选择器在移动端没有实现，
/// 点下去毫无反应；而安卓的 scoped storage 下能选的东西本来也有限。既然
/// 答案基本是唯一的，就别摆一个选择题。
///
/// 两个位置，按顺序试：
///
/// 1. **`/storage/emulated/0/Verso`** —— 拿到「所有文件访问权限」之后能用
///    （思源笔记走的也是这条）。它是**真实路径**，所以 `std::fs`、git2、
///    文件监听一行都不用改；而且文件管理器里看得见、Syncthing 之类同步得了。
///    Obsidian 走的 SAF 给的是 `content://` URI，那要把整个 `VaultFs` 用 JNI
///    重写一遍，libgit2 还读不了它
/// 2. App 私有目录 —— 没授权时的退路。**能用，只是笔记在别处看不见**，
///    所以只当兜底，不当默认
///
/// 判断「能不能用」靠**真的写一个文件**：安卓上 `create_dir_all` 在没权限时
/// 也可能返回 Ok，而目录建得出来、文件写不进去是最难查的一种坏法。
#[cfg(mobile)]
fn vault_candidates(app: &AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;
    let shared = std::env::var_os("EXTERNAL_STORAGE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/storage/emulated/0"))
        .join("Verso");
    let mut list = vec![shared];
    if let Ok(private) = app.path().app_data_dir() {
        list.push(private.join("vault"));
    }
    list
}

/// 挨个试，**第一个真的能打开的那个**才算数。
///
/// 「能建目录」不等于「能用」：安卓上 `create_dir_all` 在没权限时也可能
/// 返回 Ok，而共享存储那层 FUSE 还可能让 git2 初始化仓库失败。所以判据是
/// 一路走到 `Vault::open_watched` 成功为止。
///
/// **失败时把每一条路径的原因都带回去。** 手机上没有终端也看不了日志，
/// 一个静默返回 None 的启动流程等于让人对着一个死按钮猜 —— v0.6.6 就是
/// 这么坏的。
#[cfg(mobile)]
fn open_default_vault(
    app: &AppHandle,
    state: &AppState,
) -> std::result::Result<(Vault, VaultInfo), String> {
    let mut why = Vec::new();
    for dir in vault_candidates(app) {
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("[verso] 建不出目录 {}：{e}", dir.display());
            why.push(format!("{}：建不出目录（{e}）", dir.display()));
            continue;
        }
        match Vault::open_watched(dir.clone(), state.self_writes.clone()) {
            Ok(pair) => {
                // **退到后面的候选时要说一声。** 共享存储用不了的话，笔记会
                // 落在别处看不见的私有目录里，而用户完全无从察觉 —— 他只会
                // 觉得「授权了但没生效」。这条走 index:error 那个提示条
                if !why.is_empty() {
                    let _ = app.emit(
                        "index:error",
                        format!("笔记暂时放在 {}。{}", dir.display(), why.join("；")),
                    );
                }
                return Ok(pair);
            }
            Err(e) => {
                // 同时打进 logcat：手机上界面能显示的字数有限，而
                // `adb logcat -s RustStderr` 里能看到完整的一句
                eprintln!("[verso] vault 打不开 {}：{e}", dir.display());
                why.push(format!("{} 用不了：{e}", dir.display()));
            }
        }
    }
    Err(format!("这几个位置都用不了：
{}", why.join("
")))
}

/// 启动时自动重开上次的 vault 和笔记。目录被删或被移走就静默返回 None，
/// 让前端回到欢迎页 —— 不该拿一个「上次的路径没了」的报错拦住用户。
///
/// **移动端没有欢迎页这一说**：没有上次的记录时就用私有目录里那个默认的
/// （见 `default_vault`），因为那里根本没有第二个选项可选。
#[tauri::command]
fn vault_reopen_last(app: AppHandle, state: State<'_, AppState>) -> Option<Reopened> {
    let saved = recent::load(&app);
    // **移动端每次都重新算一遍，不认上次记的那个。**
    //
    // MainActivity 是在启动时把用户带去授权页的，而这个函数早就跑完了 ——
    // 于是首次启动必然落在私有目录那条退路上，然后被记下来。不重算的话，
    // 用户授权之后**再怎么重启也回不到共享目录**，而他会以为授权没生效。
    #[cfg(mobile)]
    let (v, vault) = {
        let _ = &saved;
        open_default_vault(&app, &state).ok()?
    };
    #[cfg(not(mobile))]
    let (v, vault) =
        Vault::open_watched(PathBuf::from(saved.last_vault?), state.self_writes.clone()).ok()?;

    // 笔记可能已被删除或改名，存在才恢复
    let last_note = saved
        .last_note
        .filter(|rel| v.resolve(rel).map(|p| p.is_file()).unwrap_or(false));

    activate(&app, &state, v);
    Some(Reopened { vault, last_note })
}

/// 手机上没有目录选择器，欢迎页那个按钮改成走这条。
///
/// **返回 Result 而不是 Option**：失败时前端会把这句话原样显示出来，
/// 那是手机上唯一能看到原因的地方。
#[tauri::command]
fn vault_open_default(app: AppHandle, state: State<'_, AppState>) -> Result<VaultInfo> {
    #[cfg(mobile)]
    {
        let (v, info) = open_default_vault(&app, &state).map_err(Error::Vault)?;
        recent::save_vault(&app, &info.root);
        activate(&app, &state, v);
        Ok(info)
    }
    #[cfg(not(mobile))]
    {
        let _ = (&app, &state);
        Err(Error::Vault("桌面上请自己选一个目录".into()))
    }
}

/// 这是不是手机。欢迎页要据此决定那个按钮该干什么 —— 桌面上是选目录，
/// 手机上没有目录可选（见 `vault_open_default`）
#[tauri::command]
fn platform_is_mobile() -> bool {
    cfg!(mobile)
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

    // 图标同理，索引没就绪就先不显示 —— 树本身不该因为少一个装饰打不开
    if let Ok(icons) = state.with_index(|i| i.icons()) {
        let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for (path, icon) in icons {
            map.entry(path).or_insert(icon);
        }
        fill_icons(&mut tree, &map);
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

fn fill_icons(nodes: &mut [TreeNode], map: &std::collections::HashMap<String, String>) {
    for n in nodes {
        n.icon = map.get(&n.path).cloned();
        fill_icons(&mut n.children, map);
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

/// 模板面板里直接新建。目录不存在时一并建立，路径校验仍由 Vault 负责。
#[tauri::command]
fn template_create(state: State<'_, AppState>, dir: String) -> Result<NoteMeta> {
    let meta = state.with_vault(|v| v.create_template(&dir))?;
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
/// 只提交，不同步 —— 推送走 `vault_sync`。
#[tauri::command]
fn git_commit(
    state: State<'_, AppState>,
    message: Option<String>,
) -> Result<Option<vault::git::CommitInfo>> {
    state.with_vault(|v| vault::git::commit_all(&v.root, message.as_deref()))
}

/// 生效的提交署名（仓库级优先，其次全局；都没有时提交挂「Verso」）
#[tauri::command]
fn git_identity_get(state: State<'_, AppState>) -> Result<vault::git::Identity> {
    state.with_vault(|v| vault::git::identity_get(&v.root))
}

/// 把署名写进 vault 仓库级配置，跟着 vault 走。空串 = 清掉，回到全局配置
#[tauri::command]
fn git_identity_set(
    state: State<'_, AppState>,
    name: String,
    email: String,
) -> Result<vault::git::Identity> {
    state.with_vault(|v| vault::git::identity_set(&v.root, &name, &email))
}

/// 最近的若干次提交。侧栏的历史面板用（§2.8）
#[tauri::command]
fn git_history(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<vault::git::HistoryEntry>> {
    state.with_vault(|v| vault::git::history(&v.root, limit.unwrap_or(50)))
}

/// 当前还没有记进版本历史的文件。侧栏的「当前改动」用（§2.8）。
#[tauri::command]
fn git_working_changes(state: State<'_, AppState>) -> Result<Vec<vault::git::FileChange>> {
    state.with_vault(|v| vault::git::working_changes(&v.root))
}

/// 一篇文件的差异。`commit` 为空时比较当前工作区；有值时比较那一版与上一版。
#[tauri::command]
fn git_diff_file(
    state: State<'_, AppState>,
    path: String,
    commit: Option<String>,
) -> Result<vault::git::FileDiff> {
    state.with_vault(|v| {
        // §0：任何来自前端的路径都要先过这一道。历史里的删除文件虽然已经
        // 不存在，`resolve` 仍能验证它是 vault 内的相对路径。
        v.resolve(&path)?;
        vault::git::diff_file(&v.root, commit.as_deref(), &path)
    })
}

/// 撤销一篇文件尚未记进版本历史的改动。
///
/// 已经存在于 HEAD 的文件写回最近记录的原始字节；还没记录过的新文件删除。
/// 前端必须先确认，因为这和历史里的「回退」不同：未记录内容没有备份版本。
#[tauri::command]
fn git_discard_file(state: State<'_, AppState>, path: String) -> Result<()> {
    state.with_vault(|v| {
        let abs = v.resolve(&path)?;
        let change = vault::git::working_changes(&v.root)?
            .into_iter()
            .find(|change| change.path == path)
            .ok_or_else(|| Error::Vault(format!("{path} 没有可撤销的改动")))?;
        let previous = vault::git::file_at_head(&v.root, &path)?;

        match previous {
            Some(bytes) => v.fs.write_bytes(&abs, &bytes)?,
            None if change.kind == "added" => {
                if v.fs.exists(&abs) {
                    v.fs.remove_file(&abs)?;
                }
            }
            None => return Err(Error::Vault(format!("最近的版本里找不到 {path}"))),
        }
        vault::git::reset_index_file(&v.root, &path)
    })?;
    state.reindex(&path);
    Ok(())
}

/// 把某一篇笔记回退到某一版。
///
/// **回退前先把当前状态记一个版本** —— 不然「回退」就成了一次不可撤销的
/// 覆盖，而它本该只是历史里的又一步。写盘走 `VaultFs`（§1.2），顺带让文件
/// 监听认出这是自己写的，不会再弹一条「文件被外部修改」。
#[tauri::command]
fn git_restore_file(state: State<'_, AppState>, commit: String, path: String) -> Result<()> {
    if !path.ends_with(".md") {
        return Err(Error::Vault("只能回退笔记".into()));
    }
    let text = state.with_vault(|v| vault::git::file_at(&v.root, &commit, &path))?;
    state.with_vault(|v| {
        vault::git::commit_all(&v.root, Some("回退前的状态"))?;
        let abs = v.resolve(&path)?;
        v.fs.write_atomic(&abs, &text)
    })?;
    state.reindex(&path);
    Ok(())
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

/// 关窗前给前端的通知。见 `run()` 里的 `on_window_event`
const CLOSING_EVENT: &str = "app:closing";

/// 前端最多有这么久做收尾。超了就不等了 —— **卡死的收尾不能变成关不掉的窗口**。
///
/// 就算真被切断，丢的也只是「关机前那一个版本」而不是内容：收尾的第一步是
/// 落盘，落盘完才轮到提交。
const CLOSE_GRACE: std::time::Duration = std::time::Duration::from_secs(5);

/// 前端收尾做完了，可以真的关了。
///
/// 用 `destroy` 而不是 `close`：后者会再发一次 `CloseRequested`，又绕回
/// 上面那段拦截逻辑。
#[tauri::command]
fn close_now(window: tauri::Window) {
    let _ = window.destroy();
}


// —— §2.8 远端同步（M5b）——

/// 当前配的远端。没配过时 `url` 是 null
#[tauri::command]
fn sync_remote_get(state: State<'_, AppState>) -> Result<vault::sync::RemoteInfo> {
    state.with_vault(|v| vault::sync::remote_get(&v.root))
}

/// 配远端。空串 = 不要远端了。
///
/// 顺带报告这个 URL 上有没有存过令牌 —— 换了个仓库地址之后，界面得知道
/// 是不是又要填一次
#[tauri::command]
fn sync_remote_set(state: State<'_, AppState>, url: String) -> Result<vault::sync::RemoteInfo> {
    state.with_vault(|v| vault::sync::remote_set(&v.root, &url))
}

/// 存/删这个远端的访问令牌。空串 = 删掉。
///
/// **只进系统钥匙串，不进设置文件**（`vault/secret.rs` 开头写了为什么）。
#[tauri::command]
fn sync_token_set(url: String, token: String) -> Result<()> {
    vault::secret::token_set(&url, &token)
}

/// 这个远端存过令牌没有。**有意不提供「读令牌」的命令** ——
/// 令牌一旦传给前端，就会出现在 IPC 日志和 DevTools 里
#[tauri::command]
fn sync_token_has(url: String) -> bool {
    vault::secret::token_has(&url)
}

/// 同步一次：提交本地改动 → 取远端 → 接到一起 → 推上去。
///
/// 令牌在 Rust 侧从钥匙串取，前端不经手。撞上冲突时返回的 `conflicts`
/// 非空，且**这次同步什么都没做** —— 工作区、历史、远端全都没动。
///
/// 同步会改磁盘上的文件（拉下来的那些），所以完事要重建索引，
/// 不然搜索和 database 视图看到的还是旧内容。
#[tauri::command]
fn vault_sync(state: State<'_, AppState>) -> Result<vault::sync::SyncOutcome> {
    let (root, url) = state.with_vault(|v| {
        Ok((
            v.root.clone(),
            vault::sync::remote_get(&v.root)?.url.unwrap_or_default(),
        ))
    })?;
    let token = vault::secret::token_get(&url);
    let out = vault::sync::sync(&root, token)?;
    if out.pulled > 0 {
        rebuild_index(&state);
    }
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 自动更新（§2.11）。**只有桌面装得上** —— 移动端的包由应用商店
        // 或系统安装器管，一个应用没有权限就地替换自己。
        //
        // 注册放在 `setup` 里而不是链上直接 `.plugin(...)`：那两个 crate 是
        // target 依赖，安卓上根本不存在，`#[cfg(desktop)]` 必须能把整段
        // 代码连同 `use` 一起去掉。
        .setup(|app| {
            // 令牌存储要知道应用私有数据目录（vault/secret.rs 的安卓文件
            // 后端靠它定位；桌面走钥匙串，用不上，但 init 没有副作用）
            {
                use tauri::Manager;
                if let Ok(dir) = app.path().app_data_dir() {
                    vault::secret::init(dir);
                }
            }
            #[cfg(desktop)]
            {
                let handle = app.handle();
                handle.plugin(tauri_plugin_updater::Builder::new().build())?;
                handle.plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            vault_open,
            vault_recent_list,
            vault_recent_forget,
            vault_reopen_last,
            vault_open_default,
            platform_is_mobile,
            tree_list,
            note_read,
            note_write,
            attachment_write,
            frontmatter_write,
            note_create,
            note_create_untitled,
            template_create,
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
            git_history,
            git_working_changes,
            git_diff_file,
            git_discard_file,
            git_restore_file,
            git_identity_get,
            git_identity_set,
            sync_remote_get,
            sync_remote_set,
            sync_token_set,
            sync_token_has,
            vault_sync,
            workspace_get,
            workspace_set,
            settings_get,
            settings_set,
            close_now,
        ])
        .on_window_event(|window, event| {
            // 点 X 的那一刻，编辑器里最后敲的几个字可能还没落盘（§2.7 的自动
            // 保存是停手 800ms 才发生的），也还没记成版本（§2.8）。窗口一旦
            // 销毁，前端连一个 tick 都没有 —— 所以先拦下来，让它把手里的事
            // 做完，再由 `close_now` 真的关。
            let tauri::WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            let state = window.state::<AppState>();
            // 第二次点 X = 「我知道它在收尾，但我现在就要走」。直接放行，
            // 不然一个卡住的前端就等于一个关不掉的窗口
            if state.closing.swap(true, Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            let _ = window.emit(CLOSING_EVENT, ());
            // 安全网：前端崩了、或者根本没挂上监听（比如白屏），也得能关掉
            let w = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(CLOSE_GRACE);
                let _ = w.destroy();
            });
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
