//! Git 底座。DESIGN.md §2.8
//!
//! M0 只做一件事：新建/打开 vault 时确保它是个 git 仓库，并写好 .gitignore。
//! 成本几乎为零，但省掉了以后要求用户手动补救。完整的 pull/commit/push
//! 与冲突解决在 M5。

use std::path::Path;

use crate::error::Result;

/// `.folio/` 是纯派生数据（索引缓存、UI 状态），删掉能重建，不该进版本库。
const GITIGNORE: &str = "\
# Folio 私有目录：索引缓存与 UI 状态，纯派生数据，删掉可重建
.folio/

.DS_Store
Thumbs.db
";

pub struct GitInitResult {
    pub created_repo: bool,
    pub created_gitignore: bool,
}

/// 幂等：已经是仓库就不动它，已有 .gitignore 也不覆盖
/// （用户可能已经加了自己的规则）。
pub fn ensure_repo(root: &Path) -> Result<GitInitResult> {
    let created_repo = match git2::Repository::open(root) {
        Ok(_) => false,
        Err(_) => {
            git2::Repository::init(root)?;
            true
        }
    };

    let gitignore = root.join(".gitignore");
    let created_gitignore = if gitignore.exists() {
        false
    } else {
        std::fs::write(&gitignore, GITIGNORE)?;
        true
    };

    Ok(GitInitResult {
        created_repo,
        created_gitignore,
    })
}
