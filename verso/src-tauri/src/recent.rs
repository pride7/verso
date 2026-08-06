//! 记住打开过的 vault，并保留上次的位置。DESIGN.md §2.1
//!
//! 存在**应用配置目录**而不是 `.verso/` —— `.verso/` 是 per-vault 的 UI 状态，
//! 而「上次打开哪个 vault」是应用级状态，鸡生蛋问题：还没打开 vault 时读不到它。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub last_vault: Option<String>,
    /// 上次打开的笔记（vault 相对路径）。重启后回到原处，
    /// 否则每次启动都要重新找回自己在写的那篇。
    #[serde(default)]
    pub last_note: Option<String>,
    /// 成功打开过的仓库，最近使用的在前。只存路径；名字与可用性每次读取时
    /// 重新算，目录改名/移走后界面才能反映真实情况。
    #[serde(default)]
    pub vaults: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentVault {
    pub root: String,
    pub name: String,
    pub available: bool,
    /// 共享节点创建的独立仓库。由仓库根的可删除标记推断，
    /// 不另存一份会与磁盘事实分叉的应用状态。
    pub shared: bool,
}

fn recent_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("recent.json"))
}

fn same_root(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// 剥掉 Windows 的 `\\?\` 前缀。早期版本把 canonicalize 出来的 verbatim 路径
/// 原样存进了 recent.json，读出来时统一成人话写法 —— 否则欢迎页会显示
/// `\\?\D:\…`，还会和新格式的同一目录并存成两条。
fn plain(root: &str) -> String {
    crate::winpath::for_external(Path::new(root))
        .to_string_lossy()
        .into_owned()
}

/**
 * 旧版只有 `lastVault`。读出来时顺手补进清单；同时去重，避免用户从大小写
 * 不同的路径表示打开同一目录后菜单里长出两条。
 */
fn normalize(mut data: Recent) -> Recent {
    let mut unique: Vec<String> = Vec::new();
    for root in data.vaults {
        let root = plain(&root);
        if !unique.iter().any(|known| same_root(known, &root)) {
            unique.push(root);
        }
    }
    data.last_vault = data.last_vault.map(|last| plain(&last));
    if let Some(last) = data.last_vault.as_ref() {
        if !unique.iter().any(|known| same_root(known, last)) {
            unique.insert(0, last.clone());
        }
    }
    data.vaults = unique;
    data
}

pub fn load(app: &AppHandle) -> Recent {
    recent_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .map(normalize)
        .unwrap_or_default()
}

/// 尽力而为：写不进去不该让打开 vault / 打开笔记这些事失败。
fn store(app: &AppHandle, data: &Recent) {
    let Some(path) = recent_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(data) {
        let _ = std::fs::write(path, json);
    }
}

pub fn save_vault(app: &AppHandle, vault_root: &str) {
    let mut cur = load(app);
    // 换了 vault，上一个 vault 里的笔记路径就没有意义了
    if cur.last_vault.as_deref() != Some(vault_root) {
        cur.last_note = None;
    }
    cur.last_vault = Some(vault_root.to_string());
    cur.vaults.retain(|root| !same_root(root, vault_root));
    cur.vaults.insert(0, vault_root.to_string());
    store(app, &cur);
}

pub fn save_note(app: &AppHandle, note_rel: &str) {
    let mut cur = load(app);
    cur.last_note = Some(note_rel.to_string());
    store(app, &cur);
}

fn name_of(root: &str) -> String {
    Path::new(root)
        .file_name()
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string())
}

pub fn list(app: &AppHandle) -> Vec<RecentVault> {
    load(app)
        .vaults
        .into_iter()
        .map(|root| {
            let path = Path::new(&root);
            let shared = crate::vault::share::is_shared_space(path);
            let name = if shared {
                crate::vault::share::space_info(path)
                    .map(|space| space.name)
                    .unwrap_or_else(|| name_of(&root))
            } else {
                name_of(&root)
            };
            RecentVault {
                name,
                available: path.is_dir(),
                shared,
                root,
            }
        })
        .collect()
}

/// 只忘掉应用配置里的入口，绝不碰那个目录本身。当前项也允许清掉：欢迎页上
/// 上次目录已经失效时，用户必须能把它从列表移除。
pub fn forget(app: &AppHandle, vault_root: &str) {
    let mut cur = load(app);
    cur.vaults.retain(|root| !same_root(root, vault_root));
    if cur
        .last_vault
        .as_deref()
        .is_some_and(|last| same_root(last, vault_root))
    {
        cur.last_vault = None;
        cur.last_note = None;
    }
    store(app, &cur);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_last_vault_is_migrated_into_the_list() {
        let old: Recent = serde_json::from_str(
            r#"{"lastVault":"D:/Notes/research","lastNote":"today.md"}"#,
        )
        .unwrap();
        let data = normalize(old);
        assert_eq!(data.vaults, vec!["D:/Notes/research"]);
        assert_eq!(data.last_note.as_deref(), Some("today.md"));
    }

    #[test]
    fn normalization_keeps_order_and_removes_duplicates() {
        let data = normalize(Recent {
            last_vault: Some("D:/Notes/a".into()),
            last_note: None,
            vaults: vec![
                "D:/Notes/b".into(),
                "D:/Notes/a".into(),
                "D:/Notes/b".into(),
            ],
        });
        assert_eq!(data.vaults, vec!["D:/Notes/b", "D:/Notes/a"]);
    }

    #[test]
    fn name_comes_from_the_last_path_component() {
        assert_eq!(name_of("D:/Notes/research"), "research");
        assert_eq!(name_of("/home/me/notebook"), "notebook");
    }

    /// 早期版本存进去的是 `\\?\D:\…`。读出来必须剥掉前缀，并且和新格式的
    /// 同一目录合并成一条 —— 否则欢迎页一个仓库显示两遍，其中一条还带着前缀
    #[test]
    fn verbatim_windows_paths_are_cleaned_and_deduped() {
        let data = normalize(Recent {
            last_vault: Some(r"\\?\D:\Documents\Verso\xsfeng".into()),
            last_note: Some("today.md".into()),
            vaults: vec![
                r"\\?\D:\Documents\Verso\xsfeng".into(),
                r"D:\Documents\Verso\xsfeng".into(),
                r"\\?\D:\Projects\notebook\test-vault".into(),
            ],
        });
        assert_eq!(
            data.vaults,
            vec![r"D:\Documents\Verso\xsfeng", r"D:\Projects\notebook\test-vault"]
        );
        assert_eq!(data.last_vault.as_deref(), Some(r"D:\Documents\Verso\xsfeng"));
        assert_eq!(data.last_note.as_deref(), Some("today.md"), "笔记路径不该被动");
    }
}
