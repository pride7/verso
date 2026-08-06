//! 每个 vault 的界面状态：打开着哪些标签页、哪个是当前页。DESIGN.md §2.1
//!
//! ## 为什么在 `.verso/` 里，而顺序文件不在
//!
//! 两者看着像，判断标准却把它们分到了两边 —— **丢了要不要紧**：
//!
//! - `.verso-order.json`（手动排序）丢了**重建不出来**：那是用户一个一个拖出来
//!   的意图。所以它在 vault 根、进版本库、跟着同步走。
//! - 标签页丢了只是「下次启动少开几个页签」。它正是铁律第 6 条说的那种
//!   「`.verso/` 整个删掉也能重建」的东西 —— 重建方式就是你再点一次。
//!
//! 而且它是 per-machine 的：两台机器同一个 vault，各自开着什么页签本来就该
//! 各算各的。`.verso/` 在 `.gitignore` 里，这一点自动成立。

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::vault::fs::VaultFs;

/// `.verso/` 下的文件名
const FILE: &str = "workspace.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    /// 打开着的笔记，vault 相对路径，顺序就是标签栏上的顺序
    #[serde(default)]
    pub tabs: Vec<String>,
    /// 当前页在 `tabs` 里的下标
    #[serde(default)]
    pub active: usize,
    /// **前几个是固定的。** 固定不是一个存路径的集合，而是一段下标区间 ——
    /// 「固定的排在最前」这条不变量因此是结构上成立的，见 `src/lib/tabs.ts`
    #[serde(default)]
    pub pinned_count: usize,
}

impl Workspace {
    /// 夹到合法范围。`active` 越界时回到最后一个，而不是报错或清空 ——
    /// 这个文件可能被手改，也可能是上个版本写的
    fn sanitized(mut self) -> Self {
        let old_active = self.active;
        let old_current = self.tabs.get(self.active).cloned();
        let old_pinned = self.pinned_count.min(self.tabs.len());
        self.pinned_count = self
            .tabs
            .iter()
            .take(old_pinned)
            .filter(|path| is_restorable_path(path))
            .count();
        self.tabs.retain(|path| is_restorable_path(path));
        if self.tabs.is_empty() {
            self.active = 0;
        } else if let Some(current) = old_current {
            // 当前页还在时跟着路径走；删掉的是它左边的基础设施标签，也不能
            // 顺手切到另一篇。当前页本身被过滤时则接右边，没有才退到左边。
            self.active = self
                .tabs
                .iter()
                .position(|path| path == &current)
                .unwrap_or_else(|| old_active.min(self.tabs.len() - 1));
        } else {
            self.active = old_active.min(self.tabs.len() - 1);
        }
        self
    }
}

/// 仓库根的 AI 约定文件只应在用户从「AI 协作」明确打开时出现。
/// 它们不是笔记，不能从 workspace / 最近文档里自动复活；子目录同名文件不受影响。
pub(crate) fn is_restorable_path(path: &str) -> bool {
    let path = path.trim();
    !path.is_empty() && path != "AGENTS.md" && path != "CLAUDE.md"
}

fn path(root: &Path) -> std::path::PathBuf {
    root.join(".verso").join(FILE)
}

/// 读。读不出来就当没开过标签 —— 这个文件坏掉不该让 vault 打不开
pub fn load(fs: &dyn VaultFs, root: &Path) -> Workspace {
    fs.read_to_string(&path(root))
        .ok()
        .and_then(|s| serde_json::from_str::<Workspace>(&s).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn save(fs: &dyn VaultFs, root: &Path, ws: &Workspace) -> Result<()> {
    let ws = ws.clone().sanitized();
    let json = serde_json::to_string_pretty(&ws)
        .map_err(|e| crate::error::Error::Vault(format!("工作区状态序列化失败: {e}")))?;
    fs.write_atomic(&path(root), &format!("{json}\n"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::fs::DesktopFs;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("verso-ws-{tag}-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn ws(tabs: &[&str], active: usize) -> Workspace {
        Workspace {
            tabs: tabs.iter().map(|s| s.to_string()).collect(),
            active,
            ..Default::default()
        }
    }

    #[test]
    fn round_trips() {
        let root = tmp("rt");
        let fs = DesktopFs::new();
        let w = ws(&["甲.md", "数学/乙.md"], 1);

        save(&fs, &root, &w).unwrap();
        let back = load(&fs, &root);
        assert_eq!(back.tabs, w.tabs);
        assert_eq!(back.active, 1);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_file_means_no_tabs() {
        let root = tmp("none");
        assert!(load(&DesktopFs::new(), &root).tabs.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn corrupt_file_degrades_instead_of_failing() {
        let root = tmp("bad");
        std::fs::create_dir_all(root.join(".verso")).unwrap();
        std::fs::write(root.join(".verso").join(FILE), "{ 这不是 json").unwrap();
        assert!(load(&DesktopFs::new(), &root).tabs.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    // 这个文件可以手改，也可能是上个版本写的。越界的下标不该让整个 vault
    // 打不开，也不该把用户开着的标签清空
    #[test]
    fn out_of_range_active_falls_back_to_last() {
        assert_eq!(ws(&["甲.md", "乙.md"], 9).sanitized().active, 1);
        assert_eq!(ws(&[], 3).sanitized().active, 0);
    }

    // 上个版本写的文件里没有这个键。少一个键不该让标签全丢
    #[test]
    fn a_file_without_pinned_count_still_loads() {
        let w: Workspace = serde_json::from_str(r#"{"tabs":["甲.md"],"active":0}"#).unwrap();
        assert_eq!(w.pinned_count, 0);
        assert_eq!(w.tabs.len(), 1);
    }

    #[test]
    fn pinned_count_cannot_exceed_the_tabs() {
        let w = Workspace {
            tabs: vec!["甲.md".into()],
            active: 0,
            pinned_count: 9,
        }
        .sanitized();
        assert_eq!(w.pinned_count, 1);
    }

    #[test]
    fn blank_paths_are_dropped() {
        let w = ws(&["甲.md", "  ", "乙.md"], 2).sanitized();
        assert_eq!(w.tabs, vec!["甲.md", "乙.md"]);
        assert_eq!(w.active, 1, "下标要跟着被夹回来");
    }

    #[test]
    fn root_ai_instructions_are_never_restored_as_notes() {
        let w = Workspace {
            tabs: vec![
                "甲.md".into(),
                "AGENTS.md".into(),
                "项目/AGENTS.md".into(),
                "CLAUDE.md".into(),
                "乙.md".into(),
            ],
            active: 1,
            pinned_count: 4,
        }
        .sanitized();

        assert_eq!(w.tabs, vec!["甲.md", "项目/AGENTS.md", "乙.md"]);
        assert_eq!(w.active, 1, "当前基础设施页被过滤后，应接到右边那篇");
        assert_eq!(w.pinned_count, 2, "固定数量也要扣掉被过滤的两项");
    }

    #[test]
    fn filtering_an_earlier_ai_tab_keeps_the_same_current_note() {
        let w = Workspace {
            tabs: vec!["AGENTS.md".into(), "甲.md".into(), "乙.md".into()],
            active: 2,
            pinned_count: 0,
        }
        .sanitized();

        assert_eq!(w.tabs, vec!["甲.md", "乙.md"]);
        assert_eq!(w.active, 1);
        assert_eq!(w.tabs[w.active], "乙.md");
    }
}
