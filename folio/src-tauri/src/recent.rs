//! 记住上次打开的 vault。
//!
//! 存在**应用配置目录**而不是 `.folio/` —— `.folio/` 是 per-vault 的 UI 状态，
//! 而「上次打开哪个 vault」是应用级状态，鸡生蛋问题：还没打开 vault 时读不到它。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub last_vault: Option<String>,
}

fn recent_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("recent.json"))
}

pub fn load(app: &AppHandle) -> Recent {
    recent_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 尽力而为：写不进去不该让打开 vault 这件事失败。
pub fn save(app: &AppHandle, vault_root: &str) {
    let Some(path) = recent_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let data = Recent {
        last_vault: Some(vault_root.to_string()),
    };
    if let Ok(json) = serde_json::to_string_pretty(&data) {
        let _ = std::fs::write(path, json);
    }
}
